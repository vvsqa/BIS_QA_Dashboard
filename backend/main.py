from fastapi import FastAPI, Query, HTTPException, UploadFile, File, Body, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from datetime import datetime, timedelta, date
from typing import Optional, List, Dict, Any
from collections import defaultdict
from pydantic import BaseModel
import tempfile
import os
import shutil

from database import SessionLocal
from models import (
    Bug, TestPlan, TestRun, TestCase, TestResult, TicketTracking,
    Employee, Timesheet, EmployeeGoal, EmployeeReview, KPI, KPIRating,
    TicketStatusHistory, BugStatusHistory,
    EnhancedTimesheet, LeaveEntry, PlannedTask, WeeklyPlan,
    EmployeeNameMapping, Holiday
)
from google_sheets_sync import GoogleSheetsSync, get_sheets_sync_status
from sheets_scheduler import get_scheduler, start_auto_sync, stop_auto_sync


# ===== PYDANTIC MODELS =====

class EmployeeCreate(BaseModel):
    employee_id: str
    name: str
    email: str
    role: Optional[str] = None
    location: Optional[str] = None
    date_of_joining: Optional[datetime] = None
    team: str
    category: Optional[str] = None
    employment_status: Optional[str] = "Ongoing Employee"
    lead: Optional[str] = None

class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    location: Optional[str] = None
    date_of_joining: Optional[datetime] = None
    team: Optional[str] = None
    category: Optional[str] = None
    employment_status: Optional[str] = None
    lead: Optional[str] = None
    manager: Optional[str] = None
    previous_experience: Optional[float] = None
    bis_introduced_date: Optional[datetime] = None
    platform: Optional[str] = None
    photo_url: Optional[str] = None
    is_active: Optional[bool] = None
    mapping_data: Optional[dict] = None

class GoalCreate(BaseModel):
    goal_type: str  # 'goal', 'strength', 'improvement'
    title: str
    description: Optional[str] = None
    target_date: Optional[date] = None
    created_by: str

class GoalUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    target_date: Optional[date] = None
    status: Optional[str] = None
    progress: Optional[int] = None

class ReviewCreate(BaseModel):
    review_period: str
    review_date: date
    technical_rating: int
    productivity_rating: int
    quality_rating: int
    communication_rating: int
    strengths_summary: Optional[str] = None
    improvements_summary: Optional[str] = None
    manager_comments: Optional[str] = None
    recommendation: str
    salary_hike_percent: Optional[float] = None
    reviewed_by: str

class KPICreate(BaseModel):
    kpi_code: str
    kpi_name: str
    description: Optional[str] = None
    role: str
    team: Optional[str] = None
    category: Optional[str] = None
    weight: Optional[float] = 1.0

class KPIRatingCreate(BaseModel):
    kpi_id: int
    quarter: str  # "2025-Q1"
    rating: Optional[float] = None  # Deprecated, use manager_rating
    self_rating: Optional[float] = None
    lead_rating: Optional[float] = None
    manager_rating: Optional[float] = None
    self_comments: Optional[str] = None
    lead_comments: Optional[str] = None
    manager_comments: Optional[str] = None
    rated_by: str  # "self", "lead", or "manager"
    salary_hike_percent: Optional[float] = None
    reviewed_by: str

app = FastAPI()

# Static uploads (employee photos)
UPLOADS_ROOT = os.path.join(os.path.dirname(__file__), "uploads")
PROFILE_PHOTO_DIR = os.path.join(UPLOADS_ROOT, "profile_photos")
os.makedirs(PROFILE_PHOTO_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOADS_ROOT), name="uploads")

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

# Startup and shutdown events for auto-sync scheduler
@app.on_event("startup")
async def startup_event():
    """Start the Google Sheets auto-sync scheduler on application startup."""
    try:
        if start_auto_sync():
            print("[OK] Google Sheets auto-sync started")
        else:
            print("[INFO] Google Sheets auto-sync is disabled (set SHEETS_AUTO_SYNC=true to enable)")
    except Exception as e:
        print(f"[WARNING] Failed to start auto-sync: {e}")

@app.on_event("shutdown")
async def shutdown_event():
    """Stop the scheduler on application shutdown."""
    try:
        stop_auto_sync()
        print("[OK] Google Sheets auto-sync stopped")
    except Exception as e:
        print(f"[WARNING] Error stopping auto-sync: {e}")


# ===== TEAM CLASSIFICATION HELPER =====

def get_team_classification(db: Session) -> dict:
    """
    Build a mapping of employee names to their team (DEV/QA).
    Names not in the employee database are classified as 'BIS Team' (client).
    """
    employees = db.query(Employee.name, Employee.team).filter(Employee.is_active == True).all()
    team_map = {}
    for emp in employees:
        if emp.name:
            # Store with normalized name (lowercase for comparison)
            team_map[emp.name.strip().lower()] = emp.team or "UNKNOWN"
    return team_map


def classify_person(name: str, team_map: dict) -> str:
    """
    Classify a person's team based on the team_map.
    Returns 'DEV', 'QA', or 'BIS Team' (for client/external people).
    """
    if not name:
        return "Unknown"
    
    normalized_name = name.strip().lower()
    
    if normalized_name in team_map:
        team = team_map[normalized_name]
        if team == "DEVELOPMENT":
            return "DEV"
        elif team == "QA":
            return "QA"
        return team
    
    # Not in employee database = BIS Team (client)
    return "BIS Team"


@app.get("/")
def root():
    return {"status": "FastAPI is running"}

@app.get("/bugs")
def get_bugs(
    ticket_id: Optional[int] = Query(None),
    environment: str = Query("All"),
    platform: str = Query("All"),
    only_open: bool = Query(False)
):
    db: Session = SessionLocal()

    query = db.query(Bug)
    
    # Only filter by ticket_id if provided and not 0 (0 is used as placeholder for "all")
    if ticket_id is not None and ticket_id != 0:
        query = query.filter(Bug.ticket_id == ticket_id)

    if environment != "All":
        query = query.filter(Bug.environment == environment)

    if platform != "All":
        query = query.filter(Bug.platform == platform)

    if only_open:
        query = query.filter(
            Bug.status.in_(["New", "Reopened", "Fixed", "Assigned to Dev"])
        )

    bugs = query.all()
    db.close()
    return bugs

@app.get("/bugs/summary")
def bug_summary(
    ticket_id: int = Query(...),
    environment: str = Query("All"),
    platform: str = Query("All")
):
    db: Session = SessionLocal()

    query = db.query(Bug).filter(Bug.ticket_id == ticket_id)

    if environment != "All":
        query = query.filter(Bug.environment == environment)

    if platform != "All":
        query = query.filter(Bug.platform == platform)

    bugs = query.all()

    total = len(bugs)
    open_bugs = len([b for b in bugs if b.status in ["New", "Reopened", "Fixed", "Assigned to Dev"]])
    pending = len([b for b in bugs if b.status == "Released to QA"])
    closed = len([b for b in bugs if b.status == "Closed"])
    deferred = len([b for b in bugs if b.status == "Deferred"])
    rejected = len([b for b in bugs if b.status == "Rejected"])

    db.close()

    return {
        "ticket_id": ticket_id,
        "environment": environment,
        "total_bugs": total,
        "open_bugs": open_bugs,
        "pending_retest": pending,
        "closed_bugs": closed,
        "deferred_bugs": deferred,
        "rejected_bugs": rejected
    }


@app.get("/bugs/ticket-info")
def get_ticket_info(ticket_id: int = Query(...)):
    """Get ticket title and platform info"""
    db: Session = SessionLocal()
    bug = db.query(Bug).filter(Bug.ticket_id == ticket_id).first()
    db.close()
    
    if bug:
        return {
            "ticket_id": ticket_id,
            "ticket_title": bug.subject.split(" - ")[0] if bug.subject else f"Ticket #{ticket_id}",
            "platform": bug.platform or "Web"
        }
    return {
        "ticket_id": ticket_id,
        "ticket_title": f"Ticket #{ticket_id}",
        "platform": "Web"
    }


@app.get("/bugs/severity-breakdown")
def severity_breakdown(
    ticket_id: Optional[int] = Query(None),
    environment: str = Query("All"),
    platform: str = Query("All")
):
    """Get bug counts by status and severity for the bar chart"""
    db: Session = SessionLocal()

    query = db.query(Bug)
    
    if ticket_id is not None:
        query = query.filter(Bug.ticket_id == ticket_id)

    if environment != "All":
        query = query.filter(Bug.environment == environment)

    if platform != "All":
        query = query.filter(Bug.platform == platform)

    bugs = query.all()
    db.close()

    # Define statuses and severities
    statuses = ["New", "Assigned to Dev", "Fixed", "Released to QA", "Reopened", "Closed"]
    severities = ["Critical", "Major", "Minor", "Low Bug"]

    # Build matrix: for each status, count bugs by severity
    result = {}
    for status in statuses:
        result[status] = {}
        for severity in severities:
            count = len([b for b in bugs if b.status == status and b.severity == severity])
            result[status][severity] = count

    return {
        "statuses": statuses,
        "severities": severities,
        "data": result
    }


@app.get("/bugs/priority-breakdown")
def priority_breakdown(
    ticket_id: Optional[int] = Query(None),
    environment: str = Query("All"),
    platform: str = Query("All")
):
    """Get bug counts by priority for the pie chart"""
    db: Session = SessionLocal()

    query = db.query(Bug)
    
    if ticket_id is not None:
        query = query.filter(Bug.ticket_id == ticket_id)

    if environment != "All":
        query = query.filter(Bug.environment == environment)

    if platform != "All":
        query = query.filter(Bug.platform == platform)

    bugs = query.all()
    db.close()

    priorities = ["High", "Medium", "Low", "Low Bug"]
    result = {}
    for priority in priorities:
        result[priority] = len([b for b in bugs if b.priority == priority])

    return result


@app.get("/bugs/metrics")
def bug_metrics(
    ticket_id: Optional[int] = Query(None),
    environment: str = Query("All"),
    platform: str = Query("All")
):
    """Get closure rate and critical bugs percentage"""
    db: Session = SessionLocal()

    query = db.query(Bug)
    
    if ticket_id is not None:
        query = query.filter(Bug.ticket_id == ticket_id)

    if environment != "All":
        query = query.filter(Bug.environment == environment)

    bugs = query.all()
    db.close()

    total = len(bugs)
    closed = len([b for b in bugs if b.status == "Closed"])
    critical = len([b for b in bugs if b.severity == "Critical"])

    closure_rate = round((closed / total * 100), 1) if total > 0 else 0
    critical_percentage = round((critical / total * 100), 1) if total > 0 else 0

    return {
        "closure_rate": closure_rate,
        "critical_percentage": critical_percentage,
        "total_bugs": total,
        "closed_bugs": closed,
        "critical_bugs": critical
    }


@app.get("/bugs/all-summary")
def all_bugs_summary(environment: str = Query("All")):
    """Get summary for all bugs across all tickets"""
    db: Session = SessionLocal()

    query = db.query(Bug)

    if environment != "All":
        query = query.filter(Bug.environment == environment)

    bugs = query.all()
    db.close()

    total = len(bugs)
    open_bugs = len([b for b in bugs if b.status in ["New", "Reopened", "Fixed", "Assigned to Dev"]])
    pending = len([b for b in bugs if b.status == "Released to QA"])
    closed = len([b for b in bugs if b.status == "Closed"])
    deferred = len([b for b in bugs if b.status == "Deferred"])
    rejected = len([b for b in bugs if b.status == "Rejected"])

    return {
        "environment": environment,
        "total_bugs": total,
        "open_bugs": open_bugs,
        "pending_retest": pending,
        "closed_bugs": closed,
        "deferred_bugs": deferred,
        "rejected_bugs": rejected
    }


@app.get("/bugs/assignee-breakdown")
def assignee_breakdown(
    ticket_id: Optional[int] = Query(None),
    environment: str = Query("All"),
    platform: str = Query("All")
):
    """Get bug distribution by assignee with team classification"""
    db: Session = SessionLocal()

    try:
        # Get team classification map
        team_map = get_team_classification(db)
        
        query = db.query(Bug)

        if ticket_id is not None:
            query = query.filter(Bug.ticket_id == ticket_id)

        if environment != "All":
            query = query.filter(Bug.environment == environment)

        if platform != "All":
            query = query.filter(Bug.platform == platform)

        bugs = query.all()

        assignee_data = defaultdict(lambda: {"open": 0, "closed": 0, "total": 0, "team": "Unknown"})
        
        for bug in bugs:
            assignee = bug.assignee or "Unassigned"
            assignee_data[assignee]["total"] += 1
            assignee_data[assignee]["team"] = classify_person(assignee, team_map)
            if bug.status == "Closed":
                assignee_data[assignee]["closed"] += 1
            else:
                assignee_data[assignee]["open"] += 1

        result = {assignee: data for assignee, data in assignee_data.items()}
        return result
    finally:
        db.close()


@app.get("/bugs/author-breakdown")
def author_breakdown(
    ticket_id: Optional[int] = Query(None),
    environment: str = Query("All"),
    platform: str = Query("All")
):
    """Get bug distribution by author (who reported bugs) with team classification"""
    db: Session = SessionLocal()

    try:
        # Get team classification map
        team_map = get_team_classification(db)
        
        query = db.query(Bug)

        if ticket_id is not None:
            query = query.filter(Bug.ticket_id == ticket_id)

        if environment != "All":
            query = query.filter(Bug.environment == environment)

        if platform != "All":
            query = query.filter(Bug.platform == platform)

        bugs = query.all()

        author_data = defaultdict(lambda: {"total": 0, "by_severity": defaultdict(int), "team": "Unknown"})
        
        for bug in bugs:
            author = bug.author or "Unknown"
            author_data[author]["total"] += 1
            author_data[author]["team"] = classify_person(author, team_map)
            if bug.severity:
                author_data[author]["by_severity"][bug.severity] += 1

        result = {}
        for author, data in author_data.items():
            result[author] = {
                "total": data["total"],
                "by_severity": dict(data["by_severity"]),
                "team": data["team"]
            }
        
        return result
    finally:
        db.close()


@app.get("/bugs/team-summary")
def bug_team_summary(
    ticket_id: Optional[int] = Query(None),
    environment: str = Query("All")
):
    """Get bug summary grouped by team (DEV, QA, BIS Team)"""
    db: Session = SessionLocal()

    try:
        # Get team classification map
        team_map = get_team_classification(db)
        
        query = db.query(Bug)

        if ticket_id is not None and ticket_id != 0:
            query = query.filter(Bug.ticket_id == ticket_id)

        if environment != "All":
            query = query.filter(Bug.environment == environment)

        bugs = query.all()

        team_data = {
            "DEV": {"assignees": {}, "total_bugs": 0, "open": 0, "closed": 0},
            "QA": {"assignees": {}, "total_bugs": 0, "open": 0, "closed": 0},
            "BIS Team": {"assignees": {}, "total_bugs": 0, "open": 0, "closed": 0}
        }
        
        for bug in bugs:
            assignee = bug.assignee or "Unassigned"
            team = classify_person(assignee, team_map)
            
            if team not in team_data:
                team = "BIS Team"  # Default fallback
            
            team_data[team]["total_bugs"] += 1
            if bug.status == "Closed":
                team_data[team]["closed"] += 1
            else:
                team_data[team]["open"] += 1
            
            if assignee not in team_data[team]["assignees"]:
                team_data[team]["assignees"][assignee] = {"total": 0, "open": 0, "closed": 0}
            
            team_data[team]["assignees"][assignee]["total"] += 1
            if bug.status == "Closed":
                team_data[team]["assignees"][assignee]["closed"] += 1
            else:
                team_data[team]["assignees"][assignee]["open"] += 1

        return team_data
    finally:
        db.close()


@app.get("/bugs/module-breakdown")
def module_breakdown(
    ticket_id: Optional[int] = Query(None),
    environment: str = Query("All")
):
    """Get bug distribution by module"""
    db: Session = SessionLocal()

    query = db.query(Bug)

    if ticket_id is not None:
        query = query.filter(Bug.ticket_id == ticket_id)

    if environment != "All":
        query = query.filter(Bug.environment == environment)

    bugs = query.all()
    db.close()

    module_data = defaultdict(int)
    
    for bug in bugs:
        module = bug.module or "Unknown"
        module_data[module] += 1

    return dict(module_data)


@app.get("/bugs/feature-breakdown")
def feature_breakdown(
    ticket_id: Optional[int] = Query(None),
    environment: str = Query("All")
):
    """Get bug distribution by feature"""
    db: Session = SessionLocal()

    query = db.query(Bug)

    if ticket_id is not None:
        query = query.filter(Bug.ticket_id == ticket_id)

    if environment != "All":
        query = query.filter(Bug.environment == environment)

    bugs = query.all()
    db.close()

    feature_data = defaultdict(lambda: {"open": 0, "closed": 0, "total": 0})
    
    for bug in bugs:
        feature = bug.feature or "Unknown"
        feature_data[feature]["total"] += 1
        if bug.status == "Closed":
            feature_data[feature]["closed"] += 1
        else:
            feature_data[feature]["open"] += 1

    result = {feature: data for feature, data in feature_data.items()}
    return result


@app.get("/bugs/browser-os-breakdown")
def browser_os_breakdown(
    ticket_id: Optional[int] = Query(None),
    environment: str = Query("All")
):
    """Get bug distribution by browser and OS combinations"""
    db: Session = SessionLocal()

    query = db.query(Bug)

    if ticket_id is not None:
        query = query.filter(Bug.ticket_id == ticket_id)

    if environment != "All":
        query = query.filter(Bug.environment == environment)

    bugs = query.all()
    db.close()

    browser_os_data = defaultdict(int)
    
    for bug in bugs:
        browser = bug.browser or "Unknown"
        os = bug.os or "Unknown"
        key = f"{browser} / {os}"
        browser_os_data[key] += 1

    return dict(browser_os_data)


@app.get("/bugs/platform-breakdown")
def platform_breakdown(
    ticket_id: Optional[int] = Query(None),
    environment: str = Query("All")
):
    """Get bug distribution by platform"""
    db: Session = SessionLocal()

    query = db.query(Bug)

    if ticket_id is not None:
        query = query.filter(Bug.ticket_id == ticket_id)

    if environment != "All":
        query = query.filter(Bug.environment == environment)

    bugs = query.all()
    db.close()

    platform_data = defaultdict(lambda: {"open": 0, "closed": 0, "total": 0, "by_status": defaultdict(int)})
    
    for bug in bugs:
        platform = bug.platform or "Unknown"
        platform_data[platform]["total"] += 1
        platform_data[platform]["by_status"][bug.status or "Unknown"] += 1
        if bug.status == "Closed":
            platform_data[platform]["closed"] += 1
        else:
            platform_data[platform]["open"] += 1

    result = {}
    for platform, data in platform_data.items():
        result[platform] = {
            "total": data["total"],
            "open": data["open"],
            "closed": data["closed"],
            "by_status": dict(data["by_status"])
        }
    
    return result


@app.get("/bugs/age-analysis")
def age_analysis(
    ticket_id: Optional[int] = Query(None),
    environment: str = Query("All")
):
    """Get bug age metrics"""
    db: Session = SessionLocal()

    query = db.query(Bug)

    if ticket_id is not None:
        query = query.filter(Bug.ticket_id == ticket_id)

    if environment != "All":
        query = query.filter(Bug.environment == environment)

    bugs = query.all()
    db.close()

    now = datetime.now()
    open_bugs = [b for b in bugs if b.status not in ["Closed", "Deferred"]]
    
    ages = []
    age_buckets = {"0-7": 0, "7-30": 0, "30-60": 0, "60+": 0}
    oldest_age = 0
    
    for bug in open_bugs:
        if bug.created_on:
            age_days = (now - bug.created_on.replace(tzinfo=None) if bug.created_on.tzinfo else bug.created_on).days
            ages.append(age_days)
            oldest_age = max(oldest_age, age_days)
            
            if age_days <= 7:
                age_buckets["0-7"] += 1
            elif age_days <= 30:
                age_buckets["7-30"] += 1
            elif age_days <= 60:
                age_buckets["30-60"] += 1
            else:
                age_buckets["60+"] += 1

    avg_age = sum(ages) / len(ages) if ages else 0

    return {
        "average_age_days": round(avg_age, 1),
        "oldest_age_days": oldest_age,
        "total_open_bugs": len(open_bugs),
        "age_buckets": age_buckets
    }


@app.get("/bugs/resolution-time")
def resolution_time(
    ticket_id: Optional[int] = Query(None),
    environment: str = Query("All")
):
    """Get resolution time metrics"""
    db: Session = SessionLocal()

    query = db.query(Bug)

    if ticket_id is not None:
        query = query.filter(Bug.ticket_id == ticket_id)

    if environment != "All":
        query = query.filter(Bug.environment == environment)

    bugs = query.all()
    db.close()

    closed_bugs = [b for b in bugs if b.status == "Closed" and b.created_on and b.closed_on]
    
    resolution_times = []
    time_buckets = {"<1": 0, "1-3": 0, "3-7": 0, "7-30": 0, "30+": 0}
    
    for bug in closed_bugs:
        created = bug.created_on.replace(tzinfo=None) if bug.created_on.tzinfo else bug.created_on
        closed = bug.closed_on.replace(tzinfo=None) if bug.closed_on.tzinfo else bug.closed_on
        days = (closed - created).days
        resolution_times.append(days)
        
        if days < 1:
            time_buckets["<1"] += 1
        elif days <= 3:
            time_buckets["1-3"] += 1
        elif days <= 7:
            time_buckets["3-7"] += 1
        elif days <= 30:
            time_buckets["7-30"] += 1
        else:
            time_buckets["30+"] += 1

    if resolution_times:
        sorted_times = sorted(resolution_times)
        avg_time = sum(resolution_times) / len(resolution_times)
        median_time = sorted_times[len(sorted_times) // 2]
        fastest = min(resolution_times)
        slowest = max(resolution_times)
    else:
        avg_time = median_time = fastest = slowest = 0

    return {
        "average_days": round(avg_time, 1),
        "median_days": median_time,
        "fastest_days": fastest,
        "slowest_days": slowest,
        "total_resolved": len(closed_bugs),
        "time_buckets": time_buckets
    }


@app.get("/bugs/reopened-analysis")
def reopened_analysis(
    ticket_id: Optional[int] = Query(None),
    environment: str = Query("All")
):
    """Get reopened bugs analysis"""
    db: Session = SessionLocal()

    query = db.query(Bug)

    if ticket_id is not None:
        query = query.filter(Bug.ticket_id == ticket_id)

    if environment != "All":
        query = query.filter(Bug.environment == environment)

    bugs = query.all()
    db.close()

    reopened_bugs = [b for b in bugs if b.status == "Reopened"]
    total_bugs = len(bugs)
    
    reopened_by_severity = defaultdict(int)
    reopened_by_priority = defaultdict(int)
    
    for bug in reopened_bugs:
        if bug.severity:
            reopened_by_severity[bug.severity] += 1
        if bug.priority:
            reopened_by_priority[bug.priority] += 1

    reopened_percentage = round((len(reopened_bugs) / total_bugs * 100), 1) if total_bugs > 0 else 0

    return {
        "total_reopened": len(reopened_bugs),
        "reopened_percentage": reopened_percentage,
        "total_bugs": total_bugs,
        "by_severity": dict(reopened_by_severity),
        "by_priority": dict(reopened_by_priority)
    }


@app.get("/bugs/deferred-bugs")
def deferred_bugs(
    ticket_id: Optional[int] = Query(None),
    environment: str = Query("All")
):
    """Get deferred bugs with ageing information"""
    db: Session = SessionLocal()

    query = db.query(Bug)

    if ticket_id is not None:
        query = query.filter(Bug.ticket_id == ticket_id)

    if environment != "All":
        query = query.filter(Bug.environment == environment)

    query = query.filter(Bug.status == "Deferred")
    bugs = query.all()
    db.close()

    now = datetime.now()
    deferred_list = []
    
    for bug in bugs:
        age_days = 0
        if bug.created_on:
            created = bug.created_on.replace(tzinfo=None) if bug.created_on.tzinfo else bug.created_on
            age_days = (now - created).days
        
        deferred_list.append({
            "bug_id": bug.bug_id,
            "subject": bug.subject,
            "severity": bug.severity,
            "priority": bug.priority,
            "assignee": bug.assignee,
            "age_days": age_days,
            "created_on": bug.created_on.isoformat() if bug.created_on else None
        })
    
    # Sort by age (oldest first)
    deferred_list.sort(key=lambda x: x["age_days"], reverse=True)
    
    return deferred_list


@app.get("/bugs/time-tracking")
def bug_time_tracking(
    ticket_id: Optional[int] = Query(None),
    environment: str = Query("All")
):
    """Get estimate vs actual time comparison with variance analysis"""
    db: Session = SessionLocal()
    
    try:
        query = db.query(Bug)
        
        if ticket_id is not None and ticket_id != 0:
            query = query.filter(Bug.ticket_id == ticket_id)
        
        if environment != "All":
            query = query.filter(Bug.environment == environment)
        
        bugs = query.all()
        
        total_estimated = 0
        total_spent = 0
        estimated_count = 0
        not_estimated_count = 0
        bugs_with_variance = []
        
        for bug in bugs:
            estimated = bug.estimated_hours or 0
            spent = bug.spent_hours or 0
            
            if estimated > 0:
                estimated_count += 1
                total_estimated += estimated
                total_spent += spent
                
                variance_percent = ((spent - estimated) / estimated) * 100 if estimated > 0 else 0
                bugs_with_variance.append({
                    "bug_id": bug.bug_id,
                    "subject": bug.subject[:50] + "..." if len(bug.subject or "") > 50 else bug.subject,
                    "estimated_hours": estimated,
                    "spent_hours": spent,
                    "variance_percent": round(variance_percent, 1),
                    "variance_status": "green" if abs(variance_percent) < 10 else ("amber" if abs(variance_percent) < 30 else "red")
                })
            else:
                not_estimated_count += 1
        
        overall_variance = ((total_spent - total_estimated) / total_estimated * 100) if total_estimated > 0 else 0
        
        # Group by variance status
        variance_distribution = {
            "under_estimate": len([b for b in bugs_with_variance if b["variance_percent"] < -10]),
            "on_track": len([b for b in bugs_with_variance if -10 <= b["variance_percent"] <= 10]),
            "over_estimate": len([b for b in bugs_with_variance if b["variance_percent"] > 10])
        }
        
        return {
            "total_bugs": len(bugs),
            "estimated_count": estimated_count,
            "not_estimated_count": not_estimated_count,
            "not_estimated_percent": round((not_estimated_count / len(bugs) * 100) if bugs else 0, 1),
            "total_estimated_hours": round(total_estimated, 1),
            "total_spent_hours": round(total_spent, 1),
            "overall_variance_percent": round(overall_variance, 1),
            "variance_distribution": variance_distribution,
            "top_variances": sorted(bugs_with_variance, key=lambda x: abs(x["variance_percent"]), reverse=True)[:10]
        }
    finally:
        db.close()


@app.get("/bugs/sla-analysis")
def bug_sla_analysis(
    ticket_id: Optional[int] = Query(None),
    environment: str = Query("All")
):
    """Get due date/SLA tracking - overdue, on-time, no due date"""
    db: Session = SessionLocal()
    
    try:
        query = db.query(Bug)
        
        if ticket_id is not None and ticket_id != 0:
            query = query.filter(Bug.ticket_id == ticket_id)
        
        if environment != "All":
            query = query.filter(Bug.environment == environment)
        
        bugs = query.all()
        now = datetime.now()
        
        overdue = []
        on_time = []
        no_due_date = []
        completed_on_time = 0
        completed_late = 0
        
        for bug in bugs:
            if bug.due_date is None:
                no_due_date.append(bug.bug_id)
            else:
                due = bug.due_date.replace(tzinfo=None) if bug.due_date.tzinfo else bug.due_date
                
                if bug.status == "Closed" and bug.closed_on:
                    closed = bug.closed_on.replace(tzinfo=None) if bug.closed_on.tzinfo else bug.closed_on
                    if closed <= due:
                        completed_on_time += 1
                        on_time.append(bug.bug_id)
                    else:
                        completed_late += 1
                        overdue.append({
                            "bug_id": bug.bug_id,
                            "subject": bug.subject[:50] + "..." if len(bug.subject or "") > 50 else bug.subject,
                            "due_date": due.isoformat(),
                            "days_overdue": (closed - due).days,
                            "status": bug.status,
                            "severity": bug.severity
                        })
                elif bug.status != "Closed":
                    if now > due:
                        days_overdue = (now - due).days
                        overdue.append({
                            "bug_id": bug.bug_id,
                            "subject": bug.subject[:50] + "..." if len(bug.subject or "") > 50 else bug.subject,
                            "due_date": due.isoformat(),
                            "days_overdue": days_overdue,
                            "status": bug.status,
                            "severity": bug.severity
                        })
                    else:
                        on_time.append(bug.bug_id)
        
        # Sort overdue by days overdue (most overdue first)
        overdue_list = sorted(overdue, key=lambda x: x["days_overdue"], reverse=True)
        
        return {
            "total_bugs": len(bugs),
            "overdue_count": len(overdue),
            "on_time_count": len(on_time),
            "no_due_date_count": len(no_due_date),
            "completed_on_time": completed_on_time,
            "completed_late": completed_late,
            "sla_compliance_rate": round((len(on_time) / (len(on_time) + len(overdue)) * 100) if (len(on_time) + len(overdue)) > 0 else 0, 1),
            "overdue_bugs": overdue_list[:20],  # Top 20 overdue
            "distribution": {
                "overdue": len(overdue),
                "on_time": len(on_time),
                "no_due_date": len(no_due_date)
            }
        }
    finally:
        db.close()


@app.get("/bugs/lifecycle-analysis")
def bug_lifecycle_analysis(
    ticket_id: Optional[int] = Query(None),
    environment: str = Query("All")
):
    """Get bug lifecycle metrics - start to close timeline"""
    db: Session = SessionLocal()
    
    try:
        query = db.query(Bug)
        
        if ticket_id is not None and ticket_id != 0:
            query = query.filter(Bug.ticket_id == ticket_id)
        
        if environment != "All":
            query = query.filter(Bug.environment == environment)
        
        bugs = query.all()
        
        lifecycle_days = []
        creation_to_close = []
        
        for bug in bugs:
            # Calculate lifecycle from start_date to closed_on
            if bug.start_date and bug.closed_on:
                start = bug.start_date.replace(tzinfo=None) if bug.start_date.tzinfo else bug.start_date
                closed = bug.closed_on.replace(tzinfo=None) if bug.closed_on.tzinfo else bug.closed_on
                days = (closed - start).days
                if days >= 0:
                    lifecycle_days.append(days)
            
            # Also calculate from created_on to closed_on
            if bug.created_on and bug.closed_on:
                created = bug.created_on.replace(tzinfo=None) if bug.created_on.tzinfo else bug.created_on
                closed = bug.closed_on.replace(tzinfo=None) if bug.closed_on.tzinfo else bug.closed_on
                days = (closed - created).days
                if days >= 0:
                    creation_to_close.append(days)
        
        # Calculate distribution buckets
        def get_distribution(days_list):
            return {
                "0-1": len([d for d in days_list if d <= 1]),
                "2-3": len([d for d in days_list if 2 <= d <= 3]),
                "4-7": len([d for d in days_list if 4 <= d <= 7]),
                "8-14": len([d for d in days_list if 8 <= d <= 14]),
                "15-30": len([d for d in days_list if 15 <= d <= 30]),
                "30+": len([d for d in days_list if d > 30])
            }
        
        avg_lifecycle = sum(lifecycle_days) / len(lifecycle_days) if lifecycle_days else 0
        avg_creation_to_close = sum(creation_to_close) / len(creation_to_close) if creation_to_close else 0
        
        return {
            "total_closed_bugs": len(creation_to_close),
            "avg_lifecycle_days": round(avg_lifecycle, 1),
            "avg_creation_to_close_days": round(avg_creation_to_close, 1),
            "min_lifecycle_days": min(lifecycle_days) if lifecycle_days else 0,
            "max_lifecycle_days": max(lifecycle_days) if lifecycle_days else 0,
            "median_lifecycle_days": sorted(lifecycle_days)[len(lifecycle_days)//2] if lifecycle_days else 0,
            "lifecycle_distribution": get_distribution(lifecycle_days),
            "creation_close_distribution": get_distribution(creation_to_close)
        }
    finally:
        db.close()


@app.get("/bugs/completion-progress")
def bug_completion_progress(
    ticket_id: Optional[int] = Query(None),
    environment: str = Query("All")
):
    """Get done_ratio/completion progress distribution"""
    db: Session = SessionLocal()
    
    try:
        query = db.query(Bug)
        
        if ticket_id is not None and ticket_id != 0:
            query = query.filter(Bug.ticket_id == ticket_id)
        
        if environment != "All":
            query = query.filter(Bug.environment == environment)
        
        # Only get open bugs (not closed)
        query = query.filter(Bug.status != "Closed")
        
        bugs = query.all()
        
        completion_buckets = {
            "0%": 0,
            "1-25%": 0,
            "26-50%": 0,
            "51-75%": 0,
            "76-99%": 0,
            "100%": 0
        }
        
        total_done_ratio = 0
        bugs_with_progress = 0
        
        for bug in bugs:
            done = bug.done_ratio or 0
            total_done_ratio += done
            
            if done > 0:
                bugs_with_progress += 1
            
            if done == 0:
                completion_buckets["0%"] += 1
            elif done <= 25:
                completion_buckets["1-25%"] += 1
            elif done <= 50:
                completion_buckets["26-50%"] += 1
            elif done <= 75:
                completion_buckets["51-75%"] += 1
            elif done < 100:
                completion_buckets["76-99%"] += 1
            else:
                completion_buckets["100%"] += 1
        
        avg_completion = total_done_ratio / len(bugs) if bugs else 0
        
        return {
            "total_open_bugs": len(bugs),
            "bugs_with_progress": bugs_with_progress,
            "bugs_not_started": completion_buckets["0%"],
            "avg_completion_percent": round(avg_completion, 1),
            "completion_distribution": completion_buckets,
            "near_completion": completion_buckets["76-99%"] + completion_buckets["100%"]
        }
    finally:
        db.close()


# ===== TESTRAIL ENDPOINTS =====

@app.get("/testrail/summary")
def testrail_summary(ticket_id: int = Query(...)):
    """Get test case counts and status breakdown for a ticket"""
    db: Session = SessionLocal()
    
    try:
        # Get all test results for this ticket
        results = db.query(TestResult).filter(TestResult.ticket_id == ticket_id).all()
        
        total_tests = len(results)
        status_counts = {
            "Passed": 0,
            "Failed": 0,
            "Blocked": 0,
            "Retest": 0,
            "Untested": 0
        }
        
        for result in results:
            status = result.status_name or "Untested"
            if status in status_counts:
                status_counts[status] += 1
        
        # Get unique test cases count
        unique_cases = db.query(TestCase.case_id).filter(TestCase.ticket_id == ticket_id).distinct().count()
        plans_count = db.query(TestPlan).filter(TestPlan.ticket_id == ticket_id).count()
        runs_count = db.query(TestRun).filter(TestRun.ticket_id == ticket_id).count()
        
        # Get test plan name (most recent plan)
        test_plan = db.query(TestPlan).filter(TestPlan.ticket_id == ticket_id).order_by(TestPlan.created_on.desc()).first()
        plan_name = None
        if test_plan and test_plan.name:
            # Remove ticket_id_ prefix from plan name
            import re
            plan_name = re.sub(r'^\d+_', '', test_plan.name)
        
        return {
            "ticket_id": ticket_id,
            "total_test_cases": unique_cases,
            "total_test_results": total_tests,
            "status_counts": status_counts,
            "test_plans_count": plans_count,
            "test_runs_count": runs_count,
            "test_plan_name": plan_name
        }
    finally:
        db.close()


@app.get("/testrail/test-plans")
def testrail_test_plans(ticket_id: int = Query(...)):
    """Get all test plans for a ticket"""
    db: Session = SessionLocal()
    try:
        plans = db.query(TestPlan).filter(TestPlan.ticket_id == ticket_id).all()
        return [
            {
                "plan_id": plan.plan_id,
                "name": plan.name,
                "description": plan.description,
                "created_on": plan.created_on.isoformat() if plan.created_on else None,
                "updated_on": plan.updated_on.isoformat() if plan.updated_on else None,
                "custom_fields": plan.custom_fields
            }
            for plan in plans
        ]
    finally:
        db.close()


@app.get("/testrail/test-runs")
def testrail_test_runs(ticket_id: int = Query(...)):
    """Get all test runs for a ticket with their test results"""
    db: Session = SessionLocal()
    try:
        runs = db.query(TestRun).filter(TestRun.ticket_id == ticket_id).order_by(TestRun.created_on.desc()).all()
        result = []
        
        for run in runs:
            # Get all test results for this run
            results = db.query(TestResult).filter(TestResult.run_id == run.run_id).all()
            
            # Count statuses for this run
            status_counts = {
                "Passed": 0,
                "Failed": 0,
                "Blocked": 0,
                "Retest": 0,
                "Untested": 0
            }
            
            for res in results:
                status = res.status_name or "Untested"
                if status in status_counts:
                    status_counts[status] += 1
            
            # Get unique test cases in this run
            unique_cases = db.query(TestResult.case_id).filter(
                TestResult.run_id == run.run_id
            ).distinct().count()
            
            result.append({
                "run_id": run.run_id,
                "plan_id": run.plan_id,
                "name": run.name,
                "description": run.description,
                "status": run.status,
                "created_on": run.created_on.isoformat() if run.created_on else None,
                "updated_on": run.updated_on.isoformat() if run.updated_on else None,
                "total_tests": len(results),
                "unique_test_cases": unique_cases,
                "status_counts": status_counts,
                "custom_fields": run.custom_fields
            })
        
        return result
    finally:
        db.close()


@app.get("/testrail/test-cases")
def testrail_test_cases(ticket_id: int = Query(...)):
    """Get all test cases with results for a ticket"""
    db: Session = SessionLocal()
    try:
        # Get all test cases for this ticket
        cases = db.query(TestCase).filter(TestCase.ticket_id == ticket_id).all()
        
        # Get latest results for each case
        case_results = {}
        results = db.query(TestResult).filter(TestResult.ticket_id == ticket_id).all()
        
        for result in results:
            case_id = result.case_id
            if case_id not in case_results or (result.created_on and (
                not case_results[case_id].created_on or 
                result.created_on > case_results[case_id].created_on
            )):
                case_results[case_id] = result
        
        return [
            {
                "case_id": case.case_id,
                "run_id": case.run_id,
                "title": case.title,
                "section": case.section,
                "priority": case.priority,
                "type": case.type,
                "latest_status": case_results.get(case.case_id).status_name if case.case_id in case_results and case_results.get(case.case_id) else "Untested",
                "latest_result_id": case_results.get(case.case_id).test_id if case.case_id in case_results and case_results.get(case.case_id) else None,
                "custom_fields": case.custom_fields
            }
            for case in cases
        ]
    finally:
        db.close()


@app.get("/testrail/status-breakdown")
def testrail_status_breakdown(ticket_id: int = Query(...)):
    """Get test status distribution for a ticket"""
    db: Session = SessionLocal()
    try:
        results = db.query(TestResult).filter(TestResult.ticket_id == ticket_id).all()
        
        status_counts = defaultdict(int)
        for result in results:
            status = result.status_name or "Untested"
            status_counts[status] += 1
        
        total = len(results)
        
        return {
            "ticket_id": ticket_id,
            "total": total,
            "status_distribution": dict(status_counts),
            "percentages": {
                status: round((count / total * 100), 1) if total > 0 else 0
                for status, count in status_counts.items()
            }
        }
    finally:
        db.close()


# ===== TICKET TRACKING ENDPOINTS =====

@app.get("/tickets/search")
def search_tickets(query: str = Query("", description="Search query for ticket ID or title")):
    """Search tickets for autocomplete - returns matching ticket IDs from PM tracker Excel import only"""
    db: Session = SessionLocal()
    try:
        # Get tickets ONLY from TicketTracking (PM tracker Excel import)
        tracking_tickets = db.query(TicketTracking).all()
        
        # Build a map of ticket_id -> first bug subject for titles
        ticket_id_to_title = {}
        if tracking_tickets:
            ticket_ids = [t.ticket_id for t in tracking_tickets]
            # Get ticket titles from Bug table for tickets that exist in tracking
            bugs = db.query(Bug.ticket_id, Bug.subject).filter(
                Bug.ticket_id.in_(ticket_ids)
            ).distinct(Bug.ticket_id).all()
            
            for bug in bugs:
                if bug.ticket_id and bug.subject:
                    title_parts = bug.subject.split(" - ")
                    ticket_id_to_title[bug.ticket_id] = title_parts[0] if title_parts else bug.subject
        
        # Build ticket list from TicketTracking only
        tickets = []
        for t in tracking_tickets:
            ticket_data = {
                "ticket_id": t.ticket_id,
                "title": ticket_id_to_title.get(t.ticket_id, f"Ticket #{t.ticket_id}"),
                "status": t.status,
                "assignee": t.current_assignee
            }
            tickets.append(ticket_data)
        
        # Filter by query if provided
        if query:
            query_str = query.strip()
            
            # First, find tickets where ticket_id STARTS WITH the query
            starts_with = [
                t for t in tickets
                if str(t["ticket_id"]).startswith(query_str)
            ]
            
            # If we have matches that start with the query, return only those
            if starts_with:
                # Sort by ticket_id descending (most recent first)
                starts_with.sort(key=lambda x: x["ticket_id"], reverse=True)
                return starts_with[:50]
            
            # Otherwise, fall back to tickets that CONTAIN the query anywhere
            query_lower = query_str.lower()
            contains = [
                t for t in tickets
                if query_str in str(t["ticket_id"]) or query_lower in (t["title"] or "").lower()
            ]
            
            # Sort by ticket_id descending (most recent first)
            contains.sort(key=lambda x: x["ticket_id"], reverse=True)
            return contains[:50]
        
        # No query - return all tickets sorted by ticket_id descending
        tickets.sort(key=lambda x: x["ticket_id"], reverse=True)
        
        # Limit results for performance
        return tickets[:50]
    finally:
        db.close()


@app.get("/ticket-tracking/{ticket_id}")
def get_ticket_tracking(ticket_id: int):
    """Get tracking data for a specific ticket, including developers from Redmine"""
    db: Session = SessionLocal()
    try:
        tracking = db.query(TicketTracking).filter(TicketTracking.ticket_id == ticket_id).first()
        
        # Get developers from Redmine bugs for this ticket
        bugs = db.query(Bug).filter(Bug.ticket_id == ticket_id).all()
        redmine_developers = set()
        for bug in bugs:
            if bug.assignee and bug.assignee.strip():
                redmine_developers.add(bug.assignee.strip())
        
        if not tracking:
            # Return just Redmine data if no tracking data
            if redmine_developers:
                return {
                    "ticket_id": ticket_id,
                    "status": None,
                    "developers": list(redmine_developers),
                    "qc_testers": [],
                    "eta": None,
                    "current_assignee": None,
                    "dev_estimate_hours": None,
                    "actual_dev_hours": None,
                    "qa_estimate_hours": None,
                    "actual_qa_hours": None,
                    "dev_deviation": None,
                    "qa_deviation": None,
                    "qa_vs_dev_ratio": None,
                    "updated_on": None
                }
            return None
        
        # Collect all developers (from tracking + Redmine)
        developers = set()
        if tracking.backend_developer:
            developers.add(tracking.backend_developer.strip())
        if tracking.frontend_developer:
            developers.add(tracking.frontend_developer.strip())
        if tracking.developer_assigned:
            developers.add(tracking.developer_assigned.strip())
        developers.update(redmine_developers)
        # Remove empty strings
        developers = [d for d in developers if d]
        
        # Collect QC testers
        qc_testers = []
        if tracking.qc_tester:
            qc_testers = [t.strip() for t in tracking.qc_tester.split(',') if t.strip()]
        
        # Calculate deviations
        dev_deviation = None
        if tracking.dev_estimate_hours and tracking.actual_dev_hours:
            dev_deviation = round(tracking.actual_dev_hours - tracking.dev_estimate_hours, 1)
        
        qa_deviation = None
        if tracking.qa_estimate_hours and tracking.actual_qa_hours:
            qa_deviation = round(tracking.actual_qa_hours - tracking.qa_estimate_hours, 1)
        
        # QA vs Dev ratio (how much QA time compared to actual dev time)
        qa_vs_dev_ratio = None
        if tracking.actual_dev_hours and tracking.actual_qa_hours and tracking.actual_dev_hours > 0:
            qa_vs_dev_ratio = round((tracking.actual_qa_hours / tracking.actual_dev_hours) * 100, 1)
        
        return {
            "ticket_id": tracking.ticket_id,
            "status": tracking.status,
            "developers": developers,
            "qc_testers": qc_testers,
            "eta": tracking.eta.isoformat() if tracking.eta else None,
            "current_assignee": tracking.current_assignee,
            "dev_estimate_hours": tracking.dev_estimate_hours,
            "actual_dev_hours": tracking.actual_dev_hours,
            "qa_estimate_hours": tracking.qa_estimate_hours,
            "actual_qa_hours": tracking.actual_qa_hours,
            "dev_deviation": dev_deviation,
            "qa_deviation": qa_deviation,
            "qa_vs_dev_ratio": qa_vs_dev_ratio,
            "updated_on": tracking.updated_on.isoformat() if tracking.updated_on else None
        }
    finally:
        db.close()


@app.get("/ticket-tracking/summary/all")
def get_ticket_tracking_summary():
    """Get overview metrics for all tracked tickets"""
    db: Session = SessionLocal()
    try:
        all_tracking = db.query(TicketTracking).all()
        
        if not all_tracking:
            return {
                "total_tickets": 0,
                "avg_dev_estimate": 0,
                "avg_dev_actual": 0,
                "avg_qa_estimate": 0,
                "avg_qa_actual": 0,
                "dev_efficiency": 0,
                "qa_efficiency": 0,
                "status_breakdown": {}
            }
        
        total = len(all_tracking)
        
        # Calculate averages
        dev_estimates = [t.dev_estimate_hours for t in all_tracking if t.dev_estimate_hours]
        dev_actuals = [t.actual_dev_hours for t in all_tracking if t.actual_dev_hours]
        qa_estimates = [t.qa_estimate_hours for t in all_tracking if t.qa_estimate_hours]
        qa_actuals = [t.actual_qa_hours for t in all_tracking if t.actual_qa_hours]
        
        avg_dev_estimate = sum(dev_estimates) / len(dev_estimates) if dev_estimates else 0
        avg_dev_actual = sum(dev_actuals) / len(dev_actuals) if dev_actuals else 0
        avg_qa_estimate = sum(qa_estimates) / len(qa_estimates) if qa_estimates else 0
        avg_qa_actual = sum(qa_actuals) / len(qa_actuals) if qa_actuals else 0
        
        # Calculate efficiency (how well estimates match actual)
        dev_efficiency = (avg_dev_estimate / avg_dev_actual * 100) if avg_dev_actual > 0 else 100
        qa_efficiency = (avg_qa_estimate / avg_qa_actual * 100) if avg_qa_actual > 0 else 100
        
        # Status breakdown
        status_counts = defaultdict(int)
        for t in all_tracking:
            status_counts[t.status or "Unknown"] += 1
        
        return {
            "total_tickets": total,
            "avg_dev_estimate": round(avg_dev_estimate, 1),
            "avg_dev_actual": round(avg_dev_actual, 1),
            "avg_qa_estimate": round(avg_qa_estimate, 1),
            "avg_qa_actual": round(avg_qa_actual, 1),
            "dev_efficiency": round(dev_efficiency, 1),
            "qa_efficiency": round(qa_efficiency, 1),
            "status_breakdown": dict(status_counts)
        }
    finally:
        db.close()


@app.get("/ticket-tracking/team-metrics")
def get_team_metrics():
    """Get developer/QC productivity metrics"""
    db: Session = SessionLocal()
    try:
        all_tracking = db.query(TicketTracking).all()
        
        if not all_tracking:
            return {
                "developers": {},
                "qc_testers": {}
            }
        
        # Developer metrics
        dev_metrics = defaultdict(lambda: {"tickets": 0, "total_hours": 0, "total_estimate": 0})
        qc_metrics = defaultdict(lambda: {"tickets": 0, "total_hours": 0, "total_estimate": 0})
        
        for t in all_tracking:
            # Backend developer
            if t.backend_developer:
                dev_metrics[t.backend_developer]["tickets"] += 1
                if t.actual_dev_hours:
                    dev_metrics[t.backend_developer]["total_hours"] += t.actual_dev_hours
                if t.dev_estimate_hours:
                    dev_metrics[t.backend_developer]["total_estimate"] += t.dev_estimate_hours
            
            # Frontend developer
            if t.frontend_developer:
                dev_metrics[t.frontend_developer]["tickets"] += 1
                if t.actual_dev_hours:
                    dev_metrics[t.frontend_developer]["total_hours"] += t.actual_dev_hours
                if t.dev_estimate_hours:
                    dev_metrics[t.frontend_developer]["total_estimate"] += t.dev_estimate_hours
            
            # QC Tester
            if t.qc_tester:
                qc_metrics[t.qc_tester]["tickets"] += 1
                if t.actual_qa_hours:
                    qc_metrics[t.qc_tester]["total_hours"] += t.actual_qa_hours
                if t.qa_estimate_hours:
                    qc_metrics[t.qc_tester]["total_estimate"] += t.qa_estimate_hours
        
        # Calculate efficiency for each person
        for dev, data in dev_metrics.items():
            if data["total_hours"] > 0:
                data["efficiency"] = round((data["total_estimate"] / data["total_hours"]) * 100, 1)
            else:
                data["efficiency"] = 100
            data["total_hours"] = round(data["total_hours"], 1)
            data["total_estimate"] = round(data["total_estimate"], 1)
        
        for qc, data in qc_metrics.items():
            if data["total_hours"] > 0:
                data["efficiency"] = round((data["total_estimate"] / data["total_hours"]) * 100, 1)
            else:
                data["efficiency"] = 100
            data["total_hours"] = round(data["total_hours"], 1)
            data["total_estimate"] = round(data["total_estimate"], 1)
        
        return {
            "developers": dict(dev_metrics),
            "qc_testers": dict(qc_metrics)
        }
    finally:
        db.close()


@app.post("/ticket-tracking/refresh")
def refresh_ticket_tracking():
    """Trigger manual import from imports folder"""
    import subprocess
    import os
    
    script_path = os.path.join(os.path.dirname(__file__), "sync_excel_to_db.py")
    imports_folder = os.path.join(os.path.dirname(__file__), "imports")
    
    try:
        # Run the import script
        result = subprocess.run(
            ["python", script_path, "--folder", imports_folder],
            capture_output=True,
            text=True,
            timeout=60
        )
        
        return {
            "success": result.returncode == 0,
            "message": result.stdout if result.returncode == 0 else result.stderr,
            "return_code": result.returncode
        }
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "message": "Import process timed out after 60 seconds",
            "return_code": -1
        }
    except Exception as e:
        return {
            "success": False,
            "message": str(e),
            "return_code": -1
        }


@app.post("/ticket-tracking/sync-latest")
def sync_latest_ticket_report():
    """Import the latest TicketReport file from Downloads folder"""
    import subprocess
    import os
    
    script_path = os.path.join(os.path.dirname(__file__), "sync_excel_to_db.py")
    
    try:
        # Run the import script with --import-latest flag
        result = subprocess.run(
            ["python", script_path, "--import-latest"],
            capture_output=True,
            text=True,
            timeout=120  # Allow more time for large files
        )
        
        output = result.stdout if result.returncode == 0 else result.stderr
        
        # Parse the output to extract counts
        imported = 0
        updated = 0
        if "New records:" in output:
            try:
                imported = int(output.split("New records:")[1].split()[0])
            except:
                pass
        if "Updated records:" in output:
            try:
                updated = int(output.split("Updated records:")[1].split()[0])
            except:
                pass
        
        return {
            "success": result.returncode == 0,
            "message": "Sync completed successfully" if result.returncode == 0 else "Sync failed",
            "details": output,
            "imported": imported,
            "updated": updated,
            "return_code": result.returncode
        }
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "message": "Import process timed out after 120 seconds",
            "details": "",
            "imported": 0,
            "updated": 0,
            "return_code": -1
        }
    except Exception as e:
        return {
            "success": False,
            "message": str(e),
            "details": "",
            "imported": 0,
            "updated": 0,
            "return_code": -1
        }


@app.get("/ticket-tracking/sync-status")
def get_ticket_sync_status():
    """Get status of last ticket sync and available files"""
    import os
    import re
    from pathlib import Path
    from datetime import datetime
    
    # Get Downloads folder
    downloads_folder = str(Path.home() / 'Downloads')
    imports_folder = os.path.join(os.path.dirname(__file__), "imports")
    
    # Pattern for TicketReport files
    pattern = re.compile(r'^TicketReport_(\d{8})_(\d{6})\.xlsx$', re.IGNORECASE)
    
    # Find latest file in Downloads
    latest_download = None
    latest_download_time = None
    download_count = 0
    
    if os.path.exists(downloads_folder):
        for f in os.listdir(downloads_folder):
            match = pattern.match(f)
            if match:
                download_count += 1
                filepath = os.path.join(downloads_folder, f)
                mtime = os.path.getmtime(filepath)
                if latest_download_time is None or mtime > latest_download_time:
                    latest_download_time = mtime
                    latest_download = f
    
    # Find latest file in imports folder
    latest_import = None
    latest_import_time = None
    
    if os.path.exists(imports_folder):
        for f in os.listdir(imports_folder):
            if pattern.match(f):
                filepath = os.path.join(imports_folder, f)
                mtime = os.path.getmtime(filepath)
                if latest_import_time is None or mtime > latest_import_time:
                    latest_import_time = mtime
                    latest_import = f
    
    # Get last sync time from database
    db = SessionLocal()
    try:
        last_updated = db.query(func.max(TicketTracking.updated_on)).scalar()
    finally:
        db.close()
    
    return {
        "downloads_folder": downloads_folder,
        "files_in_downloads": download_count,
        "latest_download": latest_download,
        "latest_download_time": datetime.fromtimestamp(latest_download_time).isoformat() if latest_download_time else None,
        "latest_import": latest_import,
        "latest_import_time": datetime.fromtimestamp(latest_import_time).isoformat() if latest_import_time else None,
        "last_db_update": last_updated.isoformat() if last_updated else None,
        "needs_sync": latest_download_time and latest_import_time and latest_download_time > latest_import_time
    }


# ===== TICKETS DASHBOARD ENDPOINTS =====

# Status to Team Mapping (same as frontend)
STATUS_TEAM_MAPPING = {
    'NEW': 'BIS',
    'Ready For Development': 'DEV',
    'Quote Required': 'BIS',
    'Closed': 'Completed',
    'Backlog—Unranked': 'BIS',
    'Moved to Live': 'BIS',
    'Technical Review': 'DEV',
    'Approved for Live': 'DEV',
    'Live - awaiting fixes': 'DEV',
    'Express Lane Review': 'DEV',
    'In Progress': 'DEV',
    'Start Code Review': 'DEV',
    'Quote': 'BIS',
    'QC Testing': 'QA',
    'Under Review': 'BIS',
    'Code Review Failed': 'DEV',
    'QC Review Fail': 'DEV',
    'Pending Quote Approval': 'BIS',
    'BIS Testing': 'BIS - QA',
    'Planning': 'BIS',
    'Testing In Progress': 'BIS - QA',
    'Code Review Passed': 'DEV',
    'QC Testing in Progress': 'QA',
    'QC Testing Hold': 'QA',
    'Hold/Pending': 'BIS',
    'Design Review': 'BIS',
    'Ready for Design': 'BIS',
    'Design In Progress': 'BIS',
    'Tested - Awaiting Fixes': 'DEV',
    'Re-opened': 'DEV',
    'Reopened': 'DEV'
}

@app.get("/tickets-dashboard/overview")
def get_tickets_overview():
    """Get overall tickets dashboard data with team breakdown"""
    db: Session = SessionLocal()
    try:
        all_tickets = db.query(TicketTracking).all()
        
        if not all_tickets:
            return {
                "total_tickets": 0,
                "by_status": {},
                "by_team": {},
                "by_assignee": {},
                "team_status_breakdown": {},
                "eta_analysis": {
                    "overdue": 0,
                    "due_this_week": 0,
                    "no_eta": 0,
                    "on_track": 0
                }
            }
        
        today = datetime.now().date()
        week_from_now = today + timedelta(days=7)
        
        # Initialize counters
        by_status = defaultdict(int)
        by_team = defaultdict(int)
        by_assignee = defaultdict(list)
        team_status_breakdown = defaultdict(lambda: defaultdict(int))
        team_tickets = defaultdict(list)
        
        eta_overdue = 0
        eta_due_this_week = 0
        eta_no_eta = 0
        eta_on_track = 0
        
        completed_count = 0
        completed_tickets = []
        
        for ticket in all_tickets:
            status = ticket.status or 'Unknown'
            team = STATUS_TEAM_MAPPING.get(status, 'Unknown')
            assignee = ticket.current_assignee or 'Unassigned'
            
            # Check if completed
            is_closed = status.lower() in ['closed', 'moved to live', 'completed']
            
            # Calculate ageing (days since updated_on or created)
            ticket_age = 0
            if ticket.updated_on:
                age_delta = today - (ticket.updated_on.date() if hasattr(ticket.updated_on, 'date') else ticket.updated_on)
                ticket_age = age_delta.days
            elif ticket.eta:
                age_delta = today - (ticket.eta.date() if hasattr(ticket.eta, 'date') else ticket.eta)
                ticket_age = age_delta.days
            
            ticket_data = {
                "ticket_id": ticket.ticket_id,
                "status": status,
                "team": team,
                "assignee": assignee,
                "eta": ticket.eta.isoformat() if ticket.eta else None,
                "age_days": ticket_age,
                "dev_estimate": ticket.dev_estimate_hours,
                "dev_actual": ticket.actual_dev_hours,
                "qa_estimate": ticket.qa_estimate_hours,
                "qa_actual": ticket.actual_qa_hours,
                "updated_on": ticket.updated_on.isoformat() if ticket.updated_on else None
            }
            
            if is_closed:
                completed_count += 1
                completed_tickets.append(ticket_data)
                continue  # Skip completed tickets from active tracking
            
            # Count by status (only active tickets)
            by_status[status] += 1
            
            # Count by team (only active tickets)
            by_team[team] += 1
            
            # Track team status breakdown (only active tickets)
            team_status_breakdown[team][status] += 1
            
            # Track tickets by assignee (only active tickets)
            by_assignee[assignee].append(ticket_data)
            
            # Track tickets by team (only active tickets)
            team_tickets[team].append(ticket_data)
            
            # ETA analysis (only active tickets)
            if not ticket.eta:
                eta_no_eta += 1
            else:
                eta_date = ticket.eta.date() if hasattr(ticket.eta, 'date') else ticket.eta
                if eta_date < today:
                    eta_overdue += 1
                elif eta_date <= week_from_now:
                    eta_due_this_week += 1
                else:
                    eta_on_track += 1
        
        return {
            "total_tickets": len(all_tickets),
            "completed_count": completed_count,
            "completed_tickets": completed_tickets,
            "active_tickets": len(all_tickets) - completed_count,
            "by_status": dict(by_status),
            "by_team": dict(by_team),
            "by_assignee": {k: {"count": len(v), "tickets": v} for k, v in by_assignee.items()},
            "team_status_breakdown": {k: dict(v) for k, v in team_status_breakdown.items()},
            "team_tickets": {k: v for k, v in team_tickets.items()},
            "eta_analysis": {
                "overdue": eta_overdue,
                "due_this_week": eta_due_this_week,
                "no_eta": eta_no_eta,
                "on_track": eta_on_track
            }
        }
    finally:
        db.close()


@app.get("/tickets-dashboard/team/{team_name}")
def get_team_tickets(team_name: str):
    """Get detailed tickets for a specific team"""
    db: Session = SessionLocal()
    try:
        all_tickets = db.query(TicketTracking).all()
        
        team_tickets = []
        status_breakdown = defaultdict(int)
        assignee_breakdown = defaultdict(list)
        
        for ticket in all_tickets:
            status = ticket.status or 'Unknown'
            team = STATUS_TEAM_MAPPING.get(status, 'Unknown')
            
            # Match team (case-insensitive, handle variations)
            team_normalized = team.lower().replace(' ', '-').replace('/', '-')
            team_name_normalized = team_name.lower().replace(' ', '-').replace('/', '-')
            
            if team_normalized == team_name_normalized:
                assignee = ticket.current_assignee or 'Unassigned'
                
                # Calculate ageing
                today = datetime.now().date()
                ticket_age = 0
                if ticket.updated_on:
                    age_delta = today - (ticket.updated_on.date() if hasattr(ticket.updated_on, 'date') else ticket.updated_on)
                    ticket_age = age_delta.days
                elif ticket.eta:
                    age_delta = today - (ticket.eta.date() if hasattr(ticket.eta, 'date') else ticket.eta)
                    ticket_age = age_delta.days
                
                ticket_data = {
                    "ticket_id": ticket.ticket_id,
                    "status": status,
                    "assignee": assignee,
                    "eta": ticket.eta.isoformat() if ticket.eta else None,
                    "age_days": ticket_age,
                    "dev_estimate": ticket.dev_estimate_hours,
                    "dev_actual": ticket.actual_dev_hours,
                    "qa_estimate": ticket.qa_estimate_hours,
                    "qa_actual": ticket.actual_qa_hours,
                    "backend_developer": ticket.backend_developer,
                    "frontend_developer": ticket.frontend_developer,
                    "qc_tester": ticket.qc_tester,
                    "updated_on": ticket.updated_on.isoformat() if ticket.updated_on else None
                }
                
                team_tickets.append(ticket_data)
                status_breakdown[status] += 1
                assignee_breakdown[assignee].append(ticket_data)
        
        return {
            "team": team_name,
            "total_tickets": len(team_tickets),
            "tickets": team_tickets,
            "status_breakdown": dict(status_breakdown),
            "assignee_breakdown": {k: {"count": len(v), "tickets": v} for k, v in assignee_breakdown.items()}
        }
    finally:
        db.close()


@app.get("/tickets-dashboard/assignee/{assignee_name}")
def get_assignee_tickets(assignee_name: str):
    """Get tickets assigned to a specific person"""
    db: Session = SessionLocal()
    try:
        # Handle 'Unassigned' case
        if assignee_name.lower() == 'unassigned':
            tickets = db.query(TicketTracking).filter(
                (TicketTracking.current_assignee == None) | (TicketTracking.current_assignee == '')
            ).all()
        else:
            tickets = db.query(TicketTracking).filter(
                TicketTracking.current_assignee.ilike(f"%{assignee_name}%")
            ).all()
        
        result = []
        status_breakdown = defaultdict(int)
        team_breakdown = defaultdict(int)
        
        today = datetime.now().date()
        
        for ticket in tickets:
            status = ticket.status or 'Unknown'
            team = STATUS_TEAM_MAPPING.get(status, 'Unknown')
            
            # Calculate ageing
            ticket_age = 0
            if ticket.updated_on:
                age_delta = today - (ticket.updated_on.date() if hasattr(ticket.updated_on, 'date') else ticket.updated_on)
                ticket_age = age_delta.days
            elif ticket.eta:
                age_delta = today - (ticket.eta.date() if hasattr(ticket.eta, 'date') else ticket.eta)
                ticket_age = age_delta.days
            
            result.append({
                "ticket_id": ticket.ticket_id,
                "status": status,
                "team": team,
                "eta": ticket.eta.isoformat() if ticket.eta else None,
                "age_days": ticket_age,
                "dev_estimate": ticket.dev_estimate_hours,
                "dev_actual": ticket.actual_dev_hours,
                "qa_estimate": ticket.qa_estimate_hours,
                "qa_actual": ticket.actual_qa_hours,
                "updated_on": ticket.updated_on.isoformat() if ticket.updated_on else None
            })
            
            status_breakdown[status] += 1
            team_breakdown[team] += 1
        
        return {
            "assignee": assignee_name,
            "total_tickets": len(result),
            "tickets": result,
            "status_breakdown": dict(status_breakdown),
            "team_breakdown": dict(team_breakdown)
        }
    finally:
        db.close()


@app.get("/tickets-dashboard/status/{status_name}")
def get_status_tickets(status_name: str):
    """Get all tickets with a specific status"""
    db: Session = SessionLocal()
    try:
        tickets = db.query(TicketTracking).filter(
            TicketTracking.status.ilike(f"%{status_name}%")
        ).all()
        
        result = []
        assignee_breakdown = defaultdict(int)
        
        for ticket in tickets:
            status = ticket.status or 'Unknown'
            team = STATUS_TEAM_MAPPING.get(status, 'Unknown')
            assignee = ticket.current_assignee or 'Unassigned'
            
            result.append({
                "ticket_id": ticket.ticket_id,
                "status": status,
                "team": team,
                "assignee": assignee,
                "eta": ticket.eta.isoformat() if ticket.eta else None,
                "dev_estimate": ticket.dev_estimate_hours,
                "dev_actual": ticket.actual_dev_hours
            })
            
            assignee_breakdown[assignee] += 1
        
        return {
            "status": status_name,
            "team": STATUS_TEAM_MAPPING.get(status_name, 'Unknown'),
            "total_tickets": len(result),
            "tickets": result,
            "assignee_breakdown": dict(assignee_breakdown)
        }
    finally:
        db.close()


@app.get("/tickets-dashboard/eta-alerts")
def get_eta_alerts():
    """Get tickets with ETA concerns (overdue, due soon, no ETA)"""
    db: Session = SessionLocal()
    try:
        all_tickets = db.query(TicketTracking).all()
        
        today = datetime.now().date()
        week_from_now = today + timedelta(days=7)
        
        overdue = []
        due_this_week = []
        no_eta = []
        
        for ticket in all_tickets:
            status = ticket.status or 'Unknown'
            is_closed = status.lower() in ['closed', 'moved to live', 'completed']
            
            if is_closed:
                continue
            
            team = STATUS_TEAM_MAPPING.get(status, 'Unknown')
            
            ticket_data = {
                "ticket_id": ticket.ticket_id,
                "status": status,
                "team": team,
                "assignee": ticket.current_assignee or 'Unassigned',
                "eta": ticket.eta.isoformat() if ticket.eta else None
            }
            
            if not ticket.eta:
                no_eta.append(ticket_data)
            else:
                eta_date = ticket.eta.date() if hasattr(ticket.eta, 'date') else ticket.eta
                if eta_date < today:
                    days_overdue = (today - eta_date).days
                    ticket_data["days_overdue"] = days_overdue
                    overdue.append(ticket_data)
                elif eta_date <= week_from_now:
                    days_until = (eta_date - today).days
                    ticket_data["days_until_eta"] = days_until
                    due_this_week.append(ticket_data)
        
        # Sort by urgency
        overdue.sort(key=lambda x: x.get("days_overdue", 0), reverse=True)
        due_this_week.sort(key=lambda x: x.get("days_until_eta", 7))
        
        return {
            "overdue": overdue,
            "due_this_week": due_this_week,
            "no_eta": no_eta,
            "summary": {
                "overdue_count": len(overdue),
                "due_this_week_count": len(due_this_week),
                "no_eta_count": len(no_eta)
            }
        }
    finally:
        db.close()


@app.get("/tickets-dashboard/time-analysis")
def get_time_analysis(
    period: str = Query("last_week", description="Time period: last_week, last_2_weeks, last_month, custom"),
    start_date: Optional[str] = Query(None, description="Start date for custom period (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date for custom period (YYYY-MM-DD)")
):
    """Get time-based analysis of ticket activity by team"""
    db: Session = SessionLocal()
    try:
        today = datetime.now().date()
        
        # Determine date range
        if period == "last_week":
            range_start = today - timedelta(days=7)
            range_end = today
        elif period == "last_2_weeks":
            range_start = today - timedelta(days=14)
            range_end = today
        elif period == "last_month":
            range_start = today - timedelta(days=30)
            range_end = today
        elif period == "custom" and start_date and end_date:
            range_start = datetime.strptime(start_date, "%Y-%m-%d").date()
            range_end = datetime.strptime(end_date, "%Y-%m-%d").date()
        else:
            range_start = today - timedelta(days=7)
            range_end = today
        
        all_tickets = db.query(TicketTracking).all()
        
        print(f"Time Analysis: period={period}, range={range_start} to {range_end}, total_tickets={len(all_tickets)}")
        
        # Filter tickets by update date within period
        period_tickets = []
        for ticket in all_tickets:
            if ticket.updated_on:
                update_date = ticket.updated_on.date() if hasattr(ticket.updated_on, 'date') else ticket.updated_on
                if range_start <= update_date <= range_end:
                    period_tickets.append(ticket)
        
        print(f"Period tickets found: {len(period_tickets)}")
        
        # Team-centric analysis structure
        teams_data = {
            'BIS': {
                'name': 'BIS',
                'description': 'Business Intelligence & Strategy',
                'members': defaultdict(lambda: {'tickets': [], 'statuses': defaultdict(int)}),
                'total_tickets': 0,
                'status_breakdown': defaultdict(int),
                'transitions': defaultdict(int)  # e.g., how many moved to Dev
            },
            'DEV': {
                'name': 'DEV',
                'description': 'Development Team',
                'members': defaultdict(lambda: {'tickets': [], 'statuses': defaultdict(int)}),
                'total_tickets': 0,
                'status_breakdown': defaultdict(int),
                'transitions': defaultdict(int)
            },
            'QA': {
                'name': 'QA',
                'description': 'Quality Assurance',
                'members': defaultdict(lambda: {'tickets': [], 'statuses': defaultdict(int)}),
                'total_tickets': 0,
                'status_breakdown': defaultdict(int),
                'transitions': defaultdict(int),
                'moved_to_bis_testing': 0,  # Special metric for QA
                'moved_to_dev': 0  # Tickets sent back to dev
            },
            'BIS - QA': {
                'name': 'BIS - QA',
                'description': 'BIS Quality Testing',
                'members': defaultdict(lambda: {'tickets': [], 'statuses': defaultdict(int)}),
                'total_tickets': 0,
                'status_breakdown': defaultdict(int),
                'transitions': defaultdict(int)
            }
        }
        
        # Track closed tickets separately
        closed_tickets_count = 0
        active_tickets_count = 0
        
        # Track achievements for each team
        achievements = {
            'DEV': {
                'moved_to_qc_testing': 0,
                'label': 'Moved to QC Testing'
            },
            'QA': {
                'moved_to_bis_testing': 0,
                'moved_to_closed': 0,
                'label_bis': 'Moved to BIS Testing',
                'label_closed': 'Moved to Closed'
            },
            'BIS - QA': {
                'approved_for_live': 0,
                'label': 'Approved for Live'
            }
        }
        
        # Process tickets
        for ticket in period_tickets:
            status = ticket.status or 'Unknown'
            team = STATUS_TEAM_MAPPING.get(status, 'Unknown')
            
            # Check if ticket is closed/completed
            is_closed = status.lower() in ['closed', 'moved to live', 'completed'] or team == 'Completed'
            
            # Track achievements based on current status (these are milestones reached)
            # DEV achievement: tickets that moved to QC Testing
            if status in ['QC Testing', 'QC Testing in Progress', 'QC Testing Hold']:
                achievements['DEV']['moved_to_qc_testing'] += 1
            
            # QA achievement: tickets moved to BIS Testing
            if status == 'BIS Testing':
                achievements['QA']['moved_to_bis_testing'] += 1
            
            # QA achievement: tickets moved to Closed
            if status.lower() in ['closed', 'moved to live']:
                achievements['QA']['moved_to_closed'] += 1
            
            # BIS-QA achievement: tickets approved for live
            if status in ['Approved for Live', 'Moved to Live']:
                achievements['BIS - QA']['approved_for_live'] += 1
            
            if is_closed:
                closed_tickets_count += 1
                continue  # Skip closed tickets from team analysis
            
            active_tickets_count += 1
            
            if team not in teams_data:
                teams_data[team] = {
                    'name': team,
                    'description': team,
                    'members': defaultdict(lambda: {'tickets': [], 'statuses': defaultdict(int)}),
                    'total_tickets': 0,
                    'status_breakdown': defaultdict(int),
                    'transitions': defaultdict(int)
                }
            
            ticket_data = {
                "ticket_id": ticket.ticket_id,
                "status": status,
                "team": team,
                "assignee": ticket.current_assignee or 'Unassigned',
                "updated_on": ticket.updated_on.isoformat() if ticket.updated_on else None,
                "eta": ticket.eta.isoformat() if ticket.eta else None,
                "dev_estimate": ticket.dev_estimate_hours,
                "dev_actual": ticket.actual_dev_hours,
                "qa_estimate": ticket.qa_estimate_hours,
                "qa_actual": ticket.actual_qa_hours,
                "qc_tester": ticket.qc_tester,
                "backend_developer": ticket.backend_developer,
                "frontend_developer": ticket.frontend_developer
            }
            
            teams_data[team]['total_tickets'] += 1
            teams_data[team]['status_breakdown'][status] += 1
            
            # Get the right member based on team
            if team == 'QA':
                member = ticket.qc_tester or ticket.current_assignee or 'Unassigned'
                # Track QA-specific metrics
                if status == 'BIS Testing':
                    teams_data['QA']['moved_to_bis_testing'] += 1
                elif status in ['Code Review Failed', 'QC Review Fail', 'Tested - Awaiting Fixes']:
                    teams_data['QA']['moved_to_dev'] += 1
            elif team == 'DEV':
                member = ticket.backend_developer or ticket.frontend_developer or ticket.current_assignee or 'Unassigned'
            else:
                member = ticket.current_assignee or 'Unassigned'
            
            teams_data[team]['members'][member]['tickets'].append(ticket_data)
            teams_data[team]['members'][member]['statuses'][status] += 1
        
        # Convert to serializable format
        result_teams = {}
        for team_key, team_data in teams_data.items():
            if team_data['total_tickets'] > 0:  # Only include teams with activity
                members_list = []
                for member_name, member_data in team_data['members'].items():
                    members_list.append({
                        'name': member_name,
                        'ticket_count': len(member_data['tickets']),
                        'tickets': member_data['tickets'],
                        'status_breakdown': dict(member_data['statuses'])
                    })
                # Sort members by ticket count
                members_list.sort(key=lambda x: x['ticket_count'], reverse=True)
                
                result_teams[team_key] = {
                    'name': team_data['name'],
                    'description': team_data['description'],
                    'total_tickets': team_data['total_tickets'],
                    'status_breakdown': dict(team_data['status_breakdown']),
                    'members': members_list
                }
                
                # Add QA-specific metrics
                if team_key == 'QA':
                    result_teams[team_key]['moved_to_bis_testing'] = team_data.get('moved_to_bis_testing', 0)
                    result_teams[team_key]['moved_to_dev'] = team_data.get('moved_to_dev', 0)
        
        return {
            "period": {
                "type": period,
                "start_date": range_start.isoformat(),
                "end_date": range_end.isoformat(),
                "days": (range_end - range_start).days
            },
            "summary": {
                "total_tickets_worked": len(period_tickets),
                "active_tickets": active_tickets_count,
                "closed_tickets": closed_tickets_count,
                "teams_active": len(result_teams)
            },
            "achievements": {
                "DEV": {
                    "count": achievements['DEV']['moved_to_qc_testing'],
                    "label": "Moved to QC Testing",
                    "icon": "🧪"
                },
                "QA": {
                    "bis_testing": {
                        "count": achievements['QA']['moved_to_bis_testing'],
                        "label": "Moved to BIS Testing",
                        "icon": "🔍"
                    },
                    "closed": {
                        "count": achievements['QA']['moved_to_closed'],
                        "label": "Moved to Closed",
                        "icon": "✅"
                    }
                },
                "BIS_QA": {
                    "count": achievements['BIS - QA']['approved_for_live'],
                    "label": "Approved for Live",
                    "icon": "🚀"
                }
            },
            # Debug info
            "_debug": {
                "period": period,
                "range_start": range_start.isoformat(),
                "range_end": range_end.isoformat(),
                "period_tickets_count": len(period_tickets),
                "achievements_raw": {
                    "dev_to_qc": achievements['DEV']['moved_to_qc_testing'],
                    "qa_to_bis": achievements['QA']['moved_to_bis_testing'],
                    "qa_to_closed": achievements['QA']['moved_to_closed'],
                    "bis_qa_approved": achievements['BIS - QA']['approved_for_live']
                }
            },
            "teams": result_teams
        }
    finally:
        db.close()


@app.get("/tickets-dashboard/user-performance")
def get_user_performance(
    user: str = Query(..., description="User name to get performance for"),
    period: str = Query("last_month", description="Time period")
):
    """Get detailed performance metrics for a specific user"""
    db: Session = SessionLocal()
    try:
        today = datetime.now().date()
        
        # Determine date range
        if period == "last_week":
            range_start = today - timedelta(days=7)
        elif period == "last_2_weeks":
            range_start = today - timedelta(days=14)
        elif period == "last_month":
            range_start = today - timedelta(days=30)
        else:
            range_start = today - timedelta(days=30)
        
        all_tickets = db.query(TicketTracking).all()
        
        user_lower = user.lower()
        user_tickets = []
        
        for ticket in all_tickets:
            assignee = (ticket.current_assignee or '').lower()
            backend_dev = (ticket.backend_developer or '').lower()
            frontend_dev = (ticket.frontend_developer or '').lower()
            qc_tester = (ticket.qc_tester or '').lower()
            
            is_user_ticket = user_lower in [assignee, backend_dev, frontend_dev, qc_tester]
            
            if is_user_ticket:
                status = ticket.status or 'Unknown'
                team = STATUS_TEAM_MAPPING.get(status, 'Unknown')
                
                # Check if updated within period
                in_period = False
                if ticket.updated_on:
                    update_date = ticket.updated_on.date() if hasattr(ticket.updated_on, 'date') else ticket.updated_on
                    in_period = update_date >= range_start
                
                user_tickets.append({
                    "ticket_id": ticket.ticket_id,
                    "status": status,
                    "team": team,
                    "role": "Assignee" if assignee == user_lower else 
                            "Backend Dev" if backend_dev == user_lower else
                            "Frontend Dev" if frontend_dev == user_lower else
                            "QC Tester",
                    "updated_on": ticket.updated_on.isoformat() if ticket.updated_on else None,
                    "eta": ticket.eta.isoformat() if ticket.eta else None,
                    "in_period": in_period,
                    "dev_estimate": ticket.dev_estimate_hours,
                    "dev_actual": ticket.actual_dev_hours,
                    "qa_estimate": ticket.qa_estimate_hours,
                    "qa_actual": ticket.actual_qa_hours
                })
        
        # Calculate metrics
        total_tickets = len(user_tickets)
        period_tickets = [t for t in user_tickets if t.get("in_period")]
        completed = [t for t in user_tickets if t["status"].lower() in ['closed', 'moved to live', 'completed']]
        
        # Status breakdown
        status_breakdown = defaultdict(int)
        team_breakdown = defaultdict(int)
        role_breakdown = defaultdict(int)
        
        for ticket in user_tickets:
            status_breakdown[ticket["status"]] += 1
            team_breakdown[ticket["team"]] += 1
            role_breakdown[ticket["role"]] += 1
        
        return {
            "user": user,
            "period": period,
            "metrics": {
                "total_tickets_assigned": total_tickets,
                "tickets_worked_in_period": len(period_tickets),
                "completed_tickets": len(completed),
                "completion_rate": round((len(completed) / total_tickets * 100), 1) if total_tickets > 0 else 0
            },
            "breakdown": {
                "by_status": dict(status_breakdown),
                "by_team": dict(team_breakdown),
                "by_role": dict(role_breakdown)
            },
            "tickets": user_tickets
        }
    finally:
        db.close()


# ===== EMPLOYEE MANAGEMENT ENDPOINTS =====

def get_date_range(period: str):
    """Get date range for a given period"""
    today = datetime.now()
    if period == "past_week":
        return today - timedelta(days=7), today
    elif period == "past_month":
        return today - timedelta(days=30), today
    elif period == "past_quarter":
        return today - timedelta(days=90), today
    elif period == "one_year":
        return today - timedelta(days=365), today
    else:  # overall
        return None, today


def calculate_experience_years(date_of_joining):
    """Calculate years of experience from joining date"""
    if not date_of_joining:
        return 0
    today = datetime.now()
    delta = today - date_of_joining
    return round(delta.days / 365.25, 1)  # One decimal place

def calculate_bis_experience(bis_introduced_date):
    """Calculate BIS experience from BIS introduced date"""
    if not bis_introduced_date:
        return None
    today = datetime.now()
    delta = today - bis_introduced_date
    return round(delta.days / 365.25, 1)  # One decimal place

def calculate_total_experience(date_of_joining, previous_experience):
    """Calculate total experience (Techversant + previous)"""
    techversant_exp = calculate_experience_years(date_of_joining)
    prev_exp = previous_experience or 0
    return round(techversant_exp + prev_exp, 1)  # One decimal place


@app.get("/employees")
def list_employees(
    team: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    lead: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(True),
    search: Optional[str] = Query(None),
    employment_status: Optional[str] = Query(None)
):
    """List all employees with optional filters"""
    db: Session = SessionLocal()
    try:
        query = db.query(Employee)

        if is_active is not None:
            query = query.filter(Employee.is_active == is_active)
        if team:
            query = query.filter(Employee.team.ilike(f"%{team}%"))
        if category:
            query = query.filter(Employee.category.ilike(f"%{category}%"))
        if lead:
            query = query.filter(Employee.lead.ilike(f"%{lead}%"))
        if employment_status:
            query = query.filter(Employee.employment_status == employment_status)
        if search:
            query = query.filter(
                or_(
                    Employee.name.ilike(f"%{search}%"),
                    Employee.employee_id.ilike(f"%{search}%"),
                    Employee.email.ilike(f"%{search}%")
                )
            )
        
        employees = query.order_by(Employee.name).all()
        
        result = []
        for emp in employees:
            result.append({
                "id": emp.id,
                "employee_id": emp.employee_id,
                "name": emp.name,
                "email": emp.email,
                "role": emp.role,
                "location": emp.location,
                "date_of_joining": emp.date_of_joining.isoformat() if emp.date_of_joining else None,
                "team": emp.team,
                "category": emp.category,
                "employment_status": emp.employment_status or "Ongoing Employee",
                "lead": emp.lead,
                "experience_years": calculate_experience_years(emp.date_of_joining),
                "is_active": emp.is_active
            })
        
        return result
    finally:
        db.close()


@app.get("/employees/export-all")
def export_all_employees(
    team: Optional[str] = Query(None, description="Filter by team"),
    category: Optional[str] = Query(None, description="Filter by category"),
    employment_status: Optional[str] = Query(None, description="Filter by employment status")
):
    """Export all employees with basic profile details to Excel format with additional columns for mapping"""
    db: Session = SessionLocal()
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from io import BytesIO
        
        # Query employees with filters
        query = db.query(Employee)
        
        if team:
            query = query.filter(Employee.team.ilike(f"%{team}%"))
        if category:
            query = query.filter(Employee.category.ilike(f"%{category}%"))
        if employment_status:
            query = query.filter(func.upper(Employee.employment_status) == employment_status.upper())
        
        employees = query.order_by(Employee.name).all()
        
        # Create workbook
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Employee Profiles"
        
        # Define header style
        header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
        header_font = Font(bold=True, color="FFFFFF", size=12)
        border_style = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin')
        )
        
        # Base headers - fixed profile columns
        base_headers = [
            "Employee ID",
            "Name",
            "Email",
            "Role",
            "Location",
            "Date of Joining",
            "Team",
            "Category",
            "Employment Status",
            "Reporting To (Lead)",
            "Reporting Manager",
            "Previous Experience",
            "Experience (Years)",
            "Active Status"
        ]
        
        # Collect all unique dynamic column names from all employees' mapping_data
        dynamic_columns = set()
        for emp in employees:
            if emp.mapping_data:
                for key in emp.mapping_data.keys():
                    dynamic_columns.add(key)
        
        # Sort dynamic columns for consistent ordering
        # Put standard columns first (Column 1-5, Notes), then any custom columns alphabetically
        standard_dynamic = ["Column 1", "Column 2", "Column 3", "Column 4", "Column 5", "Notes"]
        custom_columns = sorted([c for c in dynamic_columns if c not in standard_dynamic])
        
        # Build ordered list of dynamic columns
        ordered_dynamic_columns = []
        for col in standard_dynamic:
            if col in dynamic_columns:
                ordered_dynamic_columns.append(col)
        ordered_dynamic_columns.extend(custom_columns)
        
        # If no dynamic columns exist, add default empty columns for user to fill
        if not ordered_dynamic_columns:
            ordered_dynamic_columns = ["Column 1", "Column 2", "Column 3", "Notes"]
        
        # Combine headers
        headers = base_headers + ordered_dynamic_columns
        
        ws.append(headers)
        
        # Style header row
        for col_idx, header in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col_idx)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal='center', vertical='center')
            cell.border = border_style
        
        # Number of base columns (for styling)
        num_base_cols = len(base_headers)
        
        # Add employee data
        for emp in employees:
            # Get existing mapping data if available
            mapping = emp.mapping_data or {}
            
            # Build base row data
            row = [
                emp.employee_id or "",
                emp.name or "",
                emp.email or "",
                emp.role or "",
                emp.location or "",
                emp.date_of_joining.strftime("%d-%b-%Y") if emp.date_of_joining else "",
                emp.team or "",
                emp.category or "",
                emp.employment_status or "Ongoing Employee",
                emp.lead or "",
                emp.manager or "",
                round(emp.previous_experience, 1) if emp.previous_experience is not None else "",
                calculate_experience_years(emp.date_of_joining),
                "Active" if emp.is_active else "Inactive"
            ]
            
            # Add dynamic column values
            for col_name in ordered_dynamic_columns:
                row.append(mapping.get(col_name, "") or "")
            
            ws.append(row)
            
            # Style data row
            for col_idx in range(1, len(headers) + 1):
                cell = ws.cell(row=ws.max_row, column=col_idx)
                cell.border = border_style
                if col_idx == 6:  # Date column
                    cell.alignment = Alignment(horizontal='left')
                elif col_idx > num_base_cols:  # Dynamic/mapping columns
                    cell.fill = PatternFill(start_color="FFFACD", end_color="FFFACD", fill_type="solid")  # Light yellow
        
        # Adjust column widths - base columns
        base_column_widths = {
            'A': 15,  # Employee ID
            'B': 30,  # Name
            'C': 30,  # Email
            'D': 25,  # Role
            'E': 15,  # Location
            'F': 18,  # Date of Joining
            'G': 15,  # Team
            'H': 15,  # Category
            'I': 20,  # Employment Status
            'J': 25,  # Reporting To (Lead)
            'K': 25,  # Reporting Manager
            'L': 18,  # Previous Experience
            'M': 15,  # Experience (Years)
            'N': 15   # Active Status
        }
        
        for col, width in base_column_widths.items():
            ws.column_dimensions[col].width = width
        
        # Set width for dynamic columns (starting from column N onwards)
        from openpyxl.utils import get_column_letter
        for i, col_name in enumerate(ordered_dynamic_columns):
            col_letter = get_column_letter(num_base_cols + 1 + i)
            # Notes column gets extra width
            ws.column_dimensions[col_letter].width = 30 if col_name == "Notes" else 20
        
        # Freeze header row
        ws.freeze_panes = 'A2'
        
        # Add filter to header row
        ws.auto_filter.ref = ws.dimensions
        
        # Save to BytesIO
        output = BytesIO()
        wb.save(output)
        output.seek(0)
        
        # Generate filename
        filter_parts = []
        if team:
            filter_parts.append(f"Team_{team}")
        if category:
            filter_parts.append(f"Category_{category}")
        if employment_status:
            filter_parts.append(f"Status_{employment_status}")
        
        filter_str = "_".join(filter_parts) if filter_parts else "All"
        filename = f"Employee_Profiles_Export_{filter_str}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error exporting employees: {str(e)}")
    finally:
        db.close()


@app.post("/employees/import-mapping")
def import_employee_mapping_data(
    file_path: Optional[str] = Query(None, description="Path to Excel file. If not provided, will look for latest in Downloads folder")
):
    """Import employee mapping data from Excel file (Column 1-5, Notes)"""
    db: Session = SessionLocal()
    try:
        import openpyxl
        from pathlib import Path
        import sys
        
        # Get Downloads folder path
        def get_downloads_folder():
            """Get the user's Downloads folder path"""
            if sys.platform == 'win32':
                import winreg
                try:
                    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 
                        r'SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders') as key:
                        downloads = winreg.QueryValueEx(key, '{374DE290-123F-4565-9164-39C4925E467B}')[0]
                        return downloads
                except:
                    pass
            return os.path.join(Path.home(), 'Downloads')
        
        DOWNLOADS_FOLDER = get_downloads_folder()
        
        # Determine file path
        excel_path = file_path
        if not excel_path:
            # Find the most recent Employee_Profiles_Export_*.xlsx file in Downloads
            if not os.path.exists(DOWNLOADS_FOLDER):
                raise HTTPException(status_code=404, detail=f"Downloads folder not found: {DOWNLOADS_FOLDER}")
            
            import glob
            pattern = os.path.join(DOWNLOADS_FOLDER, "Employee_Profiles_Export_*.xlsx")
            matching_files = glob.glob(pattern)
            
            if not matching_files:
                raise HTTPException(
                    status_code=404, 
                    detail=f"No Employee_Profiles_Export_*.xlsx files found in {DOWNLOADS_FOLDER}"
                )
            
            # Sort by modification time (newest first)
            matching_files.sort(key=lambda x: os.path.getmtime(x), reverse=True)
            excel_path = matching_files[0]
        
        if not os.path.exists(excel_path):
            raise HTTPException(status_code=404, detail=f"File not found: {excel_path}")
        
        # Load workbook
        wb = openpyxl.load_workbook(excel_path, data_only=True)
        ws = wb.active
        
        # Read headers to find column indices
        headers = [cell.value for cell in ws[1]]
        
        # Define base profile columns that should NOT be treated as mapping data
        base_profile_columns = {
            "employee id", "name", "email", "role", "location",
            "date of joining", "team", "category", "employment status",
            "reporting to (lead)", "reporting to", "lead", "reporting manager", "manager",
            "experience (years)", "experience", "active status", "active", "status",
            "user role", "user_role", "password", "login password"
        }
        
        # Find column indices
        col_indices = {}
        dynamic_columns = {}  # Store dynamic column name -> index mapping
        
        for idx, header in enumerate(headers, 1):
            header_str = str(header).strip() if header else ""
            header_lower = header_str.lower()
            
            if header_str == "Employee ID":
                col_indices["employee_id"] = idx
            elif header_lower in ["previous experience", "previous_experience", "prev experience", "prev exp"]:
                col_indices["previous_experience"] = idx
            elif header_lower in ["reporting to (lead)", "reporting to", "lead", "reporting lead"]:
                col_indices["lead"] = idx
            elif header_lower in ["reporting manager", "manager", "reporting to (manager)"]:
                col_indices["manager"] = idx
            elif header_lower in ["user role", "user_role", "access role"]:
                col_indices["user_role"] = idx
            elif header_lower in ["password", "login password"]:
                col_indices["password"] = idx
            elif header_str and header_lower not in base_profile_columns:
                # This is a dynamic/mapping column - store with original name
                dynamic_columns[header_str] = idx
        
        if "employee_id" not in col_indices:
            raise HTTPException(status_code=400, detail="Employee ID column not found in Excel file")
        
        # Process rows
        updated_count = 0
        not_found = []
        
        for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=False), start=2):
            # Get employee ID
            emp_id_cell = row[col_indices["employee_id"] - 1]
            employee_id = str(emp_id_cell.value).strip() if emp_id_cell.value else None
            
            if not employee_id or employee_id.lower() in ['none', 'null', '']:
                continue
            
            # Find employee in database
            employee = db.query(Employee).filter(Employee.employee_id == employee_id).first()
            
            if not employee:
                not_found.append(employee_id)
                continue
            
            # Extract mapping data from all dynamic columns
            mapping_data = {}
            for col_name, col_idx in dynamic_columns.items():
                val = row[col_idx - 1].value
                if val is not None and str(val).strip():
                    mapping_data[col_name] = str(val).strip()
            
            # Update previous_experience if column exists
            if "previous_experience" in col_indices:
                val = row[col_indices["previous_experience"] - 1].value
                if val is not None:
                    try:
                        # Try to convert to float
                        prev_exp = float(val)
                        employee.previous_experience = prev_exp
                    except (ValueError, TypeError):
                        # If conversion fails, skip this value
                        pass
            
            # Update lead if column exists
            if "lead" in col_indices:
                val = row[col_indices["lead"] - 1].value
                if val is not None:
                    lead_value = str(val).strip()
                    if lead_value:
                        employee.lead = lead_value
                    else:
                        employee.lead = None
            
            # Update manager if column exists
            if "manager" in col_indices:
                val = row[col_indices["manager"] - 1].value
                if val is not None:
                    manager_value = str(val).strip()
                    if manager_value:
                        employee.manager = manager_value
                    else:
                        employee.manager = None

            
            # Update employee mapping_data (set to None if empty dict to clear old data)
            employee.mapping_data = mapping_data if mapping_data else None
            updated_count += 1
        
        db.commit()
        
        return {
            "success": True,
            "message": f"Successfully imported mapping data for {updated_count} employees",
            "updated_count": updated_count,
            "not_found": not_found,
            "file_used": os.path.basename(excel_path)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error importing mapping data: {str(e)}")
    finally:
        db.close()


@app.get("/employees/team-overview")
def get_team_overview():
    """Get team-level summary for PM dashboard"""
    db: Session = SessionLocal()
    try:
        employees = db.query(Employee).filter(Employee.is_active == True).all()
        
        team_stats = {
            "DEVELOPMENT": {"total": 0, "billed": 0, "unbilled": 0},
            "QA": {"total": 0, "billed": 0, "unbilled": 0}
        }
        
        leads = defaultdict(lambda: {"total": 0, "dev": 0, "qa": 0})
        
        for emp in employees:
            team = emp.team or "Unknown"
            if team not in team_stats:
                team_stats[team] = {"total": 0, "billed": 0, "unbilled": 0}
            
            team_stats[team]["total"] += 1
            if emp.category and "BILLED" in emp.category.upper():
                if "UN" in emp.category.upper():
                    team_stats[team]["unbilled"] += 1
                else:
                    team_stats[team]["billed"] += 1
            
            if emp.lead:
                leads[emp.lead]["total"] += 1
                if team == "DEVELOPMENT":
                    leads[emp.lead]["dev"] += 1
                elif team == "QA":
                    leads[emp.lead]["qa"] += 1
        
        return {
            "total_employees": len(employees),
            "team_breakdown": team_stats,
            "leads": dict(leads)
        }
    finally:
        db.close()


@app.get("/employees/{employee_id}")
def get_employee(employee_id: str):
    """Get single employee details"""
    db: Session = SessionLocal()
    try:
        employee = db.query(Employee).filter(
            or_(
                Employee.employee_id == employee_id,
                Employee.id == int(employee_id) if employee_id.isdigit() else False
            )
        ).first()
        
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found")

        # Calculate experience metrics
        techversant_exp = calculate_experience_years(employee.date_of_joining)
        bis_exp = calculate_bis_experience(employee.bis_introduced_date) if employee.category == "BILLED" else None
        total_exp = calculate_total_experience(employee.date_of_joining, employee.previous_experience)
        
        return {
            "id": employee.id,
            "employee_id": employee.employee_id,
            "name": employee.name,
            "email": employee.email,
            "role": employee.role,
            "location": employee.location,
            "date_of_joining": employee.date_of_joining.isoformat() if employee.date_of_joining else None,
            "team": employee.team,
            "category": employee.category,
            "employment_status": employee.employment_status or "Ongoing Employee",
            "lead": employee.lead,
            "manager": employee.manager,
            "previous_experience": round(float(employee.previous_experience), 1) if employee.previous_experience is not None else None,
            "bis_introduced_date": employee.bis_introduced_date.isoformat() if employee.bis_introduced_date else None,
            "techversant_experience": techversant_exp,
            "bis_experience": bis_exp,
            "total_experience": total_exp,
            "bis_status": "Un-Billed" if employee.category != "BILLED" else "Billed",
            "platform": employee.platform,
            "photo_url": employee.photo_url,
            "experience_years": techversant_exp,  # Keep for backward compatibility
            "is_active": employee.is_active,
            "mapping_data": employee.mapping_data or {},
            "created_on": employee.created_on.isoformat() if employee.created_on else None,
            "updated_on": employee.updated_on.isoformat() if employee.updated_on else None
        }
    finally:
        db.close()


@app.get("/employees/{employee_id}/export")
def export_employee_profile(employee_id: str):
    """Export employee profile data to Excel format"""
    db: Session = SessionLocal()
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from io import BytesIO
        
        # Find employee
        employee = db.query(Employee).filter(
            or_(
                Employee.employee_id == employee_id,
                Employee.id == int(employee_id) if employee_id.isdigit() else False
            )
        ).first()
        
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found")

        # Create workbook
        wb = openpyxl.Workbook()
        
        # Remove default sheet
        if 'Sheet' in wb.sheetnames:
            wb.remove(wb['Sheet'])
        
        # ===== Sheet 1: Basic Information =====
        ws_basic = wb.create_sheet("Basic Information", 0)
        ws_basic.append(["Field", "Value"])
        
        basic_data = [
            ["Employee ID", employee.employee_id],
            ["Name", employee.name],
            ["Email", employee.email],
            ["Role", employee.role or "N/A"],
            ["Location", employee.location or "N/A"],
            ["Date of Joining", employee.date_of_joining.strftime("%d-%b-%Y") if employee.date_of_joining else "N/A"],
            ["Team", employee.team or "N/A"],
            ["Category", employee.category or "N/A"],
            ["Employment Status", employee.employment_status or "Ongoing Employee"],
            ["Reporting To (Lead)", employee.lead or "N/A"],
            ["Experience (Years)", calculate_experience_years(employee.date_of_joining)],
            ["Active Status", "Active" if employee.is_active else "Inactive"],
        ]
        
        for row in basic_data:
            ws_basic.append(row)
        
        # Style header
        header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
        header_font = Font(bold=True, color="FFFFFF", size=12)
        ws_basic['A1'].fill = header_fill
        ws_basic['A1'].font = header_font
        ws_basic['B1'].fill = header_fill
        ws_basic['B1'].font = header_font
        
        # Adjust column widths
        ws_basic.column_dimensions['A'].width = 25
        ws_basic.column_dimensions['B'].width = 40
        
        # ===== Sheet 2: Performance Metrics =====
        ws_perf = wb.create_sheet("Performance Metrics")
        ws_perf.append(["Metric", "Value", "Period"])
        
        # Get performance data directly from database
        try:
            # Get latest RAG status
            latest_review = db.query(EmployeeReview).filter(
                EmployeeReview.employee_id == employee.employee_id
            ).order_by(EmployeeReview.review_date.desc()).first()
            
            perf_rows = []
            if latest_review:
                perf_rows.extend([
                    ["RAG Status", latest_review.rag_status or "N/A", latest_review.review_period or "Overall"],
                    ["RAG Score", latest_review.rag_score or 0, latest_review.review_period or "Overall"],
                    ["Overall Rating", latest_review.overall_rating or 0, latest_review.review_period or "Overall"],
                ])
            
            # Get bug/ticket counts
            if employee.team == "DEVELOPMENT":
                bugs_resolved = db.query(Bug).filter(
                    Bug.assignee == employee.name,
                    Bug.status == "Resolved"
                ).count()
                bugs_created = db.query(Bug).filter(
                    Bug.author == employee.name
                ).count()
                tickets_completed = db.query(TicketTracking).filter(
                    TicketTracking.developer_assigned == employee.name,
                    TicketTracking.status == "Completed"
                ).count()
                tickets_in_progress = db.query(TicketTracking).filter(
                    TicketTracking.developer_assigned == employee.name,
                    TicketTracking.status.in_(["In Progress", "In Development"])
                ).count()
                
                perf_rows.extend([
                    ["Bugs Resolved", bugs_resolved, "Overall"],
                    ["Bugs Created", bugs_created, "Overall"],
                    ["Tickets Completed", tickets_completed, "Overall"],
                    ["Tickets In Progress", tickets_in_progress, "Overall"],
                ])
            else:
                bugs_found = db.query(Bug).filter(
                    Bug.author == employee.name
                ).count()
                bugs_resolved = db.query(Bug).filter(
                    Bug.assignee == employee.name,
                    Bug.status == "Resolved"
                ).count()
                test_cases_executed = db.query(TestResult).filter(
                    TestResult.executed_by == employee.name
                ).count()
                test_cases_passed = db.query(TestResult).filter(
                    TestResult.executed_by == employee.name,
                    TestResult.status == "Passed"
                ).count()
                
                perf_rows.extend([
                    ["Bugs Found", bugs_found, "Overall"],
                    ["Bugs Resolved", bugs_resolved, "Overall"],
                    ["Test Cases Executed", test_cases_executed, "Overall"],
                    ["Test Cases Passed", test_cases_passed, "Overall"],
                ])
            
            # Get timesheet summary (last 30 days)
            thirty_days_ago = date.today() - timedelta(days=30)
            timesheet_entries = db.query(EnhancedTimesheet).filter(
                EnhancedTimesheet.employee_name == employee.name,
                EnhancedTimesheet.date >= thirty_days_ago
            ).all()
            
            total_hours = sum(e.hours_logged or 0 for e in timesheet_entries)
            total_productive = sum(e.productive_hours or 0 for e in timesheet_entries)
            working_days = len(set(e.date for e in timesheet_entries))
            avg_daily = total_hours / working_days if working_days > 0 else 0
            
            perf_rows.extend([
                ["Total Hours Logged (30 days)", f"{total_hours:.1f}h", "Last 30 Days"],
                ["Total Productive Hours (30 days)", f"{total_productive:.1f}h", "Last 30 Days"],
                ["Working Days (30 days)", working_days, "Last 30 Days"],
                ["Avg Daily Hours (30 days)", f"{avg_daily:.1f}h", "Last 30 Days"],
            ])
            
            for row in perf_rows:
                ws_perf.append(row)
        except Exception as e:
            ws_perf.append(["Error", f"Could not fetch performance data: {str(e)}", "N/A"])
        
        # Style header
        ws_perf['A1'].fill = header_fill
        ws_perf['A1'].font = header_font
        ws_perf['B1'].fill = header_fill
        ws_perf['B1'].font = header_font
        ws_perf['C1'].fill = header_fill
        ws_perf['C1'].font = header_font
        
        ws_perf.column_dimensions['A'].width = 25
        ws_perf.column_dimensions['B'].width = 20
        ws_perf.column_dimensions['C'].width = 15
        
        # ===== Sheet 3: Goals =====
        ws_goals = wb.create_sheet("Goals & Development")
        ws_goals.append(["Type", "Title", "Description", "Status", "Progress %", "Target Date", "Created By"])
        
        try:
            goals = db.query(EmployeeGoal).filter(
                EmployeeGoal.employee_id == employee.employee_id
            ).order_by(EmployeeGoal.goal_type, EmployeeGoal.created_on.desc()).all()
            
            for goal in goals:
                goal_type_label = "Goal"
                if goal.goal_type == "strength":
                    goal_type_label = "Strength"
                elif goal.goal_type == "improvement":
                    goal_type_label = "Area of Improvement"
                
                ws_goals.append([
                    goal_type_label,
                    goal.title or "",
                    goal.description or "",
                    goal.status or "",
                    goal.progress or 0,
                    goal.target_date.strftime("%d-%b-%Y") if goal.target_date else "",
                    goal.created_by or ""
                ])
        except Exception as e:
            ws_goals.append(["Error", f"Could not fetch goals data: {str(e)}", "", "", "", "", ""])
        
        # Style header
        for col in ['A', 'B', 'C', 'D', 'E', 'F', 'G']:
            ws_goals[f'{col}1'].fill = header_fill
            ws_goals[f'{col}1'].font = header_font
            ws_goals.column_dimensions[col].width = 20
        
        # ===== Sheet 4: Performance Reviews =====
        ws_reviews = wb.create_sheet("Performance Reviews")
        ws_reviews.append(["Review Period", "Review Date", "RAG Status", "RAG Score", "Overall Rating", 
                          "Technical", "Productivity", "Quality", "Communication", "Recommendation", "Reviewed By"])
        
        try:
            reviews = db.query(EmployeeReview).filter(
                EmployeeReview.employee_id == employee.employee_id
            ).order_by(EmployeeReview.review_date.desc()).all()
            
            for review in reviews:
                ws_reviews.append([
                    review.review_period or "",
                    review.review_date.strftime("%d-%b-%Y") if review.review_date else "",
                    review.rag_status or "",
                    review.rag_score or 0,
                    review.overall_rating or 0,
                    review.technical_rating or 0,
                    review.productivity_rating or 0,
                    review.quality_rating or 0,
                    review.communication_rating or 0,
                    review.recommendation or "",
                    review.reviewed_by or ""
                ])
        except Exception as e:
            ws_reviews.append(["Error", f"Could not fetch reviews data: {str(e)}", "", "", "", "", "", "", "", "", ""])
        
        # Style header
        for col in ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']:
            ws_reviews[f'{col}1'].fill = header_fill
            ws_reviews[f'{col}1'].font = header_font
            ws_reviews.column_dimensions[col].width = 15
        
        # ===== Sheet 5: KPI Ratings =====
        ws_kpi = wb.create_sheet("KPI Ratings")
        ws_kpi.append(["Quarter", "KPI Name", "Category", "Manager Rating", "Manager Comments", "Self Rating", "Self Comments"])
        
        try:
            # Get KPI ratings grouped by quarter
            kpi_ratings = db.query(KPIRating).filter(
                KPIRating.employee_id == employee.employee_id
            ).order_by(KPIRating.year.desc(), KPIRating.quarter_number.desc(), KPIRating.kpi_id).all()
            
            current_quarter = None
            for rating in kpi_ratings:
                quarter_str = f"{rating.year}-Q{rating.quarter_number}"
                if quarter_str != current_quarter:
                    current_quarter = quarter_str
                    ws_kpi.append([quarter_str, "", "", "", "", "", ""])  # Quarter header
                
                # Get KPI details
                kpi = db.query(KPI).filter(KPI.id == rating.kpi_id).first()
                kpi_name = kpi.kpi_name if kpi else f"KPI ID: {rating.kpi_id}"
                kpi_category = kpi.category if kpi else ""
                
                ws_kpi.append([
                    "",
                    kpi_name,
                    kpi_category,
                    rating.manager_rating or "",
                    rating.manager_comments or "",
                    rating.self_rating or "",
                    rating.self_comments or ""
                ])
        except Exception as e:
            ws_kpi.append(["Error", f"Could not fetch KPI data: {str(e)}", "", "", "", "", ""])
        
        # Style header
        for col in ['A', 'B', 'C', 'D', 'E', 'F', 'G']:
            ws_kpi[f'{col}1'].fill = header_fill
            ws_kpi[f'{col}1'].font = header_font
            ws_kpi.column_dimensions[col].width = 20
        
        # ===== Sheet 6: Recent Timesheet Summary =====
        ws_timesheet = wb.create_sheet("Timesheet Summary")
        ws_timesheet.append(["Date", "Ticket ID", "Task Description", "Hours Logged", "Productive Hours", "Project Name", "Team"])
        
        try:
            # Get last 30 days of timesheet entries
            thirty_days_ago = date.today() - timedelta(days=30)
            entries = db.query(EnhancedTimesheet).filter(
                EnhancedTimesheet.employee_name == employee.name,
                EnhancedTimesheet.date >= thirty_days_ago
            ).order_by(EnhancedTimesheet.date.desc()).limit(100).all()
            
            for entry in entries:
                ws_timesheet.append([
                    entry.date.strftime("%d-%b-%Y") if entry.date else "",
                    entry.ticket_id or "",
                    entry.task_description or "",
                    entry.hours_logged or 0,
                    entry.productive_hours or 0,
                    entry.project_name or "",
                    entry.team or ""
                ])
        except Exception as e:
            ws_timesheet.append(["Error", f"Could not fetch timesheet data: {str(e)}", "", "", "", "", ""])
        
        # Style header
        for col in ['A', 'B', 'C', 'D', 'E', 'F', 'G']:
            ws_timesheet[f'{col}1'].fill = header_fill
            ws_timesheet[f'{col}1'].font = header_font
            ws_timesheet.column_dimensions[col].width = 20
        
        # Save to BytesIO
        output = BytesIO()
        wb.save(output)
        output.seek(0)
        
        # Generate filename
        filename = f"Employee_Profile_{employee.employee_id}_{employee.name.replace(' ', '_')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error exporting employee profile: {str(e)}")
    finally:
        db.close()


@app.post("/employees")
def create_employee(employee: EmployeeCreate):
    """Create a new employee"""
    db: Session = SessionLocal()
    try:
        # Check if employee_id or email already exists
        existing = db.query(Employee).filter(
            or_(
                Employee.employee_id == employee.employee_id,
                Employee.email == employee.email
            )
        ).first()
        
        if existing:
            raise HTTPException(status_code=400, detail="Employee ID or email already exists")
        
        new_employee = Employee(
            employee_id=employee.employee_id,
            name=employee.name,
            email=employee.email,
            role=employee.role,
            location=employee.location,
            date_of_joining=employee.date_of_joining,
            team=employee.team.upper() if employee.team else None,
            category=employee.category,
            employment_status=employee.employment_status or "Ongoing Employee",
            lead=employee.lead,
            is_active=True,
            created_on=datetime.utcnow()
        )
        
        db.add(new_employee)
        db.commit()
        db.refresh(new_employee)
        
        return {"message": "Employee created successfully", "id": new_employee.id, "employee_id": new_employee.employee_id}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@app.put("/employees/{employee_id}")
def update_employee(employee_id: str, updates: EmployeeUpdate):
    """Update an employee and cascade updates to related records"""
    db: Session = SessionLocal()
    try:
        employee = db.query(Employee).filter(
            or_(
                Employee.employee_id == employee_id,
                Employee.id == int(employee_id) if employee_id.isdigit() else False
            )
        ).first()
        
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found")
        
        # Store old values for cascading updates
        old_name = employee.name
        old_lead = employee.lead
        old_manager = employee.manager
        
        update_data = updates.dict(exclude_unset=True)
        for field, value in update_data.items():
            if value is not None:
                if field == 'team' and value:
                    value = value.upper()
                setattr(employee, field, value)
        
        new_name = employee.name
        new_lead = employee.lead
        new_manager = employee.manager
        
        # Cascade updates to related records
        update_count = 0
        
        # If employee name changed, update all employees who have this person as lead or manager
        if 'name' in update_data and old_name and new_name and old_name != new_name:
            # Update employees where this person is the lead
            lead_reportees = db.query(Employee).filter(
                Employee.lead.ilike(f"%{old_name}%")
            ).all()
            for reportee in lead_reportees:
                # Replace old name with new name in lead field
                if reportee.lead and old_name in reportee.lead:
                    reportee.lead = reportee.lead.replace(old_name, new_name)
                    update_count += 1
            
            # Update employees where this person is the manager
            manager_reportees = db.query(Employee).filter(
                Employee.manager.ilike(f"%{old_name}%")
            ).all()
            for reportee in manager_reportees:
                # Replace old name with new name in manager field
                if reportee.manager and old_name in reportee.manager:
                    reportee.manager = reportee.manager.replace(old_name, new_name)
                    update_count += 1
            
            # Update WeeklyPlan.planned_by
            weekly_plans = db.query(WeeklyPlan).filter(
                WeeklyPlan.planned_by.ilike(f"%{old_name}%")
            ).all()
            for plan in weekly_plans:
                if plan.planned_by and old_name in plan.planned_by:
                    plan.planned_by = plan.planned_by.replace(old_name, new_name)
                    update_count += 1
            
            # Update PlannedTask.assigned_by
            planned_tasks = db.query(PlannedTask).filter(
                PlannedTask.assigned_by.ilike(f"%{old_name}%")
            ).all()
            for task in planned_tasks:
                if task.assigned_by and old_name in task.assigned_by:
                    task.assigned_by = task.assigned_by.replace(old_name, new_name)
                    update_count += 1
        
        # If lead field changed, update all employees who have the same lead value
        # This ensures consistency when a lead name is corrected
        if 'lead' in update_data and old_lead and new_lead and old_lead != new_lead:
            # Only update if the old lead exactly matches (to avoid partial matches)
            employees_with_same_lead = db.query(Employee).filter(
                Employee.lead == old_lead,
                Employee.employee_id != employee.employee_id  # Don't update the employee being edited
            ).all()
            for emp in employees_with_same_lead:
                emp.lead = new_lead
                update_count += 1
        
        # If manager field changed, update all employees who have the same manager value
        # This ensures consistency when a manager name is corrected
        if 'manager' in update_data and old_manager and new_manager and old_manager != new_manager:
            # Only update if the old manager exactly matches (to avoid partial matches)
            employees_with_same_manager = db.query(Employee).filter(
                Employee.manager == old_manager,
                Employee.employee_id != employee.employee_id  # Don't update the employee being edited
            ).all()
            for emp in employees_with_same_manager:
                emp.manager = new_manager
                update_count += 1
        
        employee.updated_on = datetime.utcnow()
        db.commit()
        
        message = f"Employee updated successfully"
        if update_count > 0:
            message += f". Updated {update_count} related record(s)."
        
        return {"message": message, "related_records_updated": update_count}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@app.post("/employees/{employee_id}/photo")
async def upload_employee_photo(
    employee_id: str,
    request: Request,
    file: UploadFile = File(...)
):
    """Upload and save employee profile photo."""
    db: Session = SessionLocal()
    try:
        employee = db.query(Employee).filter(Employee.employee_id == employee_id).first()
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found")

        if not file.content_type or not file.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="Invalid file type. Please upload an image.")

        filename = file.filename or ""
        ext = os.path.splitext(filename)[1].lower()
        allowed_exts = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
        if ext and ext not in allowed_exts:
            raise HTTPException(status_code=400, detail="Unsupported image format.")

        if not ext:
            content_map = {
                "image/jpeg": ".jpg",
                "image/png": ".png",
                "image/webp": ".webp",
                "image/gif": ".gif"
            }
            ext = content_map.get(file.content_type, ".jpg")

        timestamp = int(datetime.utcnow().timestamp())
        safe_filename = f"{employee_id}_{timestamp}{ext}"
        file_path = os.path.join(PROFILE_PHOTO_DIR, safe_filename)

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        base_url = str(request.base_url).rstrip("/")
        photo_url = f"{base_url}/uploads/profile_photos/{safe_filename}"

        employee.photo_url = photo_url
        employee.updated_on = datetime.utcnow()
        db.commit()

        return {"photo_url": photo_url}
    finally:
        db.close()


@app.delete("/employees/{employee_id}")
def delete_employee(employee_id: str):
    """Soft delete an employee (set is_active=False)"""
    db: Session = SessionLocal()
    try:
        employee = db.query(Employee).filter(
            or_(
                Employee.employee_id == employee_id,
                Employee.id == int(employee_id) if employee_id.isdigit() else False
            )
        ).first()
        
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found")
        
        employee.is_active = False
        employee.updated_on = datetime.utcnow()
        db.commit()
        
        return {"message": "Employee deactivated successfully"}
    finally:
        db.close()


@app.post("/employees/import")
async def import_employees(file: UploadFile = File(...)):
    """Import employees from Excel file"""
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="File must be an Excel file (.xlsx or .xls)")
    
    # Save to temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx') as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name
    
    try:
        from sync_employees_to_db import import_employees as do_import
        success, imported, updated = do_import(tmp_path)
        
        if success:
            return {
                "success": True,
                "message": f"Import completed: {imported} new, {updated} updated",
                "imported": imported,
                "updated": updated
            }
        else:
            raise HTTPException(status_code=500, detail="Import failed")
    finally:
        os.unlink(tmp_path)


# ===== EMPLOYEE PERFORMANCE ENDPOINTS =====

@app.get("/employees/{employee_id}/performance")
def get_employee_performance(
    employee_id: str,
    period: str = Query("overall", description="past_week, past_month, past_quarter, one_year, overall")
):
    """Get comprehensive performance metrics for an employee"""
    db: Session = SessionLocal()
    try:
        # Get employee
        employee = db.query(Employee).filter(
            or_(
                Employee.employee_id == employee_id,
                Employee.id == int(employee_id) if employee_id.isdigit() else False
            )
        ).first()
        
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found")

        start_date, end_date = get_date_range(period)
        employee_name = employee.name
        is_dev = employee.team == "DEVELOPMENT"
        
        # Build base response
        result = {
            "employee": {
                "id": employee.id,
                "employee_id": employee.employee_id,
                "name": employee.name,
                "team": employee.team,
                "role": employee.role,
                "category": employee.category,
                "lead": employee.lead,
                "experience_years": calculate_experience_years(employee.date_of_joining)
            },
            "period": period,
            "metrics": {}
        }
        
        # ===== TICKET METRICS (from ticket_tracking) =====
        ticket_query = db.query(TicketTracking)
        
        if is_dev:
            ticket_query = ticket_query.filter(
                or_(
                    TicketTracking.backend_developer.ilike(f"%{employee_name}%"),
                    TicketTracking.frontend_developer.ilike(f"%{employee_name}%")
                )
            )
        else:  # QA
            ticket_query = ticket_query.filter(
                TicketTracking.qc_tester.ilike(f"%{employee_name}%")
            )
        
        if start_date:
            ticket_query = ticket_query.filter(TicketTracking.updated_on >= start_date)
        
        tickets = ticket_query.all()
        ticket_ids = [t.ticket_id for t in tickets]
        
        # Calculate estimate vs actual
        total_estimate = sum(t.dev_estimate_hours or 0 for t in tickets) if is_dev else sum(t.qa_estimate_hours or 0 for t in tickets)
        total_actual = sum(t.actual_dev_hours or 0 for t in tickets) if is_dev else sum(t.actual_qa_hours or 0 for t in tickets)
        
        result["metrics"]["tickets"] = {
            "count": len(tickets),
            "ticket_ids": ticket_ids[:50],  # Limit to 50
            "estimate_hours": round(total_estimate, 1),
            "actual_hours": round(total_actual, 1),
            "estimate_accuracy": round((total_estimate / total_actual * 100), 1) if total_actual > 0 else 100
        }
        
        # ===== BUG METRICS (from bugs) =====
        bug_query = db.query(Bug)
        
        if is_dev:
            bug_query = bug_query.filter(Bug.assignee.ilike(f"%{employee_name}%"))
        else:  # QA - bugs reported by this person
            bug_query = bug_query.filter(Bug.author.ilike(f"%{employee_name}%"))
        
        if start_date:
            bug_query = bug_query.filter(Bug.created_on >= start_date)
        
        bugs = bug_query.all()
        total_bugs = len(bugs)
        
        if total_bugs > 0:
            # Status breakdown
            closed_bugs = len([b for b in bugs if b.status == "Closed"])
            reopened_bugs = len([b for b in bugs if b.status == "Reopened"])
            rejected_bugs = len([b for b in bugs if b.status == "Rejected"])
            
            # Severity breakdown
            critical_bugs = len([b for b in bugs if b.severity == "Critical"])
            major_bugs = len([b for b in bugs if b.severity == "Major"])
            minor_bugs = len([b for b in bugs if b.severity == "Minor"])
            
            # Environment breakdown
            live_bugs = len([b for b in bugs if b.environment == "Live"])
            pre_bugs = len([b for b in bugs if b.environment == "Pre"])
            staging_bugs = len([b for b in bugs if b.environment == "Staging"])
            
            # Bug ageing (for open bugs)
            open_bugs = [b for b in bugs if b.status not in ["Closed", "Rejected"]]
            ages = []
            for bug in open_bugs:
                if bug.created_on:
                    age = (datetime.now() - bug.created_on).days
                    ages.append(age)
            avg_ageing = round(sum(ages) / len(ages), 1) if ages else 0
            
            # Resolution time (for closed bugs)
            resolution_times = []
            for bug in bugs:
                if bug.status == "Closed" and bug.created_on and bug.closed_on:
                    days = (bug.closed_on - bug.created_on).days
                    resolution_times.append(days)
            avg_resolution = round(sum(resolution_times) / len(resolution_times), 1) if resolution_times else 0
            
            # Modules expertise
            modules = list(set(b.module for b in bugs if b.module))
            
            # Bug types
            bug_types = defaultdict(int)
            for bug in bugs:
                tracker = bug.tracker or "Unknown"
                bug_types[tracker] += 1
            
            result["metrics"]["bugs"] = {
                "total": total_bugs,
                "closed": closed_bugs,
                "reopened": reopened_bugs,
                "rejected": rejected_bugs,
                "closure_rate": round((closed_bugs / total_bugs * 100), 1),
                "reopened_percent": round((reopened_bugs / total_bugs * 100), 1),
                "rejected_percent": round((rejected_bugs / total_bugs * 100), 1),
                "severity": {
                    "critical": critical_bugs,
                    "critical_percent": round((critical_bugs / total_bugs * 100), 1),
                    "major": major_bugs,
                    "minor": minor_bugs
                },
                "environment": {
                    "live": live_bugs,
                    "live_percent": round((live_bugs / total_bugs * 100), 1),
                    "pre": pre_bugs,
                    "pre_percent": round((pre_bugs / total_bugs * 100), 1),
                    "staging": staging_bugs,
                    "staging_percent": round((staging_bugs / total_bugs * 100), 1)
                },
                "avg_ageing_days": avg_ageing,
                "avg_resolution_days": avg_resolution,
                "modules_expertise": modules[:15],
                "bug_types": dict(bug_types)
            }
        else:
            result["metrics"]["bugs"] = {"total": 0}
        
        # ===== TESTRAIL METRICS (QA only) =====
        if not is_dev:
            test_query = db.query(TestResult).filter(
                TestResult.assigned_to.ilike(f"%{employee_name}%")
            )
            
            if start_date:
                test_query = test_query.filter(TestResult.created_on >= start_date)
            
            test_results = test_query.all()
            total_tests = len(test_results)
            
            if total_tests > 0:
                passed = len([t for t in test_results if t.status_name == "Passed"])
                failed = len([t for t in test_results if t.status_name == "Failed"])
                blocked = len([t for t in test_results if t.status_name == "Blocked"])
                
                # Unique test runs
                unique_runs = len(set(t.run_id for t in test_results if t.run_id))
                
                result["metrics"]["tests"] = {
                    "total_executed": total_tests,
                    "passed": passed,
                    "failed": failed,
                    "blocked": blocked,
                    "pass_rate": round((passed / total_tests * 100), 1),
                    "fail_rate": round((failed / total_tests * 100), 1),
                    "blocked_percent": round((blocked / total_tests * 100), 1),
                    "test_runs_participated": unique_runs
                }
                
                # Bugs per ticket
                if len(ticket_ids) > 0:
                    result["metrics"]["bugs_per_ticket"] = round(total_bugs / len(ticket_ids), 1)
            else:
                result["metrics"]["tests"] = {"total_executed": 0}
        
        # ===== TIMESHEET METRICS =====
        timesheet_query = db.query(Timesheet).filter(
            Timesheet.employee_name.ilike(f"%{employee_name}%")
        )
        
        if start_date:
            timesheet_query = timesheet_query.filter(Timesheet.date >= start_date.date())
        
        timesheets = timesheet_query.all()
        
        total_minutes = sum(t.time_logged_minutes or 0 for t in timesheets)
        total_hours = round(total_minutes / 60, 1)
        
        # Calculate working days in period
        if start_date:
            working_days = sum(1 for i in range((end_date - start_date).days + 1) 
                             if (start_date + timedelta(days=i)).weekday() < 5)
        else:
            working_days = 250  # Approximate yearly working days
        
        expected_hours = working_days * 8
        
        result["metrics"]["timesheet"] = {
            "total_hours": total_hours,
            "expected_hours": expected_hours,
            "utilization_percent": round((total_hours / expected_hours * 100), 1) if expected_hours > 0 else 0,
            "avg_daily_hours": round(total_hours / working_days, 1) if working_days > 0 else 0,
            "entries_count": len(timesheets)
        }
        
        # ===== RAG SCORE CALCULATION =====
        rag_score = calculate_rag_score(result["metrics"], is_dev)
        result["rag_status"] = {
            "score": rag_score,
            "status": "GREEN" if rag_score >= 70 else "AMBER" if rag_score >= 50 else "RED"
        }
        
        return result
    finally:
        db.close()


def calculate_rag_score(metrics, is_dev):
    """Calculate RAG score based on metrics"""
    score = 0
    weights_used = 0
    
    bugs = metrics.get("bugs", {})
    timesheet = metrics.get("timesheet", {})
    tickets = metrics.get("tickets", {})
    
    if is_dev:
        # Closure rate (25%)
        if bugs.get("total", 0) > 0:
            closure_rate = bugs.get("closure_rate", 0)
            score += (closure_rate / 100) * 25
            weights_used += 25
        
        # Re-opened % inverse (20%)
        if bugs.get("total", 0) > 0:
            reopened_pct = bugs.get("reopened_percent", 0)
            reopened_score = max(0, 100 - (reopened_pct * 5))  # Penalize heavily
            score += (reopened_score / 100) * 20
            weights_used += 20
        
        # Estimate accuracy (20%)
        if tickets.get("actual_hours", 0) > 0:
            accuracy = tickets.get("estimate_accuracy", 100)
            accuracy_score = 100 - abs(100 - accuracy)  # Closer to 100% is better
            score += max(0, accuracy_score / 100) * 20
            weights_used += 20
        
        # Utilization (20%)
        if timesheet.get("expected_hours", 0) > 0:
            utilization = min(100, timesheet.get("utilization_percent", 0))
            score += (utilization / 100) * 20
            weights_used += 20
        
        # Resolution time (15%) - lower is better
        if bugs.get("avg_resolution_days", 0) > 0:
            res_time = bugs.get("avg_resolution_days", 0)
            res_score = max(0, 100 - (res_time * 2))  # 50 days = 0 score
            score += (res_score / 100) * 15
            weights_used += 15
    else:  # QA
        tests = metrics.get("tests", {})
        
        # Pass rate (20%)
        if tests.get("total_executed", 0) > 0:
            pass_rate = tests.get("pass_rate", 0)
            score += (pass_rate / 100) * 20
            weights_used += 20
        
        # Bugs per ticket (25%) - higher is generally better for QA
        bugs_per_ticket = metrics.get("bugs_per_ticket", 0)
        if bugs_per_ticket > 0:
            bpt_score = min(100, bugs_per_ticket * 20)  # 5+ bugs/ticket = 100
            score += (bpt_score / 100) * 25
            weights_used += 25
        
        # Rejected % inverse (15%)
        if bugs.get("total", 0) > 0:
            rejected_pct = bugs.get("rejected_percent", 0)
            rejected_score = max(0, 100 - (rejected_pct * 5))
            score += (rejected_score / 100) * 15
            weights_used += 15
        
        # Utilization (20%)
        if timesheet.get("expected_hours", 0) > 0:
            utilization = min(100, timesheet.get("utilization_percent", 0))
            score += (utilization / 100) * 20
            weights_used += 20
        
        # Critical bugs found (20%) - higher is better for QA
        if bugs.get("total", 0) > 0:
            critical_pct = bugs.get("severity", {}).get("critical_percent", 0)
            critical_score = min(100, critical_pct * 5)  # Finding critical bugs is good
            score += (critical_score / 100) * 20
            weights_used += 20
    
    # Normalize to 100 if not all weights were used
    if weights_used > 0:
        score = (score / weights_used) * 100
    
    return round(score, 1)


@app.get("/employees/{employee_id}/timesheet-summary")
def get_employee_timesheet_summary(
    employee_id: str,
    period: str = Query("past_month")
):
    """Get detailed timesheet summary for an employee"""
    db: Session = SessionLocal()
    try:
        employee = db.query(Employee).filter(
            or_(
                Employee.employee_id == employee_id,
                Employee.id == int(employee_id) if employee_id.isdigit() else False
            )
        ).first()
        
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found")

        start_date, end_date = get_date_range(period)
        
        query = db.query(Timesheet).filter(
            Timesheet.employee_name.ilike(f"%{employee.name}%")
        )
        
        if start_date:
            query = query.filter(Timesheet.date >= start_date.date())
        
        timesheets = query.order_by(Timesheet.date.desc()).all()
        
        # Daily breakdown
        daily_data = defaultdict(int)
        ticket_hours = defaultdict(int)
        
        for ts in timesheets:
            day_key = ts.date.isoformat() if ts.date else "unknown"
            daily_data[day_key] += ts.time_logged_minutes or 0
            if ts.ticket_id:
                ticket_hours[ts.ticket_id] += ts.time_logged_minutes or 0
        
        # Convert to hours
        daily_hours = {k: round(v / 60, 2) for k, v in daily_data.items()}
        ticket_hours_formatted = {k: round(v / 60, 2) for k, v in ticket_hours.items()}
        
        total_minutes = sum(daily_data.values())
        
        return {
            "employee_name": employee.name,
            "period": period,
            "total_hours": round(total_minutes / 60, 1),
            "total_entries": len(timesheets),
            "unique_tickets": len(ticket_hours),
            "daily_hours": dict(sorted(daily_hours.items(), reverse=True)[:30]),
            "ticket_hours": dict(sorted(ticket_hours_formatted.items(), key=lambda x: x[1], reverse=True)[:20])
        }
    finally:
        db.close()


@app.get("/employees/{employee_id}/rag-history")
def get_employee_rag_history(employee_id: str):
    """
    Get historical RAG scores for an employee across different time periods.
    This allows showing RAG trend over time.
    """
    db: Session = SessionLocal()
    try:
        # Find employee
        employee = db.query(Employee).filter(
            or_(
                Employee.employee_id == employee_id,
                Employee.id == int(employee_id) if employee_id.isdigit() else False
            )
        ).first()
        
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found")

        is_dev = employee.team == "DEVELOPMENT"
        employee_name = employee.name
        
        # Calculate RAG scores for different periods
        periods = ["past_week", "past_month", "past_quarter", "one_year"]
        period_labels = {
            "past_week": "Past Week",
            "past_month": "Past Month", 
            "past_quarter": "Past Quarter",
            "one_year": "Past Year"
        }
        
        rag_history = []
        
        for period in periods:
            start_date, end_date = get_date_range(period)
            
            # Get bugs for this period
            if is_dev:
                # DEV: bugs assigned to them
                bugs_query = db.query(Bug).filter(
                    Bug.assignee.ilike(f"%{employee_name}%")
                )
            else:
                # QA: bugs reported by them
                bugs_query = db.query(Bug).filter(
                    Bug.author.ilike(f"%{employee_name}%")
                )
            if start_date:
                bugs_query = bugs_query.filter(Bug.created_on >= start_date)
            bugs = bugs_query.all()
            
            # Get test results for QA
            tests = []
            if not is_dev:
                tests_query = db.query(TestResult).filter(
                    TestResult.assigned_to.ilike(f"%{employee_name}%")
                )
                if start_date:
                    tests_query = tests_query.filter(TestResult.created_on >= start_date)
                tests = tests_query.all()
            
            # Get timesheets
            ts_query = db.query(Timesheet).filter(
                Timesheet.employee_name.ilike(f"%{employee_name}%")
            )
            if start_date:
                ts_query = ts_query.filter(Timesheet.date >= start_date.date())
            timesheets = ts_query.all()
            
            # Build simplified metrics
            total_bugs = len(bugs)
            closed_bugs = len([b for b in bugs if b.status == "Closed"])
            reopened = len([b for b in bugs if b.status == "Reopened"])
            
            metrics = {
                "bugs": {
                    "total": total_bugs,
                    "closure_rate": round((closed_bugs / total_bugs * 100) if total_bugs > 0 else 0, 1),
                    "reopened_percent": round((reopened / total_bugs * 100) if total_bugs > 0 else 0, 1),
                    "rejected_percent": round((len([b for b in bugs if b.status == "Rejected"]) / total_bugs * 100) if total_bugs > 0 else 0, 1),
                    "severity": {
                        "critical_percent": round((len([b for b in bugs if b.severity == "Critical"]) / total_bugs * 100) if total_bugs > 0 else 0, 1)
                    }
                },
                "tickets": {
                    "actual_hours": 0,
                    "estimate_accuracy": 100
                },
                "timesheet": {
                    "expected_hours": 40 if period == "past_week" else 160 if period == "past_month" else 480 if period == "past_quarter" else 2000,
                    "utilization_percent": 0
                },
                "tests": {
                    "total_executed": len(tests),
                    "pass_rate": round((len([t for t in tests if t.status_name == "Passed"]) / len(tests) * 100) if tests else 0, 1)
                },
                "bugs_per_ticket": 0
            }
            
            # Calculate timesheet utilization
            total_minutes = sum(t.time_logged_minutes or 0 for t in timesheets)
            total_hours = round(total_minutes / 60, 1)
            if metrics["timesheet"]["expected_hours"] > 0:
                metrics["timesheet"]["utilization_percent"] = round(
                    (total_hours / metrics["timesheet"]["expected_hours"] * 100), 1
                )
            
            # Calculate RAG score
            rag_score = calculate_rag_score(metrics, is_dev)
            rag_status = "GREEN" if rag_score >= 70 else "AMBER" if rag_score >= 50 else "RED"
            
            rag_history.append({
                "period": period,
                "label": period_labels[period],
                "score": rag_score,
                "status": rag_status,
                "bugs_count": total_bugs,
                "tests_count": len(tests) if not is_dev else None
            })
        
        # Also get saved reviews for historical context
        reviews = db.query(EmployeeReview).filter(
            EmployeeReview.employee_id == employee_id
        ).order_by(EmployeeReview.review_date.desc()).limit(5).all()
        
        review_history = []
        for review in reviews:
            review_history.append({
                "period": review.review_period,
                "date": review.review_date.isoformat() if review.review_date else None,
                "score": review.rag_score,
                "status": review.rag_status,
                "overall_rating": review.overall_rating
            })
        
        return {
            "employee_id": employee_id,
            "employee_name": employee_name,
            "team": employee.team,
            "current_rag": rag_history[0] if rag_history else None,
            "rag_trend": rag_history,
            "review_history": review_history
        }
    finally:
        db.close()


# ===== GOALS ENDPOINTS =====

@app.get("/employees/{employee_id}/goals")
def get_employee_goals(employee_id: str):
    """Get goals, strengths, and improvements for an employee"""
    db: Session = SessionLocal()
    try:
        employee = db.query(Employee).filter(Employee.employee_id == employee_id).first()
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found")
        goals = db.query(EmployeeGoal).filter(
            EmployeeGoal.employee_id == employee_id
        ).order_by(EmployeeGoal.created_on.desc()).all()
        
        result = {
            "goals": [],
            "strengths": [],
            "improvements": []
        }
        
        for goal in goals:
            goal_data = {
                "id": goal.id,
                "title": goal.title,
                "description": goal.description,
                "target_date": goal.target_date.isoformat() if goal.target_date else None,
                "status": goal.status,
                "progress": goal.progress,
                "created_by": goal.created_by,
                "created_on": goal.created_on.isoformat() if goal.created_on else None
            }
            
            if goal.goal_type == "goal":
                result["goals"].append(goal_data)
            elif goal.goal_type == "strength":
                result["strengths"].append(goal_data)
            elif goal.goal_type == "improvement":
                result["improvements"].append(goal_data)
        
        return result
    finally:
        db.close()


@app.post("/employees/{employee_id}/goals")
def create_employee_goal(employee_id: str, goal: GoalCreate):
    """Create a new goal, strength, or improvement"""
    db: Session = SessionLocal()
    try:
        employee = db.query(Employee).filter(Employee.employee_id == employee_id).first()
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found")
        new_goal = EmployeeGoal(
            employee_id=employee_id,
            goal_type=goal.goal_type,
            title=goal.title,
            description=goal.description,
            target_date=goal.target_date,
            status="active",
            progress=0,
            created_by=goal.created_by,
            created_on=datetime.utcnow()
        )
        
        db.add(new_goal)
        db.commit()
        db.refresh(new_goal)
        
        return {"message": "Goal created successfully", "id": new_goal.id}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@app.put("/goals/{goal_id}")
def update_goal(goal_id: int, updates: GoalUpdate):
    """Update a goal"""
    db: Session = SessionLocal()
    try:
        goal = db.query(EmployeeGoal).filter(EmployeeGoal.id == goal_id).first()
        
        if not goal:
            raise HTTPException(status_code=404, detail="Goal not found")
        
        update_data = updates.dict(exclude_unset=True)
        for field, value in update_data.items():
            if value is not None:
                setattr(goal, field, value)
        
        goal.updated_on = datetime.utcnow()
        db.commit()
        
        return {"message": "Goal updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@app.delete("/goals/{goal_id}")
def delete_goal(goal_id: int):
    """Delete a goal"""
    db: Session = SessionLocal()
    try:
        goal = db.query(EmployeeGoal).filter(EmployeeGoal.id == goal_id).first()
        
        if not goal:
            raise HTTPException(status_code=404, detail="Goal not found")
        
        db.delete(goal)
        db.commit()
        
        return {"message": "Goal deleted successfully"}
    finally:
        db.close()


# ===== REVIEW ENDPOINTS =====

@app.get("/employees/{employee_id}/reportees")
def get_employee_reportees(employee_id: str):
    """Get direct and indirect reportees for a lead/manager"""
    db: Session = SessionLocal()
    try:
        employee = db.query(Employee).filter(
            or_(
                Employee.employee_id == employee_id,
                Employee.id == int(employee_id) if employee_id.isdigit() else False
            )
        ).first()
        
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found")

        # Find direct reportees - employees where this person is the lead
        direct_reportees = db.query(Employee).filter(
            Employee.lead.ilike(f"%{employee.name}%"),
            Employee.is_active == True,
            Employee.employee_id != employee.employee_id  # Exclude self
        ).order_by(Employee.name).all()
        
        # Find indirect reportees - employees where this person is the manager but NOT the lead
        indirect_reportees = db.query(Employee).filter(
            Employee.manager.ilike(f"%{employee.name}%"),
            ~Employee.lead.ilike(f"%{employee.name}%"),  # Not already a direct reportee
            Employee.is_active == True,
            Employee.employee_id != employee.employee_id  # Exclude self
        ).order_by(Employee.name).all()
        
        # Also get employees reporting to the direct reportees (for managers)
        # These are people whose lead reports to this manager
        manager_indirect = []
        for direct in direct_reportees:
            # Find people who report to this direct reportee
            sub_reportees = db.query(Employee).filter(
                Employee.lead.ilike(f"%{direct.name}%"),
                Employee.is_active == True,
                Employee.employee_id != direct.employee_id
            ).all()
            for sub in sub_reportees:
                if sub.employee_id not in [d.employee_id for d in direct_reportees]:
                    if sub.employee_id not in [m.employee_id for m in manager_indirect]:
                        manager_indirect.append(sub)
        
        return {
            "direct_reportees": [{
                "employee_id": emp.employee_id,
                "name": emp.name,
                "role": emp.role,
                "team": emp.team,
                "email": emp.email,
                "category": emp.category
            } for emp in direct_reportees],
            "indirect_reportees": [{
                "employee_id": emp.employee_id,
                "name": emp.name,
                "role": emp.role,
                "team": emp.team,
                "email": emp.email,
                "category": emp.category,
                "reports_to": emp.lead
            } for emp in indirect_reportees + manager_indirect],
            "total_direct": len(direct_reportees),
            "total_indirect": len(indirect_reportees) + len(manager_indirect)
        }
    finally:
        db.close()


@app.get("/team-leads")
def get_team_leads():
    """Get DEV Lead and QA Lead information"""
    db: Session = SessionLocal()
    try:
        # Find DEV Lead (role contains LEAD and team is DEVELOPMENT)
        dev_lead = db.query(Employee).filter(
            func.upper(Employee.role).like("%LEAD%"),
            func.upper(Employee.team) == "DEVELOPMENT",
            Employee.is_active == True
        ).first()
        
        # Find QA Lead/Manager (role contains QA and (MANAGER or LEAD) and team is QA)
        qa_lead = db.query(Employee).filter(
            or_(
                func.upper(Employee.role).like("%QA%MANAGER%"),
                func.upper(Employee.role).like("%QA%LEAD%")
            ),
            func.upper(Employee.team) == "QA",
            Employee.is_active == True
        ).first()
        
        result = {}
        
        if dev_lead:
            result["dev_lead"] = {
                "employee_id": dev_lead.employee_id,
                "name": dev_lead.name,
                "email": dev_lead.email,
                "role": dev_lead.role
            }
        else:
            result["dev_lead"] = None
            
        if qa_lead:
            result["qa_lead"] = {
                "employee_id": qa_lead.employee_id,
                "name": qa_lead.name,
                "email": qa_lead.email,
                "role": qa_lead.role
            }
        else:
            result["qa_lead"] = None
        
        return result
    finally:
        db.close()


@app.get("/employees/{employee_id}/reviews")
def get_employee_reviews(employee_id: str):
    """Get all reviews for an employee"""
    db: Session = SessionLocal()
    try:
        employee = db.query(Employee).filter(Employee.employee_id == employee_id).first()
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found")

        reviews = db.query(EmployeeReview).filter(
            EmployeeReview.employee_id == employee_id
        ).order_by(EmployeeReview.review_date.desc()).all()
        
        return [
            {
                "id": r.id,
                "review_period": r.review_period,
                "review_date": r.review_date.isoformat() if r.review_date else None,
                "rag_status": r.rag_status,
                "rag_score": r.rag_score,
                "technical_rating": r.technical_rating,
                "productivity_rating": r.productivity_rating,
                "quality_rating": r.quality_rating,
                "communication_rating": r.communication_rating,
                "overall_rating": r.overall_rating,
                "strengths_summary": r.strengths_summary,
                "improvements_summary": r.improvements_summary,
                "manager_comments": r.manager_comments,
                "recommendation": r.recommendation,
                "salary_hike_percent": r.salary_hike_percent,
                "reviewed_by": r.reviewed_by
            }
            for r in reviews
        ]
    finally:
        db.close()


@app.post("/employees/{employee_id}/reviews")
def create_employee_review(employee_id: str, review: ReviewCreate):
    """Create a new performance review"""
    db: Session = SessionLocal()
    try:
        # Calculate overall rating
        overall = (review.technical_rating + review.productivity_rating + 
                   review.quality_rating + review.communication_rating) / 4
        
        # Get current RAG score
        employee = db.query(Employee).filter(Employee.employee_id == employee_id).first()
        rag_score = 0
        rag_status = "AMBER"
        
        if employee:
            # Calculate RAG from performance metrics
            try:
                perf = get_employee_performance(employee_id, "one_year")
                rag_score = perf.get("rag_status", {}).get("score", 0)
                rag_status = perf.get("rag_status", {}).get("status", "AMBER")
            except:
                pass
        
        new_review = EmployeeReview(
            employee_id=employee_id,
            review_period=review.review_period,
            review_date=review.review_date,
            rag_status=rag_status,
            rag_score=rag_score,
            technical_rating=review.technical_rating,
            productivity_rating=review.productivity_rating,
            quality_rating=review.quality_rating,
            communication_rating=review.communication_rating,
            overall_rating=round(overall, 1),
            strengths_summary=review.strengths_summary,
            improvements_summary=review.improvements_summary,
            manager_comments=review.manager_comments,
            recommendation=review.recommendation,
            salary_hike_percent=review.salary_hike_percent,
            reviewed_by=review.reviewed_by,
            created_on=datetime.utcnow()
        )
        
        db.add(new_review)
        db.commit()
        db.refresh(new_review)
        
        return {"message": "Review created successfully", "id": new_review.id}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@app.put("/reviews/{review_id}")
def update_review(review_id: int, review: ReviewCreate):
    """Update a performance review"""
    db: Session = SessionLocal()
    try:
        existing = db.query(EmployeeReview).filter(EmployeeReview.id == review_id).first()
        
        if not existing:
            raise HTTPException(status_code=404, detail="Review not found")
        
        overall = (review.technical_rating + review.productivity_rating + 
                   review.quality_rating + review.communication_rating) / 4
        
        existing.review_period = review.review_period
        existing.review_date = review.review_date
        existing.technical_rating = review.technical_rating
        existing.productivity_rating = review.productivity_rating
        existing.quality_rating = review.quality_rating
        existing.communication_rating = review.communication_rating
        existing.overall_rating = round(overall, 1)
        existing.strengths_summary = review.strengths_summary
        existing.improvements_summary = review.improvements_summary
        existing.manager_comments = review.manager_comments
        existing.recommendation = review.recommendation
        existing.salary_hike_percent = review.salary_hike_percent
        existing.reviewed_by = review.reviewed_by
        existing.updated_on = datetime.utcnow()
        
        db.commit()
        
        return {"message": "Review updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


# ===== KPI MANAGEMENT ENDPOINTS =====

@app.post("/kpis/import")
async def import_kpi_matrix(file: UploadFile = File(...)):
    """Import KPI matrix from Excel file with multiple sheets (one per role)"""
    db: Session = SessionLocal()
    try:
        import openpyxl
        import re
        
        # Save uploaded file temporarily
        with tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx') as tmp_file:
            content = await file.read()
            tmp_file.write(content)
            tmp_path = tmp_file.name
        
        try:
            workbook = openpyxl.load_workbook(tmp_path)
            
            # Map sheet names to role names (normalize to match database)
            role_mapping = {
                'Software Engineer': 'SOFTWARE ENGINEER',
                'Lead': 'LEAD',
                'Project Manager': 'PROJECT MANAGER',
                'Department Heads': 'DEPARTMENT HEAD',
                'QA Engineer': 'QA ENGINEER',
                'QA Manager': 'QA MANAGER'
            }
            
            # Determine team from role
            def get_team_from_role(role_name):
                if 'QA' in role_name.upper():
                    return 'QA'
                elif 'SOFTWARE ENGINEER' in role_name.upper() or 'LEAD' in role_name.upper():
                    return 'DEVELOPMENT'
                else:
                    return None  # For PM, Department Heads, etc.
            
            total_imported = 0
            total_updated = 0
            sheet_summary = []
            
            # Process each sheet (each sheet represents a role)
            for sheet_name in workbook.sheetnames:
                sheet = workbook[sheet_name]
                role_name = role_mapping.get(sheet_name, sheet_name.upper())
                team = get_team_from_role(role_name)
                
                imported_count = 0
                updated_count = 0
                current_kra_group = None
                
                # Process rows starting from row 3 (row 1 is empty, row 2 might be header or first data)
                for row_idx, row in enumerate(sheet.iter_rows(min_row=2, values_only=True), start=2):
                    # Skip if KPI name (column B) is empty
                    if not row[1] or not str(row[1]).strip():
                        # If KRA Group (column A) has value, update current KRA
                        if row[0] and str(row[0]).strip():
                            current_kra_group = str(row[0]).strip()
                        continue
                    
                    # Extract data from columns
                    # Column A: KRA Group (category)
                    # Column B: KPI Name
                    # Column C: Weight %
                    # Column F: Evaluation Guideline (description)
                    
                    kpi_name = str(row[1]).strip()
                    if not kpi_name or kpi_name.lower() in ['kpi', 'none']:
                        continue
                    
                    # Use KRA Group from column A, or current_kra_group, or None
                    category = None
                    if row[0] and str(row[0]).strip():
                        category = str(row[0]).strip()
                        current_kra_group = category
                    elif current_kra_group:
                        category = current_kra_group
                    
                    # Weight from column C (convert percentage to decimal if needed)
                    weight_value = row[2]
                    if weight_value is not None:
                        try:
                            weight = float(weight_value)
                            # If weight is > 1, assume it's a percentage, convert to decimal
                            if weight > 1:
                                weight = weight / 100.0
                        except (ValueError, TypeError):
                            weight = 1.0
                    else:
                        weight = 1.0
                    
                    # Description from column F (Evaluation Guideline)
                    description = None
                    if len(row) > 5 and row[5]:
                        description = str(row[5]).strip()
                    
                    # Generate KPI code from name (sanitize and make unique)
                    role_prefix = role_name.replace(' ', '_')[:30]
                    kpi_code_base = re.sub(r'[^a-zA-Z0-9]', '_', kpi_name.upper())[:65]
                    kpi_code = f"{role_prefix}_{kpi_code_base}"[:100]  # Ensure total length <= 100
                    
                    # Check if KPI already exists
                    existing = db.query(KPI).filter(
                        KPI.kpi_code == kpi_code
                    ).first()
                    
                    if existing:
                        # Update existing
                        existing.kpi_name = kpi_name
                        existing.description = description
                        existing.role = role_name
                        existing.team = team
                        existing.category = category
                        existing.weight = weight
                        updated_count += 1
                    else:
                        # Create new
                        new_kpi = KPI(
                            kpi_code=kpi_code,
                            kpi_name=kpi_name,
                            description=description,
                            role=role_name,
                            team=team,
                            category=category,
                            weight=weight
                        )
                        db.add(new_kpi)
                        db.flush()  # Flush to avoid bulk insert conflicts
                        imported_count += 1
                
                total_imported += imported_count
                total_updated += updated_count
                sheet_summary.append({
                    "sheet": sheet_name,
                    "role": role_name,
                    "imported": imported_count,
                    "updated": updated_count
                })
            
            db.commit()
            
            return {
                "message": "KPI matrix imported successfully",
                "imported": total_imported,
                "updated": total_updated,
                "total": total_imported + total_updated,
                "sheets_processed": len(workbook.sheetnames),
                "sheet_details": sheet_summary
            }
        finally:
            os.unlink(tmp_path)
            
    except Exception as e:
        db.rollback()
        import traceback
        error_detail = f"Error importing KPI matrix: {str(e)}\n{traceback.format_exc()}"
        raise HTTPException(status_code=500, detail=error_detail)
    finally:
        db.close()


@app.get("/kpis")
def list_kpis(role: Optional[str] = None, team: Optional[str] = None):
    """Get all KPIs, optionally filtered by role and team"""
    db: Session = SessionLocal()
    try:
        query = db.query(KPI).filter(KPI.is_active == True)
        
        if role:
            query = query.filter(KPI.role == role)
        if team:
            query = query.filter(KPI.team == team)
        
        kpis = query.order_by(KPI.category, KPI.kpi_name).all()
        
        return [{
            "id": k.id,
            "kpi_code": k.kpi_code,
            "kpi_name": k.kpi_name,
            "description": k.description,
            "role": k.role,
            "team": k.team,
            "category": k.category,
            "weight": k.weight
        } for k in kpis]
    finally:
        db.close()


@app.get("/employees/{employee_id}/kpis")
def get_employee_kpis(employee_id: str):
    """Get all KPIs applicable to an employee based on their role and team"""
    db: Session = SessionLocal()
    try:
        employee = db.query(Employee).filter(
            or_(
                Employee.employee_id == employee_id,
                Employee.id == int(employee_id) if employee_id.isdigit() else False
            )
        ).first()
        
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found")

        if not employee.role:
            return []  # No role means no KPIs
        
        # Normalize role for comparison (uppercase)
        employee_role = employee.role.upper().strip()
        
        # Get KPIs that match the employee's role exactly (case-insensitive)
        query = db.query(KPI).filter(
            KPI.is_active == True,
            func.upper(func.trim(KPI.role)) == employee_role
        )
        
        # Filter by team: match exact team OR if KPI.team is None (applies to all teams)
        if employee.team:
            # Normalize team for comparison (uppercase)
            employee_team = employee.team.upper().strip()
            query = query.filter(
                or_(
                    func.upper(func.trim(KPI.team)) == employee_team,
                    KPI.team.is_(None)
                )
            )
        else:
            # If employee has no team, only show KPIs with no team specified
            query = query.filter(KPI.team.is_(None))
        
        kpis = query.order_by(KPI.category, KPI.kpi_name).all()
        
        return [{
            "id": k.id,
            "kpi_code": k.kpi_code,
            "kpi_name": k.kpi_name,
            "description": k.description,
            "category": k.category,
            "weight": k.weight
        } for k in kpis]
    finally:
        db.close()


@app.get("/employees/{employee_id}/kpi-ratings")
def get_employee_kpi_ratings(employee_id: str, quarter: Optional[str] = None):
    """Get KPI ratings for an employee, optionally filtered by quarter"""
    db: Session = SessionLocal()
    try:
        employee = db.query(Employee).filter(
            or_(
                Employee.employee_id == employee_id,
                Employee.id == int(employee_id) if employee_id.isdigit() else False
            )
        ).first()
        
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found")

        # Get current year and quarter if not specified
        if not quarter:
            now = datetime.now()
            year = now.year
            quarter_num = (now.month - 1) // 3 + 1
            quarter = f"{year}-Q{quarter_num}"
        
        # Get all KPIs for this employee - match role and team exactly
        if not employee.role:
            return {"kpis": [], "quarter": quarter}
        
        # Normalize role for comparison (uppercase)
        employee_role = employee.role.upper().strip()
        
        query = db.query(KPI).filter(
            KPI.is_active == True,
            func.upper(func.trim(KPI.role)) == employee_role
        )
        
        # Filter by team: match exact team OR if KPI.team is None (applies to all teams)
        if employee.team:
            # Normalize team for comparison (uppercase)
            employee_team = employee.team.upper().strip()
            query = query.filter(
                or_(
                    func.upper(func.trim(KPI.team)) == employee_team,
                    KPI.team.is_(None)
                )
            )
        else:
            # If employee has no team, only show KPIs with no team specified
            query = query.filter(KPI.team.is_(None))
        
        kpis = query.order_by(KPI.category, KPI.kpi_name).all()
        
        # Get ratings for this quarter
        ratings_query = db.query(KPIRating).filter(
            KPIRating.employee_id == employee.employee_id,
            KPIRating.quarter == quarter
        )
        ratings = {r.kpi_id: r for r in ratings_query.all()}
        
        # Calculate overall weighted score
        total_weighted_score = 0.0
        total_weight = 0.0
        rated_kpis_count = 0
        
        result = []
        for kpi in kpis:
            rating = ratings.get(kpi.id)
            
            # Calculate score for this KPI (use manager_rating if available, else performance_score, else 0)
            kpi_score = 0.0
            if rating:
                if rating.manager_rating is not None:
                    # Convert 1-5 scale to percentage (1=20%, 5=100%)
                    kpi_score = (rating.manager_rating / 5.0) * 100
                elif rating.performance_score is not None:
                    kpi_score = rating.performance_score
                elif rating.final_score is not None:
                    kpi_score = (rating.final_score / 5.0) * 100 if rating.final_score <= 5 else rating.final_score
                
                if kpi_score > 0:
                    total_weighted_score += kpi_score * kpi.weight
                    total_weight += kpi.weight
                    rated_kpis_count += 1
            
            result.append({
                "kpi_id": kpi.id,
                "kpi_code": kpi.kpi_code,
                "kpi_name": kpi.kpi_name,
                "description": kpi.description,
                "category": kpi.category,
                "weight": kpi.weight,
                "rating": rating.rating if rating else None,
                "self_rating": rating.self_rating if rating else None,
                "lead_rating": rating.lead_rating if rating else None,
                "manager_rating": rating.manager_rating if rating else None,
                "performance_score": rating.performance_score if rating else None,
                "performance_percentage": rating.performance_percentage if rating else None,
                "final_score": rating.final_score if rating else None,
                "self_comments": rating.self_comments if rating else None,
                "lead_comments": rating.lead_comments if rating else None,
                "manager_comments": rating.manager_comments if rating else None,
                "rated_by": rating.rated_by if rating else None,
                "rated_on": rating.rated_on.isoformat() if rating and rating.rated_on else None
            })
        
        # Calculate overall weighted average
        overall_score = 0.0
        overall_rating_label = "Not Rated"
        
        if total_weight > 0 and rated_kpis_count > 0:
            overall_score = total_weighted_score / total_weight
            
            # Determine rating label based on score
            if overall_score >= 90:
                overall_rating_label = "Outstanding"
            elif overall_score >= 80:
                overall_rating_label = "Excellent"
            elif overall_score >= 70:
                overall_rating_label = "Good"
            elif overall_score >= 60:
                overall_rating_label = "Satisfactory"
            elif overall_score >= 50:
                overall_rating_label = "Needs Improvement"
            else:
                overall_rating_label = "Poor"
        
        return {
            "employee_id": employee.employee_id,
            "employee_name": employee.name,
            "role": employee.role,
            "quarter": quarter,
            "kpis": result,
            "overall_score": round(overall_score, 2),
            "overall_rating": overall_rating_label,
            "rated_kpis_count": rated_kpis_count,
            "total_kpis_count": len(kpis)
        }
    finally:
        db.close()


@app.post("/employees/{employee_id}/kpi-ratings")
def submit_kpi_ratings(
    employee_id: str,
    ratings: List[KPIRatingCreate]
):
    """Submit KPI ratings for an employee for a quarter"""
    db: Session = SessionLocal()
    try:
        employee = db.query(Employee).filter(
            or_(
                Employee.employee_id == employee_id,
                Employee.id == int(employee_id) if employee_id.isdigit() else False
            )
        ).first()
        
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found")

        # Parse quarter to get year and quarter number
        quarter = ratings[0].quarter if ratings else None
        if not quarter:
            raise HTTPException(status_code=400, detail="Quarter is required")
        
        year = int(quarter.split('-')[0])
        quarter_num = int(quarter.split('-Q')[1])
        
        submitted_count = 0
        
        for rating_data in ratings:
            # Verify KPI exists
            kpi = db.query(KPI).filter(KPI.id == rating_data.kpi_id).first()
            if not kpi:
                continue
            
            # Check if rating already exists
            existing = db.query(KPIRating).filter(
                KPIRating.employee_id == employee.employee_id,
                KPIRating.kpi_id == rating_data.kpi_id,
                KPIRating.quarter == quarter
            ).first()
            
            # Calculate performance score from actual metrics
            performance_score = calculate_kpi_performance_score(
                db, employee, kpi, quarter
            )
            
            # Calculate final score (use manager rating if provided, otherwise performance score)
            final_score = None
            if rating_data.manager_rating is not None:
                final_score = rating_data.manager_rating
            elif performance_score is not None:
                final_score = performance_score
            
            # Determine if lead and manager are the same person
            is_lead_manager_same = employee.lead and employee.manager and employee.lead.strip().upper() == employee.manager.strip().upper()
            
            # Update or create rating based on who is rating
            if existing:
                # Update existing - only update the field for the current rater
                if rating_data.rated_by == "self":
                    existing.self_rating = rating_data.self_rating
                    existing.self_comments = rating_data.self_comments
                elif rating_data.rated_by == "lead":
                    existing.lead_rating = rating_data.lead_rating
                    existing.lead_comments = rating_data.lead_comments
                    # If lead and manager are same, also update manager fields
                    if is_lead_manager_same:
                        existing.manager_rating = rating_data.lead_rating
                        existing.manager_comments = rating_data.lead_comments
                elif rating_data.rated_by == "manager":
                    existing.manager_rating = rating_data.manager_rating
                    existing.manager_comments = rating_data.manager_comments
                    # If lead and manager are same, also update lead fields
                    if is_lead_manager_same:
                        existing.lead_rating = rating_data.manager_rating
                        existing.lead_comments = rating_data.manager_comments
                
                # Keep backward compatibility
                if rating_data.rating is not None:
                    existing.rating = rating_data.rating
                if rating_data.manager_rating is not None:
                    existing.manager_rating = rating_data.manager_rating
                if rating_data.manager_comments is not None:
                    existing.manager_comments = rating_data.manager_comments
                
                existing.performance_score = performance_score
                existing.final_score = final_score
                existing.rated_by = rating_data.rated_by
                existing.rated_on = datetime.now()
            else:
                # Create new
                new_rating = KPIRating(
                    employee_id=employee.employee_id,
                    kpi_id=rating_data.kpi_id,
                    quarter=quarter,
                    year=year,
                    quarter_number=quarter_num,
                    rating=rating_data.rating,  # Backward compatibility
                    self_rating=rating_data.self_rating if rating_data.rated_by == "self" else None,
                    lead_rating=rating_data.lead_rating if rating_data.rated_by == "lead" else None,
                    manager_rating=rating_data.manager_rating if rating_data.rated_by == "manager" else None,
                    self_comments=rating_data.self_comments if rating_data.rated_by == "self" else None,
                    lead_comments=rating_data.lead_comments if rating_data.rated_by == "lead" else None,
                    manager_comments=rating_data.manager_comments if rating_data.rated_by == "manager" else None,
                    performance_score=performance_score,
                    final_score=final_score,
                    rated_by=rating_data.rated_by
                )
                # If lead and manager are same, copy lead rating to manager
                if is_lead_manager_same and rating_data.rated_by == "lead":
                    new_rating.manager_rating = rating_data.lead_rating
                    new_rating.manager_comments = rating_data.lead_comments
                elif is_lead_manager_same and rating_data.rated_by == "manager":
                    new_rating.lead_rating = rating_data.manager_rating
                    new_rating.lead_comments = rating_data.manager_comments
                
                db.add(new_rating)
            
            submitted_count += 1
        
        db.commit()
        
        return {
            "message": f"Successfully submitted {submitted_count} KPI ratings",
            "quarter": quarter,
            "count": submitted_count
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


def calculate_kpi_performance_score(db: Session, employee: Employee, kpi: KPI, quarter: str) -> Optional[float]:
    """Calculate performance score for a KPI based on actual metrics"""
    # Parse quarter to get date range
    year = int(quarter.split('-')[0])
    quarter_num = int(quarter.split('-Q')[1])
    start_month = (quarter_num - 1) * 3 + 1
    start_date = datetime(year, start_month, 1)
    
    if quarter_num == 4:
        end_date = datetime(year + 1, 1, 1)
    else:
        end_date = datetime(year, start_month + 3, 1)
    
    # This is a placeholder - implement actual calculation based on KPI code
    # You can implement specific calculations based on kpi.kpi_code
    # Example: If KPI is about bug closure rate, calculate from actual bugs
    
    return None


# ===== STATUS HISTORY ENDPOINTS =====

@app.get("/status-history/tickets")
def get_ticket_status_history(
    ticket_id: Optional[int] = Query(None, description="Filter by specific ticket ID"),
    status: Optional[str] = Query(None, description="Filter by status (new_status)"),
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    limit: int = Query(100, description="Maximum records to return")
):
    """Get ticket status change history"""
    db: Session = SessionLocal()
    try:
        query = db.query(TicketStatusHistory)
        
        if ticket_id:
            query = query.filter(TicketStatusHistory.ticket_id == ticket_id)
        
        if status:
            query = query.filter(TicketStatusHistory.new_status == status)
        
        if start_date:
            start = datetime.strptime(start_date, "%Y-%m-%d")
            query = query.filter(TicketStatusHistory.changed_on >= start)
        
        if end_date:
            end = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
            query = query.filter(TicketStatusHistory.changed_on <= end)
        
        history = query.order_by(TicketStatusHistory.changed_on.desc()).limit(limit).all()
        
        return [
            {
                "id": h.id,
                "ticket_id": h.ticket_id,
                "previous_status": h.previous_status,
                "new_status": h.new_status,
                "changed_on": h.changed_on.isoformat() if h.changed_on else None,
                "current_assignee": h.current_assignee,
                "qc_tester": h.qc_tester,
                "duration_in_previous_status": h.duration_in_previous_status,
                "source": h.source
            }
            for h in history
        ]
    finally:
        db.close()


@app.get("/status-history/tickets/moved-to")
def get_tickets_moved_to_status(
    status: str = Query(..., description="Target status (e.g., 'BIS Testing')"),
    start_date: str = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: str = Query(..., description="End date (YYYY-MM-DD)")
):
    """Get tickets that moved to a specific status during a date range"""
    db: Session = SessionLocal()
    try:
        start = datetime.strptime(start_date, "%Y-%m-%d")
        end = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
        
        # Find status changes to the target status within the date range
        history = db.query(TicketStatusHistory).filter(
            TicketStatusHistory.new_status == status,
            TicketStatusHistory.changed_on >= start,
            TicketStatusHistory.changed_on <= end
        ).order_by(TicketStatusHistory.changed_on.desc()).all()
        
        # Get unique ticket IDs
        ticket_ids = list(set(h.ticket_id for h in history))
        
        # Get ticket details
        tickets = db.query(TicketTracking).filter(
            TicketTracking.ticket_id.in_(ticket_ids)
        ).all() if ticket_ids else []
        
        ticket_map = {t.ticket_id: t for t in tickets}
        
        result = []
        for h in history:
            ticket = ticket_map.get(h.ticket_id)
            result.append({
                "ticket_id": h.ticket_id,
                "moved_from": h.previous_status,
                "moved_to": h.new_status,
                "moved_on": h.changed_on.isoformat() if h.changed_on else None,
                "current_status": ticket.status if ticket else None,
                "qc_tester": ticket.qc_tester if ticket else h.qc_tester,
                "duration_in_previous_status_hours": h.duration_in_previous_status
            })
        
        return {
            "status": status,
            "date_range": {"start": start_date, "end": end_date},
            "total_count": len(ticket_ids),
            "tickets": result
        }
    finally:
        db.close()


@app.get("/status-history/bugs")
def get_bug_status_history(
    bug_id: Optional[int] = Query(None, description="Filter by specific bug ID"),
    ticket_id: Optional[int] = Query(None, description="Filter by ticket ID"),
    status: Optional[str] = Query(None, description="Filter by status"),
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    limit: int = Query(100, description="Maximum records to return")
):
    """Get bug status change history"""
    db: Session = SessionLocal()
    try:
        query = db.query(BugStatusHistory)
        
        if bug_id:
            query = query.filter(BugStatusHistory.bug_id == bug_id)
        
        if ticket_id:
            query = query.filter(BugStatusHistory.ticket_id == ticket_id)
        
        if status:
            query = query.filter(BugStatusHistory.new_status == status)
        
        if start_date:
            start = datetime.strptime(start_date, "%Y-%m-%d")
            query = query.filter(BugStatusHistory.changed_on >= start)
        
        if end_date:
            end = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
            query = query.filter(BugStatusHistory.changed_on <= end)
        
        history = query.order_by(BugStatusHistory.changed_on.desc()).limit(limit).all()
        
        return [
            {
                "id": h.id,
                "bug_id": h.bug_id,
                "ticket_id": h.ticket_id,
                "previous_status": h.previous_status,
                "new_status": h.new_status,
                "changed_on": h.changed_on.isoformat() if h.changed_on else None,
                "assignee": h.assignee,
                "duration_in_previous_status": h.duration_in_previous_status,
                "source": h.source
            }
            for h in history
        ]
    finally:
        db.close()


@app.get("/status-history/summary")
def get_status_history_summary(
    start_date: str = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: str = Query(..., description="End date (YYYY-MM-DD)")
):
    """Get summary of status changes during a date range"""
    db: Session = SessionLocal()
    try:
        start = datetime.strptime(start_date, "%Y-%m-%d")
        end = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
        
        # Ticket status changes
        ticket_changes = db.query(TicketStatusHistory).filter(
            TicketStatusHistory.changed_on >= start,
            TicketStatusHistory.changed_on <= end
        ).all()
        
        # Bug status changes
        bug_changes = db.query(BugStatusHistory).filter(
            BugStatusHistory.changed_on >= start,
            BugStatusHistory.changed_on <= end
        ).all()
        
        # Aggregate ticket changes by status
        ticket_moved_to = defaultdict(int)
        ticket_moved_from = defaultdict(int)
        for tc in ticket_changes:
            if tc.new_status:
                ticket_moved_to[tc.new_status] += 1
            if tc.previous_status:
                ticket_moved_from[tc.previous_status] += 1
        
        # Aggregate bug changes by status
        bug_moved_to = defaultdict(int)
        bug_moved_from = defaultdict(int)
        for bc in bug_changes:
            if bc.new_status:
                bug_moved_to[bc.new_status] += 1
            if bc.previous_status:
                bug_moved_from[bc.previous_status] += 1
        
        return {
            "date_range": {"start": start_date, "end": end_date},
            "tickets": {
                "total_changes": len(ticket_changes),
                "unique_tickets": len(set(tc.ticket_id for tc in ticket_changes)),
                "moved_to": dict(ticket_moved_to),
                "moved_from": dict(ticket_moved_from)
            },
            "bugs": {
                "total_changes": len(bug_changes),
                "unique_bugs": len(set(bc.bug_id for bc in bug_changes)),
                "moved_to": dict(bug_moved_to),
                "moved_from": dict(bug_moved_from)
            }
        }
    finally:
        db.close()


# ===== WEEKLY REPORT ENDPOINTS =====

@app.get("/reports/weekly")
def generate_weekly_report(
    date: str = Query(None, description="Reference date (YYYY-MM-DD) for the week. Defaults to current week."),
    download: bool = Query(True, description="If true, returns the PDF file. If false, returns report data as JSON.")
):
    """Generate weekly QA report for the specified week"""
    from weekly_report import get_week_dates, get_weekly_data, generate_pdf_report
    import os
    
    try:
        # Get week dates
        week_start, week_end = get_week_dates(date)
        
        # Fetch data
        data = get_weekly_data(week_start, week_end)
        
        if not download:
            # Return JSON summary
            return {
                "week_start": week_start.strftime("%Y-%m-%d"),
                "week_end": week_end.strftime("%Y-%m-%d"),
                "summary": data['summary'],
                "tickets_bis_testing_count": len(data['tickets_bis_testing']),
                "tickets_closed_count": len(data['tickets_closed']),
                "tickets_in_progress_count": len(data['tickets_in_progress']),
                "next_week_plan_count": len(data['next_week_plan'])
            }
        
        # Generate PDF
        reports_folder = os.path.join(os.path.dirname(__file__), "reports")
        os.makedirs(reports_folder, exist_ok=True)
        
        output_path = os.path.join(
            reports_folder,
            f"QA_Weekly_Report_{week_start.strftime('%Y%m%d')}_{week_end.strftime('%Y%m%d')}.pdf"
        )
        
        generate_pdf_report(data, output_path)
        
        return FileResponse(
            output_path,
            media_type="application/pdf",
            filename=os.path.basename(output_path)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/reports/weekly/preview")
def preview_weekly_report(
    date: str = Query(None, description="Reference date (YYYY-MM-DD) for the week")
):
    """Get preview data for weekly report without generating PDF"""
    from weekly_report import get_week_dates, get_weekly_data
    
    try:
        week_start, week_end = get_week_dates(date)
        data = get_weekly_data(week_start, week_end)
        
        return {
            "week_start": week_start.strftime("%Y-%m-%d"),
            "week_end": week_end.strftime("%Y-%m-%d"),
            "summary": data['summary'],
            "tickets_bis_testing": data['tickets_bis_testing'],
            "tickets_closed": data['tickets_closed'],
            "tickets_in_progress": data['tickets_in_progress'][:20],  # Limit for preview
            "next_week_plan": data['next_week_plan']
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/reports/ticket/{ticket_id}")
def generate_ticket_report_endpoint(ticket_id: int):
    """Generate PDF report for a specific ticket with all its data"""
    from ticket_report import get_ticket_data, generate_ticket_pdf
    import os
    
    try:
        # Fetch data
        data = get_ticket_data(ticket_id)
        
        if not data:
            raise HTTPException(status_code=404, detail=f"Ticket #{ticket_id} not found")
        
        # Generate PDF
        reports_folder = os.path.join(os.path.dirname(__file__), "reports")
        os.makedirs(reports_folder, exist_ok=True)
        
        output_path = os.path.join(
            reports_folder,
            f"Ticket_Report_{ticket_id}.pdf"
        )
        
        generate_ticket_pdf(data, output_path)
        
        return FileResponse(
            output_path,
            media_type="application/pdf",
            filename=f"Ticket_Report_{ticket_id}.pdf"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/reports/weekly-v2")
def generate_weekly_report_v2(
    date: str = Query(None, description="Reference date (YYYY-MM-DD) for the week"),
    project: str = Query(None, description="Project/Client name for the cover page"),
    last7days: bool = Query(True, description="If true, show last 7 days. If false, show Mon-Fri week.")
):
    """Generate comprehensive multi-page QA weekly report (V2)"""
    from qa_weekly_report_v2 import get_week_dates, get_comprehensive_data, generate_comprehensive_report
    import os
    
    try:
        # Get week dates - use last 7 days by default
        week_start, week_end = get_week_dates(date, use_last_7_days=last7days)
        
        # Fetch comprehensive data
        data = get_comprehensive_data(week_start, week_end)
        
        # Generate PDF
        reports_folder = os.path.join(os.path.dirname(__file__), "reports")
        os.makedirs(reports_folder, exist_ok=True)
        
        output_path = os.path.join(
            reports_folder,
            f"QA_Weekly_Report_V2_{week_start.strftime('%Y%m%d')}_{week_end.strftime('%Y%m%d')}.pdf"
        )
        
        generate_comprehensive_report(data, output_path, project)
        
        return FileResponse(
            output_path,
            media_type="application/pdf",
            filename=os.path.basename(output_path)
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/reports/weekly-v2/preview")
def preview_weekly_report_v2(
    date: str = Query(None, description="Reference date (YYYY-MM-DD) for the week"),
    last7days: bool = Query(True, description="If true, show last 7 days. If false, show Mon-Fri week.")
):
    """Get preview data for the comprehensive weekly report"""
    from qa_weekly_report_v2 import get_week_dates, get_comprehensive_data
    
    try:
        # Use last 7 days by default
        week_start, week_end = get_week_dates(date, use_last_7_days=last7days)
        data = get_comprehensive_data(week_start, week_end)
        
        return {
            "week_start": week_start.strftime("%Y-%m-%d"),
            "week_end": week_end.strftime("%Y-%m-%d"),
            "current_week": {
                "qa_tickets_count": len(data['current_week']['qa_tickets']),
                "bis_testing_count": len(data['current_week']['bis_testing_moved']),
                "closed_count": len(data['current_week']['closed_moved']),
                "in_progress_count": len(data['current_week']['in_progress']),
            },
            # QA Team Pending Breakdown
            "qa_pending_breakdown": data.get('qa_pending_breakdown', {}),
            "previous_week": data['previous_week'],
            "metrics": data['metrics'],
            "breakdowns": {
                "by_status": dict(data['breakdowns']['by_status']),
                "by_module": dict(data['breakdowns']['by_module']),
            },
            "next_week_plan_count": len(data['next_week_plan']),
            "bis_testing_tickets": [
                {
                    "ticket_id": t['ticket_id'],
                    "title": t['title'],
                    "status": t['status'],
                    "bugs_total": t['bugs_total'],
                    "bugs_open": t['bugs_open'],
                    "tests_total": t['tests_total'],
                    "pass_rate": t['pass_rate']
                }
                for t in data['current_week']['bis_testing_moved']
            ],
            "closed_tickets": [
                {
                    "ticket_id": t['ticket_id'],
                    "title": t['title'],
                    "bugs_closed": t['bugs_closed'],
                    "tests_passed": t['tests_passed']
                }
                for t in data['current_week']['closed_moved']
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ===== CALENDAR AND TASK PLANNING PYDANTIC MODELS =====

class PlannedTaskCreate(BaseModel):
    employee_id: Optional[str] = None
    employee_name: str
    ticket_id: str
    task_title: str
    task_description: Optional[str] = None
    project_name: Optional[str] = None
    planned_date: date
    planned_hours: float
    priority: Optional[str] = "medium"
    team: str
    assigned_by: str

class PlannedTaskUpdate(BaseModel):
    task_title: Optional[str] = None
    task_description: Optional[str] = None
    planned_hours: Optional[float] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    actual_hours: Optional[float] = None

class WeeklyPlanCreate(BaseModel):
    employee_id: Optional[str] = None
    employee_name: str
    week_start: date
    assigned_tickets: List[dict]  # [{"ticket_id": "123", "priority": "high", "estimated_hours": 20}]
    notes: Optional[str] = None
    team: str
    planned_by: str

class WeeklyPlanUpdate(BaseModel):
    assigned_tickets: Optional[List[dict]] = None
    notes: Optional[str] = None
    status: Optional[str] = None


# ===== GOOGLE SHEETS SYNC ENDPOINTS =====

@app.get("/sync/google-sheets/status")
def get_google_sheets_status():
    """Get the current status of Google Sheets sync configuration and scheduler."""
    config_status = get_sheets_sync_status()
    scheduler = get_scheduler()
    scheduler_status = scheduler.get_status()
    
    return {
        **config_status,
        "scheduler": scheduler_status
    }

@app.post("/sync/google-sheets")
def trigger_google_sheets_sync(team: Optional[str] = Query(None, description="Team to sync: QA, DEV, or leave empty for all")):
    """Trigger a manual sync from Google Sheets."""
    try:
        sync = GoogleSheetsSync()
        if team:
            result = sync.sync_team(team.upper())
        else:
            result = sync.sync_all()
        return {"success": True, "result": result}
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")

@app.post("/sync/google-sheets/start")
def start_auto_sync_endpoint(
    interval_minutes: Optional[int] = Query(None, description="Sync interval in minutes (ignored if realtime=true)"),
    teams: Optional[str] = Query(None, description="Comma-separated teams: QA,DEV"),
    realtime: bool = Query(True, description="Enable real-time sync (2-minute intervals)")
):
    """Start automatic syncing of Google Sheets."""
    try:
        scheduler = get_scheduler()
        teams_list = [t.strip().upper() for t in teams.split(',')] if teams else None
        scheduler.start(sync_interval_minutes=interval_minutes, teams=teams_list, realtime=realtime)
        
        mode = "real-time (2-minute intervals)" if realtime else f"{interval_minutes or 5} minute intervals"
        return {
            "success": True,
            "message": f"Auto-sync started in {mode}",
            "status": scheduler.get_status()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start auto-sync: {str(e)}")

@app.post("/sync/google-sheets/stop")
def stop_auto_sync_endpoint():
    """Stop automatic syncing of Google Sheets."""
    try:
        scheduler = get_scheduler()
        scheduler.stop()
        return {
            "success": True,
            "message": "Auto-sync stopped"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to stop auto-sync: {str(e)}")

@app.post("/sync/google-sheets/trigger")
def trigger_scheduled_sync(teams: Optional[str] = Query(None, description="Comma-separated teams: QA,DEV")):
    """Manually trigger the scheduled sync job."""
    try:
        scheduler = get_scheduler()
        teams_list = [t.strip().upper() for t in teams.split(',')] if teams else None
        result = scheduler.trigger_manual_sync(teams=teams_list)
        return {
            "success": True,
            "message": "Manual sync triggered",
            "result": result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to trigger sync: {str(e)}")


# ===== CALENDAR API ENDPOINTS =====

def is_weekend(check_date: date) -> bool:
    """Check if a date is a weekend (Saturday or Sunday)."""
    return check_date.weekday() >= 5  # 5 = Saturday, 6 = Sunday


def is_holiday(check_date: date, db: Session, include_optional: bool = False) -> Optional[Holiday]:
    """
    Check if a date is a holiday.
    Returns the Holiday object if found, None otherwise.
    If include_optional is False, only checks for regular holidays.
    """
    query = db.query(Holiday).filter(
        Holiday.holiday_date == check_date,
        Holiday.is_active == True
    )
    
    if not include_optional:
        query = query.filter(Holiday.category == 'Holiday')
    
    return query.first()


def is_working_day(check_date: date, db: Session, include_optional_holidays: bool = False) -> bool:
    """
    Check if a date is a working day (not weekend and not a holiday).
    If include_optional_holidays is True, optional holidays are also considered non-working days.
    """
    if is_weekend(check_date):
        return False
    
    holiday = is_holiday(check_date, db, include_optional=include_optional_holidays)
    if holiday:
        return False
    
    return True


def get_working_days_in_range(start_date: date, end_date: date, db: Session, include_optional_holidays: bool = False) -> int:
    """Count working days (excluding weekends and holidays) in a date range."""
    working_days = 0
    current_date = start_date
    
    while current_date <= end_date:
        if is_working_day(current_date, db, include_optional_holidays):
            working_days += 1
        current_date += timedelta(days=1)
    
    return working_days


@app.get("/calendar/holidays")
def get_holidays(
    year: Optional[int] = Query(None, description="Year. Defaults to current year."),
    category: Optional[str] = Query(None, description="Filter by category: 'Holiday' or 'Optional Holiday'")
):
    """Get list of holidays for a given year."""
    db = SessionLocal()
    try:
        if not year:
            year = date.today().year
        
        query = db.query(Holiday).filter(
            Holiday.year == year,
            Holiday.is_active == True
        )
        
        if category:
            query = query.filter(Holiday.category == category)
        
        holidays = query.order_by(Holiday.holiday_date).all()
        
        return {
            "year": year,
            "holidays": [
                {
                    "id": h.id,
                    "name": h.holiday_name,
                    "date": h.holiday_date.isoformat(),
                    "day_name": h.day_name,
                    "category": h.category
                }
                for h in holidays
            ]
        }
    finally:
        db.close()


@app.get("/calendar/weekly")
def get_weekly_calendar(
    team: str = Query("ALL", description="Team: QA, DEV, or ALL"),
    date_str: str = Query(None, description="Any date in the week (YYYY-MM-DD). Defaults to current week."),
    category: str = Query("ALL", description="Category: BILLED, UN-BILLED, or ALL")
):
    """
    Get weekly calendar view showing daily time entries per employee.
    Returns all employees with their daily entries for the week.
    """
    db = SessionLocal()
    try:
        # Parse date and calculate week boundaries (Monday to Sunday)
        if date_str:
            try:
                target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
        else:
            target_date = date.today()
        
        # Calculate week start (Monday) and end (Sunday)
        week_start = target_date - timedelta(days=target_date.weekday())
        week_end = week_start + timedelta(days=6)
        
        # Get holidays for this week
        week_holidays = {}
        holidays_query = db.query(Holiday).filter(
            Holiday.holiday_date >= week_start,
            Holiday.holiday_date <= week_end,
            Holiday.is_active == True
        ).all()
        
        for holiday in holidays_query:
            week_holidays[holiday.holiday_date.isoformat()] = {
                "name": holiday.holiday_name,
                "category": holiday.category,
                "day_name": holiday.day_name
            }
        
        # Get list of employees (filtered by team and category)
        emp_query = db.query(Employee).filter(Employee.is_active == True)
        if team.upper() != "ALL":
            # Map "DEV" to "DEVELOPMENT" for Employee table (Employee.team uses "DEVELOPMENT", not "DEV")
            employee_team_filter = team.upper()
            if employee_team_filter == "DEV":
                employee_team_filter = "DEVELOPMENT"
            emp_query = emp_query.filter(Employee.team == employee_team_filter)
        if category.upper() != "ALL":
            # Use case-insensitive exact match for category
            # Match both "BILLED" and "UN-BILLED" (with or without hyphen)
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
        
        # Get employee names for filtering timesheet data
        employee_names = [emp.name for emp in employees]
        
        # Query timesheet data
        query = db.query(EnhancedTimesheet).filter(
            EnhancedTimesheet.date >= week_start,
            EnhancedTimesheet.date <= week_end
        )
        
        if team.upper() != "ALL":
            query = query.filter(EnhancedTimesheet.team == team.upper())
        if category.upper() != "ALL" and employee_names:
            query = query.filter(EnhancedTimesheet.employee_name.in_(employee_names))
        
        entries = query.order_by(
            EnhancedTimesheet.employee_name,
            EnhancedTimesheet.date
        ).all()
        
        # Also get leave entries
        leave_query = db.query(LeaveEntry).filter(
            LeaveEntry.date >= week_start,
            LeaveEntry.date <= week_end
        )
        if team.upper() != "ALL":
            leave_query = leave_query.filter(LeaveEntry.team == team.upper())
        if category.upper() != "ALL" and employee_names:
            leave_query = leave_query.filter(LeaveEntry.employee_name.in_(employee_names))
        leaves = leave_query.all()
        
        # Build employee calendar data
        employee_data = {}
        
        # Initialize all employees
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
                is_weekend_day = is_weekend(day)
                holiday_info = week_holidays.get(day_key)
                
                employee_data[emp.name]["days"][day_key] = {
                    "date": day_key,
                    "entries": [],
                    "total_hours": 0,
                    "productive_hours": 0,
                    "hours_logged": 0,
                    "leave_type": None,
                    "is_weekend": is_weekend_day,
                    "is_holiday": holiday_info is not None,
                    "holiday_name": holiday_info["name"] if holiday_info else None,
                    "holiday_category": holiday_info["category"] if holiday_info else None,
                    "is_working_day": not is_weekend_day and holiday_info is None
                }
        
        # Add timesheet entries (also handle employees not in master list)
        for entry in entries:
            name = entry.employee_name
            if name not in employee_data:
                employee_data[name] = {
                    "employee_id": entry.employee_id,
                    "employee_name": name,
                    "team": entry.team,
                    "days": {}
                }
                for i in range(7):
                    day = week_start + timedelta(days=i)
                    day_key = day.isoformat()
                    is_weekend_day = is_weekend(day)
                    holiday_info = week_holidays.get(day_key)
                    
                    employee_data[name]["days"][day_key] = {
                        "date": day_key,
                        "entries": [],
                        "total_hours": 0,
                        "productive_hours": 0,
                        "hours_logged": 0,
                        "leave_type": None,
                        "is_weekend": is_weekend_day,
                        "is_holiday": holiday_info is not None,
                        "holiday_name": holiday_info["name"] if holiday_info else None,
                        "holiday_category": holiday_info["category"] if holiday_info else None,
                        "is_working_day": not is_weekend_day and holiday_info is None
                    }
            
            day_key = entry.date.isoformat()
            if day_key in employee_data[name]["days"]:
                # Get hours - use productive_hours if available, otherwise hours_logged
                productive = entry.productive_hours or 0
                hours_logged = entry.hours_logged or 0
                display_hours = productive if productive > 0 else hours_logged
                
                employee_data[name]["days"][day_key]["entries"].append({
                    "ticket_id": entry.ticket_id,
                    "hours": display_hours,
                    "productive_hours": productive,
                    "hours_logged": hours_logged,
                    "task_description": entry.task_description,
                    "project_name": entry.project_name
                })
                employee_data[name]["days"][day_key]["total_hours"] += display_hours
                employee_data[name]["days"][day_key]["productive_hours"] += productive
                employee_data[name]["days"][day_key]["hours_logged"] = employee_data[name]["days"][day_key].get("hours_logged", 0) + hours_logged
                if entry.leave_type:
                    employee_data[name]["days"][day_key]["leave_type"] = entry.leave_type
        
        # Add leave entries
        for leave in leaves:
            name = leave.employee_name
            if name in employee_data:
                day_key = leave.date.isoformat()
                if day_key in employee_data[name]["days"]:
                    employee_data[name]["days"][day_key]["leave_type"] = leave.leave_type
        
        # Calculate totals per employee
        for name, data in employee_data.items():
            total = sum(d["total_hours"] for d in data["days"].values())
            productive = sum(d["productive_hours"] for d in data["days"].values())
            data["weekly_total_hours"] = total
            data["weekly_productive_hours"] = productive
        
        # Calculate working days in the week (excluding weekends and holidays)
        working_days = get_working_days_in_range(week_start, week_end, db, include_optional_holidays=False)
        
        return {
            "week_start": week_start.isoformat(),
            "week_end": week_end.isoformat(),
            "team": team,
            "working_days": working_days,
            "holidays": list(week_holidays.values()),
            "employees": list(employee_data.values())
        }
    finally:
        db.close()


@app.get("/calendar/monthly")
def get_monthly_calendar(
    team: str = Query("ALL", description="Team: QA, DEV, or ALL"),
    month: str = Query(None, description="Month (YYYY-MM). Defaults to current month."),
    category: str = Query("ALL", description="Category: BILLED, UN-BILLED, or ALL")
):
    """
    Get monthly calendar view showing summary per employee.
    Returns condensed view with daily hours and leave indicators.
    """
    db = SessionLocal()
    try:
        # Parse month
        if month:
            try:
                year, mon = map(int, month.split("-"))
                month_start = date(year, mon, 1)
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid month format. Use YYYY-MM")
        else:
            today = date.today()
            month_start = date(today.year, today.month, 1)
        
        # Calculate month end
        if month_start.month == 12:
            month_end = date(month_start.year + 1, 1, 1) - timedelta(days=1)
        else:
            month_end = date(month_start.year, month_start.month + 1, 1) - timedelta(days=1)
        
        # Get holidays for this month
        month_holidays = {}
        holidays_query = db.query(Holiday).filter(
            Holiday.holiday_date >= month_start,
            Holiday.holiday_date <= month_end,
            Holiday.is_active == True
        ).all()
        
        for holiday in holidays_query:
            month_holidays[holiday.holiday_date.isoformat()] = {
                "date": holiday.holiday_date.isoformat(),
                "name": holiday.holiday_name,
                "category": holiday.category,
                "day_name": holiday.day_name
            }
        
        # Get all active employees from the Employee master table (filtered by team and category)
        emp_query = db.query(Employee).filter(Employee.is_active == True)
        if team.upper() != "ALL":
            # Map "DEV" to "DEVELOPMENT" for Employee table (Employee.team uses "DEVELOPMENT", not "DEV")
            employee_team_filter = team.upper()
            if employee_team_filter == "DEV":
                employee_team_filter = "DEVELOPMENT"
            emp_query = emp_query.filter(Employee.team == employee_team_filter)
        if category.upper() != "ALL":
            # Use case-insensitive exact match for category
            # Match both "BILLED" and "UN-BILLED" (with or without hyphen)
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
        all_employees = emp_query.all()
        
        # Get employee names for filtering timesheet data
        employee_names = [emp.name for emp in all_employees]
        
        # Query timesheet data (filtered by employee names based on team/category)
        query = db.query(EnhancedTimesheet).filter(
            EnhancedTimesheet.date >= month_start,
            EnhancedTimesheet.date <= month_end
        )
        if team.upper() != "ALL":
            query = query.filter(EnhancedTimesheet.team == team.upper())
        if category.upper() != "ALL" and employee_names:
            query = query.filter(EnhancedTimesheet.employee_name.in_(employee_names))
        entries = query.all()
        
        # Query leaves (filtered by employee names based on team/category)
        leave_query = db.query(LeaveEntry).filter(
            LeaveEntry.date >= month_start,
            LeaveEntry.date <= month_end
        )
        if team.upper() != "ALL":
            leave_query = leave_query.filter(LeaveEntry.team == team.upper())
        if category.upper() != "ALL" and employee_names:
            leave_query = leave_query.filter(LeaveEntry.employee_name.in_(employee_names))
        leaves = leave_query.all()
        
        # Build employee data
        employee_data = defaultdict(lambda: {
            "days": defaultdict(lambda: {
                "hours": 0, 
                "productive_hours": 0,
                "hours_logged": 0,
                "leave_type": None, 
                "entries": []
            }),
            "total_hours": 0,
            "total_productive_hours": 0,
            "total_leave_days": 0,
            "working_days": 0
        })
        
        # Initialize all active employees (even those with no entries)
        for emp in all_employees:
            employee_data[emp.name]["employee_id"] = emp.employee_id
            employee_data[emp.name]["employee_name"] = emp.name
            employee_data[emp.name]["team"] = emp.team
        
        for entry in entries:
            name = entry.employee_name
            day = entry.date.isoformat()
            employee_data[name]["employee_id"] = entry.employee_id
            employee_data[name]["employee_name"] = name
            employee_data[name]["team"] = entry.team
            
            # Consolidate productive hours (preferred) or hours_logged (fallback) per day
            productive = entry.productive_hours if entry.productive_hours is not None else None
            time_spent = entry.hours_logged or 0
            
            # Use productive hours if available, otherwise use time spent
            display_hours = productive if productive is not None else time_spent
            
            employee_data[name]["days"][day]["productive_hours"] += productive if productive is not None else 0
            employee_data[name]["days"][day]["hours_logged"] += time_spent
            employee_data[name]["days"][day]["hours"] = display_hours  # Display value
            employee_data[name]["days"][day]["entries"].append(entry.ticket_id)
            if entry.leave_type:
                employee_data[name]["days"][day]["leave_type"] = entry.leave_type
            employee_data[name]["total_hours"] += display_hours
            employee_data[name]["total_productive_hours"] += productive if productive is not None else 0
        
        for leave in leaves:
            name = leave.employee_name
            day = leave.date.isoformat()
            employee_data[name]["days"][day]["leave_type"] = leave.leave_type
            employee_data[name]["total_leave_days"] += 1
        
        # Calculate working days and average productive hours
        today = date.today()
        for name, data in employee_data.items():
            # Add holiday/weekend information to each day
            for day_key in list(data["days"].keys()):
                day_date = datetime.strptime(day_key, "%Y-%m-%d").date()
                is_weekend_day = is_weekend(day_date)
                holiday_info = month_holidays.get(day_key)
                
                data["days"][day_key]["is_weekend"] = is_weekend_day
                data["days"][day_key]["is_holiday"] = holiday_info is not None
                data["days"][day_key]["holiday_name"] = holiday_info["name"] if holiday_info else None
                data["days"][day_key]["holiday_category"] = holiday_info["category"] if holiday_info else None
                data["days"][day_key]["is_working_day"] = not is_weekend_day and holiday_info is None
            
            # Only count past working days (excluding weekends and holidays)
            past_working_days = [
                day_key for day_key, d in data["days"].items() 
                if datetime.strptime(day_key, "%Y-%m-%d").date() <= today 
                and d.get("is_working_day", True)
            ]
            data["working_days"] = len(past_working_days)
            
            # Calculate average productive hours (only for past working days, excluding leave days)
            past_productive_days = [
                d for day_key, d in data["days"].items() 
                if datetime.strptime(day_key, "%Y-%m-%d").date() <= today 
                and d.get("is_working_day", True)
                and (d.get("productive_hours", 0) > 0 or d.get("hours_logged", 0) > 0) 
                and not d.get("leave_type")  # Exclude leave days
            ]
            if past_productive_days:
                total_productive = sum(d.get("productive_hours") or d.get("hours_logged", 0) for d in past_productive_days)
                data["avg_productive_hours"] = round(total_productive / len(past_productive_days), 1)
            else:
                data["avg_productive_hours"] = 0
            
            # Convert defaultdict to regular dict for JSON serialization
            data["days"] = dict(data["days"])
            for day in data["days"]:
                data["days"][day] = dict(data["days"][day])
        
        # Calculate total working days in the month
        total_working_days = get_working_days_in_range(month_start, month_end, db, include_optional_holidays=False)
        
        return {
            "month": month_start.strftime("%Y-%m"),
            "month_start": month_start.isoformat(),
            "month_end": month_end.isoformat(),
            "team": team,
            "working_days": total_working_days,
            "holidays": list(month_holidays.values()),
            "employees": [dict(v) for v in employee_data.values()]
        }
    finally:
        db.close()


@app.get("/calendar/employee/{employee_id}")
def get_employee_calendar(
    employee_id: str,
    period: str = Query("week", description="Period: week or month"),
    date_str: str = Query(None, description="Reference date (YYYY-MM-DD)")
):
    """
    Get calendar data for a specific employee.
    """
    db = SessionLocal()
    try:
        # Find employee
        employee = db.query(Employee).filter(Employee.employee_id == employee_id).first()
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found")
        
        # Parse date
        if date_str:
            try:
                target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
        else:
            target_date = date.today()
        
        # Calculate period boundaries
        if period == "week":
            start_date = target_date - timedelta(days=target_date.weekday())
            end_date = start_date + timedelta(days=6)
        else:  # month
            start_date = date(target_date.year, target_date.month, 1)
            if start_date.month == 12:
                end_date = date(start_date.year + 1, 1, 1) - timedelta(days=1)
            else:
                end_date = date(start_date.year, start_date.month + 1, 1) - timedelta(days=1)
        
        # Get holidays for this period
        period_holidays = {}
        holidays_query = db.query(Holiday).filter(
            Holiday.holiday_date >= start_date,
            Holiday.holiday_date <= end_date,
            Holiday.is_active == True
        ).all()
        
        for holiday in holidays_query:
            period_holidays[holiday.holiday_date.isoformat()] = {
                "name": holiday.holiday_name,
                "category": holiday.category,
                "day_name": holiday.day_name
            }
        
        # Query timesheet entries
        entries = db.query(EnhancedTimesheet).filter(
            EnhancedTimesheet.employee_name == employee.name,
            EnhancedTimesheet.date >= start_date,
            EnhancedTimesheet.date <= end_date
        ).order_by(EnhancedTimesheet.date).all()
        
        # Query leaves
        leaves = db.query(LeaveEntry).filter(
            LeaveEntry.employee_name == employee.name,
            LeaveEntry.date >= start_date,
            LeaveEntry.date <= end_date
        ).all()
        leave_map = {l.date.isoformat(): l.leave_type for l in leaves}
        
        # Query planned tasks
        planned = db.query(PlannedTask).filter(
            PlannedTask.employee_name == employee.name,
            PlannedTask.planned_date >= start_date,
            PlannedTask.planned_date <= end_date
        ).order_by(PlannedTask.planned_date).all()
        
        # Build day-by-day data
        days = {}
        current = start_date
        while current <= end_date:
            day_key = current.isoformat()
            is_weekend_day = is_weekend(current)
            holiday_info = period_holidays.get(day_key)
            
            days[day_key] = {
                "date": day_key,
                "actual_entries": [],
                "planned_tasks": [],
                "total_actual_hours": 0,
                "total_productive_hours": 0,
                "hours_logged": 0,
                "total_planned_hours": 0,
                "leave_type": leave_map.get(day_key),
                "is_weekend": is_weekend_day,
                "is_holiday": holiday_info is not None,
                "holiday_name": holiday_info["name"] if holiday_info else None,
                "holiday_category": holiday_info["category"] if holiday_info else None,
                "is_working_day": not is_weekend_day and holiday_info is None
            }
            current += timedelta(days=1)
        
        # Add actual entries - use productive_hours if available, otherwise hours_logged
        for entry in entries:
            day_key = entry.date.isoformat()
            if day_key in days:
                productive = entry.productive_hours or 0
                hours_logged = entry.hours_logged or 0
                display_hours = productive if productive > 0 else hours_logged
                
                days[day_key]["actual_entries"].append({
                    "ticket_id": entry.ticket_id,
                    "hours": display_hours,
                    "productive_hours": productive,
                    "hours_logged": hours_logged,
                    "task_description": entry.task_description,
                    "project_name": entry.project_name
                })
                days[day_key]["total_actual_hours"] += display_hours
                days[day_key]["total_productive_hours"] += productive
                days[day_key]["hours_logged"] += hours_logged
        
        # Add planned tasks
        for task in planned:
            day_key = task.planned_date.isoformat()
            if day_key in days:
                days[day_key]["planned_tasks"].append({
                    "id": task.id,
                    "ticket_id": task.ticket_id,
                    "task_title": task.task_title,
                    "planned_hours": task.planned_hours,
                    "priority": task.priority,
                    "status": task.status
                })
                days[day_key]["total_planned_hours"] += task.planned_hours or 0
        
        # Calculate working days
        working_days = get_working_days_in_range(start_date, end_date, db, include_optional_holidays=False)
        
        # Calculate summary
        total_actual = sum(d["total_actual_hours"] for d in days.values())
        total_productive = sum(d["total_productive_hours"] for d in days.values())
        total_hours_logged = sum(d["hours_logged"] for d in days.values())
        
        return {
            "employee_id": employee.employee_id,
            "employee_name": employee.name,
            "team": employee.team,
            "period": period,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "working_days": working_days,
            "holidays": list(period_holidays.values()),
            "days": days,
            "summary": {
                "total_actual_hours": total_actual,
                "total_productive_hours": total_productive,
                "total_hours_logged": total_hours_logged,
                "total_planned_hours": sum(d["total_planned_hours"] for d in days.values()),
                "leave_days": len([d for d in days.values() if d["leave_type"]]),
                "working_days": working_days
            }
        }
    finally:
        db.close()


@app.get("/calendar/ticket/{ticket_id}/timesheet")
def get_ticket_timesheet_entries(ticket_id: str):
    """
    Get all timesheet entries for a specific ticket.
    Returns entries from all employees who worked on this ticket.
    """
    db = SessionLocal()
    try:
        # Query timesheet entries for this ticket
        entries = db.query(EnhancedTimesheet).filter(
            EnhancedTimesheet.ticket_id == ticket_id
        ).order_by(
            EnhancedTimesheet.date.desc(),
            EnhancedTimesheet.employee_name
        ).all()
        
        # Calculate summary
        total_hours = sum(e.hours_logged or 0 for e in entries)
        unique_employees = set(e.employee_name for e in entries)
        unique_dates = set(e.date for e in entries)
        
        return {
            "ticket_id": ticket_id,
            "entries": [
                {
                    "id": entry.id,
                    "date": entry.date.isoformat(),
                    "employee_id": entry.employee_id,
                    "employee_name": entry.employee_name,
                    "team": entry.team,
                    "hours_logged": entry.hours_logged,
                    "task_description": entry.task_description,
                    "project_name": entry.project_name,
                    "leave_type": entry.leave_type
                }
                for entry in entries
            ],
            "summary": {
                "total_hours": total_hours,
                "total_entries": len(entries),
                "unique_contributors": len(unique_employees),
                "days_worked": len(unique_dates),
                "contributors": list(unique_employees)
            }
        }
    finally:
        db.close()


@app.get("/calendar/leaves")
def get_team_leaves(
    team: str = Query("ALL", description="Team: QA, DEV, or ALL"),
    month: str = Query(None, description="Month (YYYY-MM). Defaults to current month.")
):
    """
    Get leave entries for a team in a given month.
    """
    db = SessionLocal()
    try:
        # Parse month
        if month:
            try:
                year, mon = map(int, month.split("-"))
                month_start = date(year, mon, 1)
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid month format. Use YYYY-MM")
        else:
            today = date.today()
            month_start = date(today.year, today.month, 1)
        
        # Calculate month end
        if month_start.month == 12:
            month_end = date(month_start.year + 1, 1, 1) - timedelta(days=1)
        else:
            month_end = date(month_start.year, month_start.month + 1, 1) - timedelta(days=1)

        # Query leaves
        query = db.query(LeaveEntry).filter(
            LeaveEntry.date >= month_start,
            LeaveEntry.date <= month_end
        )
        if team.upper() != "ALL":
            query = query.filter(LeaveEntry.team == team.upper())
        
        leaves = query.order_by(LeaveEntry.date, LeaveEntry.employee_name).all()
        
        return {
            "month": month_start.strftime("%Y-%m"),
            "team": team,
            "leaves": [
                {
                    "id": l.id,
                    "employee_id": l.employee_id,
                    "employee_name": l.employee_name,
                    "date": l.date.isoformat(),
                    "leave_type": l.leave_type,
                    "hours": l.hours,
                    "status": l.status
                }
                for l in leaves
            ],
            "summary": {
                "total_leave_entries": len(leaves),
                "by_type": dict(defaultdict(int, {l.leave_type: sum(1 for x in leaves if x.leave_type == l.leave_type) for l in leaves}))
            }
        }
    finally:
        db.close()


# ===== TASK PLANNING API ENDPOINTS =====

@app.get("/planning/weekly")
def get_weekly_plan(
    team: str = Query("ALL", description="Team: QA, DEV, or ALL"),
    week_start: str = Query(None, description="Week start date (YYYY-MM-DD). Defaults to current week.")
):
    """
    Get weekly task planning for a team.
    Returns planned tasks for each employee in the week.
    """
    db = SessionLocal()
    try:
        # Parse week start
        if week_start:
            try:
                start_date = datetime.strptime(week_start, "%Y-%m-%d").date()
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
        else:
            today = date.today()
            start_date = today - timedelta(days=today.weekday())
        
        week_end = start_date + timedelta(days=6)
        
        # Query weekly plans
        plan_query = db.query(WeeklyPlan).filter(
            WeeklyPlan.week_start == start_date
        )
        if team.upper() != "ALL":
            plan_query = plan_query.filter(WeeklyPlan.team == team.upper())
        weekly_plans = plan_query.all()
        
        # Query individual planned tasks
        task_query = db.query(PlannedTask).filter(
            PlannedTask.planned_date >= start_date,
            PlannedTask.planned_date <= week_end
        )
        if team.upper() != "ALL":
            task_query = task_query.filter(PlannedTask.team == team.upper())
        tasks = task_query.order_by(PlannedTask.employee_name, PlannedTask.planned_date).all()
        
        # Get employees
        emp_query = db.query(Employee).filter(Employee.is_active == True)
        if team.upper() != "ALL":
            # Map "DEV" to "DEVELOPMENT" for Employee table (Employee.team uses "DEVELOPMENT", not "DEV")
            employee_team_filter = team.upper()
            if employee_team_filter == "DEV":
                employee_team_filter = "DEVELOPMENT"
            emp_query = emp_query.filter(Employee.team == employee_team_filter)
        employees = emp_query.all()
        
        # Build response
        employee_plans = {}
        
        for emp in employees:
            employee_plans[emp.name] = {
                "employee_id": emp.employee_id,
                "employee_name": emp.name,
                "team": emp.team,
                "weekly_plan": None,
                "daily_tasks": {}
            }
            # Initialize days
            for i in range(7):
                day = start_date + timedelta(days=i)
                employee_plans[emp.name]["daily_tasks"][day.isoformat()] = []
        
        # Add weekly plans
        for plan in weekly_plans:
            name = plan.employee_name
            if name in employee_plans:
                employee_plans[name]["weekly_plan"] = {
                    "id": plan.id,
                    "assigned_tickets": plan.assigned_tickets,
                    "total_planned_hours": plan.total_planned_hours,
                    "notes": plan.notes,
                    "status": plan.status
                }
        
        # Add daily tasks
        for task in tasks:
            name = task.employee_name
            if name not in employee_plans:
                employee_plans[name] = {
                    "employee_id": task.employee_id,
                    "employee_name": name,
                    "team": task.team,
                    "weekly_plan": None,
                    "daily_tasks": {}
                }
                for i in range(7):
                    day = start_date + timedelta(days=i)
                    employee_plans[name]["daily_tasks"][day.isoformat()] = []
            
            day_key = task.planned_date.isoformat()
            if day_key in employee_plans[name]["daily_tasks"]:
                employee_plans[name]["daily_tasks"][day_key].append({
                    "id": task.id,
                    "ticket_id": task.ticket_id,
                    "task_title": task.task_title,
                    "planned_hours": task.planned_hours,
                    "priority": task.priority,
                    "status": task.status,
                    "project_name": task.project_name
                })
        
        return {
            "week_start": start_date.isoformat(),
            "week_end": week_end.isoformat(),
            "team": team,
            "employees": list(employee_plans.values())
        }
    finally:
        db.close()


@app.post("/planning/task")
def create_planned_task(task: PlannedTaskCreate):
    """
    Create a new planned task for an employee.
    """
    db = SessionLocal()
    try:
        # Look up employee ID if not provided
        employee_id = task.employee_id
        if not employee_id:
            employee = db.query(Employee).filter(
                Employee.name.ilike(f"%{task.employee_name}%")
            ).first()
            if employee:
                employee_id = employee.employee_id

        new_task = PlannedTask(
            employee_id=employee_id,
            employee_name=task.employee_name,
            ticket_id=task.ticket_id,
            task_title=task.task_title,
            task_description=task.task_description,
            project_name=task.project_name,
            planned_date=task.planned_date,
            planned_hours=task.planned_hours,
            priority=task.priority,
            team=task.team,
            assigned_by=task.assigned_by,
            status='planned'
        )
        
        db.add(new_task)
        db.commit()
        db.refresh(new_task)
        
        return {
            "success": True,
            "task": {
                "id": new_task.id,
                "employee_name": new_task.employee_name,
                "ticket_id": new_task.ticket_id,
                "task_title": new_task.task_title,
                "planned_date": new_task.planned_date.isoformat(),
                "planned_hours": new_task.planned_hours,
                "priority": new_task.priority,
                "status": new_task.status
            }
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@app.put("/planning/task/{task_id}")
def update_planned_task(task_id: int, updates: PlannedTaskUpdate):
    """
    Update an existing planned task.
    """
    db = SessionLocal()
    try:
        task = db.query(PlannedTask).filter(PlannedTask.id == task_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        
        if updates.task_title is not None:
            task.task_title = updates.task_title
        if updates.task_description is not None:
            task.task_description = updates.task_description
        if updates.planned_hours is not None:
            task.planned_hours = updates.planned_hours
        if updates.priority is not None:
            task.priority = updates.priority
        if updates.status is not None:
            task.status = updates.status
            if updates.status == 'completed':
                task.completed_on = datetime.utcnow()
        if updates.actual_hours is not None:
            task.actual_hours = updates.actual_hours
        
        db.commit()
        db.refresh(task)
        
        return {
            "success": True,
            "task": {
                "id": task.id,
                "employee_name": task.employee_name,
                "ticket_id": task.ticket_id,
                "task_title": task.task_title,
                "planned_date": task.planned_date.isoformat(),
                "planned_hours": task.planned_hours,
                "actual_hours": task.actual_hours,
                "priority": task.priority,
                "status": task.status
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@app.delete("/planning/task/{task_id}")
def delete_planned_task(task_id: int):
    """
    Delete a planned task.
    """
    db = SessionLocal()
    try:
        task = db.query(PlannedTask).filter(PlannedTask.id == task_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        
        db.delete(task)
        db.commit()
        
        return {"success": True, "message": f"Task {task_id} deleted"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@app.post("/planning/weekly-plan")
def create_weekly_plan(plan: WeeklyPlanCreate):
    """
    Create or update a weekly plan for an employee.
    """
    db = SessionLocal()
    try:
        # Calculate week details
        week_start = plan.week_start
        # Ensure it's a Monday
        if week_start.weekday() != 0:
            week_start = week_start - timedelta(days=week_start.weekday())
        week_end = week_start + timedelta(days=6)
        year = week_start.isocalendar()[0]
        week_number = week_start.isocalendar()[1]
        
        # Look up employee ID if not provided
        employee_id = plan.employee_id
        if not employee_id:
            employee = db.query(Employee).filter(
                Employee.name.ilike(f"%{plan.employee_name}%")
            ).first()
            if employee:
                employee_id = employee.employee_id
        
        # Calculate total planned hours from tickets
        total_hours = sum(t.get('estimated_hours', 0) for t in plan.assigned_tickets)
        
        # Check if plan exists
        existing = db.query(WeeklyPlan).filter(
            WeeklyPlan.employee_name == plan.employee_name,
            WeeklyPlan.week_start == week_start
        ).first()
        
        if existing:
            # Update existing plan
            existing.assigned_tickets = plan.assigned_tickets
            existing.total_planned_hours = total_hours
            existing.notes = plan.notes
            db.commit()
            db.refresh(existing)
            weekly_plan = existing
        else:
            # Create new plan
            weekly_plan = WeeklyPlan(
                employee_id=employee_id,
                employee_name=plan.employee_name,
                week_start=week_start,
                week_end=week_end,
                year=year,
                week_number=week_number,
                assigned_tickets=plan.assigned_tickets,
                total_planned_hours=total_hours,
                notes=plan.notes,
                team=plan.team,
                planned_by=plan.planned_by,
                status='draft'
            )
            db.add(weekly_plan)
            db.commit()
            db.refresh(weekly_plan)
        
        return {
            "success": True,
            "plan": {
                "id": weekly_plan.id,
                "employee_name": weekly_plan.employee_name,
                "week_start": weekly_plan.week_start.isoformat(),
                "week_end": weekly_plan.week_end.isoformat(),
                "assigned_tickets": weekly_plan.assigned_tickets,
                "total_planned_hours": weekly_plan.total_planned_hours,
                "status": weekly_plan.status
            }
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@app.put("/planning/weekly-plan/{plan_id}")
def update_weekly_plan(plan_id: int, updates: WeeklyPlanUpdate):
    """
    Update a weekly plan.
    """
    db = SessionLocal()
    try:
        plan = db.query(WeeklyPlan).filter(WeeklyPlan.id == plan_id).first()
        if not plan:
            raise HTTPException(status_code=404, detail="Weekly plan not found")
        
        if updates.assigned_tickets is not None:
            plan.assigned_tickets = updates.assigned_tickets
            plan.total_planned_hours = sum(t.get('estimated_hours', 0) for t in updates.assigned_tickets)
        if updates.notes is not None:
            plan.notes = updates.notes
        if updates.status is not None:
            plan.status = updates.status
        
        db.commit()
        db.refresh(plan)
        
        return {
            "success": True,
            "plan": {
                "id": plan.id,
                "employee_name": plan.employee_name,
                "week_start": plan.week_start.isoformat(),
                "assigned_tickets": plan.assigned_tickets,
                "total_planned_hours": plan.total_planned_hours,
                "status": plan.status
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


# ===== PLAN VS ACTUAL COMPARISON API =====

@app.get("/planning/comparison")
def get_plan_vs_actual(
    employee_id: str = Query(None, description="Employee ID (optional, for individual comparison)"),
    team: str = Query("ALL", description="Team: QA, DEV, or ALL"),
    period: str = Query("week", description="Period: week or month"),
    date_str: str = Query(None, description="Reference date (YYYY-MM-DD)")
):
    """
    Get plan vs actual comparison showing planned tasks against actual timesheet entries.
    Returns variance analysis and metrics.
    """
    db = SessionLocal()
    try:
        # Parse date
        if date_str:
            try:
                target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
        else:
            target_date = date.today()
        
        # Calculate period boundaries
        if period == "week":
            start_date = target_date - timedelta(days=target_date.weekday())
            end_date = start_date + timedelta(days=6)
        else:  # month
            start_date = date(target_date.year, target_date.month, 1)
            if start_date.month == 12:
                end_date = date(start_date.year + 1, 1, 1) - timedelta(days=1)
            else:
                end_date = date(start_date.year, start_date.month + 1, 1) - timedelta(days=1)
        
        # Build base queries
        planned_query = db.query(PlannedTask).filter(
            PlannedTask.planned_date >= start_date,
            PlannedTask.planned_date <= end_date
        )
        actual_query = db.query(EnhancedTimesheet).filter(
            EnhancedTimesheet.date >= start_date,
            EnhancedTimesheet.date <= end_date
        )
        
        # Filter by employee if specified
        if employee_id:
            employee = db.query(Employee).filter(Employee.employee_id == employee_id).first()
            if not employee:
                raise HTTPException(status_code=404, detail="Employee not found")
            planned_query = planned_query.filter(PlannedTask.employee_name == employee.name)
            actual_query = actual_query.filter(EnhancedTimesheet.employee_name == employee.name)
        elif team.upper() != "ALL":
            planned_query = planned_query.filter(PlannedTask.team == team.upper())
            actual_query = actual_query.filter(EnhancedTimesheet.team == team.upper())
        
        planned_tasks = planned_query.all()
        actual_entries = actual_query.all()
        
        # Build comparison data by employee
        employee_comparison = defaultdict(lambda: {
            "planned_hours": 0,
            "actual_hours": 0,
            "variance": 0,
            "variance_percent": 0,
            "planned_tasks": [],
            "actual_entries": [],
            "by_ticket": {}
        })
        
        # Process planned tasks
        for task in planned_tasks:
            name = task.employee_name
            employee_comparison[name]["employee_id"] = task.employee_id
            employee_comparison[name]["employee_name"] = name
            employee_comparison[name]["team"] = task.team
            employee_comparison[name]["planned_hours"] += task.planned_hours or 0
            employee_comparison[name]["planned_tasks"].append({
                "id": task.id,
                "ticket_id": task.ticket_id,
                "task_title": task.task_title,
                "planned_hours": task.planned_hours,
                "actual_hours": task.actual_hours,
                "priority": task.priority,
                "status": task.status,
                "date": task.planned_date.isoformat()
            })
            
            # Track by ticket
            ticket = task.ticket_id
            if ticket not in employee_comparison[name]["by_ticket"]:
                employee_comparison[name]["by_ticket"][ticket] = {
                    "planned_hours": 0,
                    "actual_hours": 0
                }
            employee_comparison[name]["by_ticket"][ticket]["planned_hours"] += task.planned_hours or 0
        
        # Process actual entries
        for entry in actual_entries:
            name = entry.employee_name
            if name not in employee_comparison:
                employee_comparison[name]["employee_id"] = entry.employee_id
                employee_comparison[name]["employee_name"] = name
                employee_comparison[name]["team"] = entry.team
            
            employee_comparison[name]["actual_hours"] += entry.hours_logged or 0
            employee_comparison[name]["actual_entries"].append({
                "ticket_id": entry.ticket_id,
                "hours": entry.hours_logged,
                "task_description": entry.task_description,
                "date": entry.date.isoformat()
            })
            
            # Track by ticket
            ticket = entry.ticket_id
            if ticket not in employee_comparison[name]["by_ticket"]:
                employee_comparison[name]["by_ticket"][ticket] = {
                    "planned_hours": 0,
                    "actual_hours": 0
                }
            employee_comparison[name]["by_ticket"][ticket]["actual_hours"] += entry.hours_logged or 0
        
        # Calculate variances
        total_planned = 0
        total_actual = 0
        
        for name, data in employee_comparison.items():
            planned = data["planned_hours"]
            actual = data["actual_hours"]
            variance = actual - planned
            variance_percent = (variance / planned * 100) if planned > 0 else 0
            
            data["variance"] = round(variance, 2)
            data["variance_percent"] = round(variance_percent, 1)
            data["estimation_accuracy"] = round(100 - abs(variance_percent), 1) if planned > 0 else None
            
            # Calculate ticket-level variance
            for ticket, ticket_data in data["by_ticket"].items():
                ticket_planned = ticket_data["planned_hours"]
                ticket_actual = ticket_data["actual_hours"]
                ticket_data["variance"] = round(ticket_actual - ticket_planned, 2)
            
            data["by_ticket"] = dict(data["by_ticket"])
            
            total_planned += planned
            total_actual += actual
        
        # Calculate overall metrics
        overall_variance = total_actual - total_planned
        overall_variance_percent = (overall_variance / total_planned * 100) if total_planned > 0 else 0
        
        return {
            "period": period,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "team": team,
            "employee_id": employee_id,
            "employees": [dict(v) for v in employee_comparison.values()],
            "summary": {
                "total_planned_hours": round(total_planned, 2),
                "total_actual_hours": round(total_actual, 2),
                "total_variance": round(overall_variance, 2),
                "variance_percent": round(overall_variance_percent, 1),
                "estimation_accuracy": round(100 - abs(overall_variance_percent), 1) if total_planned > 0 else None,
                "over_estimation": overall_variance < 0,
                "employee_count": len(employee_comparison)
            }
        }
    finally:
        db.close()


@app.get("/planning/comparison/trends")
def get_comparison_trends(
    team: str = Query("ALL", description="Team: QA, DEV, or ALL"),
    weeks: int = Query(4, description="Number of weeks to analyze")
):
    """
    Get historical trends for plan vs actual comparison.
    Shows estimation accuracy over time.
    """
    db = SessionLocal()
    try:
        today = date.today()
        trends = []
        
        for i in range(weeks):
            # Calculate week boundaries
            week_start = today - timedelta(days=today.weekday() + (i * 7))
            week_end = week_start + timedelta(days=6)
            
            # Query planned tasks for this week
            planned_query = db.query(func.sum(PlannedTask.planned_hours)).filter(
                PlannedTask.planned_date >= week_start,
                PlannedTask.planned_date <= week_end
            )
            
            # Query actual entries for this week
            actual_query = db.query(func.sum(EnhancedTimesheet.hours_logged)).filter(
                EnhancedTimesheet.date >= week_start,
                EnhancedTimesheet.date <= week_end
            )
            
            if team.upper() != "ALL":
                planned_query = planned_query.filter(PlannedTask.team == team.upper())
                actual_query = actual_query.filter(EnhancedTimesheet.team == team.upper())
            
            planned_hours = planned_query.scalar() or 0
            actual_hours = actual_query.scalar() or 0
            
            variance = actual_hours - planned_hours
            variance_percent = (variance / planned_hours * 100) if planned_hours > 0 else 0
            accuracy = 100 - abs(variance_percent) if planned_hours > 0 else None
            
            trends.append({
                "week_start": week_start.isoformat(),
                "week_end": week_end.isoformat(),
                "week_number": week_start.isocalendar()[1],
                "planned_hours": round(float(planned_hours), 2),
                "actual_hours": round(float(actual_hours), 2),
                "variance": round(float(variance), 2),
                "variance_percent": round(float(variance_percent), 1),
                "estimation_accuracy": round(accuracy, 1) if accuracy else None
            })
        
        # Reverse to show oldest first
        trends.reverse()
        
        # Calculate average accuracy
        accuracies = [t["estimation_accuracy"] for t in trends if t["estimation_accuracy"] is not None]
        avg_accuracy = sum(accuracies) / len(accuracies) if accuracies else None
        
        return {
            "team": team,
            "weeks_analyzed": weeks,
            "trends": trends,
            "summary": {
                "average_accuracy": round(avg_accuracy, 1) if avg_accuracy else None,
                "best_week": max(trends, key=lambda x: x["estimation_accuracy"] or 0) if trends else None,
                "worst_week": min(trends, key=lambda x: x["estimation_accuracy"] or 100) if trends else None
            }
        }
    finally:
        db.close()


# ===== EMPLOYEE NAME MAPPING ENDPOINTS =====

@app.get("/employee-mappings")
def get_employee_name_mappings():
    """Get all employee name mappings."""
    db = SessionLocal()
    try:
        mappings = db.query(EmployeeNameMapping).filter(
            EmployeeNameMapping.is_active == True
        ).all()
        
        return {
            "mappings": [
                {
                    "id": m.id,
                    "alternate_name": m.alternate_name,
                    "canonical_name": m.canonical_name,
                    "employee_id": m.employee_id,
                    "source": m.source,
                    "notes": m.notes
                }
                for m in mappings
            ]
        }
    finally:
        db.close()


@app.get("/employee-mappings/unmatched")
def get_unmatched_employee_names():
    """Get names in timesheets that don't have a matching Employee record."""
    db = SessionLocal()
    try:
        from sqlalchemy import func
        
        # Get all employee names
        employees = db.query(Employee.name).all()
        emp_names = set(e[0] for e in employees)
        
        # Get all timesheet names with counts
        ts_names = db.query(
            EnhancedTimesheet.employee_name,
            func.count(EnhancedTimesheet.id).label('entry_count'),
            func.min(EnhancedTimesheet.date).label('min_date'),
            func.max(EnhancedTimesheet.date).label('max_date')
        ).group_by(EnhancedTimesheet.employee_name).all()
        
        # Find unmatched
        unmatched = []
        for name, count, min_date, max_date in ts_names:
            if name not in emp_names:
                # Get team info
                sample = db.query(EnhancedTimesheet.team).filter(
                    EnhancedTimesheet.employee_name == name
                ).first()
                
                unmatched.append({
                    "name": name,
                    "entry_count": count,
                    "date_range": f"{min_date} to {max_date}",
                    "team": sample[0] if sample else None
                })
        
        return {
            "unmatched_count": len(unmatched),
            "unmatched": sorted(unmatched, key=lambda x: x["name"])
        }
    finally:
        db.close()


class NameMappingCreate(BaseModel):
    alternate_name: str
    canonical_name: str
    employee_id: Optional[str] = None
    notes: Optional[str] = None


@app.post("/employee-mappings")
def create_employee_name_mapping(mapping: NameMappingCreate):
    """Create a new employee name mapping and update existing records."""
    db = SessionLocal()
    try:
        # Check if mapping already exists
        existing = db.query(EmployeeNameMapping).filter(
            EmployeeNameMapping.alternate_name == mapping.alternate_name
        ).first()
        
        if existing:
            raise HTTPException(status_code=400, detail="Mapping already exists for this name")
        
        # Find employee ID if not provided
        emp_id = mapping.employee_id
        if not emp_id:
            emp = db.query(Employee).filter(Employee.name == mapping.canonical_name).first()
            emp_id = emp.employee_id if emp else None
        
        # Create mapping
        new_mapping = EmployeeNameMapping(
            alternate_name=mapping.alternate_name,
            canonical_name=mapping.canonical_name,
            employee_id=emp_id,
            source='api',
            notes=mapping.notes
        )
        db.add(new_mapping)
        
        # Update existing timesheet entries
        ts_count = db.query(EnhancedTimesheet).filter(
            EnhancedTimesheet.employee_name == mapping.alternate_name
        ).update({
            'employee_name': mapping.canonical_name,
            'employee_id': emp_id
        }, synchronize_session=False)
        
        # Update leave entries
        leave_count = db.query(LeaveEntry).filter(
            LeaveEntry.employee_name == mapping.alternate_name
        ).update({
            'employee_name': mapping.canonical_name,
            'employee_id': emp_id
        }, synchronize_session=False)
        
        db.commit()
        
        return {
            "success": True,
            "message": f"Mapping created. Updated {ts_count} timesheets and {leave_count} leave entries.",
            "mapping": {
                "alternate_name": mapping.alternate_name,
                "canonical_name": mapping.canonical_name,
                "employee_id": emp_id
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@app.delete("/employee-mappings/{mapping_id}")
def delete_employee_name_mapping(mapping_id: int):
    """Deactivate an employee name mapping."""
    db = SessionLocal()
    try:
        mapping = db.query(EmployeeNameMapping).filter(
            EmployeeNameMapping.id == mapping_id
        ).first()
        
        if not mapping:
            raise HTTPException(status_code=404, detail="Mapping not found")
        
        mapping.is_active = False
        db.commit()
        
        return {"success": True, "message": "Mapping deactivated"}
    finally:
        db.close()