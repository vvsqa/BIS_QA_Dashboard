"""
Migration: create test_plan_case_logs — per-ticket test-case count history (initial vs added/removed
after review comments or RN/scope regeneration). Idempotent. Run once: python add_test_plan_case_log_table.py
"""
from database import engine
from models import Base, TestPlanCaseLog

if __name__ == "__main__":
    Base.metadata.create_all(bind=engine, tables=[TestPlanCaseLog.__table__])
    print("Done: test_plan_case_logs created (if missing)")
