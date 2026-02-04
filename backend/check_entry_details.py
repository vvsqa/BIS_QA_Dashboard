from database import SessionLocal
from models import EnhancedTimesheet
from datetime import date, timedelta

db = SessionLocal()

target_date = date(2026, 1, 20)
week_start = target_date - timedelta(days=target_date.weekday())
week_end = week_start + timedelta(days=6)

entries = db.query(EnhancedTimesheet).filter(
    EnhancedTimesheet.date >= week_start,
    EnhancedTimesheet.date <= week_end,
    EnhancedTimesheet.team == 'QA'
).limit(10).all()

print(f"Checking {len(entries)} entries:")
for e in entries:
    print(f"\n  {e.employee_name} - {e.date}")
    print(f"    Hours logged: {e.hours_logged}")
    print(f"    Productive hours: {e.productive_hours}")
    print(f"    Leave type: {e.leave_type}")
    print(f"    Ticket ID: {e.ticket_id}")
    print(f"    Task: {e.task_description}")

db.close()
