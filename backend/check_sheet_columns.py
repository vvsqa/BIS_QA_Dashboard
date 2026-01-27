"""Quick script to check sheet column headers"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from config.google_sheets_config import GOOGLE_SHEETS_CONFIG

TOKEN_FILE = os.path.join(os.path.dirname(__file__), "config", "token.json")
SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly']

creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
service = build('sheets', 'v4', credentials=creds)

# Check QA Sheet - more rows
print("=" * 60)
print("QA SHEET - 'BIS - QA' tab (First 20 rows)")
print("=" * 60)
qa_sheet_id = GOOGLE_SHEETS_CONFIG['qa_sheet_id']
result = service.spreadsheets().values().get(
    spreadsheetId=qa_sheet_id,
    range="'BIS - QA'!A1:J20"
).execute()
values = result.get('values', [])
if values:
    for i, row in enumerate(values, start=1):
        print(f"Row {i}: {row}")
