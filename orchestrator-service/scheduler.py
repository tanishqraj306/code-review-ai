import os
import time
import json
from datetime import datetime, timezone
from pymongo import MongoClient
import redis
from dotenv import load_dotenv
from apscheduler.schedulers.blocking import BlockingScheduler
from github import Github
from bson.objectid import ObjectId

# --- Configuration ---
load_dotenv()

MONGO_ATLAS_URI = os.getenv("MONGO_ATLAS_URI")
GLOBAL_GITHUB_PAT = os.getenv("GITHUB_PAT") # Fallback only
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")
PR_QUEUE_NAME = "pr_queue"

# --- Database & Redis Setup ---
mongo_client = MongoClient(MONGO_ATLAS_URI)
db = mongo_client["code-reviewer-ai-db"]
repositories_collection = db["repositories"]
processed_prs_collection = db["processed_prs"]
users_collection = db["users"]

def connect_to_redis():
    """Attempt to connect to Redis, with retries."""
    while True:
        try:
            r = redis.Redis.from_url(REDIS_URL, decode_responses=True)
            r.ping()
            return r
        except redis.exceptions.ConnectionError:
            print("Redis not ready. Retrying in 5s...")
            time.sleep(5)

# --- Helper Functions ---

def get_github_client_for_repo(repo_doc):
    """
    Returns a GitHub client authenticated as the repo owner.
    Essential for accessing Private Repositories during polling.
    """
    try:
        user_id = repo_doc.get("userId")
        if user_id:
            user = users_collection.find_one({"_id": ObjectId(user_id)})
            if user and "accessToken" in user:
                return Github(user["accessToken"])
    except Exception as e:
        print(f"Error fetching user token: {e}")
    
    # Fallback to Global PAT if user token fails (only works for public repos)
    return Github(GLOBAL_GITHUB_PAT)

def check_repositories():
    """Fetches PRs for active repos and queues them if missed by webhooks."""
    print(f"\n[Scheduler] Running polling check at {datetime.now(timezone.utc)}...")
    
    redis_client = connect_to_redis()
    
    # Only check active repositories
    active_repos = repositories_collection.find({"status": "active"})
    
    for repo_doc in active_repos:
        full_name = repo_doc.get("full_name")
        if not full_name: continue

        try:
            # 1. Authenticate as the User
            gh_client = get_github_client_for_repo(repo_doc)
            repo = gh_client.get_repo(full_name)
            
            # 2. Optimization: Get only the 5 most recently updated PRs
            # We don't need to fetch everything; if it's old, we likely processed it.
            open_prs = repo.get_pulls(state="open", sort="updated", direction="desc")[:5]
            
            queued_count = 0
            
            for pr in open_prs:
                latest_commit_sha = pr.head.sha
                
                # 3. Idempotency Check: Have we processed this EXACT commit?
                # This prevents re-queueing PRs that were already handled by the Webhook.
                is_processed = processed_prs_collection.find_one({
                    "repo_full_name": full_name,
                    "pr_number": pr.number,
                    "commit_sha": latest_commit_sha
                })

                if is_processed:
                    continue

                # 4. Construct Payload (Mimics GitHub Webhook Structure)
                # This ensures the Worker (Service C) can't tell the difference.
                github_payload = {
                    "number": pr.number,
                    "repository": {
                        "full_name": full_name, 
                        "clone_url": repo.clone_url
                    },
                    "pull_request": {
                        "number": pr.number,
                        "head": {"ref": pr.head.ref}
                    },
                    "action": "opened" # Logic treats 'opened' and 'synchronize' similarly
                }

                job_to_queue = {
                    "eventType": "pull_request", 
                    "payload": github_payload,
                    "source": "scheduler" # Useful for debugging
                }

                # 5. Push to Redis
                redis_client.lpush(PR_QUEUE_NAME, json.dumps(job_to_queue))
                
                # 6. Mark as Processed immediately
                processed_prs_collection.insert_one({
                    "repo_full_name": full_name,
                    "pr_number": pr.number,
                    "commit_sha": latest_commit_sha,
                    "processed_at": datetime.now(timezone.utc),
                    "trigger": "scheduler"
                })
                queued_count += 1

            if queued_count > 0:
                print(f" -> Queued {queued_count} missed PRs for {full_name}")

            # Update heartbeat
            repositories_collection.update_one(
                {"_id": repo_doc["_id"]},
                {"$set": {"last_checked_at": datetime.now(timezone.utc)}}
            )

        except Exception as e:
            # Common error: User revoked token, or repo was deleted
            print(f" -> Failed to check {full_name}: {e}")

if __name__ == "__main__":
    # BlockingScheduler keeps the script alive
    scheduler = BlockingScheduler()
    
    # Run every 60 seconds (safe buffer for API limits)
    scheduler.add_job(check_repositories, "interval", seconds=60)
    
    print("Orchestrator scheduler started. Press Ctrl+C to exit.")
    
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        pass
