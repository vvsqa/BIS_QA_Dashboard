"""
Migration: Add previous_eta column to ticket_tracking for ETA reschedule tracking.
Run once: python add_previous_eta_column.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text
from database import engine

def main():
    with engine.connect() as conn:
        conn.execute(text("""
            ALTER TABLE ticket_tracking
            ADD COLUMN IF NOT EXISTS previous_eta TIMESTAMP NULL
        """))
        conn.commit()
    print("Done: ticket_tracking.previous_eta added")

if __name__ == "__main__":
    main()
