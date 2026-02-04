from database import SessionLocal
from models import EnhancedTimesheet
from datetime import date, timedelta

db = SessionLocal()

# Check entries for the last 7 days
today = date.today()
seven_days_ago = today - timedelta(days=7)

print(f"Checking entries from {seven_days_ago} to {today}")

# Check QA entries
qa_entries = db.query(EnhancedTimesheet).filter(
    EnhancedTimesheet.date >= seven_days_ago,
    EnhancedTimesheet.date <= today,
    EnhancedTimesheet.team == 'QA'
).order_by(EnhancedTimesheet.date.desc()).all()

print(f"\nQA entries in last 7 days: {len(qa_entries)}")

if qa_entries:
    # Group by date
    by_date = {}
    for e in qa_entries:
        date_str = str(e.date)
        if date_str not in by_date:
            by_date[date_str] = []
        by_date[date_str].append(e)
    
    print("\nEntries by date:")
    for date_str in sorted(by_date.keys(), reverse=True):
        entries = by_date[date_str]
        print(f"  {date_str}: {len(entries)} entries")
        if entries:
            sample = entries[0]
            print(f"    Sample: {sample.employee_name} - Hours: {sample.hours_logged}, Productive: {sample.productive_hours}")
else:
    print("No QA entries found in the last 7 days")

db.close()
