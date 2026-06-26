"""
Migration: add planned QA estimate columns to test_plan_requests.
Stores Claude's planned QA-activity breakdown + total, generated at test-plan time (not pushed to PM).
Run once: python add_planned_estimate_columns.py
"""
from sqlalchemy import text
from database import engine

DDL = [
    "ALTER TABLE test_plan_requests ADD COLUMN IF NOT EXISTS planned_qa_estimate_hours DOUBLE PRECISION",
    "ALTER TABLE test_plan_requests ADD COLUMN IF NOT EXISTS planned_qa_breakdown JSONB",
    "ALTER TABLE test_plan_requests ADD COLUMN IF NOT EXISTS planned_estimate_on TIMESTAMP",
]

if __name__ == "__main__":
    with engine.begin() as conn:
        for stmt in DDL:
            conn.execute(text(stmt))
            print("OK:", stmt)
    print("Done: test_plan_requests planned-estimate columns")
