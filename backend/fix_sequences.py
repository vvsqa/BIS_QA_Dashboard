"""
Fix PostgreSQL sequence values after data import.
Run this if you get "duplicate key value violates unique constraint" errors.

Usage:
    python fix_sequences.py
"""
import os

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except ImportError:
    pass

from database import SessionLocal
from sqlalchemy import text

# Tables with auto-increment id columns that might need fixing
TABLES_WITH_SEQUENCES = [
    "bug_status_history",
    "bugs",
    "users",
    "client_profiles",
    "admin_config",
    "qa_planned_tasks",
    "dev_planned_tasks",
    "test_plans",
    "test_runs",
    "test_cases",
    "test_results",
]


def fix_sequences():
    db = SessionLocal()
    print("Fixing PostgreSQL sequences...")
    print("=" * 50)
    
    try:
        for table in TABLES_WITH_SEQUENCES:
            seq_name = f"{table}_id_seq"
            try:
                # Get current max id
                result = db.execute(text(f"SELECT COALESCE(MAX(id), 0) FROM {table}")).scalar()
                max_id = result or 0
                
                # Set sequence to max + 1
                db.execute(text(f"SELECT setval('{seq_name}', {max_id + 1}, false)"))
                db.commit()
                
                print(f"  {table}: sequence set to {max_id + 1}")
            except Exception as e:
                # Table or sequence might not exist
                db.rollback()
                print(f"  {table}: skipped ({e})")
        
        print("=" * 50)
        print("Done. Re-run sync_redmine_to_db.py now.")
    finally:
        db.close()


if __name__ == "__main__":
    fix_sequences()
