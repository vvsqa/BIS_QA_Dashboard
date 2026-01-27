"""
Add self_rating, lead_rating, and lead_comments to kpi_ratings table
"""

import sys
import os

# Fix Unicode output on Windows
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

from sqlalchemy import text
from database import engine

def add_kpi_rating_fields():
    """Add new fields to kpi_ratings table"""
    try:
        with engine.connect() as conn:
            # Check and add self_rating
            check_query = text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'kpi_ratings' 
                AND column_name = 'self_rating'
            """)
            result = conn.execute(check_query)
            if not result.fetchone():
                alter_query = text("ALTER TABLE kpi_ratings ADD COLUMN self_rating FLOAT")
                conn.execute(alter_query)
                print("[OK] Added 'self_rating' column")
            else:
                print("[OK] Column 'self_rating' already exists")
            
            # Check and add lead_rating
            check_query = text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'kpi_ratings' 
                AND column_name = 'lead_rating'
            """)
            result = conn.execute(check_query)
            if not result.fetchone():
                alter_query = text("ALTER TABLE kpi_ratings ADD COLUMN lead_rating FLOAT")
                conn.execute(alter_query)
                print("[OK] Added 'lead_rating' column")
            else:
                print("[OK] Column 'lead_rating' already exists")
            
            # Check and add lead_comments
            check_query = text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'kpi_ratings' 
                AND column_name = 'lead_comments'
            """)
            result = conn.execute(check_query)
            if not result.fetchone():
                alter_query = text("ALTER TABLE kpi_ratings ADD COLUMN lead_comments TEXT")
                conn.execute(alter_query)
                print("[OK] Added 'lead_comments' column")
            else:
                print("[OK] Column 'lead_comments' already exists")
            
            # Check and add self_comments
            check_query = text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'kpi_ratings' 
                AND column_name = 'self_comments'
            """)
            result = conn.execute(check_query)
            if not result.fetchone():
                alter_query = text("ALTER TABLE kpi_ratings ADD COLUMN self_comments TEXT")
                conn.execute(alter_query)
                print("[OK] Added 'self_comments' column")
            else:
                print("[OK] Column 'self_comments' already exists")
            
            conn.commit()
            
    except Exception as e:
        print(f"[ERROR] Error adding columns: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    print("Adding KPI rating fields to kpi_ratings table...")
    add_kpi_rating_fields()
    print("Done!")
