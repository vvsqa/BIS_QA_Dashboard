from database import engine
from models import Base, Bug, TestPlan, TestRun, TestCase, TestResult, TicketTracking

print("Creating tables...")
print("This will create tables for:")
print("  - Bug (Redmine bugs)")
print("  - TestPlan (TestRail test plans)")
print("  - TestRun (TestRail test runs)")
print("  - TestCase (TestRail test cases)")
print("  - TestResult (TestRail test results)")
print("  - TicketTracking (Excel imported ticket tracking data)")

Base.metadata.create_all(bind=engine)

print("\nTables created successfully.")
