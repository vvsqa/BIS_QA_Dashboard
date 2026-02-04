from database import SessionLocal
from models import EnhancedTimesheet, Employee
from datetime import date, timedelta

db = SessionLocal()

# Simulate the API query
target_date = date(2026, 1, 20)
week_start = target_date - timedelta(days=target_date.weekday())
week_end = week_start + timedelta(days=6)

team = "QA"
category = "ALL"

print(f"Week: {week_start} to {week_end}")
print(f"Team: {team}, Category: {category}")

# Get employees (same as API)
emp_query = db.query(Employee).filter(Employee.is_active == True)
if team.upper() != "ALL":
    emp_query = emp_query.filter(Employee.team == team.upper())
if category.upper() != "ALL":
    category_upper = category.upper()
    if category_upper == "UN-BILLED" or category_upper == "UNBILLED":
        emp_query = emp_query.filter(
            or_(
                func.upper(Employee.category) == "UN-BILLED",
                func.upper(Employee.category) == "UNBILLED"
            )
        )
    else:
        emp_query = emp_query.filter(func.upper(Employee.category) == category_upper)

employees = emp_query.all()
employee_names = [emp.name for emp in employees]

print(f"\nEmployees found: {len(employees)}")
print(f"Employee names: {employee_names[:5]}...")

# Query timesheet data (same as API)
from sqlalchemy import and_, or_, func

query = db.query(EnhancedTimesheet).filter(
    and_(
        EnhancedTimesheet.date >= week_start,
        EnhancedTimesheet.date <= week_end
    )
)

if team.upper() != "ALL":
    query = query.filter(EnhancedTimesheet.team == team.upper())
if category.upper() != "ALL" and employee_names:
    query = query.filter(EnhancedTimesheet.employee_name.in_(employee_names))

entries = query.order_by(
    EnhancedTimesheet.employee_name,
    EnhancedTimesheet.date
).all()

print(f"\nEntries found: {len(entries)}")
if entries:
    print("Sample entries:")
    for e in entries[:5]:
        print(f"  {e.employee_name} - {e.date} - Team: {e.team} - Hours: {e.hours_logged}")

db.close()
