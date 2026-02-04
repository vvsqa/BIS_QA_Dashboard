"""
Add task_type column to qa_planned_tasks table.

Run once to add the task_type column for QA task type (Manual Testing, Automation Testing, etc.).
"""

import sys
import os

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

from sqlalchemy import text
from database import engine


def add_task_type_column():
    """Add task_type column to qa_planned_tasks table"""
    try:
        with engine.connect() as conn:
            check_query = text("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'qa_planned_tasks'
                AND column_name = 'task_type'
            """)
            result = conn.execute(check_query)
            if result.fetchone():
                print("[OK] Column 'task_type' already exists in qa_planned_tasks table")
                return

            alter_query = text("""
                ALTER TABLE qa_planned_tasks
                ADD COLUMN task_type VARCHAR(50)
            """)
            conn.execute(alter_query)
            conn.commit()
            print("[OK] Successfully added 'task_type' column to qa_planned_tasks table")
    except Exception as e:
        print(f"[ERROR] Error adding column: {str(e)}")
        sys.exit(1)


if __name__ == "__main__":
    add_task_type_column()
