"""
Script to add employment_status column to employees table and mark resigned employees.
"""

from database import engine, SessionLocal
from models import Employee, EnhancedTimesheet
from sqlalchemy import text

# List of resigned employees (from unmatched names)
RESIGNED_EMPLOYEES = [
    'Aadithya Mohan Nair',
    'Binod Manikalathil',
    'C. Sathish Kumar',
    'K Harish',
    'Lijeesh SG',
    'Rini Nelson L N',
    'Shiji George',
    'Sreerag S'
]


def add_employment_status_column():
    """Add employment_status column to employees table if it doesn't exist."""
    with engine.connect() as conn:
        try:
            check_query = text("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name='employees' AND column_name='employment_status'
            """)
            result = conn.execute(check_query)
            if result.fetchone():
                print("Column 'employment_status' already exists. Skipping migration.")
                return True
            
            alter_query = text("""
                ALTER TABLE employees
                ADD COLUMN employment_status VARCHAR(50) DEFAULT 'Ongoing Employee'
            """)
            conn.execute(alter_query)
            
            # Create index
            index_query = text("""
                CREATE INDEX IF NOT EXISTS ix_employees_employment_status 
                ON employees(employment_status)
            """)
            conn.execute(index_query)
            
            conn.commit()
            print("Successfully added 'employment_status' column to employees table.")
            return True
        except Exception as e:
            print(f"Error adding column: {e}")
            conn.rollback()
            return False


def set_default_status():
    """Set all existing employees to 'Ongoing Employee' if status is NULL."""
    db = SessionLocal()
    try:
        from sqlalchemy import update
        
        result = db.execute(
            update(Employee)
            .where(Employee.employment_status.is_(None))
            .values(employment_status='Ongoing Employee')
        )
        db.commit()
        print(f"Set {result.rowcount} employees to 'Ongoing Employee' status.")
    except Exception as e:
        print(f"Error setting default status: {e}")
        db.rollback()
    finally:
        db.close()


def add_resigned_employees():
    """Add resigned employees to the Employee table with 'Resigned' status."""
    db = SessionLocal()
    try:
        added_count = 0
        updated_count = 0
        
        # Get the highest existing RES_ ID to avoid conflicts
        existing_res_ids = db.query(Employee.employee_id).filter(
            Employee.employee_id.like('RES_%')
        ).all()
        max_res_num = 0
        for (eid,) in existing_res_ids:
            try:
                num = int(eid.replace('RES_', ''))
                max_res_num = max(max_res_num, num)
            except:
                pass
        
        counter = max_res_num + 1
        
        for name in RESIGNED_EMPLOYEES:
            # Get team and date info from timesheet entries
            sample_entry = db.query(EnhancedTimesheet).filter(
                EnhancedTimesheet.employee_name == name
            ).first()
            
            if not sample_entry:
                print(f"No timesheet data found for {name}, skipping.")
                continue
            
            # Check if employee already exists
            existing = db.query(Employee).filter(Employee.name == name).first()
            
            if existing:
                # Update status to Resigned
                existing.employment_status = 'Resigned'
                updated_count += 1
                print(f"Updated {name} to Resigned status")
            else:
                # Create new employee record
                # Generate a unique employee ID (max 20 chars)
                employee_id = f"RES_{counter:04d}"  # RES_0001, RES_0002, etc.
                counter += 1
                
                new_employee = Employee(
                    employee_id=employee_id,
                    name=name,
                    email=f"{name.lower().replace(' ', '.')}@resigned.local",  # Placeholder email
                    role="RESIGNED",
                    team=sample_entry.team,
                    category="UN-BILLED",  # Default category
                    employment_status='Resigned',
                    is_active=False
                )
                db.add(new_employee)
                added_count += 1
                print(f"Added {name} as Resigned employee (ID: {employee_id})")
        
        db.commit()
        print(f"\nAdded {added_count} new resigned employees, updated {updated_count} existing employees.")
    except Exception as e:
        print(f"Error adding resigned employees: {e}")
        import traceback
        traceback.print_exc()
        db.rollback()
    finally:
        db.close()


def main():
    print("=== Adding Employment Status ===\n")
    
    # Step 1: Add column
    print("Step 1: Adding employment_status column...")
    add_employment_status_column()
    
    # Step 2: Set default status
    print("\nStep 2: Setting default status for existing employees...")
    set_default_status()
    
    # Step 3: Add resigned employees
    print("\nStep 3: Adding resigned employees...")
    add_resigned_employees()
    
    print("\n=== Done ===")


if __name__ == "__main__":
    main()
