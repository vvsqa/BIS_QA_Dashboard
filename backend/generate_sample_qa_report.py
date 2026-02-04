"""
Generate a sample QA Weekly Report with dummy data (no database required).
Usage: python generate_sample_qa_report.py
Output: backend/reports/QA_Weekly_Report_SAMPLE.pdf
"""

import os
from datetime import datetime, timedelta
from collections import defaultdict

# Add parent so qa_weekly_report_v2 can be imported
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from qa_weekly_report_v2 import get_week_dates, generate_comprehensive_report


def make_ticket(
    ticket_id,
    title,
    priority="Medium",
    status="QC Testing",
    module="Forms Delta",
    qa_tester="Jane Doe",
    developers_str="John Dev",
    dev_estimate=24,
    qa_estimate=8,
    eta_str="2026-02-15",
    ageing_days=12,
    days_to_close=None,
    bugs_total=2,
    tests_total=10,
    tests_passed=8,
    include_full_details=False,
):
    """Build a single ticket dict matching get_enriched_ticket_data structure."""
    try:
        eta_dt = datetime.strptime(eta_str[:10], "%Y-%m-%d") if eta_str and len(eta_str) >= 10 and eta_str[:10].replace("-", "").isdigit() else None
    except (ValueError, TypeError):
        eta_dt = None
    t = {
        "ticket_id": ticket_id,
        "title": title,
        "priority": priority,
        "status": status,
        "eta": eta_dt,
        "eta_str": eta_str,
        "module": module,
        "feature": "User Management",
        "developers_str": developers_str,
        "qa_tester": qa_tester,
        "current_assignee": "QA Team",
        "dev_estimate": dev_estimate,
        "dev_actual": dev_estimate - 2,
        "qa_estimate": qa_estimate,
        "qa_actual": 0,
        "updated_on": datetime.now(),
        "created_on": (datetime.now() - timedelta(days=ageing_days)).strftime("%Y-%m-%d %H:%M"),
        "closed_on": None,
        "ageing_days": ageing_days,
        "days_to_close": days_to_close,
        "priority_changes_count": 0,
        "bugs_total": bugs_total,
        "bugs_open": 1,
        "bugs_closed": bugs_total - 1,
        "bugs_deferred": 0,
        "tests_total": tests_total,
        "tests_passed": tests_passed,
        "tests_failed": tests_total - tests_passed,
        "tests_blocked": 0,
        "tests_untested": 0,
        "bugs_by_severity": {"High": 1, "Medium": bugs_total - 1} if bugs_total else {},
        "pass_rate": round((tests_passed / tests_total * 100), 1) if tests_total else 0,
    }
    if include_full_details:
        t["bug_details"] = [
            {"id": 101, "subject": "Login button not visible", "status": "Closed", "severity": "Medium", "priority": "High", "environment": "Chrome", "assignee": "Jane", "created_on": "2026-01-10"},
            {"id": 102, "subject": "Validation message missing", "status": "Open", "severity": "Low", "priority": "Medium", "environment": "Firefox", "assignee": "Jane", "created_on": "2026-01-12"},
        ]
        t["test_details"] = [
            {"case_id": 1, "status": "Passed", "assigned_to": "QA"},
            {"case_id": 2, "status": "Passed", "assigned_to": "QA"},
            {"case_id": 3, "status": "Failed", "assigned_to": "QA"},
        ]
    return t


def build_sample_data():
    """Build report data structure with dummy data (no DB)."""
    now = datetime.now()
    week_start, week_end = get_week_dates(now)
    prev_week_start = week_start - timedelta(days=7)
    prev_week_end = week_end - timedelta(days=7)

    # Dummy QA tickets (current pending with QA)
    qa_tickets = [
        make_ticket(10001, "User login and session handling", "High (Bugs)", "QC Testing", "Forms Delta", "Alice QC", "Bob Dev", 16, 6, "2026-02-10", 8),
        make_ticket(10002, "Payment gateway integration", "Medium", "QC Testing in Progress", "Payments", "Alice QC", "Carol Dev", 40, 12, "2026-02-14", 5),
        make_ticket(10003, "Report export to Excel", "Low", "QC Testing Hold", "Reports", "Not Assigned", "Bob Dev", 8, 4, "2026-02-20", 22),
    ]

    # Newly added to QC this period
    newly_added = [
        make_ticket(10004, "Forms Delta – validation rules", "High Level 1", "QC Testing", "Forms Delta", "Jane Doe", "John Dev", 24, 8, "2026-02-15", 3),
        make_ticket(10005, "Dashboard widgets API", "Medium", "QC Testing", "Dashboard", "Jane Doe", "Carol Dev", 32, 10, "2026-02-18", 1),
    ]
    for t in newly_added:
        t["moved_to_qc_on"] = now - timedelta(days=2)
        t["moved_from_status"] = "In Progress"

    # Moved to BIS Testing this period
    bis_one = make_ticket(10006, "User profile settings page", "Medium", "BIS Testing", "Profile", "Alice QC", "Bob Dev", 20, 6, "2026-02-05", 14, days_to_close=None, include_full_details=True)
    bis_one["moved_to_bis_on"] = now - timedelta(days=1)
    bis_one["moved_from_status"] = "QC Testing in Progress"
    bis_one["status"] = "BIS Testing"
    bis_moved = [bis_one]

    # Closed this period (QA responsible)
    closed_moved = [
        make_ticket(10007, "Legacy login migration", "High (Bugs)", "Closed", "Auth", "Alice QC", "Bob Dev", 12, 4, "2026-01-28", 10, days_to_close=10),
    ]
    closed_moved[0]["status"] = "Closed"
    closed_moved[0]["closed_on"] = (now - timedelta(days=1)).strftime("%Y-%m-%d %H:%M")

    # In progress (Dev)
    in_progress = [
        make_ticket(10008, "API rate limiting", "High Level 2", "In Progress", "API", "Not Assigned", "Carol Dev", 16, 6, "2026-02-22", 2),
    ]
    in_progress[0]["status"] = "In Progress"

    # Next week plan (eta used for sorting)
    next_plan = [
        make_ticket(10009, "Bulk upload feature", "Medium", "Ready For Development", "Upload", "Not Assigned", "John Dev", 48, 16, "2026-02-25", 0),
    ]
    next_plan[0]["status"] = "Ready For Development"
    next_plan[0]["eta"] = datetime(2026, 2, 25)

    # Priority changes this period
    priority_changes = [
        {"ticket_id": 10002, "title": "Payment gateway integration", "previous_priority": "Low", "new_priority": "Medium", "changed_on": now - timedelta(days=3)},
    ]

    # Breakdowns
    qa_pending_breakdown = {"QC Testing": 2, "QC Testing in Progress": 1, "QC Testing Hold": 1}
    qc_newly_breakdowns = {"by_priority": defaultdict(int, {"High Level 1": 1, "Medium": 1}), "by_status": defaultdict(int, {"QC Testing": 2})}
    bis_breakdowns = {"by_module": defaultdict(int, {"Profile": 1}), "by_feature": defaultdict(int, {"User Management": 1})}
    breakdowns = {
        "by_module": defaultdict(int, {"Forms Delta": 1, "Payments": 1, "Reports": 1}),
        "by_feature": defaultdict(int, {"User Management": 3}),
        "by_priority": defaultdict(int, {"High (Bugs)": 1, "Medium": 1, "Low": 1}),
        "by_status": defaultdict(int, {"QC Testing": 2, "QC Testing in Progress": 1, "QC Testing Hold": 1}),
    }

    total_pending = len(qa_tickets)
    newly_count = len(newly_added)
    bis_count = len(bis_moved)
    closed_count = len(closed_moved)
    at_start_qa_pending = total_pending - newly_count + bis_count + closed_count
    prev_qa = max(0, at_start_qa_pending - 1)
    prev_bis = 0

    data = {
        "week_start": week_start,
        "week_end": week_end,
        "prev_week_start": prev_week_start,
        "prev_week_end": prev_week_end,
        "generation_time": now,
        "current_week": {
            "qa_tickets": qa_tickets,
            "qc_testing_newly_added": newly_added,
            "bis_testing_moved": bis_moved,
            "closed_moved": closed_moved,
            "in_progress": in_progress,
        },
        "qa_pending_breakdown": qa_pending_breakdown,
        "previous_week": {
            "qa_tickets_count": prev_qa,
            "bis_testing_count": prev_bis,
            "closed_count": 0,
        },
        "breakdowns": breakdowns,
        "bis_breakdowns": bis_breakdowns,
        "qc_newly_added_breakdowns": qc_newly_breakdowns,
        "priority_changes": priority_changes,
        "next_week_plan": next_plan,
        "metrics": {
            "total_qa_tickets": total_pending,
            "total_bugs": 5,
            "bugs_open": 2,
            "bugs_fixed": 3,
            "bugs_deferred": 0,
            "total_test_cases": 30,
            "tests_passed": 26,
            "tests_failed": 3,
            "tests_blocked": 1,
        },
        "at_start_qa_pending": at_start_qa_pending,
    }
    return data


def main():
    reports_dir = os.path.join(os.path.dirname(__file__), "reports")
    os.makedirs(reports_dir, exist_ok=True)
    output_path = os.path.join(reports_dir, "QA_Weekly_Report_SAMPLE.pdf")

    print("Building sample QA report data (dummy)...")
    data = build_sample_data()
    print(f"  QA Pending: {len(data['current_week']['qa_tickets'])}")
    print(f"  Newly to QC: {len(data['current_week']['qc_testing_newly_added'])}")
    print(f"  Moved to BIS: {len(data['current_week']['bis_testing_moved'])}")
    print(f"  Priority changes: {len(data['priority_changes'])}")

    print("Generating PDF...")
    generate_comprehensive_report(data, output_path, project_name="Sample Project (Dummy Data)")
    print(f"Done: {output_path}")
    return output_path


if __name__ == "__main__":
    main()
