"""
Migration: Create test_plan_requests table (test-plan generation queue).
Run once: python add_test_plan_requests_table.py
"""
from database import engine
from models import Base, TestPlanRequest

if __name__ == "__main__":
    print("Creating test_plan_requests table...")
    Base.metadata.create_all(
        bind=engine,
        tables=[
            TestPlanRequest.__table__,
        ],
    )
    print("Done: test_plan_requests")
