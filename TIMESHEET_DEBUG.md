# Timesheet Module – Debugging Guide

## Quick checks

1. **Backend running**  
   Open [http://localhost:8000/timesheet/health](http://localhost:8000/timesheet/health). You should see `{"status":"ok","message":"Timesheet API is available"}`.  
   If you get connection refused or 404, start the backend from the `backend` folder:
   ```bash
   python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
   ```

2. **Frontend proxy**  
   In development, the frontend (npm start) proxies `/timesheet`, `/auth`, etc. to the backend. If the timesheet page shows "Timesheet API not found (404)", restart the frontend after starting the backend so the proxy is used.

3. **Logged in with an employee-linked account**  
   The timesheet week API requires `employee_id`. If you log in as **Admin** and the admin user has no employee ID, you will get:
   - *"Your account is not linked to an employee. Ask an admin to set your employee ID in Settings..."*  
   **Fix:** Use a user that has an employee (e.g. manager/lead/employee), or in the **User** table link the admin’s `employee_id` to an employee record, or use a dedicated admin email and use a separate manager user for timesheet.

4. **Database tables missing**  
   If you see a 500 error mentioning `timesheet_entry_reviews` or "relation ... does not exist", create or update tables so that all timesheet-related tables exist. From the `backend` folder:
   ```bash
   python create_tables.py
   ```
   This creates (among others) `enhanced_timesheets`, `leave_entries`, `timesheet_submissions`, `timesheet_entries`, **`timesheet_entry_reviews`**, `timesheet_approval_log`.  
   If the tables were created before `TimeSheetEntryReview` was added to `create_tables.py`, run `create_tables.py` again; SQLAlchemy `create_all` will add only missing tables.

## Common errors

| Symptom | Cause | Fix |
|--------|--------|-----|
| 404 on `/timesheet/week` | Backend not running or wrong port; or proxy not forwarding | Start backend on 8000; restart frontend (npm start). |
| 401 Unauthorized | Not logged in or token expired | Log in again. |
| 400 "employee_id is required" / "not linked to an employee" | Current user has no `employee_id` (e.g. admin-only account) | Use a user linked to an employee, or set admin’s `employee_id` in User table / Settings. |
| 500 "relation ... does not exist" or "Timesheet error: ... run backend create_tables.py" | Missing DB table (e.g. `timesheet_entry_reviews`) | Run `python create_tables.py` in `backend`. |
| Lock banner "Submit last week's timesheet" | Last week’s timesheet not submitted | Submit last week’s timesheet from the Timesheet page. |
| Empty week / no entries | No data for that week (no sync + no manual entries) | Add manual entries or ensure Google Sheets sync has run and populated `enhanced_timesheets`. |

## API endpoints (for manual checks)

- `GET /timesheet/health` – no auth, confirms API is up.
- `GET /timesheet/week?date=YYYY-MM-DD` – requires auth; returns week data for current user’s `employee_id`.
- `GET /timesheet/lock-status` – requires auth; returns `{ "locked": true/false, ... }`.

Use the backend’s OpenAPI docs at [http://localhost:8000/docs](http://localhost:8000/docs) to call these with a Bearer token.
