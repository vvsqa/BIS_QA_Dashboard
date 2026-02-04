"""
Add subdepartment column to ticket_tracking table.

Run once to add the subdepartment column used by PM Tracker API sync (Subdepartment).
Used for Web/Mobile platform display in QA Active Tickets.
"""

import sys
import os

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

from sqlalchemy import text
from database import engine


def add_subdepartment_column():
    """Add subdepartment column to ticket_tracking table"""
    try:
        with engine.connect() as conn:
            check_query = text("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'ticket_tracking'
                AND column_name = 'subdepartment'
            """)
            result = conn.execute(check_query)
            if result.fetchone():
                print("[OK] Column 'subdepartment' already exists in ticket_tracking table")
                return

            alter_query = text("""
                ALTER TABLE ticket_tracking
                ADD COLUMN subdepartment VARCHAR(100)
            """)
            conn.execute(alter_query)
            conn.commit()
            print("[OK] Successfully added 'subdepartment' column to ticket_tracking table")
    except Exception as e:
        print(f"[ERROR] Error adding column: {str(e)}")
        sys.exit(1)


if __name__ == "__main__":
    add_subdepartment_column()
