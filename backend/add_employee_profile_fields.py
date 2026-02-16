"""
Migration: Add new Employee profile fields and create employee_skills table.

New Employee fields:
- designation: Job title/designation (e.g., "Software Engineer", "QA Lead")
- mode_of_work: Onsite, Remote, Hybrid
- resignation_date: Date when resignation was submitted
- expected_lwd: Expected Last Working Day (auto-calculated)
- archived: Soft delete flag for resigned employees
- archived_on: When the employee was archived

New table: employee_skills
- Stores employee skillsets with proficiency levels

Run once: python add_employee_profile_fields.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text
from database import engine


def main():
    with engine.connect() as conn:
        # Add new columns to employees table
        print("Adding new fields to employees table...")
        
        conn.execute(text("""
            ALTER TABLE employees ADD COLUMN IF NOT EXISTS designation VARCHAR(150);
        """))
        print("  - designation column added")
        
        conn.execute(text("""
            ALTER TABLE employees ADD COLUMN IF NOT EXISTS mode_of_work VARCHAR(50) DEFAULT 'Onsite';
        """))
        print("  - mode_of_work column added")
        
        conn.execute(text("""
            ALTER TABLE employees ADD COLUMN IF NOT EXISTS resignation_date TIMESTAMP;
        """))
        print("  - resignation_date column added")
        
        conn.execute(text("""
            ALTER TABLE employees ADD COLUMN IF NOT EXISTS expected_lwd TIMESTAMP;
        """))
        print("  - expected_lwd column added")
        
        conn.execute(text("""
            ALTER TABLE employees ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;
        """))
        print("  - archived column added")
        
        conn.execute(text("""
            ALTER TABLE employees ADD COLUMN IF NOT EXISTS archived_on TIMESTAMP;
        """))
        print("  - archived_on column added")
        
        # Create index on archived column for efficient filtering
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_employees_archived ON employees(archived);
        """))
        print("  - index on archived created")
        
        conn.commit()
        print("Employee fields migration complete.\n")
        
        # Create employee_skills table
        print("Creating employee_skills table...")
        
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS employee_skills (
                id SERIAL PRIMARY KEY,
                employee_id VARCHAR(20) NOT NULL,
                skill_name VARCHAR(150) NOT NULL,
                proficiency_level INTEGER CHECK (proficiency_level >= 1 AND proficiency_level <= 5),
                years_of_experience FLOAT,
                created_on TIMESTAMP DEFAULT NOW(),
                updated_on TIMESTAMP DEFAULT NOW(),
                CONSTRAINT fk_employee_skills_employee 
                    FOREIGN KEY (employee_id) 
                    REFERENCES employees(employee_id) 
                    ON DELETE CASCADE
            );
        """))
        print("  - employee_skills table created")
        
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_employee_skills_employee_id ON employee_skills(employee_id);
        """))
        print("  - index on employee_id created")
        
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_employee_skills_skill_name ON employee_skills(skill_name);
        """))
        print("  - index on skill_name created")
        
        conn.commit()
        print("Employee skills table migration complete.\n")
        
        print("All migrations completed successfully!")


if __name__ == "__main__":
    main()
