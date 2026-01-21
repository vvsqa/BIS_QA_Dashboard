import requests
from sqlalchemy.orm import Session
from database import SessionLocal
from models import Bug
from datetime import datetime

REDMINE_URL = "https://redmine.bissafety.app"
API_KEY = "9d32eee5d4a31e7051efbe930a8b395ae5f77fb6"

headers = {
    "X-Redmine-API-Key": API_KEY
}

LIMIT = 100
OFFSET = 0


def get_custom_field(issue, field_name):
    for field in issue.get("custom_fields", []):
        if field.get("name") == field_name:
            return field.get("value")
    return None


def parse_datetime(value):
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


print("Starting Redmine → PostgreSQL sync...")

db: Session = SessionLocal()
total_processed = 0

try:
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

        issues = response.json().get("issues", [])
        if not issues:
            break

        for issue in issues:
            bug_id = issue.get("id")

            existing_bug = db.query(Bug).filter(Bug.bug_id == bug_id).first()

            # <<< ADDED: Extract Ticket ID from custom fields >>>
            ticket_id_value = get_custom_field(issue, "Ticket ID")
            ticket_id = int(ticket_id_value) if ticket_id_value and str(ticket_id_value).isdigit() else None

            bug_data = {
                "bug_id": bug_id,
                "ticket_id": ticket_id,  # <<< ADDED >>>
                "subject": issue.get("subject"),
                "status": issue.get("status", {}).get("name"),
                "priority": issue.get("priority", {}).get("name"),
                "assignee": issue.get("assigned_to", {}).get("name"),
                "author": issue.get("author", {}).get("name"),
                "environment": get_custom_field(issue, "Environment"),
                "severity": get_custom_field(issue, "Severity"),
                "module": get_custom_field(issue, "Module"),
                "feature": get_custom_field(issue, "Feature"),
                "project": issue.get("project", {}).get("name"),
                "created_on": parse_datetime(issue.get("created_on")),
                "updated_on": parse_datetime(issue.get("updated_on")),
                "closed_on": parse_datetime(issue.get("closed_on"))
            }

            if existing_bug:
                for key, value in bug_data.items():
                    setattr(existing_bug, key, value)
            else:
                db.add(Bug(**bug_data))

            total_processed += 1

        db.commit()
        OFFSET += LIMIT
        print(f"Processed {total_processed} bugs so far...")

    print(f"\nSYNC COMPLETED. Total bugs processed: {total_processed}")

except Exception as e:
    db.rollback()
    print("ERROR during sync:", e)

finally:
    db.close()
