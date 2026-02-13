# Google Sheets (Timesheet) Data – DevOps Runbook

This document tells the DevOps team how to get **timesheet data from Google Sheets** into the QA Dashboard so the live app shows calendar/timesheet data (e.g. Calendar module, timesheet entries).

---

## 1. How Google Sheets data is used

- The app syncs data **from** Google Sheets **into** the database (e.g. `enhanced_timesheet`, `leave_entries`). The frontend and API read from the database, not from Sheets at request time.
- The backend can run an **auto-sync** when `SHEETS_AUTO_SYNC=true`: it starts a scheduler that periodically runs the sync. If credentials or sheet IDs are missing or wrong, **no data** will appear in the live app.

---

## 2. One-time setup

### 2.1 Choose authentication method

The app supports two ways to access Google Sheets:

| Method | Use when |
|--------|----------|
| **OAuth2** | Sheets are owned by or shared with a **personal/team Google account**. You run a one-time browser flow to get a `token.json`. |
| **Service account** | Sheets are **shared with a service account email**. You place a single JSON key file on the server. |

Config is controlled by **`GOOGLE_AUTH_METHOD`**: `oauth2` (default) or `service_account`.

---

### 2.2 Option A: OAuth2 (default)

1. **Google Cloud Console**
   - Create or select a project.
   - Enable **Google Sheets API**.
   - Create **OAuth 2.0 Client ID** (e.g. “Desktop app” or “Web application”).
   - Download the client JSON and save it as the **OAuth2 credentials file** (see env table below).

2. **On the server (one-time)**
   - Place the OAuth2 client JSON in the backend, e.g. `backend/config/oauth2_credentials.json` (or path set by `OAUTH2_CREDENTIALS_FILE`).
   - Run the OAuth2 setup so the app can get a refresh token:
     ```bash
     cd backend
     python setup_oauth2.py --credentials config/oauth2_credentials.json
     ```
   - Complete the browser login with the **Google account that has access to the timesheet sheets**. This creates `config/token.json` (or path set by `OAUTH2_TOKEN_FILE`).

3. **Environment variables** (see table in §2.4). At minimum, set sheet IDs and sheet names if different from defaults; ensure `GOOGLE_AUTH_METHOD=oauth2` (or leave unset).

---

### 2.3 Option B: Service account

1. **Google Cloud Console**
   - Enable **Google Sheets API**.
   - Create a **Service account**, download its JSON key.

2. **Share the Google Sheets with the service account**
   - Open each timesheet spreadsheet (QA and Dev).
   - Share with the **service account email** (e.g. `xxx@yyy.iam.gserviceaccount.com`) with “Viewer” (or “Editor” if you ever write). Without this, the sync will fail with permission errors.

3. **On the server**
   - Place the service account JSON in the backend, e.g. `backend/config/google_credentials.json` (or path set by `GOOGLE_CREDENTIALS_FILE`).

4. **Environment**
   - Set `GOOGLE_AUTH_METHOD=service_account` and, if needed, `GOOGLE_CREDENTIALS_FILE` to the path of that JSON (relative to backend or absolute).

---

### 2.4 Environment variables (backend)

Set these where the backend runs (e.g. `.env` in the backend directory, or container/host env):

| Variable | Required | Example | Description |
|----------|----------|---------|-------------|
| `GOOGLE_AUTH_METHOD` | No | `oauth2` or `service_account` | Default `oauth2`. |
| **OAuth2** | | | |
| `OAUTH2_CREDENTIALS_FILE` | No | `config/oauth2_credentials.json` | Path to OAuth2 client JSON (relative to backend dir). |
| `OAUTH2_TOKEN_FILE` | No | `config/token.json` | Path to token file created by `setup_oauth2.py`. |
| **Service account** | | | |
| `GOOGLE_CREDENTIALS_FILE` | No | `config/google_credentials.json` | Path to service account JSON (relative to backend dir). |
| **Sheet IDs and names** | | | |
| `QA_TIMESHEET_SHEET_ID` | No | (from sheet URL) | QA timesheet spreadsheet ID (from `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit`). |
| `DEV_TIMESHEET_SHEET_ID` | No | (from sheet URL) | Dev timesheet spreadsheet ID. |
| `QA_SHEET_NAME` | No | `BIS - QA` | Name of the **tab/sheet** for QA (inside the QA spreadsheet). |
| `DEV_SHEET_NAME` | No | `Web` | Name of the **tab/sheet** for Dev (inside the Dev spreadsheet). |
| **Sync behaviour** | | | |
| `SHEETS_AUTO_SYNC` | No | `true` | Set to `true` to start automatic sync when the backend starts. |
| `SHEETS_SYNC_INTERVAL` | No | `5` | Interval in **minutes** between syncs (e.g. 5). |
| `SHEETS_REALTIME_SYNC` | No | `true` | When true, uses 2-minute intervals for “realtime” mode. |

**Important:** If `SHEETS_AUTO_SYNC` is not `true`, the scheduler does not run and no Sheets data will be synced unless you trigger a manual sync via the API.

---

## 3. Automatic sync (when backend runs)

- When the **backend starts**, it checks `SHEETS_AUTO_SYNC`. If `true`, it starts the **Google Sheets sync scheduler**.
- The scheduler runs the sync every few minutes (see `SHEETS_SYNC_INTERVAL` / `SHEETS_REALTIME_SYNC`). No separate cron is required for normal operation.

**Check that sync is running:**

- `GET /sync/google-sheets/status` – returns whether the scheduler is running and last sync info.
- Trigger a manual sync: `POST /sync/google-sheets/start` (optional query params: `realtime=true`, `interval_minutes=5`).

---

## 4. Manual sync (optional)

If you need a one-off sync (e.g. after changing sheet IDs):

- Use the API: `POST /sync/google-sheets/start`.
- Or run the sync in code/script by instantiating `GoogleSheetsSync` and calling `sync_all()` (same as the scheduler uses).

---

## 5. Column mapping (if your sheet layout differs)

The app maps columns using names. Defaults are in `config/google_sheets_config.py` and can be overridden with env vars, for example:

- `COL_EMPLOYEE_NAME` (default e.g. `Tester` for QA)
- `COL_DATE`, `COL_TICKET_ID`, `COL_HOURS`, `COL_LEAVE_TYPE`, `COL_TASK_DESC`, `COL_PROJECT`

If your sheet headers differ, set these to match your header row so the sync can find employee name, date, ticket, hours, leave type, etc.

---

## 6. Summary checklist for DevOps

1. Choose **OAuth2** or **Service account** and complete the corresponding setup (credentials file +, for OAuth2, `setup_oauth2.py` and browser login).
2. Place credential files under `backend/config/` (or paths set by env) so the backend can read them.
3. Set **`QA_TIMESHEET_SHEET_ID`** and **`DEV_TIMESHEET_SHEET_ID`** (and **`QA_SHEET_NAME`** / **`DEV_SHEET_NAME`** if different from defaults).
4. Set **`SHEETS_AUTO_SYNC=true`** so the live app syncs Sheets data on startup and keeps it updated.
5. Restart the backend and check **`GET /sync/google-sheets/status`** to confirm the scheduler is running and data is syncing.

After this, timesheet data from Google Sheets will be available in the live app (Calendar module, timesheet views, etc.).
