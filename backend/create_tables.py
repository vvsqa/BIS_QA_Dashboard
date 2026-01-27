from database import engine
from models import (
    Base, Bug, TestPlan, TestRun, TestCase, TestResult, TicketTracking,
    Employee, Timesheet, EmployeeGoal, EmployeeReview, KPI, KPIRating,
    TicketStatusHistory, BugStatusHistory,
    EnhancedTimesheet, LeaveEntry, PlannedTask, WeeklyPlan
)

print("Creating tables...")
print("This will create tables for:")
print("  - Bug (Redmine bugs)")
print("  - TestPlan (TestRail test plans)")
print("  - TestRun (TestRail test runs)")
print("  - TestCase (TestRail test cases)")
print("  - TestResult (TestRail test results)")
print("  - TicketTracking (Excel imported ticket tracking data)")
print("  - Employee (Employee master data)")
print("  - Timesheet (Daily timesheet entries)")
print("  - EmployeeGoal (Goals, strengths, improvements)")
print("  - EmployeeReview (Yearly performance reviews)")
print("  - KPI (KPI definitions mapped to roles)")
print("  - KPIRating (Quarterly KPI ratings)")
print("  - TicketStatusHistory (Ticket status change tracking)")
print("  - BugStatusHistory (Bug status change tracking)")
print("  - EnhancedTimesheet (Google Sheets timesheet with leave/task details)")
print("  - LeaveEntry (Leave tracking)")
print("  - PlannedTask (Task planning by leads)")
print("  - WeeklyPlan (Weekly ticket assignments)")

Base.metadata.create_all(bind=engine)

print("\nTables created successfully.")
