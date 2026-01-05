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
from bson.objectid import ObjectId

load_dotenv()

GITHUB_PAT = os.getenv("GITHUB_PAT")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
MONGO_ATLAS_URI = os.getenv("MONGO_ATLAS_URI")
PR_QUEUE_NAME = "pr_queue"
CLONE_DIR = "/tmp/repos"

gh_client = Github(GITHUB_PAT)
genai.configure(api_key=GEMINI_API_KEY)
ai_model = genai.GenerativeModel("gemini-2.5-flash")
print("Analysis worker started...")
print("Successfully connected to Github and Google AI!")

print("Connecting to MongoDB...")
mongo_client = MongoClient(MONGO_ATLAS_URI)
db = mongo_client["code-reviewer-ai-db"]
reviews_collection = db["reviews"]
repositories_collection = db["repositories"]
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
    print(f"Detection complete: {primary_language}")
    return primary_language


def setup_virtual_env(repo_path):
    """
    Creates a dedicated virtual environment for the repository.
    Returns the path to the python and pip executables inside the venv.
    """
    venv_path = os.path.join(repo_path, "venv")
    if not os.path.exists(venv_path):
        print(f"Creating virtual environment at {venv_path}...")
        subprocess.run(["python", "-m", "venv", venv_path], check=True)
    
    bin_dir = os.path.join(venv_path, "bin")
    return os.path.join(bin_dir, "python"), os.path.join(bin_dir, "pip")

def install_python_dependencies(repo_path, pip_exe):
    """
    Installs requirements.txt using the ISOLATED venv pip executable.
    """
    print("Searching for Python dependencies...")
    found_requirements = False
    for root, _, files in os.walk(repo_path):
        if "requirements.txt" in files:
            if "venv" in root:
                continue

            requirements_file = os.path.join(root, "requirements.txt")
            print(f"Found dependencies file: {requirements_file}. Installing...")
            found_requirements = True
            try:
                subprocess.run(
                    [pip_exe, "install", "-r", requirements_file],
                    check=True,
                    capture_output=True,
                    text=True,
                )
                print(f"Successfully installed dependencies from {requirements_file}.")
            except subprocess.CalledProcessError as e:
                print(f"Failed to install dependencies: {e.stderr}")

    if not found_requirements:
        print("No requirements.txt found. Skipping install.")

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


def run_pyright_analysis(repo_path):
    """Executes Pyright."""
    print("Starting Pyright analysis...")
    try:
        command = ["pyright", "--outputjson", repo_path]
        result = subprocess.run(command, capture_output=True, text=True, check=False)

        try:
            pyright_output = json.loads(result.stdout)
            diagnostics = pyright_output.get("generalDiagnostics", [])
            print(f"Pyright analysis complete. Found {len(diagnostics)} diagnostics.")
            return diagnostics
        except json.JSONDecodeError:
            print("Failed to parse Pyright JSON output.")
            return []

    except FileNotFoundError:
        print("Pyright executable not found. Ensure it is installed in Dockerfile.")
        return []

def run_clang_tidy_analysis(repo_path):
    """Finds C/C++ files and runs clang-tidy."""
    print("Starting clang-tidy analysis...")
    search_path = os.path.join(repo_path, "**")
    files_to_check = [
        f for ext in ("*.c", "*.cpp", "*.h", "*.hpp")
        for f in glob.glob(os.path.join(search_path, ext), recursive=True)
    ]

    if not files_to_check:
        return []

    try:
        command = ["clang-tidy"] + files_to_check
        result = subprocess.run(command, capture_output=True, text=True)
        return parse_clang_tidy_output(result.stdout, repo_path)
    except Exception as e:
        print(f"Failed to run clang-tidy: {e}")
        return []

def parse_clang_tidy_output(output_text, repo_path):
    diagnostics = []
    pattern = re.compile(r"(.+?):(\d+):(\d+):\s+(warning|error):\s+(.+?)\s+\[(.+?)\]")
    for line in output_text.splitlines():
        match = pattern.match(line)
        if match:
            file_path, line_num, _, severity, message, rule = match.groups()
            diagnostics.append({
                "file": os.path.join(repo_path, file_path) if not file_path.startswith("/") else file_path,
                "range": {"start": {"line": int(line_num) - 1, "character": 0}},
                "message": message.strip(),
                "severity": severity.upper(),
                "rule": rule.strip(),
            })
    return diagnostics

def run_eslint_analysis(repo_path):
    print("Starting ESLint analysis...")
    try:
        command = ["npx", "eslint", ".", "--format", "json"]
        result = subprocess.run(command, cwd=repo_path, capture_output=True, text=True, check=False)

        if result.stdout:
            try:
                results = json.loads(result.stdout)
                diagnostics = []
                for file_result in results:
                    file_path = file_result.get("filePath", "")
                    for message in file_result.get("messages", []):
                        diagnostics.append({
                            "file": file_path,
                            "range": {"start": {"line": message.get("line", 1) - 1, "character": message.get("column", 1)}},
                            "message": message.get("message"),
                            "severity": "ERROR" if message.get("severity") == 2 else "WARNING",
                            "rule": message.get("ruleId", "unknown"),
                        })
                return diagnostics
            except json.JSONDecodeError:
                return []
        return []
    except Exception as e:
        print(f"Failed to run ESLint: {e}")
        return []


def analyze_repository_summary(repo_id, repo_name, clone_url):
    """Generates a summary for the repository (triggered manually or on first add)."""
    print(f"Starting repository summary analysis for {repo_name}...")
    repo_path = os.path.join(CLONE_DIR, repo_name.replace("/", "_"), "analysis")

    try:
        auth_clone_url = clone_url.replace("https://", f"https://oauth2:{GITHUB_PAT}@")
        if os.path.exists(repo_path):
            shutil.rmtree(repo_path)
            
        git.Repo.clone_from(auth_clone_url, repo_path)
        
        # Simple file structure extraction
        file_structure = []
        readme_content = "No README found."
        
        if os.path.exists(os.path.join(repo_path, "README.md")):
            with open(os.path.join(repo_path, "README.md"), "r", errors="ignore") as f:
                readme_content = f.read()[:3000]

        for root, dirs, files in os.walk(repo_path):
            if ".git" in root: continue
            level = root.replace(repo_path, "").count(os.sep)
            if level < 2:
                indent = " " * 4 * level
                file_structure.append(f"{indent}{os.path.basename(root)}/")
                for f in files[:5]:
                    file_structure.append(f"{indent}    {f}")

        prompt = f"""
        Analyze this codebase and provide a summary.
        Project: {repo_name}
        Structure:
        {chr(10).join(file_structure)}
        README:
        {readme_content}
        
        Return JSON format: {{ "summary": "...", "tech_stack": ["..."], "key_features": ["..."] }}
        """
        
        response = ai_model.generate_content(prompt)
        # Basic cleanup of response to ensure JSON
        text = response.text.replace("```json", "").replace("```", "")
        
        repositories_collection.update_one(
            {"_id": ObjectId(repo_id)},
            {"$set": {"ai_description": text, "last_analyzed_at": datetime.utcnow()}}
        )
        print("Repository summary updated.")
    except Exception as e:
        print(f"Repo summary failed: {e}")
    finally:
        if os.path.exists(repo_path):
            shutil.rmtree(repo_path)

def format_comment_with_ai(diagnostics, diff_text):
    """Uses AI to review the logic/security of the diff."""
    print("Formatting AI review...")

    diag_summary = "No syntax errors found."
    if diagnostics:
        diag_summary = "Linter Errors Found:\n" + "\n".join(
            [f"- {d.get('file').split('/')[-1]}:{d['range']['start']['line']} : {d['message']}" for d in diagnostics[:5]]
        )

    # Truncate diff to fit context window
    diff_text = diff_text[:10000] 

    prompt = f"""
    You are a Senior Code Reviewer. Review this Pull Request.
    
    CONTEXT:
    {diag_summary}
    
    CODE DIFF:
    {diff_text}
    
    INSTRUCTIONS:
    1. Ignore syntax errors (the linter handles those).
    2. Focus on: Security Vulnerabilities, Logic Bugs, Performance Issues, and Code Readability.
    3. Be kind, constructive, and concise.
    4. Format your response in Markdown. Start with a header "## 🤖 AI Review Analysis".
    """
    
    try:
        response = ai_model.generate_content(prompt)
        return response.text
    except Exception as e:
        print(f"AI Generation failed: {e}")
        return "I encountered an error generating the AI review. Please check logs."

def post_review_comment(pr, diagnostics, ai_comment, repo_path):
    """
    1. Posts specific Linter errors as INLINE comments.
    2. Posts the AI Analysis as a GENERAL comment.
    """
    latest_commit = pr.get_commits().reversed[0]
    
    # 1. Post Inline Linter Comments (Max 10 to avoid spam/rate limits)
    posted_count = 0
    for diag in diagnostics:
        if posted_count >= 10:
            break
            
        try:
            file_path = os.path.relpath(diag.get("file"), repo_path)
            line_number = diag.get("range", {}).get("start", {}).get("line") + 1
            
            body = f"**{diag['severity']}**: {diag['message']}\n*Rule: {diag['rule']}*"
            
            # Note: create_review_comment requires the 'path' to be relative to repo root
            pr.create_review_comment(
                body=body,
                commit=latest_commit,
                path=file_path,
                line=line_number
            )
            posted_count += 1
            time.sleep(0.5) # Slight delay to be nice to GitHub API
        except Exception as e:
            print(f"Skipping inline comment (often due to line outside diff context): {e}")

    # 2. Post General AI Comment
    if ai_comment:
        try:
            pr.create_issue_comment(ai_comment)
            print("Posted AI General Review.")
        except Exception as e:
            print(f"Failed to post general comment: {e}")

def save_analysis_result(repo_name, pr_number, diagnostics, ai_comment, language):
    try:
        # Find repo to get user_id (assuming one repo per user for simplicity, or adapt logic)
        repo_doc = repositories_collection.find_one({"full_name": repo_name})
        user_id = repo_doc.get("userId") if repo_doc else None

        review_record = {
            "userId": user_id,
            "repo_name": repo_name,
            "pr_number": pr_number,
            "language": language,
            "issues_count": len(diagnostics),
            "ai_comment": ai_comment,
            "analyzed_at": datetime.utcnow(),
        }
        reviews_collection.insert_one(review_record)
        print("Analysis saved to MongoDB.")
    except Exception as e:
        print(f"DB Save failed: {e}")

# --- Main Worker Loop ---

def main():
    redis_client = connect_to_redis()
    print(f'Worker listening on "{PR_QUEUE_NAME}"...')
    
    while True:
        repo_path = None
        try:
            # Blocking pop
            _, job_json = redis_client.brpop(PR_QUEUE_NAME, 0)
            job_data = json.loads(job_json)
            
            print(f"\n--- Job Received: {job_data.get('event_type', 'unknown')} ---")
            
            # Handle Manual Repo Analysis (Summary)
            if job_data.get("event_type") == "repository_analysis":
                payload = job_data.get("payload", {})
                analyze_repository_summary(
                    payload.get("repo_id"), 
                    payload.get("repo_name"), 
                    payload.get("clone_url")
                )
                continue

            # Handle Pull Requests
            payload = job_data.get("payload", job_data) # Handle nested or flat payload
            
            # Basic Validation
            if "repository" not in payload or "pull_request" not in payload:
                # Support direct payload structure vs github webhook structure
                repo_data = payload.get("repository", {})
                pr_number = payload.get("number")
            else:
                # GitHub Webhook standard structure
                repo_data = payload["repository"]
                pr_number = payload["pull_request"]["number"]

            repo_name = repo_data.get("full_name")
            clone_url = repo_data.get("clone_url")

            if not repo_name or not pr_number:
                print("Invalid Payload Structure.")
                continue

            print(f"Processing PR #{pr_number} for {repo_name}")
            
            # Github API Fetch
            repo = gh_client.get_repo(repo_name)
            pr = repo.get_pull(pr_number)
            
            # Get Diff
            diff_response = requests.get(pr.diff_url)
            diff_text = diff_response.text
            added_lines_map = parse_diff_to_get_added_lines(diff_text)
            changed_files = list(added_lines_map.keys())
            
            language = detect_language(changed_files)
            
            # Setup Paths
            repo_path = os.path.join(CLONE_DIR, repo_name.replace("/", "_"), str(pr_number))
            
            # Clone
            auth_clone_url = clone_url.replace("https://", f"https://oauth2:{GITHUB_PAT}@")
            if os.path.exists(repo_path): shutil.rmtree(repo_path)
            
            git.Repo.clone_from(auth_clone_url, repo_path)
            
            # Checkout PR
            repo_git = git.Git(repo_path)
            repo_git.fetch("origin", f"pull/{pr_number}/head:pr-{pr_number}")
            repo_git.checkout(f"pr-{pr_number}")
            
            # Run Analysis based on Language
            relevant_diagnostics = []
            
            if language == "python":
                # Create VENV and Install Deps
                python_exe, pip_exe = setup_virtual_env(repo_path)
                install_python_dependencies(repo_path, pip_exe)
                
                # Run Analysis
                diagnostics = run_pyright_analysis(repo_path)
                
                # Filter results to changed lines only
                for diag in diagnostics:
                    fpath = diag.get("file", "")
                    rel_path = os.path.relpath(fpath, repo_path)
                    line = diag.get("range", {}).get("start", {}).get("line") + 1
                    
                    if rel_path in added_lines_map and line in added_lines_map[rel_path]:
                        relevant_diagnostics.append(diag)

            elif language == "javascript":
                install_node_dependencies(repo_path)
                diagnostics = run_eslint_analysis(repo_path)
                for diag in diagnostics:
                    fpath = diag.get("file", "")
                    rel_path = os.path.relpath(fpath, repo_path) if fpath.startswith("/") else fpath
                    line = diag.get("range", {}).get("start", {}).get("line") + 1
                    
                    if rel_path in added_lines_map and line in added_lines_map[rel_path]:
                        relevant_diagnostics.append(diag)
            
            # Post Results
            print(f"Found {len(relevant_diagnostics)} relevant linter issues.")
            
            ai_comment = format_comment_with_ai(relevant_diagnostics, diff_text)
            post_review_comment(pr, relevant_diagnostics, ai_comment, repo_path)
            save_analysis_result(repo_name, pr_number, relevant_diagnostics, ai_comment, language)
            
            print("--- Job Complete ---")

        except Exception as e:
            print(f"Critical Worker Error: {e}")
            time.sleep(1) # Prevent tight loop on error
        finally:
            if repo_path and os.path.exists(repo_path):
                print("Cleaning up...")
                shutil.rmtree(repo_path)

if __name__ == "__main__":
    main()
