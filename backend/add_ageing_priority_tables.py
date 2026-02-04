"""
Add created_on, closed_on to ticket_tracking and create ticket_priority_history table.

Run once to support ageing (created -> closed) and priority change tracking.
"""
import sys
import os

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

from sqlalchemy import text
from database import engine


def run_migrations():
    try:
        with engine.connect() as conn:
            # 1. Add created_on to ticket_tracking if missing
            result = conn.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'ticket_tracking' AND column_name = 'created_on'
            """))
            if not result.fetchone():
                conn.execute(text("""
                    ALTER TABLE ticket_tracking ADD COLUMN created_on TIMESTAMP
                """))
                conn.commit()
                print("[OK] Added column 'created_on' to ticket_tracking")
            else:
                print("[OK] Column 'created_on' already exists in ticket_tracking")

            # 2. Add closed_on to ticket_tracking if missing
            result = conn.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'ticket_tracking' AND column_name = 'closed_on'
            """))
            if not result.fetchone():
                conn.execute(text("""
                    ALTER TABLE ticket_tracking ADD COLUMN closed_on TIMESTAMP
                """))
                conn.commit()
                print("[OK] Added column 'closed_on' to ticket_tracking")
            else:
                print("[OK] Column 'closed_on' already exists in ticket_tracking")

            # 3. Create ticket_priority_history table if not exists
            result = conn.execute(text("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_name = 'ticket_priority_history'
                )
            """))
            if not result.scalar():
                conn.execute(text("""
                    CREATE TABLE ticket_priority_history (
                        id SERIAL PRIMARY KEY,
                        ticket_id INTEGER NOT NULL,
                        previous_priority VARCHAR(100),
                        new_priority VARCHAR(100) NOT NULL,
                        changed_on TIMESTAMP,
                        source VARCHAR(50) DEFAULT 'sync',
                        created_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """))
                conn.execute(text("""
                    CREATE INDEX ix_ticket_priority_history_ticket_id ON ticket_priority_history (ticket_id)
                """))
                conn.execute(text("""
                    CREATE INDEX ix_ticket_priority_history_changed_on ON ticket_priority_history (changed_on)
                """))
                conn.commit()
                print("[OK] Created table ticket_priority_history")
            else:
                print("[OK] Table ticket_priority_history already exists")

    except Exception as e:
        print(f"[ERROR] {e}")
        sys.exit(1)


if __name__ == "__main__":
    run_migrations()
