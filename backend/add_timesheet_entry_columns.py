from sqlalchemy import text

from database import engine

# Add missing columns to timesheet_entries safely (PostgreSQL)
COLUMNS = [
    ("submission_id", "INTEGER"),
    ("task_category", "VARCHAR(50)"),
    ("productive_hours", "FLOAT"),
    ("project_name", "VARCHAR(150)"),
    ("planned_task_id", "INTEGER"),
    ("planned_task_source", "VARCHAR(20)"),
    ("variance_notes", "TEXT"),
    ("variance_reason_type", "VARCHAR(50)"),
    ("created_on", "TIMESTAMP"),
    ("updated_on", "TIMESTAMP"),
]


def run_migration():
    print("Ensuring timesheet_entries has required columns...")
    with engine.begin() as conn:
        for name, coldef in COLUMNS:
            conn.execute(text(f"ALTER TABLE timesheet_entries ADD COLUMN IF NOT EXISTS {name} {coldef}"))
            print(f"  - ensured column {name}")
    print("Migration complete.")


if __name__ == "__main__":
    run_migration()
