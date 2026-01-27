"""
OAuth2 Setup Script for Google Sheets API

Use this when the Google Sheets are owned by someone else and shared with your 
personal Google account.

Prerequisites:
1. Go to Google Cloud Console: https://console.cloud.google.com/
2. Create a new project (or select existing)
3. Enable the Google Sheets API:
   - Go to APIs & Services -> Library
   - Search for "Google Sheets API" and enable it
4. Create OAuth2 Credentials:
   - Go to APIs & Services -> Credentials
   - Click "Create Credentials" -> "OAuth client ID"
   - If prompted, configure OAuth consent screen first:
     * User Type: External
     * App name: QA Dashboard
     * Add your email as test user
   - Application type: Desktop app
   - Name: QA Dashboard Desktop
   - Click Create and Download JSON
5. Place the downloaded JSON file in backend/config/ folder
   or run this script with --credentials flag

Usage:
    python setup_oauth2.py --credentials path/to/client_secret.json
    python setup_oauth2.py --authenticate
    python setup_oauth2.py --test
"""

import os
import sys
import json
import shutil
import argparse

# Add parent to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

CONFIG_DIR = os.path.join(os.path.dirname(__file__), "config")
OAUTH2_CREDENTIALS_FILE = os.path.join(CONFIG_DIR, "oauth2_credentials.json")
TOKEN_FILE = os.path.join(CONFIG_DIR, "token.json")


def setup_credentials(source_file: str) -> bool:
    """Copy OAuth2 credentials file to the config directory."""
    if not os.path.exists(source_file):
        print(f"ERROR: File not found: {source_file}")
        return False
    
    # Validate JSON structure
    try:
        with open(source_file, 'r') as f:
            creds = json.load(f)
        
        # Check for OAuth2 client credentials structure
        if 'installed' not in creds and 'web' not in creds:
            print("ERROR: Invalid OAuth2 credentials file.")
            print("Expected 'installed' or 'web' key in JSON.")
            print("Make sure you downloaded OAuth2 Client ID, not Service Account.")
            return False
        
        client_type = 'installed' if 'installed' in creds else 'web'
        client_id = creds[client_type].get('client_id', 'Unknown')
        
    except json.JSONDecodeError as e:
        print(f"ERROR: Invalid JSON file: {e}")
        return False
    
    # Create config directory if needed
    os.makedirs(CONFIG_DIR, exist_ok=True)
    
    # Copy credentials
    shutil.copy2(source_file, OAUTH2_CREDENTIALS_FILE)
    
    print(f"SUCCESS: OAuth2 credentials copied to {OAUTH2_CREDENTIALS_FILE}")
    print(f"Client ID: {client_id[:50]}...")
    print("\nNext step: Run 'python setup_oauth2.py --authenticate' to log in")
    
    return True


def authenticate():
    """Authenticate with Google and save the token."""
    print("Starting OAuth2 authentication...")
    
    if not os.path.exists(OAUTH2_CREDENTIALS_FILE):
        print(f"ERROR: OAuth2 credentials file not found: {OAUTH2_CREDENTIALS_FILE}")
        print("Run: python setup_oauth2.py --credentials <path>")
        return False
    
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.oauth2.credentials import Credentials
        
        SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly']
        
        # Check if already authenticated
        if os.path.exists(TOKEN_FILE):
            creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
            if creds and creds.valid:
                print("Already authenticated!")
                print(f"Token file: {TOKEN_FILE}")
                return True
        
        # Run authentication flow
        print("\nA browser window will open for you to log in with your Google account.")
        print("Make sure to use the account that has access to the timesheet sheets.\n")
        
        flow = InstalledAppFlow.from_client_secrets_file(OAUTH2_CREDENTIALS_FILE, SCOPES)
        creds = flow.run_local_server(port=0)
        
        # Save token
        with open(TOKEN_FILE, 'w') as token:
            token.write(creds.to_json())
        
        print(f"\nSUCCESS: Authentication complete!")
        print(f"Token saved to: {TOKEN_FILE}")
        print("\nYou can now use the Calendar module to sync data from Google Sheets.")
        
        return True
        
    except ImportError as e:
        print(f"ERROR: Missing dependency: {e}")
        print("Run: pip install google-auth-oauthlib google-api-python-client")
        return False
    except Exception as e:
        print(f"ERROR: Authentication failed: {e}")
        return False


def test_connection():
    """Test the Google Sheets API connection."""
    print("Testing Google Sheets API connection...")
    
    if not os.path.exists(TOKEN_FILE):
        print(f"ERROR: Not authenticated. Token file not found: {TOKEN_FILE}")
        print("Run: python setup_oauth2.py --authenticate")
        return False
    
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        from config.google_sheets_config import GOOGLE_SHEETS_CONFIG
        
        SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly']
        
        # Load credentials
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
        
        if not creds or not creds.valid:
            print("ERROR: Token is invalid or expired.")
            print("Run: python setup_oauth2.py --authenticate")
            return False
        
        # Build service
        service = build('sheets', 'v4', credentials=creds)
        
        print("SUCCESS: Google Sheets API connection established!")
        
        # Test sheet access
        qa_sheet_id = GOOGLE_SHEETS_CONFIG.get('qa_sheet_id')
        dev_sheet_id = GOOGLE_SHEETS_CONFIG.get('dev_sheet_id')
        
        if qa_sheet_id:
            try:
                result = service.spreadsheets().get(spreadsheetId=qa_sheet_id).execute()
                title = result.get('properties', {}).get('title', 'Unknown')
                sheets = result.get('sheets', [])
                sheet_names = [s.get('properties', {}).get('title') for s in sheets]
                print(f"\nQA Sheet Access: OK")
                print(f"  Title: {title}")
                print(f"  Tabs: {', '.join(sheet_names)}")
            except Exception as e:
                print(f"\nQA Sheet Access: FAILED - {e}")
        else:
            print("\nQA Sheet: Not configured")
        
        if dev_sheet_id:
            try:
                result = service.spreadsheets().get(spreadsheetId=dev_sheet_id).execute()
                title = result.get('properties', {}).get('title', 'Unknown')
                sheets = result.get('sheets', [])
                sheet_names = [s.get('properties', {}).get('title') for s in sheets]
                print(f"\nDev Sheet Access: OK")
                print(f"  Title: {title}")
                print(f"  Tabs: {', '.join(sheet_names)}")
            except Exception as e:
                print(f"\nDev Sheet Access: FAILED - {e}")
        else:
            print("\nDev Sheet: Not configured")
        
        return True
        
    except ImportError as e:
        print(f"ERROR: Missing dependency: {e}")
        print("Run: pip install google-api-python-client google-auth-oauthlib")
        return False
    except Exception as e:
        print(f"ERROR: {e}")
        return False


def update_auth_method():
    """Update config to use OAuth2."""
    config_file = os.path.join(CONFIG_DIR, "google_sheets_config.py")
    
    try:
        with open(config_file, 'r') as f:
            content = f.read()
        
        if 'AUTH_METHOD = os.getenv("GOOGLE_AUTH_METHOD", "service_account")' in content:
            content = content.replace(
                'AUTH_METHOD = os.getenv("GOOGLE_AUTH_METHOD", "service_account")',
                'AUTH_METHOD = os.getenv("GOOGLE_AUTH_METHOD", "oauth2")'
            )
            with open(config_file, 'w') as f:
                f.write(content)
            print("Updated config to use OAuth2 authentication method.")
            return True
    except Exception as e:
        print(f"Note: Could not update config file: {e}")
    
    return False


def main():
    parser = argparse.ArgumentParser(
        description="Setup OAuth2 for Google Sheets API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument('--credentials', '-c', type=str,
                        help="Path to OAuth2 client credentials JSON file")
    parser.add_argument('--authenticate', '-a', action='store_true',
                        help="Authenticate with Google (opens browser)")
    parser.add_argument('--test', '-t', action='store_true',
                        help="Test the Google Sheets API connection")
    
    args = parser.parse_args()
    
    if args.credentials:
        success = setup_credentials(args.credentials)
        if success:
            update_auth_method()
        sys.exit(0 if success else 1)
    elif args.authenticate:
        success = authenticate()
        sys.exit(0 if success else 1)
    elif args.test:
        success = test_connection()
        sys.exit(0 if success else 1)
    else:
        parser.print_help()
        print("\n" + "="*60)
        print("Quick Start for OAuth2 (when sheets are owned by others):")
        print("="*60)
        print("1. Go to Google Cloud Console and create OAuth2 credentials")
        print("2. Download the JSON file")
        print("3. Run: python setup_oauth2.py --credentials <path>")
        print("4. Run: python setup_oauth2.py --authenticate")
        print("5. Run: python setup_oauth2.py --test")


if __name__ == "__main__":
    main()
