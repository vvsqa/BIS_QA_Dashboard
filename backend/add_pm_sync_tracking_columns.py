"""
Migration: Add in_pm_tracker and last_pm_sync columns to ticket_tracking.
These columns ensure ticket counts match live PM Tracker data by tracking
which tickets are still present in the PM API response.

Run once: python add_pm_sync_tracking_columns.py
"""
import os
import sys
from pathlib import Path

# Add backend directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import text
from database import engine

def run_migration():
    print("Adding PM sync tracking columns to ticket_tracking...")
    
    with engine.connect() as conn:
        # Add in_pm_tracker column (default True for existing tickets)
        try:
            conn.execute(text("""
                ALTER TABLE ticket_tracking 
                ADD COLUMN IF NOT EXISTS in_pm_tracker BOOLEAN DEFAULT TRUE NOT NULL
            """))
            print("  [OK] Added in_pm_tracker column")
        except Exception as e:
            err_str = str(e).lower()
            if "already exists" in err_str:
                print("  [SKIP] in_pm_tracker column already exists")
            else:
                print("  [ERROR] in_pm_tracker: " + str(e))
        
        # Add last_pm_sync column
        try:
            conn.execute(text("""
                ALTER TABLE ticket_tracking 
                ADD COLUMN IF NOT EXISTS last_pm_sync TIMESTAMP
            """))
            print("  [OK] Added last_pm_sync column")
        except Exception as e:
            err_str = str(e).lower()
            if "already exists" in err_str:
                print("  [SKIP] last_pm_sync column already exists")
            else:
                print("  [ERROR] last_pm_sync: " + str(e))
        
        conn.commit()
    
    print("Migration complete.")

if __name__ == "__main__":
    run_migration()
