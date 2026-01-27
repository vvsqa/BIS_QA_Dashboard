"""
Redmine to Database Sync Script

This script syncs all bug/issue data from Redmine to the PostgreSQL database.
It captures ALL available fields including custom fields and stores raw data as JSON.

Usage:
    python sync_redmine_to_db.py
    python sync_redmine_to_db.py --full-refresh  # Re-fetch all data
"""

import requests
import json
import argparse
from sqlalchemy.orm import Session
from database import SessionLocal
from models import Bug, BugStatusHistory
from datetime import datetime

REDMINE_URL = "https://redmine.bissafety.app"
API_KEY = "9d32eee5d4a31e7051efbe930a8b395ae5f77fb6"

headers = {
    "X-Redmine-API-Key": API_KEY
}

LIMIT = 100


def get_custom_field(issue, field_name):
    """Extract a custom field value by name"""
    for field in issue.get("custom_fields", []):
        if field.get("name") == field_name:
            return field.get("value")
    return None


def get_all_custom_fields(issue):
    """Extract all custom fields as a dictionary"""
    custom_fields = {}
    for field in issue.get("custom_fields", []):
        name = field.get("name")
        value = field.get("value")
        if name:
            custom_fields[name] = value
    return custom_fields


def parse_datetime(value):
    """Parse datetime from Redmine format"""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except:
        return None


def parse_date(value):
    """Parse date from Redmine format (YYYY-MM-DD)"""
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except:
        return None


def parse_float(value):
    """Parse float value"""
    if value is None:
        return None
    try:
        return float(value)
    except:
        return None


def sync_redmine_bugs(full_refresh=False):
    """Sync all bugs from Redmine to database"""
    print("="*60)
    print("Starting Redmine -> PostgreSQL sync...")
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Full Refresh: {full_refresh}")
    print("="*60)

    db: Session = SessionLocal()
    total_processed = 0
    total_created = 0
    total_updated = 0
    offset = 0

    try:
        while True:
            params = {
                "project_id": "bis-web",
                "query_id": 20,
                "limit": LIMIT,
                "offset": offset
            }

            response = requests.get(
                f"{REDMINE_URL}/issues.json",
                headers=headers,
                params=params,
                timeout=30
            )
            response.raise_for_status()

            data = response.json()
            issues = data.get("issues", [])
            
            if not issues:
                break

            for issue in issues:
                bug_id = issue.get("id")
                existing_bug = db.query(Bug).filter(Bug.bug_id == bug_id).first()

                # Extract Ticket ID from custom fields
                ticket_id_value = get_custom_field(issue, "Ticket ID")
                ticket_id = int(ticket_id_value) if ticket_id_value and str(ticket_id_value).isdigit() else None

                # Extract parent task ID
                parent = issue.get("parent")
                parent_task_id = parent.get("id") if parent else None

                # Get all custom fields as dictionary
                custom_fields = get_all_custom_fields(issue)

                # Build comprehensive bug data
                bug_data = {
                    # Core identifiers
                    "bug_id": bug_id,
                    "ticket_id": ticket_id,
                    "parent_task_id": parent_task_id,
                    
                    # Basic info
                    "tracker": issue.get("tracker", {}).get("name"),
                    "subject": issue.get("subject"),
                    "description": issue.get("description"),
                    "status": issue.get("status", {}).get("name"),
                    "priority": issue.get("priority", {}).get("name"),
                    
                    # People
                    "assignee": issue.get("assigned_to", {}).get("name"),
                    "author": issue.get("author", {}).get("name"),
                    
                    # Custom fields - commonly used
                    "severity": get_custom_field(issue, "Severity"),
                    "environment": get_custom_field(issue, "Environment"),
                    "module": get_custom_field(issue, "Module"),
                    "feature": get_custom_field(issue, "Feature"),
                    "platform": get_custom_field(issue, "Platform"),
                    "browser": get_custom_field(issue, "Browser"),
                    "os": get_custom_field(issue, "OS"),
                    
                    # Project
                    "project": issue.get("project", {}).get("name"),
                    
                    # Time tracking
                    "start_date": parse_date(issue.get("start_date")),
                    "due_date": parse_date(issue.get("due_date")),
                    "estimated_hours": parse_float(issue.get("estimated_hours")),
                    "spent_hours": parse_float(issue.get("spent_hours")),
                    "done_ratio": issue.get("done_ratio"),
                    
                    # Dates
                    "created_on": parse_datetime(issue.get("created_on")),
                    "updated_on": parse_datetime(issue.get("updated_on")),
                    "closed_on": parse_datetime(issue.get("closed_on")),
                    
                    # Store ALL raw data as JSON for future use
                    "raw_data": issue,
                    "custom_fields": custom_fields
                }

                if existing_bug:
                    # Track status change before updating
                    previous_status = existing_bug.status
                    new_status = bug_data.get('status')
                    
                    # Update existing bug
                    for key, value in bug_data.items():
                        setattr(existing_bug, key, value)
                    total_updated += 1
                    
                    # Record status change if status has changed
                    if new_status and new_status != previous_status:
                        # Calculate duration in previous status
                        duration_hours = None
                        if previous_status and existing_bug.updated_on:
                            duration_seconds = (datetime.now() - existing_bug.updated_on.replace(tzinfo=None)).total_seconds()
                            duration_hours = round(duration_seconds / 3600, 2)
                        
                        history = BugStatusHistory(
                            bug_id=bug_id,
                            ticket_id=ticket_id,
                            previous_status=previous_status,
                            new_status=new_status,
                            changed_on=datetime.now(),
                            assignee=bug_data.get('assignee'),
                            duration_in_previous_status=duration_hours,
                            source='sync'
                        )
                        db.add(history)
                else:
                    # Create new bug
                    db.add(Bug(**bug_data))
                    total_created += 1
                    
                    # Record initial status for new bug
                    if bug_data.get('status'):
                        history = BugStatusHistory(
                            bug_id=bug_id,
                            ticket_id=ticket_id,
                            previous_status=None,
                            new_status=bug_data.get('status'),
                            changed_on=datetime.now(),
                            assignee=bug_data.get('assignee'),
                            duration_in_previous_status=None,
                            source='sync'
                        )
                        db.add(history)

                total_processed += 1

            db.commit()
            offset += LIMIT
            print(f"  Processed {total_processed} bugs... (created: {total_created}, updated: {total_updated})")

        print("\n" + "="*60)
        print(f"SYNC COMPLETED")
        print(f"  Total processed: {total_processed}")
        print(f"  New bugs: {total_created}")
        print(f"  Updated bugs: {total_updated}")
        print("="*60)
        
        return total_processed, total_created, total_updated

    except Exception as e:
        db.rollback()
        print(f"ERROR during sync: {e}")
        import traceback
        traceback.print_exc()
        return 0, 0, 0

    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="Sync Redmine bugs to database")
    parser.add_argument('--full-refresh', '-f', action='store_true', 
                        help="Force full refresh of all data")
    args = parser.parse_args()
    
    sync_redmine_bugs(full_refresh=args.full_refresh)


if __name__ == "__main__":
    main()
