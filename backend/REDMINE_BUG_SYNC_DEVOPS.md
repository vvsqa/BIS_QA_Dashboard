# Redmine Bug Data – DevOps Runbook

This document tells the DevOps team how to get bug-related data from the **hosted app** (and any other Redmine projects) into the QA Dashboard and keep it updating automatically.

---

## 1. One-time setup

### 1.1 Redmine API key

- In **Redmine** (hosted app instance): **My account → API access** (or **Administration → Settings → API**). Generate or copy an API key.
- The app uses this key to read issues (bugs) from Redmine. Store it securely (e.g. in your secrets manager / env).

### 1.2 Environment variables on the QA Dashboard backend

Set these where the backend runs (e.g. `.env`, container env, or host env):

| Variable | Required | Example | Description |
|----------|----------|---------|-------------|
| `REDMINE_URL` | No (has default) | `https://redmine.bissafety.app` | Base URL of the Redmine instance (use the **hosted app** Redmine URL if bugs are there). |
| `REDMINE_API_KEY` | **Yes** | `abc123...` | API key from Redmine (see above). |
| `REDMINE_PROJECT_IDS` | No | `bis-web,hosted-app` | Comma-separated **project identifiers** to sync. Default is `bis-web`. **Add the hosted app project identifier here** (e.g. `hosted-app` or whatever the project ID is in Redmine). |
| `REDMINE_AUTO_SYNC` | No | `true` | Set to `true` to enable automatic sync when the backend runs. Default is `true`. |
| `REDMINE_SYNC_INTERVAL_MINUTES` | No | `15` | How often to sync (minutes). Default is `2`. |

**Important:** To include **hosted app** bugs, set `REDMINE_PROJECT_IDS` to include that project, for example:

- If hosted app is the only Redmine:  
  `REDMINE_PROJECT_IDS=hosted-app`
- If you also want the existing project:  
  `REDMINE_PROJECT_IDS=bis-web,hosted-app`

The project identifier is the one used in the Redmine URL or in the project settings (e.g. `https://redmine.example.com/projects/hosted-app` → identifier is `hosted-app`).

### 1.3 Link bugs to PM Tracker tickets (hosted app Redmine)

For bugs to show under the correct ticket in the dashboard, each Redmine issue must have the **PM Tracker ticket ID** in a custom field.

- **Supported custom field names** (any one of these):  
  `Ticket ID`, `PM Tracker ID`, `Ticket Number`, `Reference`, `PM Tracker Ticket`, `Ticket`
- In the **hosted app** Redmine project, create a custom field with one of these names (or use an existing one) and set its value to the **numeric PM Tracker ticket ID** (e.g. `18400`) on each bug.
- If your field has a different name, it can be added to the sync script (see `TICKET_ID_FIELD_NAMES` in `sync_redmine_to_db.py`).

---

## 2. Automatic fetch (recommended)

- When the **backend starts**, it starts a **Redmine auto-sync** job (if `REDMINE_AUTO_SYNC=true`):
  - Runs one full sync shortly after startup.
  - Then runs sync **every `REDMINE_SYNC_INTERVAL_MINUTES`** (default 2).
- So: **no extra cron or task is required** as long as the backend is running and the env vars above are set.

**Check that auto-sync is on:**

- `GET /redmine/sync/status` – returns whether the scheduler is running and last sync result.
- Optionally trigger a sync once: `POST /redmine/sync` (optional query: `?all_bugs=true` to include closed bugs).

---

## 3. Manual sync (optional)

If you need to run a one-off sync (e.g. after changing `REDMINE_PROJECT_IDS`):

```bash
cd backend
# Set REDMINE_URL, REDMINE_API_KEY, REDMINE_PROJECT_IDS if not already in env
python sync_redmine_to_db.py
# Include closed bugs as well:
python sync_redmine_to_db.py --all-bugs
```

---

## 4. Summary checklist for DevOps

1. Get a **Redmine API key** from the **hosted app** Redmine (or the instance that has the bugs).
2. Set **`REDMINE_URL`** to that Redmine base URL (if different from default).
3. Set **`REDMINE_API_KEY`** in the backend environment.
4. Set **`REDMINE_PROJECT_IDS`** to include the **hosted app project identifier** (e.g. `bis-web,hosted-app`).
5. Ensure the **hosted app** Redmine has a custom field for the PM Tracker ticket ID (one of the names in §1.3) and that bugs have that value set.
6. Restart the backend (or deploy with the new env). Auto-sync will run on startup and then every few minutes.
7. (Optional) Check `GET /redmine/sync/status` or run `POST /redmine/sync` once to confirm sync works.

After this, bug data from the hosted app will be ingested and kept up to date automatically.
