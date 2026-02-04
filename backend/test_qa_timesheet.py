from database import SessionLocal
from models import EnhancedTimesheet, Employee
from datetime import date, timedelta

db = SessionLocal()

# Get current week
target_date = date(2026, 1, 27)
week_start = target_date - timedelta(days=target_date.weekday())
week_end = week_start + timedelta(days=6)

print(f"Week: {week_start} to {week_end}")

# Check all entries in this week
all_entries = db.query(EnhancedTimesheet).filter(
    EnhancedTimesheet.date >= week_start,
    EnhancedTimesheet.date <= week_end
).limit(10).all()

print(f"\nTotal entries in week: {len(all_entries)}")
for e in all_entries[:5]:
    print(f"  {e.employee_name} - {e.date} - Team: {repr(e.team)}")

# Check QA entries
qa_entries = db.query(EnhancedTimesheet).filter(
    EnhancedTimesheet.date >= week_start,
    EnhancedTimesheet.date <= week_end,
    EnhancedTimesheet.team == 'QA'
).count()

print(f"\nQA entries (team == 'QA'): {qa_entries}")

# Check QA employees
qa_employees = db.query(Employee).filter(
    Employee.team == 'QA',
    Employee.is_active == True
).all()

print(f"\nQA Employees: {len(qa_employees)}")
for emp in qa_employees[:5]:
    print(f"  {emp.name} (ID: {emp.employee_id})")

# Check entries for QA employee names
qa_employee_names = [emp.name for emp in qa_employees]
qa_entries_by_name = db.query(EnhancedTimesheet).filter(
    EnhancedTimesheet.date >= week_start,
    EnhancedTimesheet.date <= week_end,
    EnhancedTimesheet.employee_name.in_(qa_employee_names)
).count()

print(f"\nEntries for QA employee names: {qa_entries_by_name}")

# Check team values in entries
team_values = db.query(EnhancedTimesheet.team).filter(
    EnhancedTimesheet.date >= week_start,
    EnhancedTimesheet.date <= week_end
).distinct().all()

print(f"\nUnique team values in entries: {[t[0] for t in team_values]}")

db.close()
