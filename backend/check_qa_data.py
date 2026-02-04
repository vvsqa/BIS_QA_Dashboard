from database import SessionLocal
from models import EnhancedTimesheet
from datetime import date, timedelta

db = SessionLocal()

# Check total QA entries
total_qa = db.query(EnhancedTimesheet).filter(
    EnhancedTimesheet.team == 'QA'
).count()

print(f"Total QA entries in database: {total_qa}")

# Check recent QA entries (last 30 days)
recent_date = date.today() - timedelta(days=30)
recent_qa = db.query(EnhancedTimesheet).filter(
    EnhancedTimesheet.team == 'QA',
    EnhancedTimesheet.date >= recent_date
).count()

print(f"QA entries in last 30 days: {recent_qa}")

# Check latest QA entry date
latest_qa = db.query(EnhancedTimesheet).filter(
    EnhancedTimesheet.team == 'QA'
).order_by(EnhancedTimesheet.date.desc()).first()

if latest_qa:
    print(f"Latest QA entry date: {latest_qa.date}")
    print(f"Latest QA entry employee: {latest_qa.employee_name}")
else:
    print("No QA entries found in database")

# Check all team values
all_teams = db.query(EnhancedTimesheet.team).distinct().all()
print(f"\nAll team values in database: {[t[0] for t in all_teams if t[0]]}")

db.close()
