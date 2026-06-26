"""Create the rebuilt automation module tables.

Run once: python add_automation_tables.py
create_all only creates missing tables, so this is safe to re-run.
"""
from database import engine
from models import (  # noqa: F401
    Base, AutomationCase, AutomationExecution, AutomationSnapshot, AppSetting,
)

Base.metadata.create_all(bind=engine, tables=[
    AutomationCase.__table__,
    AutomationExecution.__table__,
    AutomationSnapshot.__table__,
    AppSetting.__table__,
])
print("automation_cases, automation_executions, automation_snapshots, app_settings tables ensured.")
