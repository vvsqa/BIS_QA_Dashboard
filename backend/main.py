from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import Optional
from collections import defaultdict

from database import SessionLocal
from models import Bug, TestPlan, TestRun, TestCase, TestResult, TicketTracking

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