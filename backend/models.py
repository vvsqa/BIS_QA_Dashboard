from sqlalchemy import Column, Integer, String, DateTime, Text, Float
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

class Bug(Base):
    __tablename__ = "bugs"

    id = Column(Integer, primary_key=True)
    bug_id = Column(Integer, unique=True, index=True)  # Redmine bug ID (#)

    ticket_id = Column(Integer, index=True)             # PM Tracker ID
    parent_task_id = Column(Integer, index=True)        # Redmine task ID

    tracker = Column(String(50))
    status = Column(String(50), index=True)
    priority = Column(String(50))
    severity = Column(String(50), index=True)
    environment = Column(String(50), index=True)

    subject = Column(String(500))
    assignee = Column(String(100), index=True)
    author = Column(String(100))

    module = Column(String(100), index=True)
    feature = Column(String(150))

    platform = Column(String(50))
    browser = Column(String(50))
    os = Column(String(50))

    project = Column(String(100), index=True)

    created_on = Column(DateTime)
    updated_on = Column(DateTime)
    closed_on = Column(DateTime, nullable=True)


class TestPlan(Base):
    __tablename__ = "test_plans"

    id = Column(Integer, primary_key=True)
    plan_id = Column(Integer, unique=True, index=True)  # TestRail plan ID
    ticket_id = Column(Integer, index=True)             # PM Tracker ID (links to ticket)
    name = Column(String(500))
    description = Column(Text, nullable=True)
    created_on = Column(DateTime)
    updated_on = Column(DateTime)
    custom_fields = Column(JSONB, nullable=True)       # Store all custom fields as JSON


class TestRun(Base):
    __tablename__ = "test_runs"

    id = Column(Integer, primary_key=True)
    run_id = Column(Integer, unique=True, index=True)  # TestRail run ID
    plan_id = Column(Integer, index=True)               # Links to TestPlan
    ticket_id = Column(Integer, index=True)             # PM Tracker ID (for direct access)
    name = Column(String(500))
    description = Column(Text, nullable=True)
    created_on = Column(DateTime)
    updated_on = Column(DateTime)
    status = Column(String(50), nullable=True)
    custom_fields = Column(JSONB, nullable=True)       # Store all custom fields as JSON


class TestCase(Base):
    __tablename__ = "test_cases"

    id = Column(Integer, primary_key=True)
    case_id = Column(Integer, unique=True, index=True)  # TestRail case ID
    run_id = Column(Integer, index=True)                # Links to TestRun
    ticket_id = Column(Integer, index=True)             # PM Tracker ID (for direct access)
    title = Column(String(500))
    section = Column(String(200), nullable=True)
    priority = Column(String(50), nullable=True)
    type = Column(String(50), nullable=True)
    custom_fields = Column(JSONB, nullable=True)        # Store all custom fields as JSON


class TestResult(Base):
    __tablename__ = "test_results"

    id = Column(Integer, primary_key=True)
    test_id = Column(Integer, index=True)               # TestRail test ID (test in a run)
    run_id = Column(Integer, index=True)                # Links to TestRun
    case_id = Column(Integer, index=True)               # Links to TestCase
    ticket_id = Column(Integer, index=True)             # PM Tracker ID (for direct access)
    status_id = Column(Integer)                         # TestRail status ID (1=Passed, 2=Blocked, etc.)
    status_name = Column(String(50), index=True)        # Passed, Failed, Blocked, Retest, Untested
    assigned_to = Column(String(100), nullable=True)
    created_on = Column(DateTime)
    custom_fields = Column(JSONB, nullable=True)       # Store all custom fields as JSON


class TicketTracking(Base):
    """Ticket tracking data imported from Excel exports"""
    __tablename__ = "ticket_tracking"
    
    id = Column(Integer, primary_key=True)
    ticket_id = Column(Integer, unique=True, index=True)  # Ticket Number from tracking tool
    status = Column(String(100), nullable=True)           # Ticket status (NEW, In Progress, etc.)
    backend_developer = Column(String(100), nullable=True)
    frontend_developer = Column(String(100), nullable=True)
    qc_tester = Column(String(100), nullable=True)
    eta = Column(DateTime, nullable=True)                 # Expected completion date
    current_assignee = Column(String(100), nullable=True)
    dev_estimate_hours = Column(Float, nullable=True)     # Estimated development time
    actual_dev_hours = Column(Float, nullable=True)       # Actual development time spent
    qa_estimate_hours = Column(Float, nullable=True)      # Estimated QA time
    actual_qa_hours = Column(Float, nullable=True)        # Actual QA time spent
    developer_assigned = Column(String(100), nullable=True)  # Developer column from Excel
    updated_on = Column(DateTime, nullable=True)          # Last import timestamp
