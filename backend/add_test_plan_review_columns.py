"""
Migration: add review-loop columns to test_plan_requests.
Run once: python add_test_plan_review_columns.py
"""
from sqlalchemy import text
from database import engine

DDL = [
    "ALTER TABLE test_plan_requests ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) DEFAULT 'Draft'",
    "ALTER TABLE test_plan_requests ADD COLUMN IF NOT EXISTS review_action VARCHAR(20)",
    "ALTER TABLE test_plan_requests ADD COLUMN IF NOT EXISTS review_loops INTEGER DEFAULT 0",
    "ALTER TABLE test_plan_requests ADD COLUMN IF NOT EXISTS review_error TEXT",
]

if __name__ == "__main__":
    with engine.begin() as conn:
        for stmt in DDL:
            conn.execute(text(stmt))
            print("OK:", stmt)
    print("Done: test_plan_requests review columns")
