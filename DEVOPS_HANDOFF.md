# DevOps Handoff - QA Dashboard Configuration

This is a quick deployment handoff for environment configuration.

**See also:** [RUNNING.md](./RUNNING.md) for step-by-step **local development** vs **hosted** run instructions.

Primary template: `DEPLOYMENT_ENV.example`

---

## What to do now (hosting after login fix)

Follow these steps so users can log in on the hosted app.

| Step | Action | Notes |
|------|--------|--------|
| **1. Backend env** | In backend `.env` (or env where the app runs), set at least: `DB_*` or `DATABASE_URL`, `JWT_SECRET_KEY`. | See §2 and `DEPLOYMENT_ENV.example`. |
| **2. Deploy latest backend** | Deploy/run the current backend code (with `POST /auth/login` and `POST /login`). Restart the process (e.g. `sudo supervisorctl restart qa_dashboard_8004` or your service name). | Ensures both login routes are available. |
| **3. Proxy → backend** | In nginx (or your reverse proxy), forward **API paths** to the FastAPI backend. Example: `/auth/login`, `/auth/me`, `/login`, and any other `/api/*` or backend paths must go to the backend, not to the static frontend. | If login request hits the static server, you get **404**. |
| **4. Frontend build** | Build the frontend with **`REACT_APP_API_BASE`** set to the **backend** base URL. Example: `REACT_APP_API_BASE=https://api.yourdomain.com` (no trailing slash). Then `npm run build`. | This is baked into the build; empty in prod causes login to hit the wrong host and **404**. |
| **5. Serve frontend** | Serve the built `build/` (or `dist/`) as the app’s static site. Reload proxy after any config change: e.g. `sudo systemctl reload nginx`. | — |
| **6. Verify login** | In the browser: open the app → DevTools → Network → try to log in. Check the login request: **200** = success, **401** = wrong credentials (both mean backend is reached). **404** = request not reaching backend (fix proxy or `REACT_APP_API_BASE`). | See §4 for details. |

**Optional backend check from the server:**

```bash
# Expect 401 (not 404) for invalid credentials
curl -s -o /dev/null -w "%{http_code}" -X POST https://<your-backend-url>/auth/login \
  -H "Content-Type: application/json" -d '{"email":"x@x.com","password":"y"}'
```

---

## 1) Variable Priority

- Backend reads `DATABASE_URL` first (if set), otherwise uses `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`.
- Frontend build/runtime API base comes from `REACT_APP_API_BASE`.
- Local CRA proxy (development only) uses `REACT_APP_DEV_PROXY_TARGET`.

---

## 2) Required vs Optional by Environment

Legend:
- `Required`: must be set for that environment.
- `Optional`: feature-specific; set only if you use that integration.

| Variable | Dev | Staging | Prod | Notes |
|---|---|---|---|---|
| `DATABASE_URL` | Optional | Recommended | Recommended | Preferred single DB connection string. |
| `DB_HOST` | Required* | Required* | Required* | Required if `DATABASE_URL` is not set. |
| `DB_PORT` | Required* | Required* | Required* | Usually `5432`. |
| `DB_NAME` | Required* | Required* | Required* | Database name. |
| `DB_USER` | Required* | Required* | Required* | DB user. |
| `DB_PASSWORD` | Required* | Required* | Required* | DB password. |
| `JWT_SECRET_KEY` | Required | Required | Required | Must be strong/unique per environment. |
| `REACT_APP_API_BASE` | Optional | Required | Required | Frontend backend URL, e.g. `https://api.example.com`. |
| `REACT_APP_DEV_PROXY_TARGET` | Optional | No | No | Dev only; e.g. `http://localhost:8000`. |

\* Required only when `DATABASE_URL` is not provided.

---

## 3) Integration Variables

### PM Tracker (ticket sync)

| Variable | Dev | Staging | Prod | Notes |
|---|---|---|---|---|
| `PM_API_URL` | Required (if enabled) | Required (if enabled) | Required (if enabled) | PM export endpoint. |
| `PM_API_KEY` | Required (if enabled) | Required (if enabled) | Required (if enabled) | Secret key. |
| `PM_AUTO_SYNC` | Optional | Optional | Optional | `true/false` scheduler toggle. |
| `PM_SYNC_INTERVAL_MINUTES` | Optional | Optional | Optional | Default `10`. |
| `PM_API_TIMEOUT` | Optional | Optional | Optional | Default `30`. |
| `PM_API_MAX_RETRIES` | Optional | Optional | Optional | Default `3`. |
| `PM_API_RETRY_DELAY` | Optional | Optional | Optional | Default `5`. |
| `PM_SYNC_LOGGING` | Optional | Optional | Optional | Default `true`. |
| `PM_STORE_SYNC_HISTORY` | Optional | Optional | Optional | Default `true`. |
| `PM_SYNC_HISTORY_RETENTION_DAYS` | Optional | Optional | Optional | Default `30`. |

### Redmine (bug sync)

| Variable | Dev | Staging | Prod | Notes |
|---|---|---|---|---|
| `REDMINE_URL` | Required (if enabled) | Required (if enabled) | Required (if enabled) | Redmine host URL. |
| `REDMINE_API_KEY` | Required (if enabled) | Required (if enabled) | Required (if enabled) | Secret key. |
| `REDMINE_AUTO_SYNC` | Optional | Optional | Optional | Default `true`. |
| `REDMINE_SYNC_INTERVAL_MINUTES` | Optional | Optional | Optional | Default `15`. |

### Google Sheets (timesheet sync, optional)

| Variable | Dev | Staging | Prod | Notes |
|---|---|---|---|---|
| `SHEETS_AUTO_SYNC` | Optional | Optional | Optional | Enable/disable scheduler. |
| `SHEETS_REALTIME_SYNC` | Optional | Optional | Optional | 2-minute mode when true. |
| `SHEETS_SYNC_INTERVAL` | Optional | Optional | Optional | Interval minutes. |
| `GOOGLE_AUTH_METHOD` | Optional | Optional | Optional | `oauth2` or `service_account`. |
| `GOOGLE_CREDENTIALS_FILE` | Optional | Optional | Optional | Service account json path. |
| `OAUTH2_CREDENTIALS_FILE` | Optional | Optional | Optional | OAuth client json path. |
| `OAUTH2_TOKEN_FILE` | Optional | Optional | Optional | OAuth token path. |
| `QA_TIMESHEET_SHEET_ID` | Optional | Optional | Optional | Required if feature enabled. |
| `DEV_TIMESHEET_SHEET_ID` | Optional | Optional | Optional | Required if feature enabled. |
| `QA_SHEET_NAME` | Optional | Optional | Optional | Defaults in code. |
| `DEV_SHEET_NAME` | Optional | Optional | Optional | Defaults in code. |
| `COL_EMPLOYEE_NAME` | Optional | Optional | Optional | Column mapping override. |
| `COL_DATE` | Optional | Optional | Optional | Column mapping override. |
| `COL_TICKET_ID` | Optional | Optional | Optional | Column mapping override. |
| `COL_HOURS` | Optional | Optional | Optional | Column mapping override. |
| `COL_LEAVE_TYPE` | Optional | Optional | Optional | Column mapping override. |
| `COL_TASK_DESC` | Optional | Optional | Optional | Column mapping override. |
| `COL_PROJECT` | Optional | Optional | Optional | Column mapping override. |

### TestRail + notification email (optional)

| Variable | Dev | Staging | Prod | Notes |
|---|---|---|---|---|
| `TESTRAIL_URL` | Required (if enabled) | Required (if enabled) | Required (if enabled) | TestRail base URL. |
| `TESTRAIL_EMAIL` | Required (if enabled) | Required (if enabled) | Required (if enabled) | Account email. |
| `TESTRAIL_API_KEY` | Required (if enabled) | Required (if enabled) | Required (if enabled) | Secret key. |
| `TESTRAIL_PROJECT_ID` | Required (if enabled) | Required (if enabled) | Required (if enabled) | Numeric project id. |
| `SMTP_SERVER` | Optional | Optional | Optional | Needed for email notifications. |
| `SMTP_PORT` | Optional | Optional | Optional | Usually `587`. |
| `SMTP_USERNAME` | Optional | Optional | Optional | Mail account. |
| `SMTP_PASSWORD` | Optional | Optional | Optional | Mail app password/secret. |
| `NOTIFICATION_EMAIL` | Optional | Optional | Optional | Recipient email. |

### Script/helper variables (optional)

| Variable | Dev | Staging | Prod | Notes |
|---|---|---|---|---|
| `IMPORTS_FOLDER` | Optional | Optional | Optional | For import scripts only. |
| `DOWNLOADS_FOLDER` | Optional | Optional | Optional | For import scripts only. |
| `ADMIN_EMAIL` | Optional | Optional | Optional | Used in bootstrap/reset scripts. |
| `ADMIN_DEFAULT_PASSWORD` | Optional | Optional | Optional | Used in bootstrap/reset scripts. |
| `QA_MANAGER_PASSWORD` | Optional | Optional | Optional | Used in setup script. |
| `CLIENT_DEFAULT_PASSWORD` | Optional | Optional | Optional | Default is `BIS@123`; used for admin client create/reset flows. |

---

## 4) Login / Auth (hosting – "unable to login" fix)

- **Backend login endpoints** (both work; use the same handler):
  - **Primary:** `POST /auth/login`
  - **Alias:** `POST /login` (for proxies that expect `/login`)
- **Frontend:** Build must have `REACT_APP_API_BASE` set to the **backend** base URL (e.g. `https://api.yourdomain.com`), no trailing slash. The app calls `${API_BASE}/auth/login`; if `REACT_APP_API_BASE` is empty in production, requests go to the frontend origin and return **404**.
- **Reverse proxy:** Ensure API paths (e.g. `/auth/login`, `/auth/me`, `/login`) are forwarded to the FastAPI backend so the backend returns **200** or **401**, not the static server’s **404**.
- **How to confirm:** Browser → DevTools → Network → trigger Login. Correct: **200 OK** (success) or **401 Unauthorized** (wrong credentials). Wrong: **404 Not Found** (request not reaching backend or wrong base URL).
- After changing env or proxy: rebuild frontend (`npm run build`), reload/restart proxy (e.g. `sudo systemctl reload nginx`), restart backend (e.g. `sudo supervisorctl restart qa_dashboard_8004`).

---

## 5) Recommended Dev/Staging/Prod Values

- `Dev`
  - Backend: local DB or dev DB; weak isolation acceptable.
  - Frontend:
    - `REACT_APP_API_BASE=`
    - `REACT_APP_DEV_PROXY_TARGET=http://localhost:8000`
- `Staging`
  - Use staging DB and staging API keys.
  - `REACT_APP_API_BASE=https://<staging-api-domain>`
  - Keep schedulers on only if staging data sync is intended.
- `Prod`
  - Use managed secret store (not plain files in repo).
  - `REACT_APP_API_BASE=https://<prod-api-domain>`
  - Strong unique `JWT_SECRET_KEY`.
  - Principle of least privilege for all API/database credentials.

---

## 6) Minimal Go-Live Checklist

- Backend starts with no missing env errors.
- DB connectivity works (`/auth/login` responds).
- Frontend build points to correct `REACT_APP_API_BASE`.
- PM/Redmine sync endpoints work if enabled:
  - `/pm-tracker/sync/status`
  - `/redmine/sync/status`
- CORS/domain routing validated in target environment.
- Secrets rotated from any previously exposed defaults.
