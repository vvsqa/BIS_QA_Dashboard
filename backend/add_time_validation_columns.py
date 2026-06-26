"""
Migration: add BIS Time Validation columns to weekly_ticket_reviews.
Stores QA's requested additional time + the system's per-phase recommendation.
Run once: python add_time_validation_columns.py
"""
from sqlalchemy import text
from database import engine

DDL = [
    "ALTER TABLE weekly_ticket_reviews ADD COLUMN IF NOT EXISTS requested_estimate DOUBLE PRECISION",
    "ALTER TABLE weekly_ticket_reviews ADD COLUMN IF NOT EXISTS requested_reason TEXT",
    "ALTER TABLE weekly_ticket_reviews ADD COLUMN IF NOT EXISTS phase_breakdown JSONB",
]

if __name__ == "__main__":
    with engine.begin() as conn:
        for stmt in DDL:
            conn.execute(text(stmt))
            print("OK:", stmt)
    print("Done: weekly_ticket_reviews time-validation columns")
