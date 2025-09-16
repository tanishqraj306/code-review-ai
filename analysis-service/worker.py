import os
import redis
import json
import time
import requests
from dotenv import load_dotenv
from github import Github

load_dotenv()

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
PR_QUEUE_NAME = "pr_queue"
GITHUB_PAT = os.getenv("GITHUB_PAT")

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
        try:
            _, job_json = redis_client.brpop(PR_QUEUE_NAME, 0)

            job_data = json.loads(job_json)

            print("\n--- ✅ Job Received ---")
            payload = job_data.get("payload", {})
            repo_name = payload.get("repository", {}).get("full_name")
            pr_number = payload.get("number")

            if not repo_name or not pr_number:
                print("Could not find repository name or PR number in payload.")
                continue

            repo = gh_client.get_repo(repo_name)
            pr = repo.get_pull(pr_number)

            diff_response = requests.get(pr.diff_url)
            diff_response.raise_for_status()
            diff_text = diff_response.text

            print("Successfully fetched PR diff:")
            print(f"{diff_text[:500]}...")
            print("--- Job Complete ---\n")

        except Exception as e:
            print(f"An error occurred: {e}")
            time.sleep(5)
            if not redis_client.ping():
                print("Redis connection lost. Reconnecting...")
                redis_client = connect_to_redis()


if __name__ == "__main__":
    main()
