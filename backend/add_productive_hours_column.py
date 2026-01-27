"""
Migration script to add productive_hours column to enhanced_timesheets table.
Run this once to update the database schema.
"""
from database import engine
from sqlalchemy import text

def add_productive_hours_column():
    """Add productive_hours column to enhanced_timesheets table if it doesn't exist."""
    with engine.connect() as conn:
        try:
            # Check if column exists
            check_query = text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name='enhanced_timesheets' AND column_name='productive_hours'
            """)
            result = conn.execute(check_query)
            if result.fetchone():
                print("Column 'productive_hours' already exists. Skipping migration.")
                return
            
            # Add the column
            alter_query = text("""
                ALTER TABLE enhanced_timesheets 
                ADD COLUMN productive_hours FLOAT
            """)
            conn.execute(alter_query)
            conn.commit()
            print("Successfully added 'productive_hours' column to enhanced_timesheets table.")
        except Exception as e:
            print(f"Error adding column: {e}")
            conn.rollback()
            raise

if __name__ == "__main__":
    add_productive_hours_column()
