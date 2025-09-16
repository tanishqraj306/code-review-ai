import os
import requests
import redis
import json
import time
import shutil
import git
import subprocess
from dotenv import load_dotenv
from github import Github
from unidiff import PatchSet

load_dotenv()

GITHUB_PAT = os.getenv("GITHUB_PAT")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
PR_QUEUE_NAME = "pr_queue"
CLONE_DIR = "/tmp/repos"

gh_client = Github(GITHUB_PAT)
print("Analysis worker started...")


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

        pyright_output = json.loads(results.stdout)
        diagnostics = pyright_output.get("generalDiagnostics", [])

        print(f"Pyright analysis complete. Found {len(diagnostics)} diagnostics.")
        return diagnostics
    except subprocess.CalledProcessError as e:
        print(f"Pyright execution failed: {e}")
        print(f"Stderr: {e.stderr}")
        return []
    except json.json.JSONDecodeError:
        print("Failed to parse Pyright JSON output.")
        return []


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
            pr_data = payload.get("pull_request", {})
            repo_data = payload.get("repository", {})

            repo_name = repo_data.get("full_name")
            clone_url = repo_data.get("clone_url")
            pr_branch = pr_data.get("head", {}).get("ref")
            pr_number = payload.get("number")

            if not all([repo_name, clone_url, pr_branch, pr_number]):
                print(
                    "Payload missing required data (repo_name, clone_url, pr_branch, pr_number)."
                )
                continue

            print(f"Processing PR #{pr_number} from {repo_name} (branch: {pr_branch})")

            repo = gh_client.get_repo(repo_name)
            pr = repo.get_pull(pr_number)

            # Get PR diff and parse it
            diff_response = requests.get(pr.diff_url)
            diff_response.raise_for_status()
            added_lines_map = parse_diff_to_get_added_lines(diff_response.text)
            print(f"Found added lines in {len(added_lines_map)} files.")

            # Clone repo and install dependencies
            repo_path = os.path.join(
                CLONE_DIR, repo_name.replace("/", "_"), str(pr_number)
            )
            auth_clone_url = clone_url.replace(
                "https://", f"https://oauth2:{GITHUB_PAT}@"
            )
            print(f"Cloning {repo_name} into {repo_path}...")
            git.Repo.clone_from(auth_clone_url, repo_path, branch=pr_branch)
            print("Repository cloned successfully.")
            install_dependencies(repo_path)

            # Run LSP analysis
            diagnostics = run_pyright_analysis(repo_path)

            # Filter diagnostics to only those on new lines
            relevant_diagnostics = []
            for diag in diagnostics:
                file_path = diag.get("file")
                start_line = diag.get("range", {}).get("start", {}).get("line")

                if file_path in added_lines_map:
                    if (start_line + 1) in added_lines_map[file_path]:
                        relevant_diagnostics.append(diag)
            print(
                f"Found {len(relevant_diagnostics)} relevant diagnostics on new lines."
            )
            if relevant_diagnostics:
                print("Relevant diagnostics:")
                print(json.dumps(relevant_diagnostics, indent=2))

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
