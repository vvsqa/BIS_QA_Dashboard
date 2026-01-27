"""
Google Sheets API Credentials Setup Script

This script helps you set up Google Sheets API credentials for the Calendar Module.

Prerequisites:
1. Go to Google Cloud Console: https://console.cloud.google.com/
2. Create a new project (or select existing)
3. Enable the Google Sheets API
4. Create a Service Account:
   - Go to APIs & Services > Credentials
   - Click "Create Credentials" > "Service Account"
   - Fill in the details and create
   - Go to the service account > Keys > Add Key > Create new key > JSON
   - Download the JSON file

5. Share your Google Sheets with the service account email
   - Open your QA timesheet Google Sheet
   - Click "Share" and add the service account email (found in the JSON file)
   - Give "Viewer" access
   - Repeat for Dev timesheet

Usage:
    python setup_google_credentials.py --credentials path/to/credentials.json
    python setup_google_credentials.py --test
"""

import os
import sys
import json
import argparse
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

CONFIG_DIR = os.path.join(os.path.dirname(__file__), "config")
CREDENTIALS_FILE = os.path.join(CONFIG_DIR, "google_credentials.json")
ENV_FILE = os.path.join(os.path.dirname(__file__), ".env")


def setup_credentials(source_file: str) -> bool:
    """Copy credentials file to the config directory."""
    if not os.path.exists(source_file):
        print(f"ERROR: File not found: {source_file}")
        return False
    
    # Validate JSON structure
    try:
        with open(source_file, 'r') as f:
            creds = json.load(f)
        
        required_fields = ['type', 'project_id', 'private_key', 'client_email']
        missing = [f for f in required_fields if f not in creds]
        if missing:
            print(f"ERROR: Invalid credentials file. Missing fields: {missing}")
            return False
        
        if creds.get('type') != 'service_account':
            print(f"WARNING: Expected 'service_account' type, got '{creds.get('type')}'")
    except json.JSONDecodeError as e:
        print(f"ERROR: Invalid JSON file: {e}")
        return False
    
    # Create config directory if needed
    Path(CONFIG_DIR).mkdir(parents=True, exist_ok=True)
    
    # Copy credentials
    import shutil
    shutil.copy2(source_file, CREDENTIALS_FILE)
    
    print(f"SUCCESS: Credentials copied to {CREDENTIALS_FILE}")
    print(f"\nService Account Email: {creds.get('client_email')}")
    print("\nIMPORTANT: Share your Google Sheets with this email address!")
    
    return True


def test_connection():
    """Test the Google Sheets API connection."""
    print("Testing Google Sheets API connection...")
    
    if not os.path.exists(CREDENTIALS_FILE):
        print(f"ERROR: Credentials file not found: {CREDENTIALS_FILE}")
        print("Run: python setup_google_credentials.py --credentials <path>")
        return False
    
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        from config.google_sheets_config import GOOGLE_SCOPES, GOOGLE_SHEETS_CONFIG
        
        # Load credentials
        credentials = service_account.Credentials.from_service_account_file(
            CREDENTIALS_FILE, scopes=GOOGLE_SCOPES
        )
        
        # Build service
        service = build('sheets', 'v4', credentials=credentials)
        
        print("SUCCESS: Google Sheets API connection established!")
        print(f"\nCredentials valid for: {credentials.service_account_email}")
        
        # Test sheet access if configured
        qa_sheet_id = GOOGLE_SHEETS_CONFIG.get('qa_sheet_id')
        dev_sheet_id = GOOGLE_SHEETS_CONFIG.get('dev_sheet_id')
        
        if qa_sheet_id:
            try:
                result = service.spreadsheets().get(spreadsheetId=qa_sheet_id).execute()
                print(f"QA Sheet Access: OK - '{result.get('properties', {}).get('title')}'")
            except Exception as e:
                print(f"QA Sheet Access: FAILED - {e}")
        else:
            print("QA Sheet: Not configured (set QA_TIMESHEET_SHEET_ID env var)")
        
        if dev_sheet_id:
            try:
                result = service.spreadsheets().get(spreadsheetId=dev_sheet_id).execute()
                print(f"Dev Sheet Access: OK - '{result.get('properties', {}).get('title')}'")
            except Exception as e:
                print(f"Dev Sheet Access: FAILED - {e}")
        else:
            print("Dev Sheet: Not configured (set DEV_TIMESHEET_SHEET_ID env var)")
        
        return True
        
    except ImportError as e:
        print(f"ERROR: Missing dependency: {e}")
        print("Run: pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib")
        return False
    except Exception as e:
        print(f"ERROR: {e}")
        return False


def print_env_template():
    """Print environment variable template."""
    template = """
# Google Sheets Configuration
# Add these to your .env file or set as environment variables

# Path to service account credentials JSON
GOOGLE_CREDENTIALS_FILE=config/google_credentials.json

# Google Sheet IDs (from the URL: https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit)
QA_TIMESHEET_SHEET_ID=your_qa_sheet_id_here
DEV_TIMESHEET_SHEET_ID=your_dev_sheet_id_here

# Sheet/Tab names within each spreadsheet
QA_SHEET_NAME=Sheet1
DEV_SHEET_NAME=Sheet1

# Column headers in your sheets (adjust to match your sheet)
COL_EMPLOYEE_NAME=Employee Name
COL_DATE=Date
COL_TICKET_ID=Ticket ID
COL_HOURS=Hours
COL_LEAVE_TYPE=Leave Type
COL_TASK_DESC=Task Description
COL_PROJECT=Project

# Sync settings
SHEETS_SYNC_INTERVAL=30
SHEETS_AUTO_SYNC=false
"""
    print(template)


def main():
    parser = argparse.ArgumentParser(
        description="Setup Google Sheets API credentials for Calendar Module",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument('--credentials', '-c', type=str,
                        help="Path to Google service account credentials JSON file")
    parser.add_argument('--test', '-t', action='store_true',
                        help="Test the Google Sheets API connection")
    parser.add_argument('--env-template', '-e', action='store_true',
                        help="Print environment variable template")
    
    args = parser.parse_args()
    
    if args.credentials:
        success = setup_credentials(args.credentials)
        sys.exit(0 if success else 1)
    elif args.test:
        success = test_connection()
        sys.exit(0 if success else 1)
    elif args.env_template:
        print_env_template()
    else:
        parser.print_help()
        print("\n" + "="*60)
        print("Quick Start:")
        print("="*60)
        print("1. Download service account JSON from Google Cloud Console")
        print("2. Run: python setup_google_credentials.py --credentials <path>")
        print("3. Share your Google Sheets with the service account email")
        print("4. Set environment variables (see --env-template)")
        print("5. Run: python setup_google_credentials.py --test")


if __name__ == "__main__":
    main()
