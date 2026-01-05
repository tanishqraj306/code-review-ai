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

# --- Configuration & Clients ---
load_dotenv()

# Global Fallback (only used if user token missing)
GLOBAL_GITHUB_PAT = os.getenv("GITHUB_PAT")

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
MONGO_ATLAS_URI = os.getenv("MONGO_ATLAS_URI")

PR_QUEUE_NAME = "pr_queue"
CLONE_DIR = "/tmp/repos"

# Initialize AI
genai.configure(api_key=GEMINI_API_KEY)
ai_model = genai.GenerativeModel("gemini-1.5-flash")

print("Analysis worker started...")

# MongoDB Connection
print("Connecting to MongoDB...")
mongo_client = MongoClient(MONGO_ATLAS_URI)
db = mongo_client["code-reviewer-ai-db"]
reviews_collection = db["reviews"]
repositories_collection = db["repositories"]
users_collection = db["users"]
print("Connected to MongoDB")

# --- Helper Functions ---

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

def get_token_for_repo(repo_name):
    """
    Fetches the OAuth Access Token for the user who owns/added this repo.
    Required for cloning Private Repositories.
    """
    try:
        # 1. Find the repository doc to identify the userId
        repo_doc = repositories_collection.find_one({"full_name": repo_name})
        if not repo_doc:
            print(f"⚠️ Repo {repo_name} not found in DB. Using Global PAT.")
            return GLOBAL_GITHUB_PAT

        user_id = repo_doc.get("userId")
        if not user_id:
            return GLOBAL_GITHUB_PAT

        # 2. Find the user doc to get the accessToken
        user_doc = users_collection.find_one({"_id": ObjectId(user_id)})
        if user_doc and "accessToken" in user_doc:
            return user_doc["accessToken"]
        
        print(f"⚠️ No access token found for user {user_id}. Using Global PAT.")
            
    except Exception as e:
        print(f"Error fetching token for {repo_name}: {e}")
    
    return GLOBAL_GITHUB_PAT

def parse_diff_to_get_added_lines(diff_text):
    """Parses a diff and returns a dictionary of NEWLY ADDED lines only."""
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
    """Detects primary language from file extensions."""
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
    print(f"Detected: {primary_language}")
    return primary_language

# --- Dependency Management (Isolation) ---

def setup_virtual_env(repo_path):
    """Creates a temporary venv for the job."""
    venv_path = os.path.join(repo_path, "venv")
    if not os.path.exists(venv_path):
        subprocess.run(["python", "-m", "venv", venv_path], check=True)
    
    # Return paths to executables
    bin_dir = os.path.join(venv_path, "bin")
    return os.path.join(bin_dir, "python"), os.path.join(bin_dir, "pip")

def install_python_dependencies(repo_path, pip_exe):
    """Installs requirements.txt into the ISOLATED venv."""
    print("Searching for Python dependencies...")
    for root, _, files in os.walk(repo_path):
        if "requirements.txt" in files:
            if "venv" in root: continue # Skip the venv itself
                
            requirements_file = os.path.join(root, "requirements.txt")
            try:
                subprocess.run(
                    [pip_exe, "install", "-r", requirements_file],
                    check=True, capture_output=True, text=True
                )
                print(f"Installed dependencies from {requirements_file}")
            except subprocess.CalledProcessError as e:
                print(f"Warning: Failed to install deps: {e.stderr[:200]}")

def install_node_dependencies(repo_path):
    """Installs Node dependencies if package.json exists."""
    if os.path.exists(os.path.join(repo_path, "package.json")):
        print("Installing Node dependencies...")
        try:
            subprocess.run(
                ["npm", "install", "--ignore-scripts", "--legacy-peer-deps"],
                cwd=repo_path, check=True, capture_output=True, text=True
            )
        except subprocess.CalledProcessError as e:
            print(f"Warning: npm install failed: {e.stderr[:200]}")

# --- Static Analysis Tools ---

def run_pyright_analysis(repo_path):
    try:
        command = ["pyright", "--outputjson", repo_path]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        return json.loads(result.stdout).get("generalDiagnostics", [])
    except Exception as e:
        print(f"Pyright failed: {e}")
        return []

def run_eslint_analysis(repo_path):
    try:
        command = ["npx", "eslint", ".", "--format", "json"]
        result = subprocess.run(command, cwd=repo_path, capture_output=True, text=True, check=False)
        if result.stdout:
            results = json.loads(result.stdout)
            diagnostics = []
            for file_res in results:
                for msg in file_res.get("messages", []):
                    diagnostics.append({
                        "file": file_res.get("filePath", ""),
                        "range": {"start": {"line": msg.get("line", 1) - 1}},
                        "message": msg.get("message"),
                        "severity": "ERROR" if msg.get("severity") == 2 else "WARNING",
                        "rule": msg.get("ruleId", "unknown"),
                    })
            return diagnostics
        return []
    except Exception as e:
        print(f"ESLint failed: {e}")
        return []

def run_clang_tidy_analysis(repo_path):
    search_path = os.path.join(repo_path, "**")
    files = [f for ext in ("*.c", "*.cpp") for f in glob.glob(os.path.join(search_path, ext), recursive=True)]
    if not files: return []
    
    try:
        command = ["clang-tidy"] + files
        result = subprocess.run(command, capture_output=True, text=True)
        
        diagnostics = []
        pattern = re.compile(r"(.+?):(\d+):(\d+):\s+(warning|error):\s+(.+?)\s+\[(.+?)\]")
        for line in result.stdout.splitlines():
            match = pattern.match(line)
            if match:
                fpath, lnum, _, sev, msg, rule = match.groups()
                diagnostics.append({
                    "file": fpath if fpath.startswith("/") else os.path.join(repo_path, fpath),
                    "range": {"start": {"line": int(lnum) - 1}},
                    "message": msg.strip(),
                    "severity": sev.upper(),
                    "rule": rule.strip()
                })
        return diagnostics
    except: return []

# --- AI & Commenting Logic ---

def analyze_repository_summary(repo_id, repo_name, clone_url, token):
    """Generates a summary for the repository."""
    print(f"Starting repository summary for {repo_name}...")
    repo_path = os.path.join(CLONE_DIR, repo_name.replace("/", "_"), "analysis")

    try:
        auth_clone_url = clone_url.replace("https://", f"https://oauth2:{token}@")
        if os.path.exists(repo_path): shutil.rmtree(repo_path)
        
        git.Repo.clone_from(auth_clone_url, repo_path)
        
        # Build file structure string
        file_structure = []
        readme_content = "No README."
        if os.path.exists(os.path.join(repo_path, "README.md")):
            with open(os.path.join(repo_path, "README.md"), "r", errors="ignore") as f:
                readme_content = f.read()[:3000]

        for root, _, files in os.walk(repo_path):
            if ".git" in root: continue
            level = root.replace(repo_path, "").count(os.sep)
            if level < 2:
                indent = " " * 4 * level
                file_structure.append(f"{indent}{os.path.basename(root)}/")
                for f in files[:4]: file_structure.append(f"{indent}  {f}")

        prompt = f"""
        Analyze this codebase.
        Project: {repo_name}
        Structure:
        {chr(10).join(file_structure)}
        README:
        {readme_content}
        
        Output valid JSON only: {{ "summary": "...", "tech_stack": ["..."], "key_features": ["..."] }}
        """
        
        response = ai_model.generate_content(prompt)
        # Sanitization attempt if AI adds markdown blocks
        clean_text = response.text.replace("```json", "").replace("```", "").strip()
        
        repositories_collection.update_one(
            {"_id": ObjectId(repo_id)},
            {"$set": {"ai_description": clean_text, "last_analyzed_at": datetime.utcnow()}}
        )
        print("Repository summary updated.")
    except Exception as e:
        print(f"Summary failed: {e}")
    finally:
        if os.path.exists(repo_path): shutil.rmtree(repo_path)

def format_comment_with_ai(diagnostics, diff_text):
    print("Formatting AI review...")
    
    diag_summary = "No strict syntax errors found."
    if diagnostics:
        diag_summary = "Linter Errors Found:\n" + "\n".join(
            [f"- Line {d['range']['start']['line']+1}: {d['message']}" for d in diagnostics[:5]]
        )

    diff_text = diff_text[:12000] # Truncate to fit context

    prompt = f"""
    You are a Senior Code Reviewer. Review this Pull Request.
    
    LINTER OUTPUT:
    {diag_summary}
    
    CODE DIFF:
    {diff_text}
    
    INSTRUCTIONS:
    1. Do not report syntax errors unless the linter missed them.
    2. Focus on: Security, Logic Bugs, Performance, and Clean Code principles.
    3. Be constructive and concise. 
    4. Start with "## 🤖 AI Review Analysis".
    """
    
    try:
        return ai_model.generate_content(prompt).text
    except:
        return "AI Review temporarily unavailable."

def post_review_comment(pr, diagnostics, ai_comment, repo_path):
    """Posts inline comments for linter errors and general comment for AI."""
    latest_commit = pr.get_commits().reversed[0]
    
    # 1. Inline Linter Comments
    count = 0
    for diag in diagnostics:
        if count >= 8: break # Rate limit protection
        try:
            rel_path = os.path.relpath(diag["file"], repo_path)
            line = diag["range"]["start"]["line"] + 1
            body = f"**{diag['severity']}**: {diag['message']}\n*Rule: {diag['rule']}*"
            
            pr.create_review_comment(body=body, commit=latest_commit, path=rel_path, line=line)
            count += 1
            time.sleep(0.5)
        except Exception: pass # Usually triggers if line is outside diff context

    # 2. General AI Comment
    if ai_comment:
        pr.create_issue_comment(ai_comment)

def save_analysis_result(repo_name, pr_number, diagnostics, ai_comment, language):
    try:
        repo_doc = repositories_collection.find_one({"full_name": repo_name})
        user_id = repo_doc.get("userId") if repo_doc else None

        reviews_collection.insert_one({
            "userId": user_id,
            "repo_name": repo_name,
            "pr_number": pr_number,
            "language": language,
            "issues_count": len(diagnostics),
            "ai_comment": ai_comment,
            "analyzed_at": datetime.utcnow(),
        })
    except Exception as e: print(f"DB Save Error: {e}")

# --- Main Worker Loop ---

def main():
    redis_client = connect_to_redis()
    print(f'Worker listening on "{PR_QUEUE_NAME}"...')
    
    while True:
        repo_path = None
        try:
            _, job_json = redis_client.brpop(PR_QUEUE_NAME, 0)
            job_data = json.loads(job_json)
            
            # --- Event Type: Repository Analysis (Summary) ---
            if job_data.get("event_type") == "repository_analysis":
                payload = job_data.get("payload", {})
                repo_name = payload.get("repo_name")
                token = get_token_for_repo(repo_name)
                
                analyze_repository_summary(
                    payload.get("repo_id"), repo_name, payload.get("clone_url"), token
                )
                continue

            # --- Event Type: Pull Request ---
            payload = job_data.get("payload", job_data)
            
            # Normalization (handle direct vs webhook payload)
            if "repository" in payload and "pull_request" in payload:
                repo_data = payload["repository"]
                pr_number = payload["pull_request"]["number"]
            else:
                print("Skipping invalid payload structure.")
                continue

            repo_name = repo_data.get("full_name")
            clone_url = repo_data.get("clone_url")

            print(f"Processing PR #{pr_number} for {repo_name}")
            
            # 1. Get Dynamic Token
            token = get_token_for_repo(repo_name)
            
            # 2. Initialize GitHub Client with User Token
            user_gh_client = Github(token)
            repo = user_gh_client.get_repo(repo_name)
            pr = repo.get_pull(pr_number)
            
            # 3. Get Diff
            diff_resp = requests.get(pr.diff_url, headers={"Authorization": f"token {token}"})
            diff_text = diff_resp.text
            added_lines_map = parse_diff_to_get_added_lines(diff_text)
            
            # 4. Clone
            repo_path = os.path.join(CLONE_DIR, repo_name.replace("/", "_"), str(pr_number))
            auth_clone_url = clone_url.replace("https://", f"https://oauth2:{token}@")
            
            if os.path.exists(repo_path): shutil.rmtree(repo_path)
            git.Repo.clone_from(auth_clone_url, repo_path)
            
            # Checkout specific PR ref
            repo_git = git.Git(repo_path)
            repo_git.fetch("origin", f"pull/{pr_number}/head:pr-{pr_number}")
            repo_git.checkout(f"pr-{pr_number}")
            
            # 5. Analyze
            language = detect_language(list(added_lines_map.keys()))
            relevant_diagnostics = []
            
            if language == "python":
                py_exe, pip_exe = setup_virtual_env(repo_path)
                install_python_dependencies(repo_path, pip_exe)
                
                # We need to run pyright. Note: Pyright is installed globally in Docker, 
                # but we want it to check the files in the repo.
                full_diagnostics = run_pyright_analysis(repo_path)
                
                # Filter to added lines
                for d in full_diagnostics:
                    fpath = d.get("file", "")
                    rel = os.path.relpath(fpath, repo_path)
                    ln = d.get("range", {}).get("start", {}).get("line") + 1
                    if rel in added_lines_map and ln in added_lines_map[rel]:
                        relevant_diagnostics.append(d)

            elif language == "javascript":
                install_node_dependencies(repo_path)
                full_diagnostics = run_eslint_analysis(repo_path)
                for d in full_diagnostics:
                    fpath = d.get("file", "")
                    rel = os.path.relpath(fpath, repo_path) if fpath.startswith("/") else fpath
                    ln = d.get("range", {}).get("start", {}).get("line") + 1
                    if rel in added_lines_map and ln in added_lines_map[rel]:
                        relevant_diagnostics.append(d)

            # 6. Generate AI Review & Post
            ai_comment = format_comment_with_ai(relevant_diagnostics, diff_text)
            
            post_review_comment(pr, relevant_diagnostics, ai_comment, repo_path)
            save_analysis_result(repo_name, pr_number, relevant_diagnostics, ai_comment, language)
            
            print(f"--- Job Complete for PR #{pr_number} ---")

        except Exception as e:
            print(f"Critical Worker Error: {e}")
            time.sleep(1)
        finally:
            if repo_path and os.path.exists(repo_path):
                print("Cleaning up disk...")
                shutil.rmtree(repo_path)

if __name__ == "__main__":
    main()
