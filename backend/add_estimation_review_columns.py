"""
Migration: add review-stage columns to ticket_estimations (unified QA Planning & Review module).
Idempotent. Run once: python add_estimation_review_columns.py
"""
from sqlalchemy import text
from database import engine

DDL = [
    "ALTER TABLE ticket_estimations ADD COLUMN IF NOT EXISTS test_type VARCHAR(10)",
    "ALTER TABLE ticket_estimations ADD COLUMN IF NOT EXISTS actual_hours DOUBLE PRECISION",
    "ALTER TABLE ticket_estimations ADD COLUMN IF NOT EXISTS qa_comments TEXT",
    "ALTER TABLE ticket_estimations ADD COLUMN IF NOT EXISTS recalc_total DOUBLE PRECISION",
    "ALTER TABLE ticket_estimations ADD COLUMN IF NOT EXISTS recalc_breakdown JSONB",
    "CREATE INDEX IF NOT EXISTS ix_ticket_estimations_test_type ON ticket_estimations (test_type)",
]

if __name__ == "__main__":
    with engine.begin() as conn:
        for stmt in DDL:
            conn.execute(text(stmt))
            print("OK:", stmt)
    print("Done: ticket_estimations review columns")
