from sqlalchemy import Column, Integer, String, DateTime, Text, Float, Boolean, Date, Time, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime

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
    description = Column(Text, nullable=True)           # Bug description/details
    assignee = Column(String(100), index=True)
    author = Column(String(100))

    module = Column(String(100), index=True)
    feature = Column(String(150))

    platform = Column(String(50))
    browser = Column(String(50))
    os = Column(String(50))

    project = Column(String(100), index=True)
    
    # Time tracking fields
    start_date = Column(DateTime, nullable=True)
    due_date = Column(DateTime, nullable=True)
    estimated_hours = Column(Float, nullable=True)
    spent_hours = Column(Float, nullable=True)
    done_ratio = Column(Integer, nullable=True)         # 0-100%

    created_on = Column(DateTime)
    updated_on = Column(DateTime)
    closed_on = Column(DateTime, nullable=True)
    
    # Store ALL raw Redmine data as JSON (captures everything including custom fields)
    raw_data = Column(JSONB, nullable=True)
    custom_fields = Column(JSONB, nullable=True)        # Custom fields only for quick access


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


# ===== EMPLOYEE MANAGEMENT MODELS =====

class Employee(Base):
    """Employee master data"""
    __tablename__ = "employees"
    
    id = Column(Integer, primary_key=True)
    employee_id = Column(String(20), unique=True, index=True)  # TV0539
    name = Column(String(100), index=True)
    email = Column(String(150), unique=True)
    role = Column(String(100))  # SOFTWARE ENGINEER, ASSOCIATE SOFTWARE ENGINEER, etc.
    location = Column(String(50))  # Trivandrum
    date_of_joining = Column(DateTime)
    team = Column(String(50), index=True)  # DEVELOPMENT, QA
    category = Column(String(50))  # BILLED, UN-BILLED
    employment_status = Column(String(50), default='Ongoing Employee', index=True)  # Ongoing Employee, Resigned
    lead = Column(String(100), index=True)  # Reporting manager name
    manager = Column(String(100), index=True)  # Manager name (can be different from lead)
    previous_experience = Column(Float, nullable=True)  # Years of experience before joining Techversant
    bis_introduced_date = Column(DateTime, nullable=True)  # Date when employee was introduced to BIS (for billed employees)
    platform = Column(String(50), nullable=True)  # Web or Mobile
    photo_url = Column(String(500), nullable=True)  # URL/path to employee photo
    is_active = Column(Boolean, default=True)
    mapping_data = Column(JSONB, nullable=True)  # Additional mapping columns from Excel (Column 1-5, Notes, etc.)
    created_on = Column(DateTime, default=datetime.utcnow)
    updated_on = Column(DateTime, onupdate=datetime.utcnow)


class Timesheet(Base):
    """Daily timesheet entries from PM Tool"""
    __tablename__ = "timesheets"
    
    id = Column(Integer, primary_key=True)
    employee_name = Column(String(100), index=True)
    ticket_id = Column(Integer, index=True)
    date = Column(Date, index=True)
    time_logged = Column(String(20))  # HH:MM:SS as string
    time_logged_minutes = Column(Integer)  # For easier aggregation
    team = Column(String(50))
    created_on = Column(DateTime, default=datetime.utcnow)
    
    # Unique constraint to prevent duplicates
    __table_args__ = (
        UniqueConstraint('employee_name', 'ticket_id', 'date', name='uq_timesheet_entry'),
    )


class EmployeeGoal(Base):
    """Employee goals, strengths, and areas of improvement"""
    __tablename__ = "employee_goals"
    
    id = Column(Integer, primary_key=True)
    employee_id = Column(String(20), index=True)  # FK to Employee.employee_id
    goal_type = Column(String(50))  # 'goal', 'strength', 'improvement'
    title = Column(String(200))
    description = Column(Text, nullable=True)
    target_date = Column(Date, nullable=True)
    status = Column(String(50), default='active')  # active, achieved, cancelled
    progress = Column(Integer, default=0)  # 0-100%
    created_by = Column(String(100))  # Manager who created
    created_on = Column(DateTime, default=datetime.utcnow)
    updated_on = Column(DateTime, onupdate=datetime.utcnow)


class EmployeeReview(Base):
    """Yearly performance reviews"""
    __tablename__ = "employee_reviews"
    
    id = Column(Integer, primary_key=True)
    employee_id = Column(String(20), index=True)  # FK to Employee.employee_id
    review_period = Column(String(50))  # "2025", "2024-H2", etc.
    review_date = Column(Date)
    
    # Auto-calculated RAG status
    rag_status = Column(String(10))  # RED, AMBER, GREEN
    rag_score = Column(Float)  # 0-100 calculated score
    
    # Manager ratings (1-5 stars)
    technical_rating = Column(Integer)
    productivity_rating = Column(Integer)
    quality_rating = Column(Integer)
    communication_rating = Column(Integer)
    overall_rating = Column(Float)  # Average of above
    
    # Manager notes
    strengths_summary = Column(Text, nullable=True)
    improvements_summary = Column(Text, nullable=True)
    manager_comments = Column(Text, nullable=True)
    
    # Recommendation
    recommendation = Column(String(50))  # 'retain', 'promote', 'pip', 'release'
    salary_hike_percent = Column(Float, nullable=True)
    
    reviewed_by = Column(String(100))
    created_on = Column(DateTime, default=datetime.utcnow)
    updated_on = Column(DateTime, onupdate=datetime.utcnow)


class KPI(Base):
    """KPI definitions mapped to roles"""
    __tablename__ = "kpis"
    
    id = Column(Integer, primary_key=True)
    kpi_code = Column(String(100), unique=True, index=True)  # Unique KPI identifier
    kpi_name = Column(String(200), index=True)
    description = Column(Text, nullable=True)
    role = Column(String(100), index=True)  # Role this KPI applies to (e.g., "SOFTWARE ENGINEER", "ASSOCIATE SOFTWARE ENGINEER")
    team = Column(String(50), index=True)  # DEVELOPMENT, QA, or NULL for all teams
    category = Column(String(100), nullable=True)  # Technical, Communication, Quality, etc.
    weight = Column(Float, default=1.0)  # Weight for calculating overall score
    is_active = Column(Boolean, default=True)
    created_on = Column(DateTime, default=datetime.utcnow)
    updated_on = Column(DateTime, onupdate=datetime.utcnow)


class KPIRating(Base):
    """Quarterly KPI ratings for employees"""
    __tablename__ = "kpi_ratings"
    
    id = Column(Integer, primary_key=True)
    employee_id = Column(String(20), index=True)  # FK to Employee.employee_id
    kpi_id = Column(Integer, index=True)  # FK to KPI.id
    quarter = Column(String(20), index=True)  # "2025-Q1", "2025-Q2", etc.
    year = Column(Integer, index=True)
    quarter_number = Column(Integer)  # 1, 2, 3, 4
    
    # Rating (typically 1-5 or 0-100)
    rating = Column(Float, nullable=True)  # Manager's rating (deprecated, use manager_rating)
    max_rating = Column(Float, default=5.0)  # Maximum possible rating (usually 5)
    
    # Performance data (auto-calculated from actual performance)
    performance_score = Column(Float, nullable=True)  # Calculated from actual metrics
    performance_percentage = Column(Float, nullable=True)  # Performance as percentage
    
    # Self, Lead, and Manager ratings
    self_rating = Column(Float, nullable=True)  # Employee's self rating
    lead_rating = Column(Float, nullable=True)  # Lead's rating
    manager_rating = Column(Float, nullable=True)  # Manager's rating
    manager_comments = Column(Text, nullable=True)
    lead_comments = Column(Text, nullable=True)
    self_comments = Column(Text, nullable=True)
    
    # Final score (combination of performance and manager rating)
    final_score = Column(Float, nullable=True)
    
    rated_by = Column(String(100))  # Who provided the rating (self/lead/manager)
    rated_on = Column(DateTime, default=datetime.utcnow)
    created_on = Column(DateTime, default=datetime.utcnow)
    updated_on = Column(DateTime, onupdate=datetime.utcnow)
    
    # Unique constraint: one rating per employee-KPI-quarter
    __table_args__ = (
        UniqueConstraint('employee_id', 'kpi_id', 'quarter', name='uq_kpi_rating'),
    )


# ===== STATUS HISTORY TRACKING =====

class TicketStatusHistory(Base):
    """
    Tracks all status changes for tickets.
    Every time a ticket's status changes, a new record is created.
    This enables accurate reporting on when tickets moved between statuses.
    """
    __tablename__ = "ticket_status_history"
    
    id = Column(Integer, primary_key=True)
    ticket_id = Column(Integer, index=True)  # PM Tracker Ticket ID
    
    # Status change details
    previous_status = Column(String(100), nullable=True)  # NULL for first entry
    new_status = Column(String(100), index=True)
    
    # When the change happened
    changed_on = Column(DateTime, index=True, default=datetime.utcnow)
    
    # Who was responsible (captured at time of change)
    current_assignee = Column(String(100), nullable=True)
    qc_tester = Column(String(100), nullable=True)
    
    # Duration in previous status (in hours)
    duration_in_previous_status = Column(Float, nullable=True)
    
    # Source of change detection
    source = Column(String(50), default='sync')  # 'sync', 'manual', 'api'
    
    created_on = Column(DateTime, default=datetime.utcnow)
    
    # Indexes for efficient querying
    __table_args__ = (
        # Index for finding status changes in date range
        # Index for finding when tickets entered a specific status
    )


class BugStatusHistory(Base):
    """
    Tracks all status changes for bugs.
    Enables tracking bug lifecycle and resolution times.
    """
    __tablename__ = "bug_status_history"
    
    id = Column(Integer, primary_key=True)
    bug_id = Column(Integer, index=True)  # Redmine Bug ID
    ticket_id = Column(Integer, index=True)  # Associated PM Tracker ID
    
    # Status change details
    previous_status = Column(String(100), nullable=True)
    new_status = Column(String(100), index=True)
    
    # When the change happened
    changed_on = Column(DateTime, index=True, default=datetime.utcnow)
    
    # Who was assigned at time of change
    assignee = Column(String(100), nullable=True)
    
    # Duration in previous status (in hours)
    duration_in_previous_status = Column(Float, nullable=True)
    
    # Source of change detection
    source = Column(String(50), default='sync')  # 'sync', 'manual', 'api'
    
    created_on = Column(DateTime, default=datetime.utcnow)


# ===== CALENDAR AND TASK PLANNING MODELS =====

class EnhancedTimesheet(Base):
    """
    Enhanced timesheet entries synced from Google Sheets.
    Contains additional fields for leave type, task description, and project.
    """
    __tablename__ = "enhanced_timesheets"
    
    id = Column(Integer, primary_key=True)
    employee_id = Column(String(20), index=True)  # FK to Employee.employee_id
    employee_name = Column(String(100), index=True)
    ticket_id = Column(String(150), index=True)  # Can be ticket number, generic activity, or leave/holiday marker
    date = Column(Date, index=True)
    hours_logged = Column(Float)  # Hours as decimal (Time Spent from employees)
    productive_hours = Column(Float, nullable=True)  # Productive Hours (from leads/managers)
    time_logged_minutes = Column(Integer)  # For easier aggregation
    
    # Enhanced fields from Google Sheets
    leave_type = Column(String(50), nullable=True)  # Leave, WFH, Holiday, Sick Leave, etc.
    task_description = Column(Text, nullable=True)
    project_name = Column(String(150), nullable=True)
    
    # Team and source tracking
    team = Column(String(50), index=True)  # QA, DEV
    source = Column(String(50), default='google_sheets')  # google_sheets, manual, excel
    
    # Sync metadata
    synced_on = Column(DateTime, default=datetime.utcnow)
    sheet_row_id = Column(String(100), nullable=True)  # For tracking updates
    
    created_on = Column(DateTime, default=datetime.utcnow)
    updated_on = Column(DateTime, onupdate=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint('employee_name', 'ticket_id', 'date', 'team', name='uq_enhanced_timesheet_entry'),
    )


class LeaveEntry(Base):
    """
    Dedicated leave tracking extracted from timesheets.
    Makes it easier to query and display leave information.
    """
    __tablename__ = "leave_entries"
    
    id = Column(Integer, primary_key=True)
    employee_id = Column(String(20), index=True)  # FK to Employee.employee_id
    employee_name = Column(String(100), index=True)
    date = Column(Date, index=True)
    
    leave_type = Column(String(50), index=True)  # Leave, WFH, Sick Leave, Half Day, Holiday
    status = Column(String(50), default='approved')  # pending, approved, rejected
    hours = Column(Float, default=8.0)  # Full day = 8, Half day = 4
    
    reason = Column(Text, nullable=True)
    team = Column(String(50), index=True)  # QA, DEV
    
    # Source tracking
    source = Column(String(50), default='google_sheets')
    
    created_on = Column(DateTime, default=datetime.utcnow)
    updated_on = Column(DateTime, onupdate=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint('employee_name', 'date', 'leave_type', name='uq_leave_entry'),
    )


class PlannedTask(Base):
    """
    Tasks planned by leads for team members.
    Used for plan vs actual comparison.
    """
    __tablename__ = "planned_tasks"
    
    id = Column(Integer, primary_key=True)
    employee_id = Column(String(20), index=True)  # FK to Employee.employee_id
    employee_name = Column(String(100), index=True)
    
    # Task details
    ticket_id = Column(String(50), index=True)  # Ticket number or project code
    task_title = Column(String(300))
    task_description = Column(Text, nullable=True)
    project_name = Column(String(150), nullable=True)
    
    # Planning details
    planned_date = Column(Date, index=True)
    planned_hours = Column(Float)  # Estimated hours for this task
    priority = Column(String(20), default='medium')  # high, medium, low
    
    # Status tracking
    status = Column(String(50), default='planned')  # planned, in_progress, completed, cancelled
    
    # Team and assignment
    team = Column(String(50), index=True)  # QA, DEV
    assigned_by = Column(String(100))  # Lead who assigned
    
    # Actual tracking (filled after completion)
    actual_hours = Column(Float, nullable=True)
    completed_on = Column(DateTime, nullable=True)
    
    created_on = Column(DateTime, default=datetime.utcnow)
    updated_on = Column(DateTime, onupdate=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint('employee_name', 'ticket_id', 'planned_date', name='uq_planned_task'),
    )


class WeeklyPlan(Base):
    """
    Weekly ticket assignments for employees.
    High-level weekly planning by leads.
    """
    __tablename__ = "weekly_plans"
    
    id = Column(Integer, primary_key=True)
    employee_id = Column(String(20), index=True)  # FK to Employee.employee_id
    employee_name = Column(String(100), index=True)
    
    # Week identification
    week_start = Column(Date, index=True)  # Monday of the week
    week_end = Column(Date)  # Sunday of the week
    year = Column(Integer, index=True)
    week_number = Column(Integer, index=True)  # ISO week number
    
    # Assigned tickets for the week (stored as JSON array)
    assigned_tickets = Column(JSONB)  # [{"ticket_id": "12345", "priority": "high", "estimated_hours": 20}]
    
    # Planning summary
    total_planned_hours = Column(Float, default=0)
    notes = Column(Text, nullable=True)
    
    # Team and assignment
    team = Column(String(50), index=True)  # QA, DEV
    planned_by = Column(String(100))  # Lead who created the plan
    
    # Status
    status = Column(String(50), default='draft')  # draft, published, completed
    
    created_on = Column(DateTime, default=datetime.utcnow)
    updated_on = Column(DateTime, onupdate=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint('employee_name', 'week_start', name='uq_weekly_plan'),
    )


class EmployeeNameMapping(Base):
    """
    Maps alternate/variant names to canonical employee names.
    Used to handle name discrepancies between different data sources.
    """
    __tablename__ = "employee_name_mappings"
    
    id = Column(Integer, primary_key=True)
    alternate_name = Column(String(150), unique=True, index=True)  # Name variation from sheets/imports
    canonical_name = Column(String(150), index=True)  # Correct name from Employee table
    employee_id = Column(String(20), index=True)  # FK to Employee.employee_id
    
    source = Column(String(50), default='manual')  # manual, auto-detected
    notes = Column(Text, nullable=True)
    
    is_active = Column(Boolean, default=True)
    created_on = Column(DateTime, default=datetime.utcnow)
    updated_on = Column(DateTime, onupdate=datetime.utcnow)


class Holiday(Base):
    """
    Stores Indian holidays and optional holidays.
    Employees can select 2 optional holidays per year.
    """
    __tablename__ = "holidays"
    
    id = Column(Integer, primary_key=True)
    holiday_name = Column(String(200), nullable=False)
    holiday_date = Column(Date, nullable=False, index=True)
    day_name = Column(String(20))  # Monday, Tuesday, etc.
    category = Column(String(50), nullable=False)  # 'Holiday' or 'Optional Holiday'
    year = Column(Integer, nullable=False, index=True)
    
    is_active = Column(Boolean, default=True)
    created_on = Column(DateTime, default=datetime.utcnow)
    updated_on = Column(DateTime, onupdate=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint('holiday_date', 'year', name='uq_holiday_date_year'),
    )
