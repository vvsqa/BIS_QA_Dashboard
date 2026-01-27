"""
Script to fix employee name discrepancies and merge duplicate profiles.
This script:
1. Creates the employee_name_mappings table
2. Adds known name mappings
3. Updates existing timesheet entries to use canonical names
"""

from database import engine, SessionLocal
from models import Employee, EnhancedTimesheet, LeaveEntry, EmployeeNameMapping
from sqlalchemy import text

# Known name mappings: {alternate_name: (canonical_name, employee_id)}
NAME_MAPPINGS = {
    # Format: 'Alternate Name': ('Canonical Name', 'Employee ID')
    'Anand Vishnu K V': ('Anand Vishnu', None),
    'Binoy Dominic': ('Binoy Dominic P', None),
    'Deepak  Jose': ('Deepak Jose', None),  # Double space
    # Add more mappings as needed
}


def create_mapping_table():
    """Create the employee_name_mappings table if it doesn't exist."""
    with engine.connect() as conn:
        try:
            check_query = text("""
                SELECT table_name FROM information_schema.tables 
                WHERE table_name = 'employee_name_mappings'
            """)
            result = conn.execute(check_query)
            if result.fetchone():
                print("Table 'employee_name_mappings' already exists.")
                return True
            
            create_query = text("""
                CREATE TABLE employee_name_mappings (
                    id SERIAL PRIMARY KEY,
                    alternate_name VARCHAR(150) UNIQUE NOT NULL,
                    canonical_name VARCHAR(150) NOT NULL,
                    employee_id VARCHAR(20),
                    source VARCHAR(50) DEFAULT 'manual',
                    notes TEXT,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_on TIMESTAMP
                )
            """)
            conn.execute(create_query)
            conn.commit()
            print("Created 'employee_name_mappings' table.")
            return True
        except Exception as e:
            print(f"Error creating table: {e}")
            conn.rollback()
            return False


def add_name_mappings():
    """Add known name mappings to the database."""
    db = SessionLocal()
    try:
        for alt_name, (canonical_name, emp_id) in NAME_MAPPINGS.items():
            # Check if mapping already exists
            existing = db.query(EmployeeNameMapping).filter(
                EmployeeNameMapping.alternate_name == alt_name
            ).first()
            
            if existing:
                print(f"Mapping already exists: {alt_name} -> {existing.canonical_name}")
                continue
            
            # Find employee ID if not provided
            if not emp_id:
                emp = db.query(Employee).filter(Employee.name == canonical_name).first()
                emp_id = emp.employee_id if emp else None
            
            mapping = EmployeeNameMapping(
                alternate_name=alt_name,
                canonical_name=canonical_name,
                employee_id=emp_id,
                source='manual',
                notes='Initial mapping'
            )
            db.add(mapping)
            print(f"Added mapping: {alt_name} -> {canonical_name} (ID: {emp_id})")
        
        db.commit()
        print("\nName mappings added successfully.")
    except Exception as e:
        print(f"Error adding mappings: {e}")
        db.rollback()
    finally:
        db.close()


def update_timesheet_names():
    """Update existing timesheet entries to use canonical names."""
    db = SessionLocal()
    try:
        # Get all active mappings
        mappings = db.query(EmployeeNameMapping).filter(
            EmployeeNameMapping.is_active == True
        ).all()
        
        if not mappings:
            print("No name mappings found.")
            return
        
        total_updated = 0
        
        for mapping in mappings:
            # Update EnhancedTimesheet
            ts_count = db.query(EnhancedTimesheet).filter(
                EnhancedTimesheet.employee_name == mapping.alternate_name
            ).update({
                'employee_name': mapping.canonical_name,
                'employee_id': mapping.employee_id
            }, synchronize_session=False)
            
            # Update LeaveEntry
            leave_count = db.query(LeaveEntry).filter(
                LeaveEntry.employee_name == mapping.alternate_name
            ).update({
                'employee_name': mapping.canonical_name,
                'employee_id': mapping.employee_id
            }, synchronize_session=False)
            
            if ts_count or leave_count:
                print(f"Updated '{mapping.alternate_name}' -> '{mapping.canonical_name}': "
                      f"{ts_count} timesheets, {leave_count} leaves")
                total_updated += ts_count + leave_count
        
        db.commit()
        print(f"\nTotal records updated: {total_updated}")
    except Exception as e:
        print(f"Error updating names: {e}")
        db.rollback()
    finally:
        db.close()


def show_remaining_unmatched():
    """Show names in timesheets that don't have a matching Employee record."""
    db = SessionLocal()
    try:
        # Get all employee names
        employees = db.query(Employee.name).all()
        emp_names = set(e[0] for e in employees)
        
        # Get all timesheet names
        ts_names = db.query(EnhancedTimesheet.employee_name).distinct().all()
        ts_names = set(n[0] for n in ts_names)
        
        # Find unmatched
        unmatched = ts_names - emp_names
        
        if unmatched:
            print("\n=== Remaining Unmatched Names ===")
            for name in sorted(unmatched):
                count = db.query(EnhancedTimesheet).filter(
                    EnhancedTimesheet.employee_name == name
                ).count()
                print(f"  {name}: {count} entries")
            print(f"\nTotal unmatched: {len(unmatched)}")
        else:
            print("\nAll timesheet names are matched to Employee records!")
    finally:
        db.close()


def main():
    print("=== Employee Name Mapping Fix ===\n")
    
    # Step 1: Create mapping table
    print("Step 1: Creating mapping table...")
    create_mapping_table()
    
    # Step 2: Add known mappings
    print("\nStep 2: Adding name mappings...")
    add_name_mappings()
    
    # Step 3: Update existing records
    print("\nStep 3: Updating existing timesheet records...")
    update_timesheet_names()
    
    # Step 4: Show remaining unmatched
    print("\nStep 4: Checking remaining unmatched names...")
    show_remaining_unmatched()
    
    print("\n=== Done ===")


if __name__ == "__main__":
    main()
