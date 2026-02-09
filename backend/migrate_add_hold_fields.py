"""
Migration script to add hold-related fields to QA planning tables.
Run: python migrate_add_hold_fields.py
"""
from sqlalchemy import text
from database import engine

def migrate():
    with engine.connect() as conn:
        # Add hold fields to qa_planned_tasks
        print("Adding hold fields to qa_planned_tasks...")
        
        alter_statements = [
            "ALTER TABLE qa_planned_tasks ADD COLUMN IF NOT EXISTS is_on_hold BOOLEAN DEFAULT FALSE",
            "ALTER TABLE qa_planned_tasks ADD COLUMN IF NOT EXISTS hold_reason TEXT",
            "ALTER TABLE qa_planned_tasks ADD COLUMN IF NOT EXISTS hold_started_at TIMESTAMP",
            "ALTER TABLE qa_planned_tasks ADD COLUMN IF NOT EXISTS hold_ended_at TIMESTAMP",
            "ALTER TABLE qa_planned_tasks ADD COLUMN IF NOT EXISTS hold_type VARCHAR(20)",
            "ALTER TABLE qa_planned_tasks ADD COLUMN IF NOT EXISTS hold_date DATE",
        ]
        
        for stmt in alter_statements:
            try:
                conn.execute(text(stmt))
                print(f"  OK: {stmt[:60]}...")
            except Exception as e:
                print(f"  SKIP (may already exist): {e}")
        
        # Add is_on_hold to qa_planned_allocations
        print("\nAdding is_on_hold to qa_planned_allocations...")
        try:
            conn.execute(text("ALTER TABLE qa_planned_allocations ADD COLUMN IF NOT EXISTS is_on_hold BOOLEAN DEFAULT FALSE"))
            print("  OK: Added is_on_hold column")
        except Exception as e:
            print(f"  SKIP: {e}")
        
        # Create qa_task_hold_history table
        print("\nCreating qa_task_hold_history table...")
        create_table = """
        CREATE TABLE IF NOT EXISTS qa_task_hold_history (
            id SERIAL PRIMARY KEY,
            task_id INTEGER NOT NULL,
            ticket_id INTEGER,
            employee_id VARCHAR(20),
            employee_name VARCHAR(100),
            hold_type VARCHAR(20) NOT NULL,
            hold_date DATE,
            hold_reason TEXT NOT NULL,
            pm_tracker_status VARCHAR(100),
            pm_tracker_verified BOOLEAN DEFAULT FALSE,
            hold_started_at TIMESTAMP NOT NULL,
            hold_ended_at TIMESTAMP,
            resumed_reason TEXT,
            created_by VARCHAR(100),
            created_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
        try:
            conn.execute(text(create_table))
            print("  OK: Created table")
        except Exception as e:
            print(f"  SKIP: {e}")
        
        # Create indexes
        print("\nCreating indexes...")
        indexes = [
            "CREATE INDEX IF NOT EXISTS idx_qa_planned_tasks_is_on_hold ON qa_planned_tasks(is_on_hold)",
            "CREATE INDEX IF NOT EXISTS idx_qa_task_hold_history_task_id ON qa_task_hold_history(task_id)",
            "CREATE INDEX IF NOT EXISTS idx_qa_task_hold_history_ticket_id ON qa_task_hold_history(ticket_id)",
            "CREATE INDEX IF NOT EXISTS idx_qa_task_hold_history_employee_id ON qa_task_hold_history(employee_id)",
        ]
        for idx in indexes:
            try:
                conn.execute(text(idx))
                print(f"  OK: {idx.split(' ON ')[0]}...")
            except Exception as e:
                print(f"  SKIP: {e}")
        
        conn.commit()
        print("\nMigration completed successfully!")

if __name__ == "__main__":
    migrate()
