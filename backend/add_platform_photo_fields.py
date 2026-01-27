"""
Add platform and photo_url fields to employees table
"""

import sys
import os

# Fix Unicode output on Windows
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

from sqlalchemy import text
from database import engine

def add_platform_photo_fields():
    """Add new fields to employees table"""
    try:
        with engine.connect() as conn:
            # Check and add platform
            check_query = text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'employees' 
                AND column_name = 'platform'
            """)
            result = conn.execute(check_query)
            if not result.fetchone():
                alter_query = text("ALTER TABLE employees ADD COLUMN platform VARCHAR(50)")
                conn.execute(alter_query)
                print("[OK] Added 'platform' column")
            else:
                print("[OK] Column 'platform' already exists")
            
            # Check and add photo_url
            check_query = text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'employees' 
                AND column_name = 'photo_url'
            """)
            result = conn.execute(check_query)
            if not result.fetchone():
                alter_query = text("ALTER TABLE employees ADD COLUMN photo_url VARCHAR(500)")
                conn.execute(alter_query)
                print("[OK] Added 'photo_url' column")
            else:
                print("[OK] Column 'photo_url' already exists")
            
            conn.commit()
            
    except Exception as e:
        print(f"[ERROR] Error adding columns: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    print("Adding platform and photo_url fields to employees table...")
    add_platform_photo_fields()
    print("Done!")
