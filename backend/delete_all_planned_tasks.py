"""
One-off script: Delete all QA and Dev planned tasks and their allocations (dummy data cleanup).
Run from backend dir: python delete_all_planned_tasks.py
"""
import sys
import os

# Ensure backend is on path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import SessionLocal
from models import (
    QAPlannedAllocation,
    QAPlannedTask,
    DevPlannedAllocation,
    DevPlannedTask,
)

def main():
    db = SessionLocal()
    try:
        # Delete allocations first (FK references tasks)
        qa_alloc = db.query(QAPlannedAllocation).delete()
        qa_tasks = db.query(QAPlannedTask).delete()
        dev_alloc = db.query(DevPlannedAllocation).delete()
        dev_tasks = db.query(DevPlannedTask).delete()

        db.commit()
        print("Deleted:")
        print(f"  QA planned allocations: {qa_alloc}")
        print(f"  QA planned tasks:       {qa_tasks}")
        print(f"  Dev planned allocations: {dev_alloc}")
        print(f"  Dev planned tasks:       {dev_tasks}")
        print("Done. All planned tasks and allocations have been removed.")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    main()
