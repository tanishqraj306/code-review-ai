import os
import requests
import redis
import json
import time
import shutil
import git
import subprocess
import glob
import re
import google.generativeai as genai
from pymongo import MongoClient
from dotenv import load_dotenv
from github import Github
from unidiff import PatchSet
from datetime import datetime

# Configuration & Clients
load_dotenv()
GITHUB_PAT = os.getenv("GITHUB_PAT")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
MONGO_ATLAS_URI = os.getenv("MONGO_ATLAS_URI")
PR_QUEUE_NAME = "pr_queue"
CLONE_DIR = "/tmp/repos"

gh_client = Github(GITHUB_PAT)
print("Analysis worker started...")
genai.configure(api_key=GEMINI_API_KEY)
ai_model = genai.GenerativeModel("gemini-flash-latest")
print("Successfully connected to Github and Google AI!")


# Connect to MongoDB
print("Connecting to MongoDB")
mongo_client = MongoClient(MONGO_ATLAS_URI)
db = mongo_client["code-reviewer-ai-db"]
reviews_collection = db["reviews"]
print("Connected to MongoDB")


def connect_to_redis():
    """Attempt to connect to Redis, with retries."""
    while True:
        try:
            r = redis.Redis.from_url(REDIS_URL, decode_responses=True)
            r.ping()
            print("Successfully connected to Redis!")
            return r
        except redis.exceptions.ConnectionError as e:
            print(f"Redis connection failed: {e}. Retrying in 5 seconds...")
            time.sleep(5)


def parse_diff_to_get_added_lines(diff_text):
    """Parses a diff and returns a dictionary mapping filenames to added line numbers."""
    patch_set = PatchSet(diff_text)
    added_lines = {}
    for patched_file in patch_set:
        filename = patched_file.path
        lines_in_file = set()
        for hunk in patched_file:
            for line in hunk:
                if line.is_added:
                    lines_in_file.add(line.target_line_no)
        if lines_in_file:
            added_lines[filename] = lines_in_file
    return added_lines


def detect_language(changed_files):
    """Detects the primary language of a repository."""
    print(f"Detecting language from {len(changed_files)} changed files...")
    language_counts = {"python": 0, "c": 0, "javascript": 0}

    for file_path in changed_files:
        if file_path.endswith(".py"):
            language_counts["python"] += 1
        elif file_path.endswith(("c", ".cpp", ".h", ".hpp")):
            language_counts["c"] += 1
        elif file_path.endswith((".js", ".jsx", ".ts", ".tsx")):
            language_counts["javascript"] += 1

    if not language_counts or max(language_counts.values()) == 0:
        return "unknown"

    primary_language = max(language_counts, key=language_counts.get)
    print(f"Detection complete: {language_counts}")
    return primary_language


def install_python_dependencies(repo_path):
    """
    Recursively finds all 'requirements.txt' files and installs them.
    """
    print("Searching for Python dependencies...")
    found_requirements = False
    for root, _, files in os.walk(repo_path):
        if "requirements.txt" in files:
            requirements_file = os.path.join(root, "requirements.txt")
            print(f"Found dependencies file: {requirements_file}. Installing...")
            found_requirements = True
            try:
                subprocess.run(
                    ["pip", "install", "-r", requirements_file],
                    check=True,
                    capture_output=True,
                    text=True,
                )
                print(f"Successfully installed dependencies from {requirements_file}.")
            except subprocess.CalledProcessError as e:
                print(
                    f"Failed to install dependencies from {requirements_file}: {e.stderr}"
                )

    if not found_requirements:
        print("No requirements.txt found anywhere in the repository.")


def run_pyright_analysis(repo_path):
    """Executes the Pyright language server on the given path"""
    print("Starting Pyright analysis...")
    try:
        command = ["pyright", "--outputjson", repo_path]
        result = subprocess.run(command, capture_output=True, text=True, check=True)

        pyright_output = json.loads(result.stdout)
        diagnostics = pyright_output.get("generalDiagnostics", [])

        print(f"Pyright analysis complete. Found {len(diagnostics)} diagnostics.")
        return diagnostics
    except subprocess.CalledProcessError as e:
        print(f"Pyright execution failed: {e}")
        print(f"Stderr: {e.stderr}")
        return []
    except json.JSONDecodeError:
        print("Failed to parse Pyright JSON output.")
        return []


def parse_clang_tidy_output(output_text, repo_path):
    """Parses the raw text output of clang-tidy into our standard diagnostic format."""
    diagnostics = []
    pattern = re.compile(r"(.+?):(\d+):(\d+):\s+(warning|error):\s+(.+?)\s+\[(.+?)\]")

    for line in output_text.splitlines():
        match = pattern.match(line)
        if match:
            file_path, line_num, _, severity, message, rule = match.groups()

            diagnostics.append(
                {
                    "file": os.path.join(repo_path, file_path),
                    "range": {"start": {"line": int(line_num) - 1, "character": 0}},
                    "message": message.strip(),
                    "severity": severity.upper(),
                    "rule": rule.strip(),
                }
            )
    return diagnostics


def run_clang_tidy_analysis(repo_path):
    """Finds all C/C++ files in a project and runs clang-tidy on them."""
    print("Starting clang-tidy analysis on the full project...")

    search_path = os.path.join(repo_path, "**")
    files_to_check = [
        f
        for ext in ("*.c", "*.cpp", "*.h", "*.hpp")
        for f in glob.glob(os.path.join(search_path, ext), recursive=True)
    ]

    if not files_to_check:
        print("No C/C++ files found to analyze.")
        return []

    print(f"Found {len(files_to_check)} C/C++ files to analyze.")
    try:
        command = ["clang-tidy"] + files_to_check
        result = subprocess.run(command, capture_output=True, text=True)

        print("Clang-tidy analysis complete. Parsing output...")
        diagnostics = parse_clang_tidy_output(result.stdout, repo_path)
        print(f"Parsed {len(diagnostics)} total diagnostics from clang-tidy.")
        return diagnostics

    except Exception as e:
        print(f"Failed to run clang-tidy: {e}")
        return []


def install_node_dependencies(repo_path):
    """Installs Node dependencies if package.json exists."""
    print("Checking for Node.js dependencies...")
    package_json = os.path.join(repo_path, "package.json")

    if os.path.exists(package_json):
        print("Found package.json. Installing dependencies...")

        try:
            subprocess.run(
                ["npm", "install", "--ignore-scripts", "--legacy-peer-deps"],
                cwd=repo_path,
                check=True,
                capture_output=True,
                text=True,
            )
            print("Node dependencies installed.")
        except subprocess.CalledProcessError as e:
            print(f"Failed to install Node dependencies: {e.stderr}")
    else:
        print("No package.json found. Skipping npm install.")


def parse_eslint_output(json_output, repo_path):
    """Parse ESLint JSON output info standard diagnostics."""
    diagnostics = []
    try:
        results = json.loads(json_output)
        for file_result in results:
            file_path = file_result.get("filePath", "")
            for message in file_result.get("mesages", []):
                diagnostics.append(
                    {
                        "file": file_path,
                        "range": {
                            "start": {
                                "line": message.get("line", 1) - 1,
                                "character": message.get("column", 1),
                            }
                        },
                        "message": message.get("message"),
                        "severity": "ERROR"
                        if message.get("severity") == 2
                        else "WARNING",
                        "rule": message.get("ruleId", "unknown"),
                    }
                )
    except json.JSONDecodeError:
        print("Failed to parse ESLint JSON.")
    return diagnostics


def run_eslint_analysis(repo_path):
    """Runs ESLint on the repository."""

    print("Starting ESLint analysis...")
    try:
        command = ["npx", "eslint", ".", "--format", "json"]

        result = subprocess.run(command, cwd=repo_path, capture_output=True, text=True)

        if result.stdout:
            print("ESLint analysis complete. Parsing output...")
            return parse_eslint_output(result.stdout, repo_path)
        else:
            print(f"ESLint produced no output. Stderr: {result.stderr}")
            return []

    except Exception as e:
        print(f"Failed to run ESLint: {e}")
        return []


def format_comment_with_ai(diagnostics, diff_text):
    """Uses an AI to format LSP diagnostic and review code for logic errors."""
    print("Formatting comment with AI using full code context...")

    diag_summary = "No specific type or syntax errors were found by the linter."
    if diagnostics:
        diag_list = []
        for diag in diagnostics:
            message = diag.get("message", "No message provided.")
            rule = diag.get("rule", "general")
            diag_list.append(f"- Rule `{rule}`: {message}")
        diag_summary = (
            "A static analysis tool found the following specific issues:\n"
            + "\n".join(diag_list)
        )

    max_diff_length = 4000
    if len(diff_text) > max_diff_length:
        diff_text = diff_text[:max_diff_length] + "\n\n (diff truncated due to length)"

    prompt = f"""
    ou are an expert, friendly, and encouraging code reviewer bot. Your goal is to help developers improve their code.

    A pull request was submitted with the following changes (in diff format):
    --- CODE DIFF ---
    {diff_text}
    --- END CODE DIFF ---

    {diag_summary}

    Please provide a single, concise, and helpful review comment for the pull request. Your comment should:
    1. Start with a positive and encouraging sentence.
    2. If there were specific linter issues, briefly and gently explain them.
    3. Review the provided code diff for potential logic errors, unclear code, performance improvements, or violations of best practices.
    4. Phrase everything as a helpful suggestion, not a demand. Use a humble and collaborative tone.
    5. Do not use markdown headers. Structure your feedback as a single, easy-to-read comment.
    """

    try:
        response = ai_model.generate_content(prompt)
        return response.text

    except Exception as e:
        print(f"AI comment generation failed: {e}")
        return "I found a few potential issues, but I had trouble summarizing them. Please check the logs for details."


def post_review_comment(pr, diagnostics, ai_comment, repo_path):
    """Posts a single review comment to a pull request."""
    if not ai_comment:
        return

    if diagnostics:
        first_diag = diagnostics[0]
        file_path = os.path.relpath(first_diag.get("file"), repo_path)
        line_number = first_diag.get("range", {}).get("start", {}).get("line") + 1

        print(f"Posting in-line comment to {file_path} at line {line_number}...")
        try:
            latest_commit = pr.get_commits().reversed[0]
            pr.create_review_comment(
                body=ai_comment,
                commit=latest_commit,
                path=file_path,
                line=line_number,
            )
            print("Successfully posted in-line comment to Github.")
        except Exception as e:
            print(f"Failed to post in-line comment to Github: {e}")
    else:
        print("Posting general comment on the PR...")
        try:
            pr.create_issue_comment(ai_comment)
            print("Successfully posted general comment to Github.")
        except Exception as e:
            print(f"Failed to post general comment to Github: {e}")


def save_analysis_result(repo_name, pr_number, diagnostics, ai_comment, language):
    try:
        repos = list(db.repositories.find({"full_name": repo_name}))

        if not repos:
            print(f"Warning: No users found monitoring {repo_name}. Review not saved.")
            return

        for repo in repos:
            user_id = repo.get("userId")

            review_record = {
                "userId": user_id,
                "repo_name": repo_name,
                "pr_number": pr_number,
                "language": language,
                "issues_found": len(diagnostics),
                "ai_comment": ai_comment,
                "analyzed_at": datetime.utcnow(),
            }
            reviews_collection.insert_one(review_record)
            print(f"Saved analysis result for {repo_name} PR #{pr_number} to MongoDB.")

    except Exception as e:
        print(f"Failed to save analysis result to MongoDB: {e}")


def main():
    """Main worker loop to process jobs from the Redis queue."""
    redis_client = connect_to_redis()
    print(f'Worker is listening for jobs on queue: "{PR_QUEUE_NAME}"')
    while True:
        repo_path = None
        try:
            _, job_json = redis_client.brpop(PR_QUEUE_NAME, 0)
            job_data = json.loads(job_json)

            print("\n--- ✅ Job Received ---")

            if "payload" in job_data:
                payload = job_data["payload"]
            else:
                payload = job_data

            repo_data = payload.get("repository", [])
            repo_name = repo_data.get("full_name")
            clone_url = repo_data.get("clone_url")
            pr_number = payload.get("number")

            if not all([repo_name, clone_url, pr_number]):
                print("Payload missing required data.")
                continue

            print(f"Processing PR #{pr_number} from {repo_name}")

            repo = gh_client.get_repo(repo_name)
            pr = repo.get_pull(pr_number)

            diff_response = requests.get(pr.diff_url)
            diff_response.raise_for_status()
            diff_text = diff_response.text
            added_lines_map = parse_diff_to_get_added_lines(diff_response.text)
            changed_files = list(added_lines_map.keys())

            language = detect_language(changed_files)
            print(f"Detected primary language of PR:{language}")

            # Clone repo and install dependencies
            repo_path = os.path.join(
                CLONE_DIR, repo_name.replace("/", "_"), str(pr_number)
            )
            auth_clone_url = clone_url.replace(
                "https://", f"https://oauth2:{GITHUB_PAT}@"
            )
            print(f"Cloning default branch of {repo_name}...")
            cloned_repo = git.Repo.clone_from(auth_clone_url, repo_path)
            pr_refspec = f"refs/pull/{pr_number}/head"
            local_pr_branch = f"pr-{pr_number}"
            print(f"Fetching PR refspec: {pr_refspec}...")
            cloned_repo.git.fetch("origin", f"{pr_refspec}:{local_pr_branch}")
            cloned_repo.git.checkout(local_pr_branch)
            print(f"Successfully checked out code for PR #{pr_number}")

            # Filter diagnostics and run LSP
            relevant_diagnostics = []
            if language == "python":
                install_python_dependencies(repo_path)
                diagnostics = run_pyright_analysis(repo_path)
                for diag in diagnostics:
                    file_path = diag.get("file")
                    if file_path.startswith(repo_path):
                        relative_path = os.path.relpath(file_path, repo_path)
                        start_line = diag.get("range", {}).get("start", {}).get("line")

                        if relative_path in added_lines_map:
                            if (start_line + 1) in added_lines_map[relative_path]:
                                relevant_diagnostics.append(diag)
            elif language == "c":
                diagnostics = run_clang_tidy_analysis(repo_path)
                for diag in diagnostics:
                    file_path = diag.get("file", "")
                    if file_path.startswith(repo_path):
                        relative_path = os.path.relpath(file_path, repo_path)
                        start_line = diag.get("range", {}).get("start", {}).get("line")

                        if relative_path in added_lines_map:
                            if (start_line + 1) in added_lines_map[relative_path]:
                                relevant_diagnostics.append(diag)

            elif language == "javascript":
                install_node_dependencies(repo_path)
                diagnostics = run_eslint_analysis(repo_path)

                for diag in diagnostics:
                    file_path = diag.get("file", "")
                    if file_path.startswith(repo_path):
                        relative_path = os.path.relpath(file_path, repo_path)
                        start_line = diag.get("range", {}).get("start", {}).get("line")
                        if relative_path in added_lines_map:
                            if (start_line + 1) in added_lines_map[relative_path]:
                                relevant_diagnostics.append(diag)

            print(
                f"Found {len(relevant_diagnostics)} relevant diagnostics on new lines."
            )

            if relevant_diagnostics or diff_text:
                ai_comment = format_comment_with_ai(relevant_diagnostics, diff_text)
                post_review_comment(pr, relevant_diagnostics, ai_comment, repo_path)

                save_analysis_result(
                    repo_name, pr_number, relevant_diagnostics, ai_comment, language
                )

            print("--- Job Complete ---\n")

        except Exception as e:
            print(f"An error occurred: {e}")
            time.sleep(5)
            if not redis_client.ping():
                print("Redis connection lost. Reconnecting...")
                redis_client = connect_to_redis()
        finally:
            if repo_path and os.path.exists(repo_path):
                print(f"Cleaning up directory: {repo_path}")
                shutil.rmtree(repo_path)


if __name__ == "__main__":
    main()
