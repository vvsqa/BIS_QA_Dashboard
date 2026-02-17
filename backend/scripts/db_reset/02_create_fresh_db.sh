#!/bin/bash
# =============================================================================
# Phase 2: Create Fresh Database
# =============================================================================
# Run this script AFTER exporting data (01_export_data.sh).
# This drops the old database and creates all tables fresh.
#
# WARNING: This will DELETE ALL DATA in the database!
#
# Usage: ./02_create_fresh_db.sh
# =============================================================================

set -e  # Exit on error

# Configuration - UPDATE THESE VALUES
DB_USER="postgres"
DB_NAME="qa_dashboard"
BACKEND_DIR="/development_hosting/python/fast-api/BIS_QA_Dashboard/backend"

echo "=============================================="
echo "Phase 2: Create Fresh Database"
echo "=============================================="
echo ""
echo "WARNING: This will DELETE ALL DATA in $DB_NAME!"
echo ""
read -p "Type 'YES' to confirm: " confirm

if [ "$confirm" != "YES" ]; then
    echo "Aborted."
    exit 1
fi

echo ""
echo "--- Stopping backend service ---"
sudo supervisorctl stop qa_dashboard_8004 || echo "Backend not running or supervisor not available"

echo ""
echo "--- Dropping and recreating database ---"
sudo -u postgres psql << EOF
DROP DATABASE IF EXISTS $DB_NAME;
CREATE DATABASE $DB_NAME OWNER $DB_USER;
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
EOF

echo ""
echo "--- Creating all tables from SQLAlchemy models ---"
cd "$BACKEND_DIR"
python -c "
from database import engine
from models import Base
Base.metadata.create_all(bind=engine)
print('All tables created successfully!')
"

echo ""
echo "=============================================="
echo "Fresh database created!"
echo "=============================================="
echo ""
echo "Next step: Run 03_import_core_data.sh"
