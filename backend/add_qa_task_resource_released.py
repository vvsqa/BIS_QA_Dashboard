"""Add resource_released_at to qa_planned_tasks for 'QA resource is free' feature."""
from sqlalchemy import text

from database import engine


def run_migration():
    print("Adding resource_released_at to qa_planned_tasks if not exists...")
    with engine.begin() as conn:
        conn.execute(text("""
            ALTER TABLE qa_planned_tasks
            ADD COLUMN IF NOT EXISTS resource_released_at TIMESTAMP
        """))
        print("  - resource_released_at column ready.")
    print("Migration complete.")


if __name__ == "__main__":
    run_migration()
