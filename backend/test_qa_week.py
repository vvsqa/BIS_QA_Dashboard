from database import SessionLocal
from models import EnhancedTimesheet, Employee
from datetime import date, timedelta

db = SessionLocal()

# Get week for 2026-01-20
target_date = date(2026, 1, 20)
week_start = target_date - timedelta(days=target_date.weekday())
week_end = week_start + timedelta(days=6)

print(f"Week: {week_start} to {week_end}")

# Get QA employees
qa_employees = db.query(Employee).filter(
    Employee.team == 'QA',
    Employee.is_active == True
).all()

qa_employee_names = [emp.name for emp in qa_employees]
print(f"\nQA Employee names ({len(qa_employee_names)}):")
for name in qa_employee_names[:5]:
    print(f"  {name}")

# Get entries for this week with QA team
entries = db.query(EnhancedTimesheet).filter(
    EnhancedTimesheet.date >= week_start,
    EnhancedTimesheet.date <= week_end,
    EnhancedTimesheet.team == 'QA'
).all()

print(f"\nQA entries in week: {len(entries)}")
for entry in entries[:5]:
    print(f"  {entry.employee_name} - {entry.date} - Team: {entry.team}")

# Check if employee names match
entry_names = set([e.employee_name for e in entries])
emp_names = set(qa_employee_names)
print(f"\nEntry names: {len(entry_names)}")
print(f"Employee names: {len(emp_names)}")
print(f"Names in entries but not in employees: {entry_names - emp_names}")
print(f"Names in employees but not in entries: {emp_names - entry_names}")

db.close()
