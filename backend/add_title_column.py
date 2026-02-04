"""
Add title column to ticket_tracking table.

Run once to add the title column used by PM Tracker API sync (TicketTitle).
"""

import sys
import os

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

from sqlalchemy import text
from database import engine


def add_title_column():
    """Add title column to ticket_tracking table"""
    try:
        with engine.connect() as conn:
            check_query = text("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'ticket_tracking'
                AND column_name = 'title'
            """)
            result = conn.execute(check_query)
            if result.fetchone():
                print("[OK] Column 'title' already exists in ticket_tracking table")
                return

            alter_query = text("""
                ALTER TABLE ticket_tracking
                ADD COLUMN title VARCHAR(500)
            """)
            conn.execute(alter_query)
            conn.commit()
            print("[OK] Successfully added 'title' column to ticket_tracking table")
    except Exception as e:
        print(f"[ERROR] Error adding column: {str(e)}")
        sys.exit(1)


if __name__ == "__main__":
    add_title_column()
