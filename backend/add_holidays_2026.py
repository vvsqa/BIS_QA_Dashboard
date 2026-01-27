"""
Script to add Indian holidays for 2026.
Based on the holiday calendar provided.
"""

from database import SessionLocal
from models import Holiday
from datetime import date
from sqlalchemy import text

# Holiday data for 2026
HOLIDAYS_2026 = [
    # Format: (name, date_str (DD-MM-YYYY), day_name, category)
    ("New Year's Day", "01-01-2026", "Thursday", "Optional Holiday"),
    ("Republic Day", "26-01-2026", "Monday", "Holiday"),
    ("Eid-ul-Fitr (Ramzan)", "20-03-2026", "Friday", "Holiday"),
    ("Maundy Thursday", "02-04-2026", "Thursday", "Optional Holiday"),
    ("Good Friday", "03-04-2026", "Friday", "Holiday"),
    ("Vishu", "15-04-2026", "Wednesday", "Optional Holiday"),
    ("May Day", "01-05-2026", "Friday", "Holiday"),
    ("Eid-ul-Adha (Bakrid)", "27-05-2026", "Wednesday", "Optional Holiday"),
    ("Muharram", "25-06-2026", "Thursday", "Optional Holiday"),
    ("Independence day", "15-08-2026", "Saturday", "Holiday"),
    ("First Onam", "25-08-2026", "Tuesday", "Optional Holiday"),
    ("Thiruvonam", "26-08-2026", "Wednesday", "Holiday"),
    ("Gandhi Jayanthi", "02-10-2026", "Friday", "Holiday"),
    ("Vijayadashami", "21-10-2026", "Wednesday", "Optional Holiday"),
    ("Christmas Eve", "24-12-2026", "Thursday", "Optional Holiday"),
    ("Christmas", "25-12-2026", "Friday", "Holiday"),
]


def create_holidays_table():
    """Create the holidays table if it doesn't exist."""
    from database import engine
    with engine.connect() as conn:
        try:
            check_query = text("""
                SELECT table_name FROM information_schema.tables 
                WHERE table_name = 'holidays'
            """)
            result = conn.execute(check_query)
            if result.fetchone():
                print("Table 'holidays' already exists.")
                return True
            
            # Table will be created by SQLAlchemy when we create the model
            print("Table 'holidays' will be created by SQLAlchemy.")
            return True
        except Exception as e:
            print(f"Error checking table: {e}")
            return False


def add_holidays():
    """Add holidays for 2026."""
    db = SessionLocal()
    try:
        added_count = 0
        skipped_count = 0
        
        for name, date_str, day_name, category in HOLIDAYS_2026:
            # Parse date (DD-MM-YYYY)
            day, month, year = map(int, date_str.split('-'))
            holiday_date = date(year, month, day)
            
            # Check if holiday already exists
            existing = db.query(Holiday).filter(
                Holiday.holiday_date == holiday_date,
                Holiday.year == year
            ).first()
            
            if existing:
                print(f"Skipping {name} - already exists")
                skipped_count += 1
                continue
            
            holiday = Holiday(
                holiday_name=name,
                holiday_date=holiday_date,
                day_name=day_name,
                category=category,
                year=year,
                is_active=True
            )
            db.add(holiday)
            added_count += 1
            print(f"Added: {name} - {holiday_date} ({category})")
        
        db.commit()
        print(f"\nAdded {added_count} holidays, skipped {skipped_count} existing holidays.")
    except Exception as e:
        print(f"Error adding holidays: {e}")
        import traceback
        traceback.print_exc()
        db.rollback()
    finally:
        db.close()


def main():
    print("=== Adding Indian Holidays for 2026 ===\n")
    
    # Step 1: Check/create table
    print("Step 1: Checking holidays table...")
    create_holidays_table()
    
    # Step 2: Add holidays
    print("\nStep 2: Adding holidays...")
    add_holidays()
    
    print("\n=== Done ===")


if __name__ == "__main__":
    main()
