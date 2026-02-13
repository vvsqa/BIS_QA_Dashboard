# TestRail Data – DevOps Runbook

This document tells the DevOps team how to get **TestRail** test plans, runs, cases, and results into the QA Dashboard so the live app shows TestRail data (e.g. on the ticket dashboard and Redmine & TestRail view).

---

## 1. How TestRail data is used

- The app **does not** call TestRail API at request time. It reads from the **database** (tables: `test_plans`, `test_runs`, `test_cases`, `test_results`).
- A **sync script** (`sync_testrail_to_db.py`) pulls data from the TestRail API and writes it to the database. Until this script is run (and kept up to date), the live app will show **no** TestRail data.

---

## 2. One-time setup

### 2.1 TestRail API access

- In **TestRail**: **My Settings → API Keys** (or your instance’s equivalent). Generate an API key.
- Note your **TestRail base URL** (e.g. `https://bistrainer.testrail.io`) and the **Project ID** (numeric, e.g. `14` for “BIS Web and Mobile”).

### 2.2 Environment variables on the QA Dashboard backend

Set these where the backend runs (e.g. `.env` in the backend directory, or container/host env):

| Variable | Required | Example | Description |
|----------|----------|---------|-------------|
| `TESTRAIL_URL` | No (has default) | `https://bistrainer.testrail.io` | Base URL of the TestRail instance (no trailing slash). |
| `TESTRAIL_EMAIL` | **Yes** | `your-email@company.com` | TestRail account email (used with API key for Basic auth). |
| `TESTRAIL_API_KEY` | **Yes** | (from TestRail) | API key from TestRail (see above). |
| `TESTRAIL_PROJECT_ID` | No | `14` | Numeric project ID to sync. Default is `14`. |

**Important:** Without `TESTRAIL_EMAIL` and `TESTRAIL_API_KEY`, the sync script cannot fetch data.

### 2.3 Linking TestRail plans to PM Tracker tickets

For TestRail data to show under the correct **ticket** in the dashboard, test **plan names** in TestRail must follow this format:

- **Format:** `ticket_id_plan_title`
- **Example:** `18400_Guru Training Center - Regression` → ticket ID `18400`

Only plans whose name starts with a numeric ticket ID (e.g. `18400_`) are synced and linked to that ticket. Plans that don’t match are skipped.

---

## 3. Running the sync (no built-in auto-sync)

There is **no** TestRail auto-sync started by the backend (unlike Redmine). You must run the sync script and/or schedule it yourself.

### 3.1 Manual sync

From the **backend** directory, with `.env` (or env vars) set:

```bash
cd backend
# Ensure .env has TESTRAIL_URL, TESTRAIL_EMAIL, TESTRAIL_API_KEY, TESTRAIL_PROJECT_ID
python sync_testrail_to_db.py
```

The script loads `.env` from the backend directory when run manually. It fetches all plans for the project, then for each plan whose name contains a ticket ID, it syncs runs, cases, and results into the database.

### 3.2 Automatic sync (recommended for live)

To keep TestRail data up to date in the live app, schedule the same command, for example:

- **Cron (Linux):** e.g. every 15 minutes  
  `*/15 * * * * cd /path/to/qa-dashboard-app/backend && python sync_testrail_to_db.py`
- **Task Scheduler (Windows):** Create a task that runs `python sync_testrail_to_db.py` from the backend directory at the desired interval.
- Or use any other scheduler (e.g. CI job, systemd timer) that runs the script with the same environment the backend uses.

Use the same `.env` (or env) as the backend so `TESTRAIL_*` and DB settings are correct.

---

## 4. Optional: email notification after sync

The script can send an email when sync finishes (success or failure). Optional env vars:

| Variable | Required | Description |
|----------|----------|-------------|
| `SMTP_SERVER` | No | e.g. `smtp.gmail.com` |
| `SMTP_PORT` | No | e.g. `587` |
| `SMTP_USERNAME` | No | Sender email |
| `SMTP_PASSWORD` | No | App password / SMTP password |
| `NOTIFICATION_EMAIL` | No | Recipient email |

If `SMTP_PASSWORD` is not set, the script skips sending email and continues normally.

---

## 5. Summary checklist for DevOps

1. Get **TestRail URL**, **email**, **API key**, and **Project ID**.
2. Set **`TESTRAIL_URL`**, **`TESTRAIL_EMAIL`**, **`TESTRAIL_API_KEY`**, and **`TESTRAIL_PROJECT_ID`** in the backend environment (e.g. `.env`).
3. Run **`python sync_testrail_to_db.py`** from the backend directory at least once to populate the database.
4. Schedule the same script (e.g. cron every 15 minutes) so the live app keeps showing up-to-date TestRail data.
5. Ensure TestRail **plan names** use the `ticket_id_plan_title` format so data appears under the right ticket.

After this, TestRail data will be available in the live app (ticket dashboard, Redmine & TestRail view, etc.).
