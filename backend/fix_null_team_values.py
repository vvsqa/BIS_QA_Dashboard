"""
Script to fix NULL or incorrect team values in EnhancedTimesheet entries.
This script looks up the employee's team from the Employee table and updates
any timesheet entries with NULL or incorrect team values.
"""
from database import SessionLocal
from models import Employee, EnhancedTimesheet
from sqlalchemy import func

db = SessionLocal()

try:
    print("Fixing NULL or incorrect team values in EnhancedTimesheet")
    print("=" * 60)
    
    # Find entries with NULL team
    null_entries = db.query(EnhancedTimesheet).filter(
        EnhancedTimesheet.team == None
    ).all()
    
    print(f"\nFound {len(null_entries)} entries with NULL team")
    
    if null_entries:
        fixed_count = 0
        for entry in null_entries:
            # Look up employee by name
            employee = db.query(Employee).filter(
                Employee.name == entry.employee_name,
                Employee.is_active == True
            ).first()
            
            if employee and employee.team:
                # Map "DEVELOPMENT" to "DEV" for EnhancedTimesheet
                if employee.team == "DEVELOPMENT":
                    entry.team = "DEV"
                else:
                    entry.team = employee.team
                fixed_count += 1
                if fixed_count <= 5:
                    print(f"  Fixed: {entry.employee_name} - Set team to {entry.team}")
        
        if fixed_count > 0:
            db.commit()
            print(f"\nFixed {fixed_count} entries with NULL team values")
        else:
            print("\nNo entries could be fixed (employees not found)")
    else:
        print("\nNo entries with NULL team found")
    
    # Check for entries with incorrect team values (e.g., "DEVELOPMENT" instead of "DEV")
    print("\nChecking for entries with incorrect team values...")
    
    # Find entries with "DEVELOPMENT" (should be "DEV")
    dev_entries = db.query(EnhancedTimesheet).filter(
        EnhancedTimesheet.team == "DEVELOPMENT"
    ).all()
    
    if dev_entries:
        print(f"Found {len(dev_entries)} entries with 'DEVELOPMENT' (should be 'DEV')")
        for entry in dev_entries:
            entry.team = "DEV"
        db.commit()
        print(f"Fixed {len(dev_entries)} entries")
    else:
        print("No entries with incorrect team values found")
    
    # Final verification
    print("\nFinal verification:")
    null_count = db.query(func.count(EnhancedTimesheet.id)).filter(
        EnhancedTimesheet.team == None
    ).scalar()
    
    incorrect_count = db.query(func.count(EnhancedTimesheet.id)).filter(
        EnhancedTimesheet.team == "DEVELOPMENT"
    ).scalar()
    
    print(f"  Entries with NULL team: {null_count}")
    print(f"  Entries with 'DEVELOPMENT' team: {incorrect_count}")
    
    if null_count == 0 and incorrect_count == 0:
        print("\n[OK] All team values are correct!")
    
except Exception as e:
    print(f"\nError: {e}")
    db.rollback()
finally:
    db.close()
