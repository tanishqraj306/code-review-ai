import os
import requests
import redis
import json
import time
import shutil
import git
import subprocess
import google.generativeai as genai
from dotenv import load_dotenv
from github import Github
from unidiff import PatchSet

load_dotenv()

GITHUB_PAT = os.getenv("GITHUB_PAT")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
PR_QUEUE_NAME = "pr_queue"
CLONE_DIR = "/tmp/repos"

gh_client = Github(GITHUB_PAT)
print("Analysis worker started...")
genai.configure(api_key=GEMINI_API_KEY)
ai_model = genai.GenerativeModel("gemini-1.5-flash")
print("Successfully connected to Github and Google AI!")


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


def install_dependencies(repo_path):
    """Checks for and installs dependencies from requirements.txt."""
    print("Checking for dependencies...")
    requirements_file = os.path.join(repo_path, "requirements.txt")

    if os.path.exists(requirements_file):
        print("Found requirements.txt. Installing dependencies...")
        try:
            subprocess.run(
                ["pip", "install", "-r", requirements_file],
                check=True,
                capture_output=True,
                text=True,
            )
            print("Dependencies installed successfully.")
        except subprocess.CalledProcessError as e:
            print(f"Failed to install dependencies: {e.stderr}")
    else:
        print(
            "No requirements.txt file found in root. Skipping dependency installation."
        )


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
                commit_id=latest_commit,
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

            payload = job_data.get("payload", {})
            repo_data = payload.get("repository", {})

            repo_name = repo_data.get("full_name")
            clone_url = repo_data.get("clone_url")
            pr_number = payload.get("number")

            if not all([repo_name, clone_url, pr_number]):
                print("Payload missing required data.")
                continue

            print(f"Processing PR #{pr_number} from {repo_name}")

            repo = gh_client.get_repo(repo_name)
            pr = repo.get_pull(pr_number)

            # Get PR diff and parse it
            diff_response = requests.get(pr.diff_url)
            diff_response.raise_for_status()
            diff_text = diff_response.text
            added_lines_map = parse_diff_to_get_added_lines(diff_response.text)
            print(f"Found added lines in {len(added_lines_map)} files.")

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
            install_dependencies(repo_path)

            # Run LSP analysis
            diagnostics = run_pyright_analysis(repo_path)

            # Filter diagnostics to only those on new lines
            relevant_diagnostics = []
            for diag in diagnostics:
                file_path = diag.get("file")
                if file_path.startswith(repo_path):
                    relative_path = os.path.relpath(file_path, repo_path)
                    start_line = diag.get("range", {}).get("start", {}).get("line")

                    if relative_path in added_lines_map:
                        if (start_line + 1) in added_lines_map[relative_path]:
                            relevant_diagnostics.append(diag)
            print(
                f"Found {len(relevant_diagnostics)} relevant diagnostics on new lines."
            )
            if relevant_diagnostics:
                print("Relevant diagnostics:")
                print(json.dumps(relevant_diagnostics, indent=2))

            if relevant_diagnostics or diff_text:
                ai_comment = format_comment_with_ai(relevant_diagnostics, diff_text)
                post_review_comment(pr, relevant_diagnostics, ai_comment, repo_path)

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
