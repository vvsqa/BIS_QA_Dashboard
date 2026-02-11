"""
Redmine connection test and diagnostic script.
Fetches ALL issues from configured projects and shows tracker distribution.
"""
import requests
import os
from collections import defaultdict

# Load .env when script is run directly
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except ImportError:
    pass

REDMINE_URL = os.getenv("REDMINE_URL", "https://redmine.bissafety.app")
API_KEY = os.getenv("REDMINE_API_KEY", "")
REDMINE_PROJECT_IDS = [p.strip() for p in (os.getenv("REDMINE_PROJECT_IDS", "bis-web") or "bis-web").split(",") if p.strip()]

if not API_KEY:
    raise RuntimeError("REDMINE_API_KEY is not set. Configure it in environment variables.")

headers = {"X-Redmine-API-Key": API_KEY}
LIMIT = 100


def get_custom_field(issue, field_name):
    for field in issue.get("custom_fields", []):
        if field.get("name") == field_name:
            return field.get("value")
    return None


print("=" * 60)
print("REDMINE CONNECTION TEST")
print("=" * 60)
print(f"URL: {REDMINE_URL}")
print(f"Projects: {REDMINE_PROJECT_IDS}")
print("=" * 60)

all_issues = []
tracker_counts = defaultdict(int)
status_counts = defaultdict(int)

for project_id in REDMINE_PROJECT_IDS:
    print(f"\nFetching issues from project: {project_id}")
    offset = 0
    project_issues = []

    while True:
        params = {
            "project_id": project_id,
            "status_id": "*",  # All statuses (open + closed)
            "limit": LIMIT,
            "offset": offset
        }

        try:
            response = requests.get(
                f"{REDMINE_URL}/issues.json",
                headers=headers,
                params=params,
                timeout=30
            )
            response.raise_for_status()
        except requests.RequestException as e:
            print(f"  ERROR: {e}")
            break

        data = response.json()
        issues = data.get("issues", [])

        if not issues:
            break

        project_issues.extend(issues)
        offset += LIMIT
        print(f"  Fetched {len(project_issues)} issues so far...")

    print(f"  Total from {project_id}: {len(project_issues)}")
    all_issues.extend(project_issues)

    # Count by tracker and status
    for issue in project_issues:
        tracker = (issue.get("tracker") or {}).get("name") or "Unknown"
        status = (issue.get("status") or {}).get("name") or "Unknown"
        tracker_counts[tracker] += 1
        status_counts[status] += 1

print("\n" + "=" * 60)
print(f"TOTAL ISSUES FETCHED: {len(all_issues)}")
print("=" * 60)

if tracker_counts:
    print("\nIssues by TRACKER (sync only imports 'Bug' tracker):")
    for tracker, count in sorted(tracker_counts.items(), key=lambda x: -x[1]):
        marker = " <-- synced" if tracker.lower() == "bug" else ""
        print(f"  {tracker}: {count}{marker}")

if status_counts:
    print("\nIssues by STATUS:")
    for status, count in sorted(status_counts.items(), key=lambda x: -x[1]):
        print(f"  {status}: {count}")

# Show sample bug (tracker=Bug)
bugs_only = [i for i in all_issues if (i.get("tracker") or {}).get("name", "").lower() == "bug"]
print(f"\nBugs (tracker=Bug): {len(bugs_only)}")

if bugs_only:
    issue = bugs_only[0]
    print("\nSample Bug:")
    print(f"  ID: {issue.get('id')}")
    print(f"  Subject: {issue.get('subject')}")
    print(f"  Status: {(issue.get('status') or {}).get('name')}")
    print(f"  Tracker: {(issue.get('tracker') or {}).get('name')}")
    print(f"  Assignee: {(issue.get('assigned_to') or {}).get('name')}")
    print(f"  Ticket ID field: {get_custom_field(issue, 'Ticket ID')}")
elif all_issues:
    print("\nNo issues with tracker 'Bug' found. Sample issue:")
    issue = all_issues[0]
    print(f"  ID: {issue.get('id')}")
    print(f"  Subject: {issue.get('subject')}")
    print(f"  Tracker: {(issue.get('tracker') or {}).get('name')}")
    print(f"  Status: {(issue.get('status') or {}).get('name')}")
else:
    print("\nNo issues found in the project(s).")
