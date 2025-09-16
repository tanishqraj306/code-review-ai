import os
import redis
import json
import time
import shutil
import git
import requests
from dotenv import load_dotenv
from github import Github

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
                print(
                    f"DEBUG: repo_name={repo_name}, clone_url={clone_url}, pr_branch={pr_branch}, pr_number={pr_number}"
                )
                continue

            print(f"Processing PR #{pr_number} from {repo_name} (branch: {pr_branch})")

            repo_path = os.path.join(
                CLONE_DIR, repo_name.replace("/", "_"), str(pr_number)
            )

            auth_clone_url = clone_url.replace(
                "https://", f"https://oauth2:{GITHUB_PAT}@"
            )

            print(f"Cloning {repo_name} into {repo_path}...")
            git.Repo.clone_from(auth_clone_url, repo_path, branch=pr_branch)
            print("Repository cloned successfully.")

            cloned_files = os.listdir(repo_path)
            print(f"Cloned repo contents (first 5): {cloned_files[:5]}")
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
