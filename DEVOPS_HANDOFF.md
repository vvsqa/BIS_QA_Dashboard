# DevOps Handoff - QA Dashboard Configuration

This is a quick deployment handoff for environment configuration.

Primary template: `DEPLOYMENT_ENV.example`

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

## 4) Recommended Dev/Staging/Prod Values

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

## 5) Minimal Go-Live Checklist

- Backend starts with no missing env errors.
- DB connectivity works (`/auth/login` responds).
- Frontend build points to correct `REACT_APP_API_BASE`.
- PM/Redmine sync endpoints work if enabled:
  - `/pm-tracker/sync/status`
  - `/redmine/sync/status`
- CORS/domain routing validated in target environment.
- Secrets rotated from any previously exposed defaults.
