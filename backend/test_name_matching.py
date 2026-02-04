from database import SessionLocal
from models import EnhancedTimesheet, Employee
from datetime import date, timedelta

db = SessionLocal()

target_date = date(2026, 1, 20)
week_start = target_date - timedelta(days=target_date.weekday())
week_end = week_start + timedelta(days=6)

# Get employees
employees = db.query(Employee).filter(
    Employee.is_active == True,
    Employee.team == 'QA'
).all()

employee_data = {}
for emp in employees:
    employee_data[emp.name] = {
        "employee_id": emp.employee_id,
        "employee_name": emp.name,
        "team": emp.team,
        "days": {}
    }
    # Initialize all days
    for i in range(7):
        day = week_start + timedelta(days=i)
        day_key = day.isoformat()
        employee_data[emp.name]["days"][day_key] = {
            "date": day_key,
            "entries": [],
            "total_hours": 0,
            "productive_hours": 0,
            "hours_logged": 0,
        }

print(f"Initialized {len(employee_data)} employees")
print(f"Employee names: {list(employee_data.keys())[:5]}")

# Get entries
entries = db.query(EnhancedTimesheet).filter(
    EnhancedTimesheet.date >= week_start,
    EnhancedTimesheet.date <= week_end,
    EnhancedTimesheet.team == 'QA'
).limit(10).all()

print(f"\nProcessing {len(entries)} entries:")
matched = 0
not_matched = 0

for entry in entries:
    name = entry.employee_name
    if name not in employee_data:
        print(f"  NOT MATCHED: {name} (not in employee_data)")
        not_matched += 1
    else:
        day_key = entry.date.isoformat()
        if day_key in employee_data[name]["days"]:
            matched += 1
            if matched <= 3:
                print(f"  MATCHED: {name} - {day_key}")
        else:
            print(f"  DAY NOT FOUND: {name} - {day_key} (not in days dict)")

print(f"\nMatched: {matched}, Not matched: {not_matched}")

db.close()
