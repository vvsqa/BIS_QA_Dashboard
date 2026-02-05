# QA Dashboard – Hosting & Deployment Guide

This document lists everything needed to host the QA Dashboard app: environment variables, API keys, database, Excel/Google Sheets data sources, and optional features.

---

## 1. Overview

- **Frontend:** React app (build with `npm run build`); serve static files or use a reverse proxy.
- **Backend:** FastAPI (Python); run with `uvicorn main:app --host 0.0.0.0 --port 8000` (or your port). Depends on `requests` for PM Tracker API.
- **Database:** PostgreSQL.
- **Data sources:** PM Tracker API (tickets), Google Sheets (timesheets), Excel imports (tickets, employees, PM exports).

---

## 2. Quick start – how to run

### Local (development)

1. **Start the backend** (from project root):
   ```bash
   cd backend
   pip install -r requirements.txt
   # Create backend/.env with DB_*, JWT_SECRET_KEY, PM_API_KEY (see §2.1)
   python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
   ```
   Or double‑click `start-backend.bat` (Windows); it runs the same from the project root.

2. **Start the frontend** in a **second terminal**:
   ```bash
   cd frontend
   npm install
   npm start
   ```
   The app opens at http://localhost:3000. The frontend is configured to proxy API calls to port 8000, so you **do not need** to set `REACT_APP_API_BASE` for local dev. If you already have `REACT_APP_API_BASE=http://localhost:8000` in `frontend/.env.development`, that also works.

3. Reports (preview/download) will call the backend on port 8000 (via proxy or `REACT_APP_API_BASE`). If you see “Failed to fetch”, ensure the backend is running and reachable on port 8000.

### Deployed (production)

1. **Backend:** Run the FastAPI app on your server (e.g. with uvicorn behind Nginx). Example:
   ```bash
   cd backend
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```
   Use a process manager (systemd, Docker, etc.) and set all required env vars in §3.

2. **Frontend:** Build with the **full backend URL** so the browser can call your API:
   ```bash
   cd frontend
   REACT_APP_API_BASE=https://your-api.example.com npm run build
   ```
   Replace `https://your-api.example.com` with your real backend URL (no trailing slash). Then serve the `build/` folder with Nginx, Apache, or any static host.

3. **If backend and frontend are on the same domain** (e.g. Nginx serves `/api` → backend and `/` → frontend), you can set:
   ```bash
   REACT_APP_API_BASE=   # empty
   ```
   and configure the app to use relative API paths (e.g. `/api`). The current app uses `REACT_APP_API_BASE` when set; when empty it uses relative paths for reports and falls back to `hostname:8000` in some modules.

---

## 3. Environment Variables

### 3.1 Backend (`.env` in `backend/` or system env)

Copy `backend/.env.example` to `backend/.env` and set values. **Do not commit `.env`.**

#### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DB_HOST` | PostgreSQL host | `localhost` or DB server hostname |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_NAME` | Database name | `qa_dashboard` |
| `DB_USER` | Database user | `postgres` |
| `DB_PASSWORD` | Database password | (secure password) |
| `JWT_SECRET_KEY` | Secret for JWT tokens (min 32 chars) | Long random string; **change in production** |
| `PM_API_KEY` | PM Tracker API key (authID header) | From PM Tracker / BIS provider |

**Alternative to DB_*:** set a single connection URL:

- `DATABASE_URL=postgresql+psycopg2://user:password@host:5432/qa_dashboard`

#### Optional – PM Tracker (backend)

| Variable | Description | Default |
|----------|-------------|---------|
| `PM_API_URL` | PM Tracker ticket export endpoint | `https://www.bissafety.app/rest/v.01/pm/ticket-export` |
| `PM_API_TIMEOUT` | Request timeout (seconds) | `30` |
| `PM_API_MAX_RETRIES` | Retries on failure | `3` |
| `PM_API_MAX_RETRIES` | Delay between retries (seconds) | `5` |
| `PM_AUTO_SYNC` | Enable auto sync from PM API | `true` |
| `PM_SYNC_INTERVAL_MINUTES` | Auto sync interval | `10` |
| `PM_SYNC_LOGGING` | Log sync operations | `true` |
| `PM_STORE_SYNC_HISTORY` | Store sync history in DB | `true` |
| `PM_SYNC_HISTORY_RETENTION_DAYS` | Days to keep sync history | `30` |

#### Optional – Google Sheets (Timesheets)

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_CREDENTIALS_FILE` | Service account JSON path (relative to backend) | `config/google_credentials.json` |
| `GOOGLE_AUTH_METHOD` | `service_account` or `oauth2` | `oauth2` |
| `OAUTH2_CREDENTIALS_FILE` | OAuth2 client JSON (if using oauth2) | `config/oauth2_credentials.json` |
| `OAUTH2_TOKEN_FILE` | OAuth2 token cache | `config/token.json` |
| `QA_TIMESHEET_SHEET_ID` | Google Sheet ID for QA timesheet | (from Sheet URL) |
| `DEV_TIMESHEET_SHEET_ID` | Google Sheet ID for Dev timesheet | (from Sheet URL) |
| `QA_SHEET_NAME` | Tab/sheet name for QA | `BIS - QA` |
| `DEV_SHEET_NAME` | Tab/sheet name for Dev | `Web` |
| `COL_EMPLOYEE_NAME` | Column header for employee name | `Tester` (QA) / `Developer` (Dev) |
| `COL_DATE` | Column header for date | `Date` |
| `COL_TICKET_ID` | Column header for ticket | `Ticket` |
| `COL_HOURS` | Column header for hours | `Time Spent` |
| `COL_LEAVE_TYPE` | Column header for leave | `Leave` |
| `COL_TASK_DESC` | Column header for task | `Task` |
| `COL_PROJECT` | Column header for project/status | `Status` |
| `SHEETS_SYNC_INTERVAL` | Sync interval (minutes) | `5` |
| `SHEETS_AUTO_SYNC` | Enable auto sync from Sheets | `true` |
| `SHEETS_REALTIME_SYNC` | Use shorter interval (e.g. 2 min) | `true` |

If you do not use Google Sheets, leave these unset or set `SHEETS_AUTO_SYNC=false`.

#### Optional – Excel / file paths

| Variable | Description | Default |
|----------|-------------|---------|
| `IMPORTS_FOLDER` | Folder for Excel imports (ticket reports, PM exports) | `backend/imports` |
| `DOWNLOADS_FOLDER` | Folder scanned for `Employee_Profiles_Export_*.xlsx` and ticket reports | OS Downloads folder |

Used for:

- Ticket data: Excel files (e.g. `TicketReport_*.xlsx`) placed in `IMPORTS_FOLDER` or synced from `DOWNLOADS_FOLDER`.
- PM Tracker: Excel export can be imported via API/scripts; PM API is the main source when `PM_API_KEY` is set.
- Employee profiles: Export file name pattern `Employee_Profiles_Export_*.xlsx`; can be in `DOWNLOADS_FOLDER` or path provided to API.

#### Optional – First-time admin user

| Variable | Description | Default |
|----------|-------------|---------|
| `ADMIN_EMAIL` | Email for initial admin (when creating auth tables) | `admin@techversantinfotech.com` |
| `ADMIN_DEFAULT_PASSWORD` | Initial admin password | `admin123` |

**Change these for production** and run user/auth setup (e.g. `add_user_auth_tables.py`) once.

---

## 4. Frontend (build-time / runtime)

| Variable | Description | When to set |
|----------|-------------|-------------|
| `REACT_APP_API_BASE` | Full backend API base URL | Set when frontend is not served from same host as backend (e.g. `https://api.yourdomain.com`). If empty in dev, app uses proxy or `http://hostname:8000`. |

For production build:

```bash
# Example: backend at https://api.yourdomain.com
REACT_APP_API_BASE=https://api.yourdomain.com npm run build
```

---

## 5. API Keys & External Services

### 4.1 PM Tracker API (required for ticket sync and QA planning)

- **What it does:** Fetches tickets (status, ETA, QC tester, QA estimate, etc.) for QA/Dev planning and dashboards.
- **Where to get:** From your PM Tracker / BIS provider (e.g. BIS Safety). Sent as `authID` header.
- **Where to set:** `PM_API_KEY` in backend `.env`.
- **If missing:** Ticket sync and “Refresh” in Add Task will fail; QA planning may work with existing DB data only.

### 5.2 Google Sheets (optional – timesheets)

- **What it does:** Syncs QA/Dev timesheet data from Google Sheets into the app.
- **Setup:**
  - **Service account:** Place JSON key at `backend/config/google_credentials.json` (or path in `GOOGLE_CREDENTIALS_FILE`). Share the Sheets with the service account email.
  - **OAuth2:** Place client JSON at `config/oauth2_credentials.json`, run OAuth flow once to get `config/token.json`.
- **Sheet IDs:** From the Sheet URL: `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit`. Set `QA_TIMESHEET_SHEET_ID` and `DEV_TIMESHEET_SHEET_ID`.
- **Column names:** Must match your sheet headers; override with `COL_*` env vars if different from defaults.

### 4.3 Redmine (optional – bugs)

- Used for bug sync if enabled; API key is in `sync_redmine_to_db.py`. Prefer env/config for production (not hardcoded).

---

## 5. Excel Sheets & File-Based Data

### 6.1 Ticket / PM data

- **PM Tracker API:** Primary source when `PM_API_KEY` is set (recommended).
- **Excel:** Ticket reports (e.g. `TicketReport_YYYYMMDD_HHMMSS.xlsx`) can be placed in:
  - `IMPORTS_FOLDER`, or
  - `DOWNLOADS_FOLDER` (if using watch/script that copies from Downloads).
- Column mapping is in `backend/sync_excel_to_db.py` (e.g. Ticket Number, Status, ETA, QC Tester, etc.). Column names in Excel must match those expected by the sync script.

### 5.2 Employee data

- **Employee profiles export:** File name pattern `Employee_Profiles_Export_*.xlsx`. API can look in `DOWNLOADS_FOLDER` or you can pass a file path. Ensure the export contains the columns expected by the import (see backend import endpoint/docs).

### 6.3 Paths on the server

- Create and set:
  - `IMPORTS_FOLDER`: e.g. `/var/app/qa-dashboard/backend/imports` (writable by app).
  - `DOWNLOADS_FOLDER`: only if you use “watch Downloads” or an API that reads from a fixed path; otherwise optional.
- Ensure `backend/uploads` (profile photos) exists and is writable.

---

## 7. Database Setup

1. Create PostgreSQL database, e.g. `qa_dashboard`.
2. Set `DB_*` or `DATABASE_URL` in backend `.env`.
3. Run migrations / table creation (e.g. `create_tables.py`, and any `add_*` scripts your project uses).
4. (Optional) Seed admin user: run `add_user_auth_tables.py` once with desired `ADMIN_EMAIL` / `ADMIN_DEFAULT_PASSWORD` (or set in env).

---

## 7. Running the App

### Backend

```bash
cd backend
pip install -r requirements.txt
# Set .env or export variables
uvicorn main:app --host 0.0.0.0 --port 8000
```

For production, use a process manager (systemd, supervisord) or ASGI server behind a reverse proxy (e.g. Nginx); keep `JWT_SECRET_KEY` and `DB_PASSWORD` secure.

### Frontend

```bash
# Development (proxy to backend)
npm install && npm start

# Production build
REACT_APP_API_BASE=https://your-backend-url npm run build
# Serve build/ with Nginx, Apache, or a static host.
```

---

## 9. Checklist for Hosting

- [ ] PostgreSQL created; `DB_*` or `DATABASE_URL` set.
- [ ] Tables created (e.g. `create_tables.py` + any `add_*` scripts).
- [ ] `JWT_SECRET_KEY` set to a long random value (production).
- [ ] `PM_API_KEY` set (required for ticket sync and QA planning).
- [ ] `REACT_APP_API_BASE` set for production frontend if backend is on another host.
- [ ] Admin user created and default password changed.
- [ ] (Optional) Google Sheets: credentials and Sheet IDs set; column names match or `COL_*` set.
- [ ] (Optional) Excel: `IMPORTS_FOLDER` (and optionally `DOWNLOADS_FOLDER`) set and writable; Excel column names match sync script.
- [ ] `backend/uploads` (and any custom upload path) writable for profile photos.
- [ ] HTTPS and secure headers in production (handled by reverse proxy/load balancer).

---

## 9. Quick reference – all env vars

```bash
# ----- Required -----
DB_HOST=localhost
DB_PORT=5432
DB_NAME=qa_dashboard
DB_USER=postgres
DB_PASSWORD=your_secure_password
JWT_SECRET_KEY=your-long-random-secret-at-least-32-chars
PM_API_KEY=your-pm-tracker-api-key

# ----- Optional: single DB URL -----
# DATABASE_URL=postgresql+psycopg2://user:password@host:5432/qa_dashboard

# ----- Optional: PM Tracker -----
# PM_API_URL=https://www.bissafety.app/rest/v.01/pm/ticket-export
# PM_AUTO_SYNC=true
# PM_SYNC_INTERVAL_MINUTES=10

# ----- Optional: Google Sheets -----
# GOOGLE_CREDENTIALS_FILE=config/google_credentials.json
# GOOGLE_AUTH_METHOD=oauth2
# QA_TIMESHEET_SHEET_ID=
# DEV_TIMESHEET_SHEET_ID=
# QA_SHEET_NAME=BIS - QA
# DEV_SHEET_NAME=Web
# SHEETS_AUTO_SYNC=true
# SHEETS_SYNC_INTERVAL=5

# ----- Optional: Excel / paths -----
# IMPORTS_FOLDER=backend/imports
# DOWNLOADS_FOLDER=/path/to/downloads

# ----- Optional: Admin seed -----
# ADMIN_EMAIL=admin@yourcompany.com
# ADMIN_DEFAULT_PASSWORD=change-me
```

Frontend (build):

```bash
REACT_APP_API_BASE=https://your-backend-api-url
```

This covers API keys, database, Excel-based data, and Google Sheets for hosting the app.
