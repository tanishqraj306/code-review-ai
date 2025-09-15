import os
import redis
import json
import time

REDIS_URL = os.getenv('REDIS_URL', 'redis://localhost:6379')
PR_QUEUE_NAME = 'pr_queue'

print('Analysis worker started...')

def connect_to_redis():
    """Attempt to connect to Redis, with retries."""
    while True:
        try:
            r = redis.Redis.from_url(REDIS_URL, decode_responses=True)
            r.ping()
            print('Successfully connected to Redis!')
            return r
        except redis.exceptions.ConnectionError as e:
            print(f'Redis connection failed: {e}. Retrying in 5 seconds...')
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
            pr_number = job_data.get('payload', {}).get('number', 'N/A')
            pr_title = job_data.get('payload', {}).get('pull_request', {}).get('title', 'N/A')
            
            print(f"Processing PR #{pr_number}: {pr_title}")
            print("--- Job Complete ---\n")

        except Exception as e:
            print(f"An error occurred: {e}")
            if not redis_client.ping():
                print("Redis connection lost. Reconnecting...")
                redis_client = connect_to_redis()


if __name__ == '__main__':
    main()
