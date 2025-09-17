import os
import time
import json
from datetime import datetime, timezone
from pymongo import MongoClient
import redis
from dotenv import load_dotenv
from apscheduler.schedulers.blocking import BlockingScheduler
from github import Github

load_dotenv()
MONGO_ATLAS_URI = os.getenv("MONGO_ATLAS_URI")
GITHUB_PAT = os.getenv("GITHUB_PAT")
REDIS_URL = os.getenv("REDIS_URL")

# Initialize Clients
client = MongoClient(MONGO_ATLAS_URI)
db = client["code-reviewer-ai-db"]
repositores_collection = db["repositories"]
processed_prs_collection = db["processed_prs"]

gh_client = Github(GITHUB_PAT)

PR_QUEUE_NAME = "pr_queue"


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


def check_repositories():
    """Fetches PRs for active repos and queues them for analysis."""
    print(
        f"\nScheduler running at {datetime.now(timezone.utc)} UTC: Checking for repositories..."
    )

    redis_client = connect_to_redis()

    active_repos = repositores_collection.find({"status": "active"})

    for repo_doc in active_repos:
        full_name = repo_doc["full_name"]
        print(f" -> Processing repository: {full_name}")

        try:
            repo = gh_client.get_repo(full_name)
            open_prs = repo.get_pulls(state="open", sort="created", direction="desc")

            queued_count = 0
            for pr in open_prs:
                latest_commit_sha = pr.head.sha
                is_processed = processed_prs_collection.find_one(
                    {
                        "repo_full_name": full_name,
                        "pr_number": pr.number,
                        "commit_sha": latest_commit_sha,
                    }
                )

                if is_processed:
                    continue

                github_payload = {
                    "number": pr.number,
                    "repository": {"full_name": full_name, "clone_url": repo.clone_url},
                    "pull_request": {"head": {"ref": pr.head.ref}},
                }

                job_to_queue = {"eventType": "pull_request", "payload": github_payload}

                redis_client.lpush(PR_QUEUE_NAME, json.dumps(job_to_queue))
                queued_count += 1

                processed_prs_collection.insert_one(
                    {
                        "repo_full_name": full_name,
                        "pr_number": pr.number,
                        "commit_sha": latest_commit_sha,
                        "processed_at": datetime.now(timezone.utc),
                    }
                )

            if queued_count > 0:
                print(f"Queued {queued_count} new/updated PRs for analysis.")

            repositores_collection.update_one(
                {"_id": repo_doc["_id"]},
                {"$set": {"last_checked_at": datetime.now(timezone.utc)}},
            )

        except Exception as e:
            print(f"ERROR: Failed to process repository {full_name}: {e}")


if __name__ == "__main__":
    scheduler = BlockingScheduler()
    scheduler.add_job(check_repositories, "interval", seconds=30)

    print("Orchestrator scheduler started. Press Ctrl+C to exit.")

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        pass
