import requests

REDMINE_URL = "https://redmine.bissafety.app"
API_KEY = "9d32eee5d4a31e7051efbe930a8b395ae5f77fb6"

headers = {
    "X-Redmine-API-Key": API_KEY
}

LIMIT = 100
OFFSET = 0
all_issues = []

def get_custom_field(issue, field_name):
    for field in issue.get("custom_fields", []):
        if field.get("name") == field_name:
            return field.get("value")
    return None

print("Fetching ALL bugs from Redmine (paginated)...")

while True:
    params = {
        "project_id": "bis-web",
        "query_id": 20,
        "limit": LIMIT,
        "offset": OFFSET
    }

    response = requests.get(
        f"{REDMINE_URL}/issues.json",
        headers=headers,
        params=params,
        timeout=20
    )

    response.raise_for_status()

    data = response.json()
    issues = data.get("issues", [])

    if not issues:
        break

    all_issues.extend(issues)
    OFFSET += LIMIT

    print(f"Fetched {len(all_issues)} bugs so far...")

print(f"\nTOTAL BUGS FETCHED: {len(all_issues)}")

# Print one normalized sample
if all_issues:
    issue = all_issues[0]

    bug_data = {
        "bug_id": issue.get("id"),
        "subject": issue.get("subject"),
        "status": issue.get("status", {}).get("name"),
        "priority": issue.get("priority", {}).get("name"),
        "assignee": issue.get("assigned_to", {}).get("name"),
        "author": issue.get("author", {}).get("name"),
        "environment": get_custom_field(issue, "Environment"),
        "severity": get_custom_field(issue, "Severity"),
        "module": get_custom_field(issue, "Module"),
        "feature": get_custom_field(issue, "Feature"),
        "created_on": issue.get("created_on"),
        "updated_on": issue.get("updated_on")
    }

    print("\nSample Normalized Bug:")
    for k, v in bug_data.items():
        print(f"{k}: {v}")
