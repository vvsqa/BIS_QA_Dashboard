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
    title = Column(String(500), nullable=True)            # Ticket title from PM API (TicketTitle)
    status = Column(String(100), nullable=True)           # Ticket status (NEW, In Progress, etc.)
    priority = Column(String(100), nullable=True)         # URGENT, High (Bugs), Medium, Low, etc.
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
    subdepartment = Column(String(100), nullable=True)    # Web, Mobile, BIS, etc. from PM API Subdepartment
    updated_on = Column(DateTime, nullable=True)          # Last import timestamp
    created_on = Column(DateTime, nullable=True)          # Ticket created date from PM API (TicketCreatedDate)
    closed_on = Column(DateTime, nullable=True)          # Ticket closed date from PM API (TicketClosedDate); set when status is closed
    
    # PM Tracker sync tracking - ensures counts match live PM data
    in_pm_tracker = Column(Boolean, default=True, nullable=False)  # False = ticket no longer exists in PM Tracker
    last_pm_sync = Column(DateTime, nullable=True)        # Last time this ticket was seen in PM API response


class QATicketFlag(Base):
    """App-only flags for QA tickets (e.g. Tested By Dev). Not synced from PM."""
    __tablename__ = "qa_ticket_flags"

    id = Column(Integer, primary_key=True)
    ticket_id = Column(Integer, unique=True, index=True, nullable=False)
    tested_by_dev = Column(Boolean, default=False, nullable=False)
    updated_on = Column(DateTime, onupdate=datetime.utcnow)


class TicketPriorityHistory(Base):
    """
    Tracks priority changes for tickets.
    When priority changes (from sync or API), a new record is created for ageing and reporting.
    """
    __tablename__ = "ticket_priority_history"

    id = Column(Integer, primary_key=True)
    ticket_id = Column(Integer, index=True, nullable=False)

    previous_priority = Column(String(100), nullable=True)  # NULL when first priority is set
    new_priority = Column(String(100), nullable=False)

    changed_on = Column(DateTime, index=True, default=datetime.utcnow)
    source = Column(String(50), default='sync')  # 'sync', 'manual', 'api'

    created_on = Column(DateTime, default=datetime.utcnow)


# ===== EMPLOYEE MANAGEMENT MODELS =====

class Employee(Base):
    """Employee master data"""
    __tablename__ = "employees"
    
    id = Column(Integer, primary_key=True)
    employee_id = Column(String(20), unique=True, index=True)  # TV0539
    name = Column(String(100), index=True)
    email = Column(String(150), unique=True)
    role = Column(String(100))  # SOFTWARE ENGINEER, ASSOCIATE SOFTWARE ENGINEER, etc.
    designation = Column(String(150), nullable=True)  # Job title/designation (e.g., "Software Engineer", "QA Lead")
    location = Column(String(50))  # Trivandrum
    mode_of_work = Column(String(50), default='Onsite')  # Onsite, Remote, Hybrid
    date_of_joining = Column(DateTime)
    team = Column(String(50), index=True)  # DEVELOPMENT, QA
    category = Column(String(50))  # BILLED, UN-BILLED
    employment_status = Column(String(50), default='Ongoing Employee', index=True)  # Ongoing Employee, Serving Notice Period, Resigned
    lead = Column(String(100), index=True)  # Reporting manager name
    manager = Column(String(100), index=True)  # Manager name (can be different from lead)
    previous_experience = Column(Float, nullable=True)  # Years of experience before joining Techversant
    bis_introduced_date = Column(DateTime, nullable=True)  # Date when employee was introduced to BIS (for billed employees)
    platform = Column(String(50), nullable=True)  # Web or Mobile
    photo_url = Column(String(500), nullable=True)  # URL/path to employee photo
    is_active = Column(Boolean, default=True)
    mapping_data = Column(JSONB, nullable=True)  # Additional mapping columns from Excel (Column 1-5, Notes, etc.)
    
    # Notice period and resignation tracking
    resignation_date = Column(DateTime, nullable=True)  # Date when resignation was submitted
    expected_lwd = Column(DateTime, nullable=True)  # Expected Last Working Day (auto-calculated or manual)
    
    # Archive/soft delete for resigned employees
    archived = Column(Boolean, default=False, index=True)  # True when employee is archived (resigned and removed from active list)
    archived_on = Column(DateTime, nullable=True)  # When the employee was archived
    
    created_on = Column(DateTime, default=datetime.utcnow)
    updated_on = Column(DateTime, onupdate=datetime.utcnow)


class EmployeeSkill(Base):
    """Employee skillsets with proficiency levels and years of experience"""
    __tablename__ = "employee_skills"
    
    id = Column(Integer, primary_key=True)
    employee_id = Column(String(20), index=True)  # FK to Employee.employee_id
    skill_name = Column(String(150), nullable=False, index=True)  # e.g., "React", "Python", "Selenium"
    proficiency_level = Column(Integer)  # 1-5 scale (1=Beginner, 2=Intermediate, 3=Advanced, 4=Expert, 5=Master)
    years_of_experience = Column(Float, nullable=True)  # Years using this skill
    created_on = Column(DateTime, default=datetime.utcnow)
    updated_on = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class User(Base):
    """User accounts for authentication. Links to Employee for non-admin users."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(150), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(50), index=True, nullable=False)  # ADMIN, MANAGER_DEV, MANAGER_QA, LEAD_DEV, LEAD_QA, EMPLOYEE, CLIENT
    employee_id = Column(String(20), index=True, nullable=True)  # FK to Employee.employee_id (null for admin)
    password_changed_at = Column(DateTime, nullable=True)  # Null = first login, must change
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, onupdate=datetime.utcnow)


class ClientProfile(Base):
    """Client accounts managed by admin only (separate from employees)."""
    __tablename__ = "client_profiles"

    id = Column(Integer, primary_key=True)
    name = Column(String(150), nullable=False, index=True)
    email = Column(String(150), unique=True, nullable=False, index=True)
    is_active = Column(Boolean, default=True, index=True)
    # JSON array of module ids the client can access, e.g. ["home","ticket_dashboard","tickets","all_bugs","calendar","timesheet"]. Null = default set.
    allowed_modules = Column(JSONB, nullable=True)
    created_on = Column(DateTime, default=datetime.utcnow)
    updated_on = Column(DateTime, onupdate=datetime.utcnow)


class AdminConfig(Base):
    """Configurable admin account. Single row."""
    __tablename__ = "admin_config"

    id = Column(Integer, primary_key=True)
    email = Column(String(150), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    updated_at = Column(DateTime, onupdate=datetime.utcnow)


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
        UniqueConstraint('employee_name', 'ticket_id', 'date', 'team', 'sheet_row_id', name='uq_enhanced_timesheet_entry_v2'),
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


class TimeSheetSubmission(Base):
    """Weekly timesheet submission record with approval status"""
    __tablename__ = "timesheet_submissions"

    id = Column(Integer, primary_key=True)
    employee_id = Column(String(20), index=True)
    employee_name = Column(String(100), index=True)
    week_start = Column(Date, index=True)
    week_end = Column(Date, index=True)
    status = Column(String(50), default='Pending', index=True)  # Draft, Pending, Lead Approved, Approved, Rejected, Revision Required
    submitted_on = Column(DateTime, default=datetime.utcnow)
    lead_id = Column(String(20), nullable=True)
    manager_id = Column(String(20), nullable=True)
    lead_approved_on = Column(DateTime, nullable=True)
    manager_approved_on = Column(DateTime, nullable=True)
    total_hours_logged = Column(Float, default=0.0)
    leave_hours = Column(Float, default=0.0)
    notes = Column(Text, nullable=True)
    created_on = Column(DateTime, default=datetime.utcnow)
    updated_on = Column(DateTime, onupdate=datetime.utcnow)


class TimeSheetEntry(Base):
    """Manual timesheet entry created by users"""
    __tablename__ = "timesheet_entries"

    id = Column(Integer, primary_key=True)
    submission_id = Column(Integer, index=True, nullable=True)
    employee_id = Column(String(20), index=True)
    employee_name = Column(String(100), index=True)
    date = Column(Date, index=True)
    activity_type = Column(String(100))
    task_category = Column(String(50), nullable=True)  # Ticket | Team Meetings | Customer Support | Training | KT | Leave | Miscellaneous
    hours = Column(Float)
    productive_hours = Column(Float, nullable=True)
    ticket_id = Column(String(100), nullable=True)
    description = Column(Text, nullable=True)
    project_name = Column(String(150), nullable=True)
    planned_task_id = Column(Integer, nullable=True)
    planned_task_source = Column(String(20), nullable=True)  # dev | qa | other
    variance_notes = Column(Text, nullable=True)  # required when hours differ from planned (explain why planned not achieved)
    variance_reason_type = Column(String(50), nullable=True)  # unplanned_task | estimate_ineffective | other
    created_on = Column(DateTime, default=datetime.utcnow)
    updated_on = Column(DateTime, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint('employee_name', 'date', 'ticket_id', name='uq_timesheet_manual_entry'),
    )


class TimeSheetEntryReview(Base):
    """Per-entry approval/revision decisions for a submission"""
    __tablename__ = "timesheet_entry_reviews"

    id = Column(Integer, primary_key=True)
    submission_id = Column(Integer, index=True, nullable=False)
    entry_source = Column(String(20), nullable=False)  # sync | manual
    entry_id = Column(Integer, nullable=False)
    status = Column(String(30), nullable=False)  # approved | revision_required | rejected
    productive_hours = Column(Float, nullable=True)
    notes = Column(Text, nullable=True)
    reviewed_by = Column(String(100))
    reviewed_role = Column(String(50))
    reviewed_on = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint('submission_id', 'entry_source', 'entry_id', 'reviewed_role', name='uq_timesheet_entry_review'),
    )


class TimeSheetApprovalLog(Base):
    """Audit log for approvals/rejections on timesheet submissions"""
    __tablename__ = "timesheet_approval_log"

    id = Column(Integer, primary_key=True)
    submission_id = Column(Integer, index=True, nullable=False)
    approver_id = Column(String(100))
    approver_role = Column(String(50))
    action = Column(String(50))  # approved, rejected, revision_requested, lead_approved
    notes = Column(Text, nullable=True)
    action_timestamp = Column(DateTime, default=datetime.utcnow)


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


class SyncLog(Base):
    """
    Audit trail for PM Tracker sync operations.
    Tracks which sync method was used, success/failure, and record counts.
    """
    __tablename__ = "sync_logs"
    
    id = Column(Integer, primary_key=True)
    
    # Sync source: 'excel' or 'api'
    sync_source = Column(String(20), nullable=False, index=True)
    
    # Success/failure
    success = Column(Boolean, nullable=False, index=True)
    
    # Status message or error details
    message = Column(Text, nullable=True)
    
    # Record counts
    total_records = Column(Integer, nullable=True)  # Total records processed from source
    records_added = Column(Integer, nullable=True)
    records_updated = Column(Integer, nullable=True)
    records_skipped = Column(Integer, nullable=True)
    errors = Column(Integer, nullable=True)
    
    # If fallback occurred
    fallback_from = Column(String(20), nullable=True)  # Original source before fallback (e.g., 'api')
    fallback_reason = Column(Text, nullable=True)  # Why fallback was triggered
    
    # Metadata
    duration_seconds = Column(Float, nullable=True)  # How long the sync took
    started_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    completed_at = Column(DateTime, nullable=True)
    
    # Raw response size for monitoring
    response_size_bytes = Column(Integer, nullable=True)
    
    __table_args__ = (
        # Allow quick lookup of recent syncs by source
        # "CREATE INDEX idx_synclogs_source_started ON sync_logs(sync_source, started_at DESC)"
    )


# ===== DEVELOPMENT TASK PLANNING MODULE =====

class DevPlanningWeek(Base):
    """
    One planning week (Monday–Friday) with lifecycle state.
    Managers/Leads plan Development work for the next work week.
    """
    __tablename__ = "dev_planning_weeks"

    id = Column(Integer, primary_key=True)
    week_start = Column(Date, unique=True, index=True)  # Monday of the week
    week_end = Column(Date)  # Friday of the week

    # Lifecycle: draft | submitted | approved | locked
    state = Column(String(20), default="draft", index=True)

    created_by = Column(String(100), index=True)
    created_on = Column(DateTime, default=datetime.utcnow)
    updated_on = Column(DateTime, onupdate=datetime.utcnow)
    submitted_at = Column(DateTime, nullable=True)
    submitted_by = Column(String(100), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    approved_by = Column(String(100), nullable=True)
    locked_at = Column(DateTime, nullable=True)
    locked_by = Column(String(100), nullable=True)
    unlocked_at = Column(DateTime, nullable=True)
    unlocked_by = Column(String(100), nullable=True)


class DevPlannedTask(Base):
    """
    One logical planned task (can span multiple days via spillover).
    Linked to planning week; daily hours stored in DevPlannedAllocation.
    """
    __tablename__ = "dev_planned_tasks"

    id = Column(Integer, primary_key=True)
    planning_week_id = Column(Integer, index=True, nullable=False)  # FK to DevPlanningWeek

    employee_id = Column(String(20), index=True)
    employee_name = Column(String(100), index=True)

    # Ticket (optional for generic tasks)
    ticket_id = Column(Integer, index=True, nullable=True)  # PM Tracker ticket
    ticket_title = Column(String(500), nullable=True)

    # Generic task category: Support, KT, Research, Meeting, Leave (when no ticket)
    generic_category = Column(String(50), nullable=True, index=True)
    justification = Column(Text, nullable=True)  # Required for generic tasks

    activity_description = Column(Text, nullable=False)

    start_date = Column(Date, index=True)
    end_date = Column(Date, nullable=True)
    allocation_pct = Column(Integer, nullable=True)  # 10, 20, ..., 100 (multiples of 10)
    total_planned_hours = Column(Float)  # Sum of allocation rows

    # Spillover: link to parent task when this row is auto-created spillover
    spillover_parent_id = Column(Integer, index=True, nullable=True)  # FK to DevPlannedTask.id

    status = Column(String(30), default="active", index=True)  # active | removed | converted_generic

    created_by = Column(String(100))
    updated_by = Column(String(100), nullable=True)
    created_on = Column(DateTime, default=datetime.utcnow)
    updated_on = Column(DateTime, onupdate=datetime.utcnow)


class DevPlannedAllocation(Base):
    """
    One day's allocation for a planned task. Enables 8h/day and 40h/week enforcement.
    """
    __tablename__ = "dev_planned_allocations"

    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, index=True, nullable=False)  # FK to DevPlannedTask
    allocation_date = Column(Date, index=True)
    hours = Column(Float)  # Typically 0–8

    created_on = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("task_id", "allocation_date", name="uq_dev_planned_allocation_task_date"),
    )


class DevPlanningAuditLog(Base):
    """
    Audit trail for planning week and task changes.
    """
    __tablename__ = "dev_planning_audit_logs"

    id = Column(Integer, primary_key=True)
    planning_week_id = Column(Integer, index=True, nullable=True)
    action = Column(String(50), index=True)  # create_week, submit, approve, lock, unlock, add_task, edit_task, delete_task
    entity_type = Column(String(30))  # week | task | allocation
    entity_id = Column(Integer, nullable=True)

    old_value = Column(JSONB, nullable=True)
    new_value = Column(JSONB, nullable=True)

    changed_by = Column(String(100))
    changed_on = Column(DateTime, default=datetime.utcnow)


# ===== QA TASK PLANNING MODULE =====

class QAPlanningWeek(Base):
    """One planning week for QA team. Mirrors DevPlanningWeek."""
    __tablename__ = "qa_planning_weeks"

    id = Column(Integer, primary_key=True)
    week_start = Column(Date, unique=True, index=True)
    week_end = Column(Date)
    state = Column(String(20), default="draft", index=True)
    created_by = Column(String(100), index=True)
    created_on = Column(DateTime, default=datetime.utcnow)
    updated_on = Column(DateTime, onupdate=datetime.utcnow)
    submitted_at = Column(DateTime, nullable=True)
    submitted_by = Column(String(100), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    approved_by = Column(String(100), nullable=True)
    locked_at = Column(DateTime, nullable=True)
    locked_by = Column(String(100), nullable=True)
    unlocked_at = Column(DateTime, nullable=True)
    unlocked_by = Column(String(100), nullable=True)


class QAPlannedTask(Base):
    """One QA planned task. Includes ticket_priority for color coding."""
    __tablename__ = "qa_planned_tasks"

    id = Column(Integer, primary_key=True)
    planning_week_id = Column(Integer, index=True, nullable=False)

    employee_id = Column(String(20), index=True)
    employee_name = Column(String(100), index=True)

    ticket_id = Column(Integer, index=True, nullable=True)
    ticket_title = Column(String(500), nullable=True)
    ticket_priority = Column(String(100), nullable=True)  # URGENT, High (Bugs), Medium, etc. - for color coding

    generic_category = Column(String(50), nullable=True, index=True)
    task_type = Column(String(50), nullable=True)  # Manual Testing, Automation Testing, API Testing, Non-Functional Testing
    activity_description = Column(Text, nullable=False)

    start_date = Column(Date, index=True)
    end_date = Column(Date, nullable=True)
    total_planned_hours = Column(Float)
    status = Column(String(30), default="active", index=True)
    # When set, from this date onward the task no longer blocks the resource (QA resource is free for other tasks)
    resource_released_at = Column(DateTime, nullable=True, index=True)

    # Hold functionality - allows putting task on hold (entire task or specific day)
    is_on_hold = Column(Boolean, default=False, index=True)  # True if task is currently on hold
    hold_reason = Column(Text, nullable=True)  # Reason for putting on hold
    hold_started_at = Column(DateTime, nullable=True)  # When hold started
    hold_ended_at = Column(DateTime, nullable=True)  # When hold was lifted (null if still on hold)
    hold_type = Column(String(20), nullable=True)  # 'full' for entire task, 'day' for specific day hold
    hold_date = Column(Date, nullable=True)  # If hold_type='day', which specific date is on hold

    created_by = Column(String(100))
    updated_by = Column(String(100), nullable=True)
    created_on = Column(DateTime, default=datetime.utcnow)
    updated_on = Column(DateTime, onupdate=datetime.utcnow)


class QAPlannedAllocation(Base):
    """One day's allocation for a QA planned task."""
    __tablename__ = "qa_planned_allocations"

    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, index=True, nullable=False)
    allocation_date = Column(Date, index=True)
    hours = Column(Float)
    is_on_hold = Column(Boolean, default=False)  # If True, this specific day's allocation is on hold

    created_on = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("task_id", "allocation_date", name="uq_qa_planned_allocation_task_date"),
    )


class QATaskHoldHistory(Base):
    """History of hold actions on QA planned tasks - for tracking and reporting."""
    __tablename__ = "qa_task_hold_history"

    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, index=True, nullable=False)  # References QAPlannedTask.id
    ticket_id = Column(Integer, index=True, nullable=True)  # PM Tracker ticket ID for quick lookup
    employee_id = Column(String(20), index=True)
    employee_name = Column(String(100))

    hold_type = Column(String(20), nullable=False)  # 'full' or 'day'
    hold_date = Column(Date, nullable=True)  # Specific date if hold_type='day'
    hold_reason = Column(Text, nullable=False)  # Required reason for putting on hold

    # PM Tracker verification - status at time of hold
    pm_tracker_status = Column(String(100), nullable=True)  # Status in PM Tracker when hold was made
    pm_tracker_verified = Column(Boolean, default=False)  # True if PM Tracker status was verified

    hold_started_at = Column(DateTime, nullable=False)
    hold_ended_at = Column(DateTime, nullable=True)  # Null if still on hold
    resumed_reason = Column(Text, nullable=True)  # Reason for resuming (optional)

    created_by = Column(String(100))
    created_on = Column(DateTime, default=datetime.utcnow)


# ===== AUTOMATION COVERAGE TRACKING (TestRail Project 18) =====

class AutomationTestRun(Base):
    """
    Test runs from TestRail Project 18 (Automation Coverage tracking).
    Ticket ID is extracted from run name (starts with ticket_id_).
    """
    __tablename__ = "automation_test_runs"

    id = Column(Integer, primary_key=True)
    run_id = Column(Integer, unique=True, index=True)  # TestRail run ID
    plan_id = Column(Integer, index=True, nullable=True)  # TestRail plan ID
    ticket_id = Column(Integer, index=True)  # PM Tracker ID (extracted from run name)
    name = Column(String(500))
    description = Column(Text, nullable=True)
    created_on = Column(DateTime)
    updated_on = Column(DateTime)
    status = Column(String(50), nullable=True)
    custom_fields = Column(JSONB, nullable=True)


class AutomationTestCase(Base):
    """
    Test cases from TestRail Project 18 with automation-specific fields.
    Tracks whether test cases are automated or manual, with effort metrics.
    """
    __tablename__ = "automation_test_cases"

    id = Column(Integer, primary_key=True)
    case_id = Column(Integer, index=True)  # TestRail case ID (not unique - same case can be in multiple runs)
    run_id = Column(Integer, index=True)  # TestRail run ID
    test_id = Column(Integer, unique=True, index=True)  # TestRail test ID (unique per run)
    ticket_id = Column(Integer, index=True)  # PM Tracker ID
    title = Column(String(500))
    section = Column(String(200), nullable=True)
    priority = Column(String(50), nullable=True)
    
    # Automation tracking fields (from custom fields)
    automation_status = Column(String(50), nullable=True, index=True)  # Automated, Planned, Not Automatable, etc.
    automation_candidate = Column(String(50), nullable=True, index=True)  # Yes, No, None - whether case should be automated
    execution_method = Column(String(50), nullable=True, index=True)  # Automated, Manual
    reusability_frequency = Column(String(50), nullable=True)  # High, Medium, Low
    automation_maintenance = Column(String(50), nullable=True)  # None, Low, Medium, High
    
    # Status change tracking dates
    planned_on = Column(DateTime, nullable=True, index=True)  # When automation_status changed to "Planned"
    automated_on = Column(DateTime, nullable=True, index=True)  # When automation_status changed to "Automated"
    
    # Automation effort tracking
    automation_estimated_hours = Column(Float, nullable=True)
    automation_actual_hours = Column(Float, nullable=True)
    automation_planned_start = Column(DateTime, nullable=True)
    automation_actual_start = Column(DateTime, nullable=True)
    automation_actual_end = Column(DateTime, nullable=True)
    
    # Test result status
    status_id = Column(Integer, nullable=True)  # TestRail status ID (1=Passed, 2=Blocked, etc.)
    status_name = Column(String(50), nullable=True, index=True)  # Passed, Failed, Blocked, Retest, Untested
    
    # Additional fields
    business_criticality = Column(String(50), nullable=True)  # High, Medium, Low
    functionality = Column(String(200), nullable=True)
    sub_functionality = Column(String(200), nullable=True)
    life_cycle_status = Column(String(50), nullable=True)  # Active, Deprecated, etc.
    
    # Ticket references from test case
    test_case_created_ticket_ref = Column(String(100), nullable=True)
    test_case_modified_ticket_ref = Column(String(100), nullable=True)
    
    # All custom fields as JSON for flexibility
    custom_fields = Column(JSONB, nullable=True)
    
    created_on = Column(DateTime, default=datetime.utcnow)
    updated_on = Column(DateTime, onupdate=datetime.utcnow)


class PerformanceSnapshot(Base):
    """Frozen Employee Performance leaderboard for an ended period (immutable history).

    Once a month/quarter is over, its leaderboard is computed once and stored here; subsequent
    requests return this payload unchanged so historical results never shift as data drifts.
    """
    __tablename__ = "performance_snapshots"

    id = Column(Integer, primary_key=True)
    period_key = Column(String(80), unique=True, index=True)  # e.g. "month:May 2026:all"
    period_kind = Column(String(20))                          # month | quarter
    period_label = Column(String(40))                         # "May 2026", "Q2 2026"
    team = Column(String(10))                                 # qa | dev | all
    payload = Column(JSONB)                                   # full leaderboard response
    frozen = Column(Boolean, default=True)
    created_on = Column(DateTime, default=datetime.utcnow)
