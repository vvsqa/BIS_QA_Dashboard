# BIS QA Dashboard – Internal Server Hosting Plan

This document covers **prerequisites**, **deployment steps**, and **what to share with the hosting/ops team** for running the app on your internal server.

---

## 1. Architecture Overview

| Component | Technology |
|-----------|------------|
| Backend API | Python 3.x, FastAPI, Uvicorn |
| Frontend | React (Create React App), built static files |
| Database | PostgreSQL |
| Auth | JWT (Bearer token), bcrypt passwords |
| External data | PM Tracker API (tickets), optional Google Sheets (timesheet sync) |

**Typical production setup:** One server runs **PostgreSQL**, the **backend** (Uvicorn/Gunicorn), and a **web server** (e.g. Nginx) that serves the React build and proxies API requests to the backend.

---

## 2. Server Prerequisites

### 2.1 Hardware & OS

- **OS:** Linux (e.g. Ubuntu 22.04 LTS) or Windows Server. Linux is recommended for easier scripting and process management.
- **RAM:** Minimum 2 GB; 4 GB+ recommended if running DB + backend + Nginx on the same host.
- **Disk:** At least 5 GB free (app + dependencies + DB growth + logs).
- **Network:** Server reachable from internal users; firewall allows HTTP/HTTPS (e.g. 80, 443) from your network.

### 2.2 Software to Install

| Software | Version / notes |
|----------|------------------|
| **Python** | 3.10 or 3.11 (recommended). Used for backend only. |
| **Node.js & npm** | Node 18+ LTS. Required only for **building** the frontend (one-time or on deploy). |
| **PostgreSQL** | 12+ (14+ recommended). Used as the main database. |
| **Git** | To clone the repository. |

Optional but recommended for production:

- **Nginx** (or another reverse proxy): serve frontend, proxy `/api` (or similar) to backend, terminate SSL.
- **Process manager:** `systemd` (Linux) or **Supervisor** to keep the backend running and restart on failure.
- **SSL certificate:** For HTTPS (e.g. internal CA or Let’s Encrypt if applicable).

---

## 3. External Dependencies & Configuration

### 3.1 PM Tracker API (required for ticket data)

- **Purpose:** Syncs ticket/task data into the app.
- **Needed from PM Tracker / your team:**
  - **API base URL** (e.g. `https://www.bissafety.app/rest/v.01/pm/ticket-export`).
  - **API key** (auth header, e.g. `authID`).
- **Used in:** Backend env vars `PM_API_URL`, `PM_API_KEY`. Without a valid key, ticket sync will not work.

### 3.2 Google Sheets (optional – timesheet sync)

- **Purpose:** Optional sync of QA/Dev timesheet data from Google Sheets.
- **Needed:**  
  - Google Cloud project with Sheets API enabled.  
  - Service account or OAuth2 credentials file.  
  - Sheet IDs and tab names for QA and Dev timesheets.  
- **Used in:** Backend config under `backend/config/google_sheets_config.py` and env vars (e.g. `GOOGLE_CREDENTIALS_FILE`, `QA_TIMESHEET_SHEET_ID`, `DEV_TIMESHEET_SHEET_ID`).  
- **Note:** App runs without Google Sheets; then timesheet data would come from other sources or manual entry if applicable.

### 3.3 First-time admin account

- **Purpose:** Login for the first admin user.
- **Default:** New setups use admin email `admin@techversantinfotech.com` (override with env `ADMIN_EMAIL`) so it does not conflict with manager/user logins (e.g. `vishnu.vs@techversantinfotech.com`).
- **If admin and manager currently share the same email:** Log in as admin → **Settings** → **Admin Configuration** → set **Admin Email** to a dedicated address (e.g. `admin@techversantinfotech.com`) and save. After that, use the new email for admin login and the original email for manager login (User table).

---

## 4. Environment Variables

### 4.1 Backend (e.g. `backend/.env` or system env)

**Required:**

| Variable | Description | Example |
|----------|-------------|---------|
| `DB_HOST` | PostgreSQL host | `localhost` or DB server hostname |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_NAME` | Database name | `qa_dashboard` |
| `DB_USER` | Database user | `postgres` or dedicated user |
| `DB_PASSWORD` | Database password | *(secure value)* |
| `JWT_SECRET_KEY` | Secret for signing JWTs | Long random string (e.g. 32+ chars); **must** be different in production |
| `PM_API_KEY` | PM Tracker API key | From PM Tracker / your team |

**Optional (with defaults):**

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | Full DB URL (overrides DB_* if set) | Built from DB_* |
| `PM_API_URL` | PM Tracker API base URL | `https://www.bissafety.app/rest/v.01/pm/ticket-export` |
| `PM_AUTO_SYNC` | Enable PM Tracker auto-sync | `true` |
| `PM_SYNC_INTERVAL_MINUTES` | PM sync interval | `10` |
| `SHEETS_AUTO_SYNC` | Enable Google Sheets sync | `false` |
| `GOOGLE_CREDENTIALS_FILE` | Path to Google credentials JSON | `config/google_credentials.json` |
| `QA_TIMESHEET_SHEET_ID` | QA sheet ID (if using Sheets) | — |
| `DEV_TIMESHEET_SHEET_ID` | Dev sheet ID (if using Sheets) | — |

**Security:** Do **not** commit `.env` or real secrets to the repo. A template is provided at **`backend/.env.example`** – copy to `backend/.env` on the server and fill in values.

### 4.2 Frontend (build-time)

For production build, the frontend must know the backend URL:

| Variable | Description | Example |
|----------|-------------|---------|
| `REACT_APP_API_BASE` | Full backend API base URL (no trailing slash) | `https://qa-dashboard.internal.company.com/api` or `http://server:8000` |

- If the same origin serves frontend and API (e.g. Nginx proxies `/api` to backend), you can set `REACT_APP_API_BASE` to same origin path, e.g. `https://qa-dashboard.internal.company.com/api`.
- Build command: `npm run build` (or `yarn build`). Use the same env when building.

---

## 5. Deployment Steps (summary)

1. **Prepare server:** Install Python 3.10+, Node 18+, PostgreSQL 12+.
2. **Database:** Create DB and user; run migrations / table creation (e.g. `backend/create_tables.py` or your migration flow).
3. **Clone repo:** e.g. `git clone <repo-url>` and checkout the branch/tag to deploy.
4. **Backend:**
   - `cd backend`
   - Create virtualenv: `python -m venv venv` then activate.
   - Install deps: `pip install -r requirements.txt`
   - Create `backend/.env` (or set system env) with all required variables.
   - (Optional) Run any one-off scripts for admin user / seed data.
5. **Frontend:**
   - `cd frontend`
   - `npm ci` or `npm install`
   - Set `REACT_APP_API_BASE` and run `npm run build`. Output is in `frontend/build`.
6. **Run backend:** e.g. `uvicorn main:app --host 0.0.0.0 --port 8000` (or use Gunicorn with Uvicorn workers). Prefer running behind Nginx (reverse proxy) and, if possible, with a process manager (systemd/Supervisor).
7. **Serve frontend:** Configure Nginx (or similar) to serve `frontend/build` for `/` and proxy `/api` (or your API path) to `http://127.0.0.1:8000`.

Detailed step-by-step runbooks can be added in a separate `DEPLOYMENT_RUNBOOK.md` if the ops team wants them.

---

## 6. What to Share with the Other Team

### 6.1 Documents & Repo

| Item | Description |
|------|-------------|
| **This file** (`HOSTING_PLAN.md`) | Prerequisites, env vars, high-level deployment. |
| **Repository URL & branch/tag** | What to clone and which version to deploy. |
| **`.env.example` files** | Backend (and optionally frontend) env template with variable names and short descriptions; no real secrets. |

### 6.2 Configuration to Provide (securely)

| Item | Notes |
|------|--------|
| **Database credentials** | `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME` (or `DATABASE_URL`). Prefer a dedicated DB user with minimal privileges. |
| **JWT secret** | `JWT_SECRET_KEY` – generate a long random string; unique per environment. |
| **PM Tracker API key** | `PM_API_KEY` (and `PM_API_URL` if different from default). Obtain from the team that owns PM Tracker. |
| **Google credentials (if used)** | Credentials file path and any Sheet IDs; restrict access to the backend process only. |
| **Production API URL** | Exact URL the frontend will call (used for `REACT_APP_API_BASE` when building). |

### 6.3 Access & Support

| Item | Description |
|------|-------------|
| **Application URL** | Final URL where users will open the app (e.g. `https://qa-dashboard.internal.company.com`). |
| **First-time admin login** | How to create or retrieve the initial admin account (script name, env vars, or secure handoff). |
| **Contact / escalation** | Who to contact for app bugs, PM API issues, and access (e.g. new users, password reset). |

### 6.4 Operational Details (optional but useful)

| Item | Description |
|------|-------------|
| **Backup** | What to backup (PostgreSQL DB, uploads under `backend/uploads`, any env files if not in a secrets manager). Frequency and retention. |
| **Logs** | Where backend and Nginx logs are written; how to rotate them. |
| **Restart procedure** | How to restart the backend (e.g. `systemctl restart qa-dashboard-api` or Supervisor command). |
| **Health checks** | Backend exposes docs at `/docs` and typically a root or `/health`; Nginx or a load balancer can use these for health checks. |

---

## 7. Quick Checklist for Handoff

- [ ] Server meets prerequisites (Python, Node, PostgreSQL, optional Nginx).
- [ ] Repo cloned; correct branch/tag.
- [ ] PostgreSQL database and user created; tables created/migrated.
- [ ] Backend `.env` (or equivalent) filled with DB, JWT, PM API (and optional Google) values.
- [ ] Frontend built with correct `REACT_APP_API_BASE`.
- [ ] Backend running and reachable (e.g. behind Nginx on 80/443).
- [ ] Frontend served and API calls work (login, dashboard load).
- [ ] Hosting team has this plan, `.env.example`, and contact/support info.
- [ ] Backup and restart procedures documented or communicated.

---

## 8. Optional: Stricter Production Settings

- **CORS:** In production, consider replacing `allow_origins=["*"]` in `backend/main.py` with the exact frontend origin(s).
- **JWT:** Use a strong `JWT_SECRET_KEY` and consider shorter token expiry if your auth flow allows.
- **HTTPS:** Use TLS for the app URL; Nginx can terminate SSL.
- **Secrets:** Prefer a secrets manager or server env over committing `.env` to the repo.

If you want, a separate **`.env.example`** can be added under `backend/` (and optionally `frontend/`) with the variable names and placeholder values only.
