"""
Google Sheets Configuration

This module contains configuration for Google Sheets API integration.
Set these values in environment variables or update directly for development.
"""

import os

# Google Sheets API Configuration
GOOGLE_SHEETS_CONFIG = {
    # Service account credentials file path
    "credentials_file": os.getenv("GOOGLE_CREDENTIALS_FILE", "config/google_credentials.json"),
    
    # QA Team Timesheet Google Sheet ID
    # Extract from URL: https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit
    "qa_sheet_id": os.getenv("QA_TIMESHEET_SHEET_ID", "1h2dfjM9EcCguoTBsD5WiRIRIcjIqiax5mbrSODOaeTk"),
    
    # Dev Team Timesheet Google Sheet ID
    "dev_sheet_id": os.getenv("DEV_TIMESHEET_SHEET_ID", "1rznhZmU6aEoyNi47MIv3gmU36dnVjjTm3gw0gc8UTWM"),
    
    # Sheet names/tabs within each spreadsheet
    "qa_sheet_name": os.getenv("QA_SHEET_NAME", "BIS - QA"),
    "dev_sheet_name": os.getenv("DEV_SHEET_NAME", "Web"),
    
    # Column mapping for timesheet data
    # Map your sheet column headers to our internal field names
    "column_mapping": {
        "employee_name": os.getenv("COL_EMPLOYEE_NAME", "Tester"),  # "Tester" for QA, "Developer" for Dev
        "date": os.getenv("COL_DATE", "Date"),
        "ticket_id": os.getenv("COL_TICKET_ID", "Ticket"),
        "hours_logged": os.getenv("COL_HOURS", "Time Spent"),
        "leave_type": os.getenv("COL_LEAVE_TYPE", "Leave"),
        "task_description": os.getenv("COL_TASK_DESC", "Task"),
        "project_name": os.getenv("COL_PROJECT", "Status"),  # Using Status as project context
    },
    
    # Header row number (1-indexed, 0 means auto-detect)
    "header_row": 2,
    
    # Sync settings
    "sync_interval_minutes": int(os.getenv("SHEETS_SYNC_INTERVAL", "5")),  # Default 5 minutes
    "auto_sync_enabled": os.getenv("SHEETS_AUTO_SYNC", "true").lower() == "true",  # Enabled by default
    "realtime_sync": os.getenv("SHEETS_REALTIME_SYNC", "true").lower() == "true",  # Real-time mode (2-min intervals)
}

# Scopes required for Google Sheets API
GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets.readonly'
]

# Authentication method: 'service_account' or 'oauth2'
# Use 'service_account' if you have a service account JSON
# Use 'oauth2' if sheets are shared with your personal Google account
AUTH_METHOD = os.getenv("GOOGLE_AUTH_METHOD", "oauth2")

# OAuth2 credentials file (only needed if AUTH_METHOD is 'oauth2')
# Download from Google Cloud Console -> APIs & Services -> Credentials -> OAuth 2.0 Client IDs
OAUTH2_CREDENTIALS_FILE = os.getenv("OAUTH2_CREDENTIALS_FILE", "config/oauth2_credentials.json")
OAUTH2_TOKEN_FILE = os.getenv("OAUTH2_TOKEN_FILE", "config/token.json")


def get_sheet_id(team: str) -> str:
    """Get the Google Sheet ID for a specific team."""
    team = team.upper()
    if team == "QA":
        return GOOGLE_SHEETS_CONFIG["qa_sheet_id"]
    elif team in ("DEV", "DEVELOPMENT"):
        return GOOGLE_SHEETS_CONFIG["dev_sheet_id"]
    else:
        raise ValueError(f"Unknown team: {team}. Use 'QA' or 'DEV'.")


def get_sheet_name(team: str) -> str:
    """Get the sheet/tab name for a specific team."""
    team = team.upper()
    if team == "QA":
        return GOOGLE_SHEETS_CONFIG["qa_sheet_name"]
    elif team in ("DEV", "DEVELOPMENT"):
        return GOOGLE_SHEETS_CONFIG["dev_sheet_name"]
    else:
        raise ValueError(f"Unknown team: {team}. Use 'QA' or 'DEV'.")
