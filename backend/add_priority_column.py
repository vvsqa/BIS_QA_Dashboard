"""
Add priority column to ticket_tracking table

Run once to add the priority column used by PM Tracker API sync and tickets overview.
"""

import sys
import os

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

from sqlalchemy import text
from database import engine

def add_priority_column():
    """Add priority column to ticket_tracking table"""
    try:
        with engine.connect() as conn:
            check_query = text("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'ticket_tracking'
                AND column_name = 'priority'
            """)
            result = conn.execute(check_query)
            if result.fetchone():
                print("[OK] Column 'priority' already exists in ticket_tracking table")
                return

            alter_query = text("""
                ALTER TABLE ticket_tracking
                ADD COLUMN priority VARCHAR(100)
            """)
            conn.execute(alter_query)
            conn.commit()
            print("[OK] Successfully added 'priority' column to ticket_tracking table")
    except Exception as e:
        print(f"[ERROR] Error adding column: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    add_priority_column()
