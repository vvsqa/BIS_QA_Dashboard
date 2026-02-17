#!/bin/bash
# =============================================================================
# Phase 5: Import Planning Data
# =============================================================================
# Run this script AFTER syncing external data (04_sync_external_data.sh).
# Planning tables depend on ticket_tracking being populated first.
#
# Usage: ./05_import_planning_data.sh
# =============================================================================

set -e  # Exit on error

# Configuration - UPDATE THESE VALUES
DB_HOST="localhost"
DB_USER="postgres"
DB_NAME="qa_dashboard"
EXPORT_DIR="./db_export"

echo "=============================================="
echo "Phase 5: Import Planning Data"
echo "=============================================="
echo ""

# Function to import a table
import_table() {
    local table=$1
    local file="$EXPORT_DIR/$table.csv"
    if [ -f "$file" ]; then
        echo "Importing $table..."
        psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "\COPY $table FROM '$file' WITH CSV HEADER" 2>/dev/null && echo "  [OK] $table imported" || echo "  [ERROR] Failed to import $table"
    else
        echo "  [SKIP] $file not found"
    fi
}

echo "--- Importing Planning Tables ---"
import_table "planned_tasks"
import_table "weekly_plans"
import_table "dev_planning_weeks"
import_table "dev_planned_tasks"
import_table "dev_planned_allocations"
import_table "qa_planning_weeks"
import_table "qa_planned_tasks"
import_table "qa_planned_allocations"
import_table "qa_ticket_flags"

echo ""
echo "--- Reset Sequences for Planning Tables ---"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" << 'EOF'
SELECT setval('planned_tasks_id_seq', COALESCE((SELECT MAX(id) FROM planned_tasks), 0) + 1, false);
SELECT setval('weekly_plans_id_seq', COALESCE((SELECT MAX(id) FROM weekly_plans), 0) + 1, false);
SELECT setval('dev_planning_weeks_id_seq', COALESCE((SELECT MAX(id) FROM dev_planning_weeks), 0) + 1, false);
SELECT setval('dev_planned_tasks_id_seq', COALESCE((SELECT MAX(id) FROM dev_planned_tasks), 0) + 1, false);
SELECT setval('dev_planned_allocations_id_seq', COALESCE((SELECT MAX(id) FROM dev_planned_allocations), 0) + 1, false);
SELECT setval('qa_planning_weeks_id_seq', COALESCE((SELECT MAX(id) FROM qa_planning_weeks), 0) + 1, false);
SELECT setval('qa_planned_tasks_id_seq', COALESCE((SELECT MAX(id) FROM qa_planned_tasks), 0) + 1, false);
SELECT setval('qa_planned_allocations_id_seq', COALESCE((SELECT MAX(id) FROM qa_planned_allocations), 0) + 1, false);
SELECT setval('qa_ticket_flags_id_seq', COALESCE((SELECT MAX(id) FROM qa_ticket_flags), 0) + 1, false);
EOF
echo "  [OK] Sequences reset"

echo ""
echo "=============================================="
echo "Planning data imported!"
echo "=============================================="
echo ""
echo "Next step: Run 06_verify_and_restart.sh"
