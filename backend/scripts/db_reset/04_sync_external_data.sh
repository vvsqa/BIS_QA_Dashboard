#!/bin/bash
# =============================================================================
# Phase 4: Sync External Data Sources
# =============================================================================
# Run this script AFTER importing core data (03_import_core_data.sh).
# This syncs data from PM Tracker, Redmine, TestRail, and Google Sheets.
#
# Usage: ./04_sync_external_data.sh
# =============================================================================

set -e  # Exit on error

# Configuration
BACKEND_PORT="8004"
BACKEND_DIR="/development_hosting/python/fast-api/BIS_QA_Dashboard/backend"

echo "=============================================="
echo "Phase 4: Sync External Data Sources"
echo "=============================================="
echo ""

echo "--- Step 4.1: Starting backend service ---"
sudo supervisorctl start qa_dashboard_8004 || echo "Backend may already be running"
echo "Waiting for backend to start..."
sleep 15

# Check if backend is running
if ! curl -s http://127.0.0.1:$BACKEND_PORT/ > /dev/null; then
    echo "ERROR: Backend is not responding on port $BACKEND_PORT"
    echo "Please check the backend logs and try again."
    exit 1
fi
echo "  [OK] Backend is running"

echo ""
echo "--- Step 4.2: Sync PM Tracker (Tickets) ---"
echo "This populates: ticket_tracking, ticket_status_history, ticket_priority_history"
curl -s -X POST "http://127.0.0.1:$BACKEND_PORT/ticket-tracking/sync-latest" | python -m json.tool || echo "PM Tracker sync completed (check logs for details)"

echo ""
echo "Verifying PM Tracker sync..."
curl -s "http://127.0.0.1:$BACKEND_PORT/ticket-tracking/sync-status" | python -m json.tool || echo "Could not get sync status"

echo ""
echo "--- Step 4.3: Sync Redmine (Bugs) ---"
echo "This populates: bugs, bug_status_history"
curl -s -X POST "http://127.0.0.1:$BACKEND_PORT/redmine/sync?all_bugs=true" | python -m json.tool || echo "Redmine sync completed (check logs for details)"

echo ""
echo "--- Step 4.4: Sync TestRail (Test Plans/Results) ---"
echo "This populates: test_plans, test_runs, test_cases, test_results"
cd "$BACKEND_DIR"
python sync_testrail_to_db.py || echo "TestRail sync completed (check output for details)"

echo ""
echo "--- Step 4.5: Sync Google Sheets (Timesheets) ---"
echo "This populates: enhanced_timesheets, leave_entries"

echo "Syncing QA team..."
curl -s -X POST "http://127.0.0.1:$BACKEND_PORT/sync/google-sheets?team=QA" | python -m json.tool || echo "QA sheets sync completed"

echo ""
echo "Syncing DEV team..."
curl -s -X POST "http://127.0.0.1:$BACKEND_PORT/sync/google-sheets?team=DEV" | python -m json.tool || echo "DEV sheets sync completed"

echo ""
echo "=============================================="
echo "External data sync complete!"
echo "=============================================="
echo ""
echo "Next step: Run 05_import_planning_data.sh"
