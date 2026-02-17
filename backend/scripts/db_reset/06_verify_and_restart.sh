#!/bin/bash
# =============================================================================
# Phase 6: Verification and Final Restart
# =============================================================================
# Run this script AFTER importing all data.
# This verifies the data and restarts services.
#
# Usage: ./06_verify_and_restart.sh
# =============================================================================

# Configuration - UPDATE THESE VALUES
DB_HOST="localhost"
DB_USER="postgres"
DB_NAME="qa_dashboard"

echo "=============================================="
echo "Phase 6: Verification and Final Restart"
echo "=============================================="
echo ""

echo "--- Step 6.1: Check Table Counts ---"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" << 'EOF'
SELECT 'employees' as table_name, COUNT(*) as count FROM employees
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'ticket_tracking', COUNT(*) FROM ticket_tracking
UNION ALL SELECT 'bugs', COUNT(*) FROM bugs
UNION ALL SELECT 'test_plans', COUNT(*) FROM test_plans
UNION ALL SELECT 'test_runs', COUNT(*) FROM test_runs
UNION ALL SELECT 'test_cases', COUNT(*) FROM test_cases
UNION ALL SELECT 'test_results', COUNT(*) FROM test_results
UNION ALL SELECT 'enhanced_timesheets', COUNT(*) FROM enhanced_timesheets
UNION ALL SELECT 'dev_planned_tasks', COUNT(*) FROM dev_planned_tasks
UNION ALL SELECT 'qa_planned_tasks', COUNT(*) FROM qa_planned_tasks
ORDER BY table_name;
EOF

echo ""
echo "--- Step 6.2: Restart Backend ---"
sudo supervisorctl restart qa_dashboard_8004
echo "Waiting for backend to restart..."
sleep 10

echo ""
echo "--- Step 6.3: Reload Nginx ---"
sudo systemctl reload nginx

echo ""
echo "--- Step 6.4: Backend Health Check ---"
curl -s http://127.0.0.1:8004/ && echo "" && echo "  [OK] Backend is responding" || echo "  [ERROR] Backend not responding"

echo ""
echo "=============================================="
echo "Database Reset Complete!"
echo "=============================================="
echo ""
echo "Next steps:"
echo "1. Open the app in browser"
echo "2. Login with existing user credentials"
echo "3. Verify data appears correctly"
echo ""
echo "If login fails, check:"
echo "- Backend logs: sudo supervisorctl tail -f qa_dashboard_8004"
echo "- Users table: psql -d $DB_NAME -c 'SELECT id, email, role, is_active FROM users;'"
