"""Create qa_ticket_flags table for Tested By Dev and other QA-only flags."""
from sqlalchemy import text

from database import engine


def run_migration():
    print("Creating qa_ticket_flags table if not exists...")
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS qa_ticket_flags (
                id SERIAL PRIMARY KEY,
                ticket_id INTEGER UNIQUE NOT NULL,
                tested_by_dev BOOLEAN NOT NULL DEFAULT FALSE,
                updated_on TIMESTAMP
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_qa_ticket_flags_ticket_id ON qa_ticket_flags (ticket_id)"))
        print("  - qa_ticket_flags table ready.")
    print("Migration complete.")


if __name__ == "__main__":
    run_migration()
