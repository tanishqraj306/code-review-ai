import os
import time
from pymongo import MongoClient
from dotenv import load_dotenv
from apscheduler.schedulers.blocking import BlockingScheduler

load_dotenv()
MONGO_ATLAS_URI = os.getenv("MONGO_ATLAS_URI")

client = MongoClient(MONGO_ATLAS_URI)
db = client["code-reviewer-ai-db"]
repositores_collection = db["repositories"]


def check_repositories():
    """The main job executed by the scheduler."""
    print("Scheduler running: Checking for repositories to scan...")

    active_repos = repositores_collection.find({"status": "active"})

    repo_count = 0
    for repo in active_repos:
        repo_count += 1
        full_name = repo["full_name"]
        print(f" -> Found active repository: {full_name}")

    if repo_count == 0:
        print("No active repositores found to check.")


if __name__ == "__main__":
    scheduler = BlockingScheduler()
    scheduler.add_job(check_repositories, "interval", seconds=30)

    print("Orchestrator scheduler started. Press Ctrl+C to exit.")

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        pass
