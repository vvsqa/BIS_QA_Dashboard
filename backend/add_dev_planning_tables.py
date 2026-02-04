"""
Migration: Create Development Task Planning tables.
Run once: python add_dev_planning_tables.py
"""
from database import engine
from models import Base, DevPlanningWeek, DevPlannedTask, DevPlannedAllocation, DevPlanningAuditLog

if __name__ == "__main__":
    print("Creating Development Task Planning tables...")
    Base.metadata.create_all(
        bind=engine,
        tables=[
            DevPlanningWeek.__table__,
            DevPlannedTask.__table__,
            DevPlannedAllocation.__table__,
            DevPlanningAuditLog.__table__,
        ],
    )
    print("Done: dev_planning_weeks, dev_planned_tasks, dev_planned_allocations, dev_planning_audit_logs")
