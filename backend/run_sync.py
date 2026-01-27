"""Run sync for QA and Dev teams"""
from google_sheets_sync import GoogleSheetsSync

s = GoogleSheetsSync()

print("Syncing QA team...")
result = s.sync_team('QA')
print('QA Sync Result:')
print(f"  Rows processed: {result['rows_processed']}")
print(f"  Timesheets added: {result['timesheets_added']}")
print(f"  Timesheets updated: {result['timesheets_updated']}")
print(f"  Leaves added: {result['leaves_added']}")
print(f"  Errors: {result['errors']}")

print("\nSyncing DEV team...")
result = s.sync_team('DEV')
print('DEV Sync Result:')
print(f"  Rows processed: {result['rows_processed']}")
print(f"  Timesheets added: {result['timesheets_added']}")
print(f"  Timesheets updated: {result['timesheets_updated']}")
print(f"  Leaves added: {result['leaves_added']}")
print(f"  Errors: {result['errors']}")

print("\nDone!")
