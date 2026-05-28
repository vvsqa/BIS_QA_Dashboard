# QA Dashboard Sync Setup Guide

This guide helps you set up the QA Dashboard sync scripts on your machine to sync data from TestRail and PM Tool to Google Sheets.

---

## Prerequisites

Before starting, ensure you have:

1. **Windows 10/11** (for batch file execution)
2. **Python 3.9+** installed ([Download Python](https://www.python.org/downloads/))
3. **Git** (optional, for cloning the repository)
4. Access credentials for:
   - TestRail account
   - PM Tool API
   - Google Cloud Console (for Sheets API)

---

## Step 1: Get the Project Files

### Option A: Clone from Git (Recommended)
```bash
git clone <repository-url>
cd qa-dashboard-app
```

### Option B: Copy from Shared Location
Copy the entire `qa-dashboard-app` folder to your machine (e.g., `C:\Projects\qa-dashboard-app`)

---

## Step 2: Install Python Dependencies

Open Command Prompt or PowerShell and navigate to the backend folder:

```bash
cd C:\Projects\qa-dashboard-app\backend
pip install -r requirements.txt
```

If you prefer using a virtual environment (recommended):
```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

---

## Step 3: Configure Environment Variables

### 3.1 Create the .env file

1. Copy the example file:
   ```bash
   copy .env.example .env
   ```

2. Open `.env` in a text editor (Notepad, VS Code, etc.)

### 3.2 Configure TestRail Credentials

Get these from your TestRail account:

1. Log in to TestRail (https://bistrainer.testrail.io)
2. Go to **My Settings** (click your name in top-right)
3. Under **API Keys**, click **Add Key** or copy existing key

Update in `.env`:
```ini
TESTRAIL_URL=https://bistrainer.testrail.io
TESTRAIL_EMAIL=your_email@company.com
TESTRAIL_API_KEY=your_api_key_here
TESTRAIL_PROJECT_ID=14
TESTRAIL_AUTOMATION_PROJECT_ID=18
```

### 3.3 Configure PM Tool Credentials

Get the API key from your PM Tool administrator.

Update in `.env`:
```ini
PM_API_URL=https://www.bissafety.app/rest/v.01/pm/ticket-export
PM_API_KEY=your_pm_api_key_here
```

### 3.4 Configure Google Sheets Export

#### Create a Service Account:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the **Google Sheets API**:
   - Go to APIs & Services → Library
   - Search for "Google Sheets API"
   - Click Enable
4. Create a Service Account:
   - Go to APIs & Services → Credentials
   - Click "Create Credentials" → "Service Account"
   - Give it a name (e.g., "qa-dashboard-sync")
   - Click "Create and Continue" → "Done"
5. Generate a Key:
   - Click on the service account you created
   - Go to "Keys" tab
   - Click "Add Key" → "Create new key" → "JSON"
   - Save the downloaded JSON file

#### Set up the credentials:

1. Create a `credentials` folder in the backend directory:
   ```bash
   mkdir credentials
   ```

2. Copy your downloaded JSON key file to:
   ```
   backend/credentials/sheets_export_credentials.json
   ```

3. Share the Google Sheet with your service account:
   - Open your Google Sheet
   - Click "Share"
   - Add the service account email (looks like: `name@project-id.iam.gserviceaccount.com`)
   - Give it "Editor" access

4. Get the Spreadsheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit
   ```

5. Update in `.env`:
   ```ini
   SHEETS_EXPORT_CREDENTIALS_FILE=credentials/sheets_export_credentials.json
   SHEETS_EXPORT_SPREADSHEET_ID=your_spreadsheet_id_here
   ```

---

## Step 4: Update Batch File Paths

The batch files contain hardcoded paths that need to be updated for your machine.

### 4.1 Find and Replace Paths

Open each `.bat` file in the `backend` folder and replace:

| Find | Replace With |
|------|--------------|
| `D:\Vishnu VS\Projects\qa-dashboard-app` | Your project path (e.g., `C:\Projects\qa-dashboard-app`) |

**Files to update:**
- `testrail_sync.bat`
- `sync_pm_to_sheets.bat`
- `PM_Quick_Sync.bat`
- `Start_PM_Sync_Desktop.bat`
- `Check_Sync_Status.bat`
- Any other `.bat` files you plan to use

### 4.2 Example Update

**Before:**
```batch
cd /d "D:\Vishnu VS\Projects\qa-dashboard-app\backend"
```

**After:**
```batch
cd /d "C:\Projects\qa-dashboard-app\backend"
```

---

## Step 5: Create Desktop Shortcuts (Optional)

1. Right-click on the `.bat` file you want to create a shortcut for
2. Select "Create shortcut"
3. Move the shortcut to your Desktop
4. (Optional) Right-click the shortcut → Properties → Change Icon

**Recommended shortcuts:**
- `testrail_sync.bat` - Sync TestRail data
- `sync_pm_to_sheets.bat` - Sync PM data
- `Check_Sync_Status.bat` - Check sync status

---

## Step 6: Test the Sync

### Test TestRail Sync:
```bash
cd backend
python sync_automation_testrail.py
```

Expected output:
```
Fetching cases from TestRail...
Found X cases
Updating Google Sheet...
Sync complete!
```

### Test PM Sync:
```bash
cd backend
python google_sheets_export.py
```

---

## Step 7: Set Up Automatic Sync (Optional)

### Using Windows Task Scheduler:

1. Open Task Scheduler (search "Task Scheduler" in Start menu)
2. Click "Create Basic Task"
3. Name: "QA Dashboard Sync"
4. Trigger: Daily (or your preferred schedule)
5. Action: Start a program
6. Program: `C:\Projects\qa-dashboard-app\backend\testrail_sync.bat`
7. Finish

---

## Troubleshooting

### Common Issues:

#### "Python not found"
- Ensure Python is installed and added to PATH
- Try: `python --version` in Command Prompt
- If not working, reinstall Python and check "Add to PATH" during installation

#### "Module not found" errors
- Run: `pip install -r requirements.txt`
- If using virtual environment, ensure it's activated: `venv\Scripts\activate`

#### "Permission denied" for Google Sheets
- Ensure the service account email has Editor access to the sheet
- Check that the credentials JSON file path is correct in `.env`

#### "401 Unauthorized" from TestRail
- Verify your TestRail email and API key in `.env`
- Ensure your TestRail account has API access enabled

#### "Connection refused" or timeout errors
- Check your internet connection
- Verify the API URLs in `.env` are correct
- Check if your company firewall blocks the APIs

---

## File Structure Reference

```
qa-dashboard-app/
├── backend/
│   ├── .env                          # Your credentials (DO NOT SHARE)
│   ├── .env.example                  # Template for credentials
│   ├── requirements.txt              # Python dependencies
│   ├── credentials/
│   │   └── sheets_export_credentials.json  # Google service account key
│   ├── sync_automation_testrail.py   # TestRail sync script
│   ├── google_sheets_export.py       # Google Sheets export script
│   ├── testrail_sync.bat             # Batch file for TestRail sync
│   ├── sync_pm_to_sheets.bat         # Batch file for PM sync
│   └── ...
└── frontend/
    └── ...
```

---

## Security Notes

**DO NOT share or commit:**
- `.env` file (contains API keys)
- `credentials/*.json` files (Google service account keys)
- Any file containing passwords or tokens

These files are already in `.gitignore` but be careful when sharing the project folder manually.

---

## Getting Help

If you encounter issues:

1. Check the Troubleshooting section above
2. Review the error message in the Command Prompt window
3. Contact the dashboard administrator with:
   - The error message
   - Which script you were running
   - Your operating system version

---

## Quick Reference Commands

```bash
# Navigate to backend folder
cd C:\Projects\qa-dashboard-app\backend

# Activate virtual environment (if using one)
venv\Scripts\activate

# Run TestRail sync
python sync_automation_testrail.py

# Run PM sync
python google_sheets_export.py

# Run full sync (both)
python sync_automation_testrail.py && python google_sheets_export.py

# Check Python version
python --version

# Install/update dependencies
pip install -r requirements.txt
```

---

*Last updated: March 2026*
