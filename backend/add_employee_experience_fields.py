"""
Add experience and manager fields to employees table

This script adds:
- previous_experience (Float)
- bis_introduced_date (DateTime)
- manager (String)
"""

import sys
import os

# Fix Unicode output on Windows
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

from sqlalchemy import text
from database import engine

def add_employee_fields():
    """Add new fields to employees table"""
    try:
        with engine.connect() as conn:
            # Check and add previous_experience
            check_query = text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'employees' 
                AND column_name = 'previous_experience'
            """)
            result = conn.execute(check_query)
            if not result.fetchone():
                alter_query = text("ALTER TABLE employees ADD COLUMN previous_experience FLOAT")
                conn.execute(alter_query)
                print("[OK] Added 'previous_experience' column")
            else:
                print("[OK] Column 'previous_experience' already exists")
            
            # Check and add bis_introduced_date
            check_query = text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'employees' 
                AND column_name = 'bis_introduced_date'
            """)
            result = conn.execute(check_query)
            if not result.fetchone():
                alter_query = text("ALTER TABLE employees ADD COLUMN bis_introduced_date TIMESTAMP")
                conn.execute(alter_query)
                print("[OK] Added 'bis_introduced_date' column")
            else:
                print("[OK] Column 'bis_introduced_date' already exists")
            
            # Check and add manager
            check_query = text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'employees' 
                AND column_name = 'manager'
            """)
            result = conn.execute(check_query)
            if not result.fetchone():
                alter_query = text("ALTER TABLE employees ADD COLUMN manager VARCHAR(100)")
                conn.execute(alter_query)
                print("[OK] Added 'manager' column")
            else:
                print("[OK] Column 'manager' already exists")
            
            conn.commit()
            
    except Exception as e:
        print(f"[ERROR] Error adding columns: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    print("Adding experience and manager fields to employees table...")
    add_employee_fields()
    print("Done!")
