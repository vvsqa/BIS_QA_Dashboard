# Database Reset Scripts

These scripts help you reset the database while preserving user-created data.

## Prerequisites

1. SSH access to the live server
2. PostgreSQL access (psql command)
3. Supervisor access for backend management
4. All API keys configured in `backend/.env`

## Scripts Overview

| Script | Description |
|--------|-------------|
| `01_export_data.sh` | Exports all user-created data to CSV files |
| `02_create_fresh_db.sh` | Drops and recreates the database with fresh tables |
| `03_import_core_data.sh` | Imports employees, users, and core tables |
| `04_sync_external_data.sh` | Syncs PM Tracker, Redmine, TestRail, Google Sheets |
| `05_import_planning_data.sh` | Imports planning tables (after tickets synced) |
| `06_verify_and_restart.sh` | Verifies data and restarts services |

## Quick Start

```bash
# 1. Navigate to backend directory
cd /development_hosting/python/fast-api/BIS_QA_Dashboard/backend

# 2. Copy scripts to server (if not already there)
git pull

# 3. Make scripts executable
chmod +x scripts/db_reset/*.sh

# 4. Run scripts in order
cd scripts/db_reset
./01_export_data.sh
./02_create_fresh_db.sh
./03_import_core_data.sh
./04_sync_external_data.sh
./05_import_planning_data.sh
./06_verify_and_restart.sh
```

## Configuration

Before running, update these values in each script:

```bash
DB_HOST="localhost"
DB_USER="postgres"          # Your PostgreSQL username
DB_NAME="qa_dashboard"      # Database name
BACKEND_DIR="/development_hosting/python/fast-api/BIS_QA_Dashboard/backend"
```

## Required Environment Variables

Ensure `backend/.env` has these configured:

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=qa_dashboard
DB_USER=your_user
DB_PASSWORD=your_password

# PM Tracker
PM_API_KEY=your_key
PM_API_URL=https://www.bissafety.app/rest/v.01/pm/ticket-export

# Redmine
REDMINE_API_KEY=your_key
REDMINE_URL=https://redmine.bissafety.app
REDMINE_PROJECT_IDS=bis-web

# TestRail
TESTRAIL_URL=https://bistrainer.testrail.io
TESTRAIL_EMAIL=your_email
TESTRAIL_API_KEY=your_key
TESTRAIL_PROJECT_ID=14

# Google Sheets
GOOGLE_AUTH_METHOD=oauth2
QA_TIMESHEET_SHEET_ID=your_sheet_id
DEV_TIMESHEET_SHEET_ID=your_sheet_id
```

## Rollback

If something goes wrong, restore from the backup archive:

```bash
# Extract backup
tar -xzvf db_export_backup_YYYYMMDD_HHMMSS.tar.gz

# Re-run import scripts
./03_import_core_data.sh
./05_import_planning_data.sh
```

## Troubleshooting

### Login not working after reset

Check the users table:
```bash
psql -d qa_dashboard -c "SELECT id, email, role, is_active, employee_id FROM users;"
```

### Backend not starting

Check logs:
```bash
sudo supervisorctl tail -f qa_dashboard_8004
```

### Sync failing

Check API keys are configured:
```bash
cat backend/.env | grep -E "API_KEY|URL"
```

### Sequences out of sync

Reset all sequences:
```bash
psql -d qa_dashboard -c "SELECT setval(pg_get_serial_sequence('employees', 'id'), COALESCE(MAX(id), 0) + 1, false) FROM employees;"
```
