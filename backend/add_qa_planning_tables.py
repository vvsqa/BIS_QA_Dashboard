"""
Migration: Create QA Task Planning tables.
Run once: python add_qa_planning_tables.py
"""
from database import engine
from models import Base, QAPlanningWeek, QAPlannedTask, QAPlannedAllocation

if __name__ == "__main__":
    print("Creating QA Task Planning tables...")
    Base.metadata.create_all(
        bind=engine,
        tables=[
            QAPlanningWeek.__table__,
            QAPlannedTask.__table__,
            QAPlannedAllocation.__table__,
        ],
    )
    print("Done: qa_planning_weeks, qa_planned_tasks, qa_planned_allocations")
