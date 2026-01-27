"""
Add mapping_data column to employees table

This script adds a JSONB column to store additional mapping data
from Excel imports (Column 1-5, Notes, etc.)
"""

import sys
import os

# Fix Unicode output on Windows
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

from sqlalchemy import text
from database import engine

def add_mapping_data_column():
    """Add mapping_data JSONB column to employees table"""
    try:
        with engine.connect() as conn:
            # Check if column already exists
            check_query = text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'employees' 
                AND column_name = 'mapping_data'
            """)
            result = conn.execute(check_query)
            if result.fetchone():
                print("[OK] Column 'mapping_data' already exists in employees table")
                return
            
            # Add the column
            alter_query = text("""
                ALTER TABLE employees 
                ADD COLUMN mapping_data JSONB
            """)
            conn.execute(alter_query)
            conn.commit()
            print("[OK] Successfully added 'mapping_data' column to employees table")
            
    except Exception as e:
        print(f"[ERROR] Error adding column: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    print("Adding mapping_data column to employees table...")
    add_mapping_data_column()
    print("Done!")
