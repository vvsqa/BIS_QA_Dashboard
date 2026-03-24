# Google Sheets Export Setup Guide

This guide explains how to set up automatic export of PM Tool and TestRail data to Google Sheets.

## What Gets Exported

The following sheets are created/updated every hour:

| Sheet Name | Description | Data Source |
|------------|-------------|-------------|
| `PM_Tickets` | All tickets from PM Tool | PM Tracker API |
| `PM_Status_History` | Ticket status change history | PM Tracker API |
| `TestRail_Runs` | Test runs | TestRail Project 18 |
| `TestRail_Cases` | Test cases with automation status | TestRail Project 18 |
| `TestRail_Bugs` | Bug tracking data | Redmine |
| `TestRail_Results` | Test execution results | TestRail |
| `_Sync_Info` | Sync metadata and timestamps | System |

---

## Setup Steps

### Step 1: Google Cloud Project Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)

2. **Create a new project** (or select an existing one):
   - Click on the project dropdown at the top of the page
   - Click "New Project"
   - Enter a name (e.g., "QA Dashboard Export")
   - Click "Create"

3. **Enable the Google Sheets API**:
   - In the left sidebar, go to "APIs & Services" → "Library"
   - Search for "Google Sheets API"
   - Click on "Google Sheets API"
   - Click "Enable"

### Step 2: Create a Service Account

1. Go to "APIs & Services" → "Credentials"

2. Click "Create Credentials" → "Service Account"

3. Fill in the service account details:
   - **Name**: `qa-dashboard-export` (or any name you prefer)
   - **Description**: "Exports QA dashboard data to Google Sheets"
   - Click "Create and Continue"

4. Skip the "Grant access" section (click "Continue")

5. Click "Done"

### Step 3: Create and Download the JSON Key

1. On the Credentials page, click on the service account you just created

2. Go to the "Keys" tab

3. Click "Add Key" → "Create new key"

4. Select "JSON" format

5. Click "Create"
   - This downloads a JSON file to your computer

6. **Important**: Save this file as:
   ```
   backend/credentials/sheets_export_credentials.json
   ```

### Step 4: Create or Share the Google Sheet

1. **Create a new Google Sheet** or use your existing one:
   - Go to [Google Sheets](https://sheets.google.com)
   - Create a new spreadsheet
   - Name it (e.g., "QA Dashboard Data Export")

2. **Get the Spreadsheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_HERE/edit
   ```
   The spreadsheet ID is the long string between `/d/` and `/edit`

3. **Share the sheet with the service account**:
   - Open your JSON credentials file
   - Find the `client_email` field (looks like: `qa-dashboard-export@your-project.iam.gserviceaccount.com`)
   - In your Google Sheet, click "Share"
   - Paste the service account email
   - Give it "Editor" access
   - Click "Send" (you can uncheck "Notify people")

### Step 5: Configure Environment Variables

Add these to your `backend/.env` file:

```env
# Google Sheets Export Configuration
SHEETS_EXPORT_CREDENTIALS_FILE=credentials/sheets_export_credentials.json
SHEETS_EXPORT_SPREADSHEET_ID=1syijUiNk3yfDgdVnZcr2eWJ4RfSghae1zLT741AaTA0
SHEETS_EXPORT_AUTO_SYNC=true
```

Replace the spreadsheet ID with your actual ID.

### Step 6: Install Required Packages

Make sure you have the Google API packages installed:

```bash
pip install google-auth google-api-python-client
```

### Step 7: Restart the Backend

Restart your FastAPI backend server. You should see:

```
[OK] Google Sheets Export auto-sync started (exports every hour)
```

---

## PM_Tickets Sheet Columns

| Column | Description |
|--------|-------------|
| Ticket ID | PM Tracker ticket number |
| Title | Ticket title |
| Status | Current status (e.g., "QC Testing", "BIS Testing") |
| Priority | URGENT, High (Bugs), Medium, Low |
| Subdepartment | Web, Mobile, BIS |
| Backend Developer | Assigned backend developer |
| Frontend Developer | Assigned frontend developer |
| QC Tester | Assigned QA tester |
| Current Assignee | Current person responsible |
| ETA | Expected completion date |
| Dev Estimate (hrs) | Estimated development hours |
| Actual Dev (hrs) | Actual development hours spent |
| QA Estimate (hrs) | Estimated QA hours |
| Actual QA (hrs) | Actual QA hours spent |
| Created On | Ticket creation date |
| Updated On | Last update date |
| Closed On | When ticket was closed |
| In PM Tracker | Yes/No - whether ticket exists in PM |
| Last PM Sync | Last time ticket was synced |

---

## PM_Status_History Sheet Columns

| Column | Description |
|--------|-------------|
| Ticket ID | PM Tracker ticket number |
| Previous Status | Status before the change |
| New Status | Status after the change |
| Changed On | When the status changed |
| Current Assignee | Who was assigned when status changed |
| QC Tester | QA tester at time of change |
| Duration in Previous (hrs) | Hours spent in previous status |
| Source | How change was detected (sync, api, manual) |

---

## TestRail_Cases Sheet Columns

| Column | Description |
|--------|-------------|
| Case ID | TestRail case ID |
| Test ID | TestRail test ID (unique per run) |
| Run ID | TestRail run ID |
| Ticket ID | Associated PM ticket |
| Title | Test case title |
| Section | Test case section/category |
| Priority | Test priority |
| Automation Status | Automated, Planned, Not Automatable |
| Automation Candidate | Yes, No |
| Execution Method | Automated, Manual |
| Reusability | High, Medium, Low |
| Maintenance | None, Low, Medium, High |
| Status | Pass, Fail, Blocked, etc. |
| Business Criticality | High, Medium, Low |
| Functionality | Feature area |
| Sub-Functionality | Sub-feature |
| Life Cycle Status | Active, Deprecated |
| Est. Hours | Estimated automation hours |
| Actual Hours | Actual automation hours |
| Planned On | When marked as "Planned" |
| Automated On | When marked as "Automated" |

---

## API Endpoints

### Check Export Status

```
GET /sync/sheets-export/status
```

Returns:
```json
{
  "configured": true,
  "credentials_file": true,
  "spreadsheet_id": true,
  "auto_sync_enabled": true,
  "google_api_available": true,
  "spreadsheet_url": "https://docs.google.com/spreadsheets/d/..."
}
```

### Trigger Manual Export

```
POST /sync/sheets-export/trigger
```

Forces an immediate export of all data.

---

## Troubleshooting

### "Google Sheets service not initialized"
- Check that the credentials file exists at the specified path
- Verify the JSON file is valid
- Make sure the Google Sheets API is enabled in your Google Cloud project

### "Permission denied" or 403 error
- Ensure you've shared the Google Sheet with the service account email
- The service account needs Editor access, not just Viewer

### "File not found" for credentials
- Check the path in `SHEETS_EXPORT_CREDENTIALS_FILE`
- If using a relative path, it's relative to the `backend/` folder

### Export not running automatically
- Verify `SHEETS_EXPORT_AUTO_SYNC=true` is in your .env file
- Check the backend logs for any startup errors
- The scheduler runs every 1 hour; check `_Sync_Info` sheet for last sync time

---

## Security Notes

- **Never commit** the `credentials/` folder or any `*.credentials.json` files to git
- The `.gitignore` already excludes these files
- Service account credentials have limited scope (only Google Sheets access)
- Consider rotating the service account key periodically
