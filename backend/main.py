from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import Optional
from collections import defaultdict

from database import SessionLocal
from models import Bug

app = FastAPI()

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"status": "FastAPI is running"}

@app.get("/bugs")
def get_bugs(
    ticket_id: Optional[int] = Query(None),
    environment: str = Query("All"),
    only_open: bool = Query(False)
):
    db: Session = SessionLocal()

    query = db.query(Bug)
    
    # Only filter by ticket_id if provided and not 0 (0 is used as placeholder for "all")
    if ticket_id is not None and ticket_id != 0:
        query = query.filter(Bug.ticket_id == ticket_id)

    if environment != "All":
        query = query.filter(Bug.environment == environment)

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
    environment: str = Query("All")
):
    db: Session = SessionLocal()

    query = db.query(Bug).filter(Bug.ticket_id == ticket_id)

    if environment != "All":
        query = query.filter(Bug.environment == environment)

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
    environment: str = Query("All")
):
    """Get bug counts by status and severity for the bar chart"""
    db: Session = SessionLocal()

    query = db.query(Bug)
    
    if ticket_id is not None:
        query = query.filter(Bug.ticket_id == ticket_id)

    if environment != "All":
        query = query.filter(Bug.environment == environment)

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
    environment: str = Query("All")
):
    """Get bug counts by priority for the pie chart"""
    db: Session = SessionLocal()

    query = db.query(Bug)
    
    if ticket_id is not None:
        query = query.filter(Bug.ticket_id == ticket_id)

    if environment != "All":
        query = query.filter(Bug.environment == environment)

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
    environment: str = Query("All")
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
    environment: str = Query("All")
):
    """Get bug distribution by assignee"""
    db: Session = SessionLocal()

    query = db.query(Bug)

    if ticket_id is not None:
        query = query.filter(Bug.ticket_id == ticket_id)

    if environment != "All":
        query = query.filter(Bug.environment == environment)

    bugs = query.all()
    db.close()

    assignee_data = defaultdict(lambda: {"open": 0, "closed": 0, "total": 0})
    
    for bug in bugs:
        assignee = bug.assignee or "Unassigned"
        assignee_data[assignee]["total"] += 1
        if bug.status == "Closed":
            assignee_data[assignee]["closed"] += 1
        else:
            assignee_data[assignee]["open"] += 1

    result = {assignee: data for assignee, data in assignee_data.items()}
    return result


@app.get("/bugs/author-breakdown")
def author_breakdown(
    ticket_id: Optional[int] = Query(None),
    environment: str = Query("All")
):
    """Get bug distribution by author (who reported bugs)"""
    db: Session = SessionLocal()

    query = db.query(Bug)

    if ticket_id is not None:
        query = query.filter(Bug.ticket_id == ticket_id)

    if environment != "All":
        query = query.filter(Bug.environment == environment)

    bugs = query.all()
    db.close()

    author_data = defaultdict(lambda: {"total": 0, "by_severity": defaultdict(int)})
    
    for bug in bugs:
        author = bug.author or "Unknown"
        author_data[author]["total"] += 1
        if bug.severity:
            author_data[author]["by_severity"][bug.severity] += 1

    result = {}
    for author, data in author_data.items():
        result[author] = {
            "total": data["total"],
            "by_severity": dict(data["by_severity"])
        }
    
    return result


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