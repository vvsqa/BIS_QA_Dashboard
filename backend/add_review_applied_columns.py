"""
Migration: add apply-confirmation columns to test_plan_requests so the UI can show whether the
reviewed Excel was picked up and applied (queued -> applied/failed), with a timestamp.
Run once: python add_review_applied_columns.py
"""
from sqlalchemy import text
from database import engine

DDL = [
    "ALTER TABLE test_plan_requests ADD COLUMN IF NOT EXISTS review_applied_on TIMESTAMP",
    "ALTER TABLE test_plan_requests ADD COLUMN IF NOT EXISTS review_applied_loop INTEGER",
]

if __name__ == "__main__":
    with engine.begin() as conn:
        for stmt in DDL:
            conn.execute(text(stmt))
            print("OK:", stmt)
    print("Done: test_plan_requests review-applied columns")
