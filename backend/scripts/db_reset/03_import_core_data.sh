#!/bin/bash
# =============================================================================
# Phase 3: Import Core User Data
# =============================================================================
# Run this script AFTER creating fresh database (02_create_fresh_db.sh).
# This imports employees, users, and other core tables.
#
# Usage: ./03_import_core_data.sh
# =============================================================================

set -e  # Exit on error

# Configuration - UPDATE THESE VALUES
DB_HOST="localhost"
DB_USER="postgres"
DB_NAME="qa_dashboard"
EXPORT_DIR="./db_export"

echo "=============================================="
echo "Phase 3: Import Core User Data"
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

echo "--- Step 3.1: Import Core Tables (no dependencies) ---"
import_table "employees"
import_table "users"
import_table "kpis"
import_table "holidays"

echo ""
echo "--- Step 3.2: Import Employee-Related Tables ---"
import_table "employee_skills"
import_table "employee_goals"
import_table "employee_reviews"
import_table "kpi_ratings"
import_table "employee_name_mappings"
import_table "client_profiles"

echo ""
echo "--- Step 3.3: Import Timesheet Tables ---"
import_table "timesheet_submissions"
import_table "timesheet_entries"
import_table "timesheet_entry_reviews"
import_table "timesheet_approval_log"

echo ""
echo "--- Step 3.4: Reset Auto-Increment Sequences ---"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" << 'EOF'
SELECT setval('employees_id_seq', COALESCE((SELECT MAX(id) FROM employees), 0) + 1, false);
SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 0) + 1, false);
SELECT setval('employee_skills_id_seq', COALESCE((SELECT MAX(id) FROM employee_skills), 0) + 1, false);
SELECT setval('employee_goals_id_seq', COALESCE((SELECT MAX(id) FROM employee_goals), 0) + 1, false);
SELECT setval('employee_reviews_id_seq', COALESCE((SELECT MAX(id) FROM employee_reviews), 0) + 1, false);
SELECT setval('kpis_id_seq', COALESCE((SELECT MAX(id) FROM kpis), 0) + 1, false);
SELECT setval('kpi_ratings_id_seq', COALESCE((SELECT MAX(id) FROM kpi_ratings), 0) + 1, false);
SELECT setval('timesheet_submissions_id_seq', COALESCE((SELECT MAX(id) FROM timesheet_submissions), 0) + 1, false);
SELECT setval('timesheet_entries_id_seq', COALESCE((SELECT MAX(id) FROM timesheet_entries), 0) + 1, false);
SELECT setval('holidays_id_seq', COALESCE((SELECT MAX(id) FROM holidays), 0) + 1, false);
EOF
echo "  [OK] Sequences reset"

echo ""
echo "=============================================="
echo "Core data imported!"
echo "=============================================="
echo ""
echo "Next step: Run 04_sync_external_data.sh"
