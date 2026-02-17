#!/bin/bash
# =============================================================================
# Phase 1: Export User-Created Data
# =============================================================================
# Run this script on the LIVE SERVER before resetting the database.
# This exports all user-created data that cannot be recovered from external sources.
#
# Usage: ./01_export_data.sh
# =============================================================================

set -e  # Exit on error

# Configuration - UPDATE THESE VALUES
DB_HOST="localhost"
DB_USER="postgres"
DB_NAME="qa_dashboard"
EXPORT_DIR="./db_export"

echo "=============================================="
echo "Phase 1: Export User-Created Data"
echo "=============================================="
echo ""
echo "Database: $DB_NAME"
echo "Export directory: $EXPORT_DIR"
echo ""

# Create export directory
mkdir -p "$EXPORT_DIR"

# Function to export a table
export_table() {
    local table=$1
    echo "Exporting $table..."
    psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "\COPY $table TO '$EXPORT_DIR/$table.csv' WITH CSV HEADER" 2>/dev/null || echo "  [SKIP] Table $table does not exist or is empty"
}

echo "--- Critical Tables ---"
export_table "employees"
export_table "users"
export_table "employee_skills"

echo ""
echo "--- High Priority Tables ---"
export_table "employee_goals"
export_table "employee_reviews"
export_table "kpis"
export_table "kpi_ratings"
export_table "timesheet_submissions"
export_table "timesheet_entries"
export_table "timesheet_entry_reviews"
export_table "timesheet_approval_log"

echo ""
echo "--- Medium Priority Tables ---"
export_table "planned_tasks"
export_table "weekly_plans"
export_table "dev_planning_weeks"
export_table "dev_planned_tasks"
export_table "dev_planned_allocations"
export_table "qa_planning_weeks"
export_table "qa_planned_tasks"
export_table "qa_planned_allocations"
export_table "qa_ticket_flags"
export_table "holidays"
export_table "employee_name_mappings"

echo ""
echo "--- Low Priority Tables ---"
export_table "client_profiles"
export_table "admin_config"

echo ""
echo "--- Creating backup archive ---"
tar -czvf db_export_backup_$(date +%Y%m%d_%H%M%S).tar.gz "$EXPORT_DIR"

echo ""
echo "=============================================="
echo "Export complete!"
echo "=============================================="
echo ""
echo "Exported files:"
ls -la "$EXPORT_DIR"/*.csv 2>/dev/null || echo "No CSV files found"
echo ""
echo "Backup archive created. Keep this safe before proceeding!"
