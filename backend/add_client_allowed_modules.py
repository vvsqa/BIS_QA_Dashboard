"""
Migration: Add allowed_modules column to client_profiles.
Run once: python add_client_allowed_modules.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text
from database import engine

def main():
    with engine.connect() as conn:
        # PostgreSQL: add JSONB column if not exists
        conn.execute(text("""
            ALTER TABLE client_profiles
            ADD COLUMN IF NOT EXISTS allowed_modules JSONB NULL
        """))
        conn.commit()
    print("Done: client_profiles.allowed_modules added")

if __name__ == "__main__":
    main()
