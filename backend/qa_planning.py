"""
QA Task Planning: helpers and business logic.
Provides QA active tickets overview with priority queue, ageing, activity types, and sub-department grouping.
Excludes BIS Testing tickets - only QC Testing, QC Testing in Progress, QC Testing Hold.
Includes QA planner: week data, tasks, allocations (mirrors dev_planning for QA team).
"""
import math
import re
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, cast
from sqlalchemy.types import Date

from models import (
    TicketTracking, TicketStatusHistory, Bug, Employee,
    Holiday, LeaveEntry,
    QAPlanningWeek, QAPlannedTask, QAPlannedAllocation,
    QATicketFlag,
)
from dev_planning import (
    get_working_days_list,
    get_leave_hours_for_employees,
    is_working_day,
)

HOURS_PER_DAY = 8
HOURS_PER_WEEK = 40

# QA statuses (exclude BIS Testing)
QA_QC_STATUSES = ['QC Testing', 'QC Testing in Progress', 'QC Testing Hold']

# Statuses considered closed (excluded from task planner ticket suggestions when showing "all statuses")
CLOSED_STATUSES = ['Closed', 'Moved to Live', 'Completed']

# Statuses that indicate ticket was returned from QA (failed review) - for "Retesting after failure"
QC_FAIL_STATUSES = ['QC Review Fail', 'Tested - Awaiting Fixes', 'Code Review Failed']

# Priority order (1 = highest) - must match TicketsDashboard PRIORITY_ORDER
PRIORITY_ORDER = {
    'URGENT': 1,
    'High (Bugs)': 2,
    'High (Billable)': 3,
    'EPIC!': 4,
    'Medium (Bugs)': 5,
    'High Level 1': 6,
    'High Level 2': 7,
    'High Level 3': 8,
    'High Level 4': 9,
    'Medium': 10,
    'Low': 11,
    'Quote': 12,
    'Suggestion': 13,
}


def _priority_sort_key(priority: str) -> int:
    """Lower = higher priority."""
    return PRIORITY_ORDER.get(priority, 99)


def get_module_for_ticket(db: Session, ticket_id: int) -> Optional[str]:
    """Get module (sub-department) from first Bug linked to ticket."""
    bug = db.query(Bug).filter(Bug.ticket_id == ticket_id).first()
    return bug.module if bug and bug.module else None


def _normalize_platform(value: Optional[str]) -> str:
    """Normalize platform/subdepartment to Web or Mobile.
    Subdepartment 'Mobile' = Mobile; all other values = Web.
    """
    if not value or not str(value).strip():
        return 'Web'
    if str(value).strip().lower() == 'mobile':
        return 'Mobile'
    return 'Web'


def get_platform_for_ticket(db: Session, ticket_id: int, ticket_subdepartment: Optional[str] = None) -> str:
    """
    Get platform (Web/Mobile) for a ticket.
    Prefer Subdepartment from PM Tracker (TicketTracking), fallback to Bug.platform from Redmine.
    """
    # 1. Subdepartment from PM API (synced to TicketTracking) - most reliable for ticket-level
    if ticket_subdepartment and str(ticket_subdepartment).strip():
        return _normalize_platform(ticket_subdepartment)
    # 2. Bug platform from Redmine
    bugs = db.query(Bug).filter(Bug.ticket_id == ticket_id, Bug.platform.isnot(None)).all()
    for bug in bugs:
        if bug.platform:
            return _normalize_platform(bug.platform)
    return 'Web'


def get_moved_to_qc_date(db: Session, ticket_id: int) -> Optional[datetime]:
    """Earliest date ticket moved to any QC status (QC Testing, QC Testing in Progress, QC Testing Hold)."""
    h = (
        db.query(TicketStatusHistory)
        .filter(
            TicketStatusHistory.ticket_id == ticket_id,
            TicketStatusHistory.new_status.in_(QA_QC_STATUSES),
        )
        .order_by(TicketStatusHistory.changed_on.asc())
        .first()
    )
    return h.changed_on if h else None


def get_moved_to_hold_date(db: Session, ticket_id: int) -> Optional[datetime]:
    """Most recent date ticket moved to QC Testing Hold (for hold duration)."""
    h = (
        db.query(TicketStatusHistory)
        .filter(
            TicketStatusHistory.ticket_id == ticket_id,
            TicketStatusHistory.new_status == 'QC Testing Hold',
        )
        .order_by(TicketStatusHistory.changed_on.desc())
        .first()
    )
    return h.changed_on if h else None


def get_moved_to_qc_fail_date(db: Session, ticket_id: int) -> Optional[datetime]:
    """Most recent date ticket moved to any QC fail status (QC Review Fail, Tested - Awaiting Fixes, Code Review Failed)."""
    h = (
        db.query(TicketStatusHistory)
        .filter(
            TicketStatusHistory.ticket_id == ticket_id,
            TicketStatusHistory.new_status.in_(QC_FAIL_STATUSES),
        )
        .order_by(TicketStatusHistory.changed_on.desc())
        .first()
    )
    return h.changed_on if h else None


def get_qc_fail_count(db: Session, ticket_id: int) -> int:
    """Number of times this ticket has been moved to QC Review Fail (or Tested - Awaiting Fixes, Code Review Failed)."""
    count = (
        db.query(TicketStatusHistory)
        .filter(
            TicketStatusHistory.ticket_id == ticket_id,
            TicketStatusHistory.new_status.in_(QC_FAIL_STATUSES),
        )
        .count()
    )
    return count or 0


def _build_qa_module_expertise(db: Session) -> Dict[str, set]:
    """Build { employee_name: set(modules) } from TicketTracking (qc_tester) + Bug (module), and Bug.assignee."""
    result = {}
    # From tickets: qc_tester + ticket's module (via Bug)
    tickets = db.query(TicketTracking).filter(TicketTracking.qc_tester.isnot(None)).all()
    for t in tickets:
        raw = (t.qc_tester or '').strip()
        if not raw:
            continue
        module = get_module_for_ticket(db, t.ticket_id)
        if module:
            for name in (n.strip() for n in raw.split(',') if n.strip()):
                result.setdefault(name, set()).add(module)
    # From bugs: assignee + bug.module (QA often assigned to bugs)
    bugs = db.query(Bug).filter(Bug.assignee.isnot(None), Bug.module.isnot(None)).all()
    for b in bugs:
        name = (b.assignee or '').strip()
        module = (b.module or '').strip()
        if name and module:
            result.setdefault(name, set()).add(module)
    return {k: v for k, v in result.items()}


def _get_qa_availability_this_week(db: Session, today: Optional[date] = None) -> Dict[str, float]:
    """Return { employee_name: remaining_hours } for current week (Mon–Fri)."""
    today = today or date.today()
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=4)
    alloc_map = get_qa_allocated_hours_for_week(week_start, week_end, db, None)
    employees = get_qa_employees(db)
    names = [e.name for e in employees if e.name]
    leave_map = get_leave_hours_for_employees(names, week_start, week_end, db)
    working_days = get_working_days_list(week_start, week_end, db)
    result = {}
    for emp in employees:
        name = emp.name
        if not name:
            continue
        capacity = len(working_days) * HOURS_PER_DAY
        allocated = sum(alloc_map.get(name, {}).values())
        leave = sum(leave_map.get(name, {}).values())
        result[name] = max(0, capacity - allocated - leave)
    return result


def _suggest_qa_for_ticket(
    ticket: Dict,
    qa_names: List[str],
    module_expertise: Dict[str, set],
    availability: Dict[str, float],
    current_workload: Dict[str, int],
    hours_needed: float = 8.0,
) -> Optional[str]:
    """
    Suggest best QA resource for ticket based on module expertise, availability, and current workload.
    Returns top suggestion name or None if no suitable candidate.
    Distributes work across team by penalizing those with high workload.
    """
    module = ticket.get('module') or 'Unassigned'
    hours_needed = ticket.get('qa_estimate_hours') or hours_needed

    scores = []
    for name in qa_names:
        if not name:
            continue
        # Module expertise bonus
        module_match = 2 if module != 'Unassigned' and module in module_expertise.get(name, set()) else 0
        # Availability: can fit the hours
        avail = availability.get(name, 0)
        can_fit = 1.5 if avail >= hours_needed else 0
        # Availability score (more available = better)
        avail_score = min(1.0, avail / HOURS_PER_WEEK) * 0.5
        # Workload penalty (fewer current tickets = better, max penalty 2 points)
        workload = current_workload.get(name, 0)
        workload_penalty = min(2.0, workload * 0.3)
        score = module_match + can_fit + avail_score - workload_penalty
        scores.append((score, avail, -workload, name))

    # Sort by score desc, then by availability desc, then by workload asc (fewer tickets first)
    scores.sort(key=lambda x: (-x[0], -x[1], x[2]))
    if scores:
        return scores[0][3]
    return None


def is_retesting_after_failure(db: Session, ticket_id: int) -> bool:
    """
    True if ticket previously had QC Review Fail / Tested - Awaiting Fixes and then moved back to QC.
    Indicates "Pending for retest" / "Retesting after failure" activity type.
    """
    return get_retest_cycle_count(db, ticket_id) > 0


def get_retest_cycle_count(db: Session, ticket_id: int) -> int:
    """
    Number of times this ticket has repeated the cycle: in QC -> failed (QC Review Fail etc.) -> back to QC.
    Each transition from a fail status back to a QC status counts as one cycle.
    """
    history = (
        db.query(TicketStatusHistory)
        .filter(TicketStatusHistory.ticket_id == ticket_id)
        .order_by(TicketStatusHistory.changed_on.asc())
        .all()
    )
    count = 0
    in_fail = False
    for h in history:
        if h.new_status in QC_FAIL_STATUSES:
            in_fail = True
        elif h.new_status in QA_QC_STATUSES:
            if in_fail:
                count += 1
            in_fail = False
    return count


def get_qa_ticket_suggestions(
    db: Session,
    assignee: Optional[str] = None,
    today: Optional[date] = None,
    limit_per_category: int = 5,
) -> Dict[str, List[Dict]]:
    """
    Return categorized ticket suggestions for the create-task modal.
    Shows tickets of ALL statuses (excluding only closed/completed) so any ticket
    can be selected when adding a task.
    - next_in_queue: By priority, unassigned first, then ageing
    - on_hold: Tickets in QC Testing Hold (next when hold is released)
    - for_retesting: Tickets that failed QC and came back for retesting
    - ageing: Most days in QA (longest waiting)
    When assignee is provided, prioritizes tickets for that tester (retesting, on hold).
    """
    today = today or date.today()
    # All non-closed tickets (all statuses) so user can select any ticket for planning
    # Only include tickets that are still in PM Tracker
    tickets = (
        db.query(TicketTracking)
        .filter(
            TicketTracking.status.isnot(None),
            ~TicketTracking.status.in_(CLOSED_STATUSES),
            TicketTracking.in_pm_tracker == True
        )
        .all()
    )
    assignee_lower = (assignee or "").strip().lower()

    def _ticket_item(t) -> Dict:
        moved_qc = get_moved_to_qc_date(db, t.ticket_id)
        moved_hold = get_moved_to_hold_date(db, t.ticket_id)
        moved_qc_date = moved_qc.date() if moved_qc and hasattr(moved_qc, 'date') else (moved_qc if isinstance(moved_qc, date) else None)
        days_in_qc = (today - moved_qc_date).days if moved_qc_date else 0
        hold_date = moved_hold.date() if moved_hold and hasattr(moved_hold, 'date') else (moved_hold if isinstance(moved_hold, date) else None)
        days_on_hold = (today - hold_date).days if (t.status == 'QC Testing Hold') and hold_date else 0
        retesting = is_retesting_after_failure(db, t.ticket_id)
        retest_cycle_count = get_retest_cycle_count(db, t.ticket_id)
        subdepartment = getattr(t, 'subdepartment', None)
        platform = get_platform_for_ticket(db, t.ticket_id, subdepartment)
        qc = (t.qc_tester or "").strip().lower()
        is_for_tester = assignee_lower and (assignee_lower in qc or qc in assignee_lower) if qc else False
        is_hold = (t.status or "").lower().find("hold") >= 0
        return {
            "ticket_id": t.ticket_id,
            "title": (getattr(t, 'title', None) or '').strip() or f"Ticket #{t.ticket_id}",
            "status": t.status,
            "priority": (t.priority or '').strip() or 'Unspecified',
            "platform": platform,
            "qc_tester": (t.qc_tester or '').strip() or None,
            "qa_estimate_hours": t.qa_estimate_hours,
            "days_in_qc": days_in_qc,
            "days_on_hold": days_on_hold,
            "retesting": retesting,
            "retest_cycle_count": retest_cycle_count,
            "_sort": {
                "priority_order": _priority_sort_key(t.priority or ''),
                "is_unassigned": not bool(qc),
                "is_for_tester": is_for_tester,
                "is_hold": is_hold,
            },
        }

    items = [_ticket_item(t) for t in tickets]

    # next_in_queue: unassigned first, then for this tester (retesting), then by priority, then ageing
    def _next_sort(x):
        s = x["_sort"]
        if s["is_unassigned"]:
            return (0, s["priority_order"], -x["days_in_qc"], x["ticket_id"])
        if s["is_for_tester"]:
            return (1, s["priority_order"], -x["days_in_qc"], x["ticket_id"])
        return (2, s["priority_order"], -x["days_in_qc"], x["ticket_id"])

    next_list = sorted(items, key=_next_sort)[:limit_per_category]
    next_list = [{k: v for k, v in x.items() if k != "_sort"} for x in next_list]

    # on_hold: QC Testing Hold, sorted by days_on_hold desc (longest first) or priority
    on_hold_list = [x for x in items if x["_sort"]["is_hold"]]
    on_hold_list = sorted(on_hold_list, key=lambda x: (
        -1 if x["_sort"]["is_for_tester"] else 0,
        x["_sort"]["priority_order"],
        -x["days_on_hold"],
        x["ticket_id"],
    ))[:limit_per_category]
    on_hold_list = [{k: v for k, v in x.items() if k != "_sort"} for x in on_hold_list]

    # for_retesting: retesting after failure
    retest_list = [x for x in items if x["retesting"]]
    retest_list = sorted(retest_list, key=lambda x: (
        -1 if x["_sort"]["is_for_tester"] else 0,
        x["_sort"]["priority_order"],
        -x["days_in_qc"],
        x["ticket_id"],
    ))[:limit_per_category]
    retest_list = [{k: v for k, v in x.items() if k != "_sort"} for x in retest_list]

    # ageing: most days in QA
    ageing_list = sorted(items, key=lambda x: (-x["days_in_qc"], x["_sort"]["priority_order"], x["ticket_id"]))[:limit_per_category]
    ageing_list = [{k: v for k, v in x.items() if k != "_sort"} for x in ageing_list]

    return {
        "next_in_queue": next_list,
        "on_hold": on_hold_list,
        "for_retesting": retest_list,
        "ageing": ageing_list,
    }


def get_qa_overview_data(db: Session, today: Optional[date] = None) -> Dict[str, Any]:
    """
    Build QA active tickets overview:
    - Status cards: QC Testing, QC Testing in Progress, QC Testing Hold (counts)
    - Queue: tickets sorted by priority then ageing (oldest first within same priority)
    - Ageing: moved_to_qc_on, days_in_qc, days_on_hold
    - Activity type: to_be_started, retesting_after_failure, on_hold_X_days
    - Grouped by sub-department (module)
    - Next in queue (first N for highlighting)
    """
    today = today or date.today()
    # Only include tickets that are still in PM Tracker (excludes stale/deleted tickets)
    tickets = (
        db.query(TicketTracking)
        .filter(
            TicketTracking.status.in_(QA_QC_STATUSES),
            TicketTracking.in_pm_tracker == True
        )
        .all()
    )

    # Precompute for QA resource suggestion
    module_expertise = _build_qa_module_expertise(db)
    availability = _get_qa_availability_this_week(db, today)
    qa_employees = get_qa_employees(db)
    qa_names = [e.name for e in qa_employees if e.name]
    # Fallback: merge in names from historical data (qc_testers, bug assignees, planned tasks)
    seen = set(qa_names)
    for t in db.query(TicketTracking).filter(TicketTracking.qc_tester.isnot(None)).all():
        for n in (x.strip() for x in (t.qc_tester or '').split(',') if x.strip()):
            if n and n not in seen:
                seen.add(n)
                qa_names.append(n)
    for b in db.query(Bug).filter(Bug.assignee.isnot(None)).all():
        n = (b.assignee or '').strip()
        if n and n not in seen:
            seen.add(n)
            qa_names.append(n)
    for row in db.query(QAPlannedTask.employee_name).filter(QAPlannedTask.employee_name.isnot(None)).distinct():
        n = (row[0] or '').strip()
        if n and n not in seen:
            seen.add(n)
            qa_names.append(n)
    # Ensure fallback names have availability (default capacity if not in Employee-based availability)
    for n in qa_names:
        if n not in availability:
            availability[n] = HOURS_PER_WEEK

    # Calculate current workload: how many active QC tickets each person is assigned to
    current_workload: Dict[str, int] = {}
    for t in tickets:
        tester = (t.qc_tester or '').strip()
        if tester:
            for name in (x.strip() for x in tester.split(',') if x.strip()):
                current_workload[name] = current_workload.get(name, 0) + 1

    status_counts = {'QC Testing': 0, 'QC Testing in Progress': 0, 'QC Testing Hold': 0}
    queue = []
    by_module: Dict[str, List[Dict]] = {}

    for ticket in tickets:
        status = ticket.status or 'Unknown'
        if status not in QA_QC_STATUSES:
            continue

        status_counts[status] = status_counts.get(status, 0) + 1

        moved_qc = get_moved_to_qc_date(db, ticket.ticket_id)
        moved_hold = get_moved_to_hold_date(db, ticket.ticket_id)
        module = get_module_for_ticket(db, ticket.ticket_id) or 'Unassigned'
        subdepartment = getattr(ticket, 'subdepartment', None)
        platform = get_platform_for_ticket(db, ticket.ticket_id, subdepartment)
        retesting = is_retesting_after_failure(db, ticket.ticket_id)
        retest_cycle_count = get_retest_cycle_count(db, ticket.ticket_id)

        # Ageing
        moved_qc_date = moved_qc.date() if moved_qc and hasattr(moved_qc, 'date') else (moved_qc if isinstance(moved_qc, date) else None)
        days_in_qc = (today - moved_qc_date).days if moved_qc_date else 0

        hold_date = moved_hold.date() if moved_hold and hasattr(moved_hold, 'date') else (moved_hold if isinstance(moved_hold, date) else None)
        days_on_hold = (today - hold_date).days if status == 'QC Testing Hold' and hold_date else 0

        # Activity type: first time in QA, on hold, in progress, or pending/retesting after failure (with cycle count)
        status_lower = (status or '').lower().replace(' ', '')
        has_time_logged = (ticket.actual_qa_hours or 0) > 0
        is_in_progress = 'inprogress' in status_lower or has_time_logged
        if status == 'QC Testing Hold':
            activity_type = 'on_hold'
            activity_label = f'On hold ({days_on_hold} days)'
        elif retesting:
            activity_type = 'pending_retest'
            # When back in QC after failure: "Pending for retest" and show how many times this cycle repeated
            if is_in_progress:
                activity_label = f'Pending for retest – In progress (cycle {retest_cycle_count})' if retest_cycle_count else 'Pending for retest – In progress'
            else:
                activity_label = f'Pending for retest (cycle {retest_cycle_count})' if retest_cycle_count else 'Pending for retest'
        elif is_in_progress:
            activity_type = 'in_progress'
            activity_label = 'In progress'
        else:
            activity_type = 'to_be_started'
            activity_label = 'To be started'

        priority = (ticket.priority or '').strip() or 'Unspecified'
        developers = []
        if ticket.backend_developer:
            developers.append(ticket.backend_developer)
        if ticket.frontend_developer:
            developers.append(ticket.frontend_developer)
        developers = list(set(developers))

        # Suggested QA resource (only when no qc_tester assigned)
        suggested_qa = None
        if not (ticket.qc_tester and str(ticket.qc_tester).strip()):
            suggested_qa = _suggest_qa_for_ticket(
                {'module': module, 'qa_estimate_hours': ticket.qa_estimate_hours},
                qa_names, module_expertise, availability, current_workload,
            )

        # QA lead for assigned QC tester (lead of the tester's employee record)
        qa_lead = None
        qc_tester_str = (ticket.qc_tester or '').strip()
        if qc_tester_str:
            primary_tester = qc_tester_str.split(',')[0].strip()
            if primary_tester:
                emp = db.query(Employee).filter(Employee.name.ilike(f"%{primary_tester}%")).first()
                if emp and emp.lead:
                    qa_lead = emp.lead.strip()

        item = {
            'ticket_id': ticket.ticket_id,
            'title': (getattr(ticket, 'title', None) or '').strip() or f"Ticket #{ticket.ticket_id}",
            'status': status,
            'priority': priority,
            'priority_order': _priority_sort_key(priority),
            'qc_tester': (ticket.qc_tester or '').strip() or None,
            'qa_lead': qa_lead,
            'suggested_qa': suggested_qa,
            'developers': developers,
            'developers_str': ', '.join(developers) if developers else 'Not Assigned',
            'eta': ticket.eta.isoformat() if ticket.eta else None,
            'qa_estimate_hours': ticket.qa_estimate_hours,
            'qa_actual_hours': ticket.actual_qa_hours,
            'dev_estimate_hours': ticket.dev_estimate_hours,
            'module': module,
            'platform': platform,
            'moved_to_qc_on': moved_qc.isoformat() if moved_qc else None,
            'days_in_qc': days_in_qc,
            'days_on_hold': days_on_hold,
            'activity_type': activity_type,
            'activity_label': activity_label,
            'retest_cycle_count': retest_cycle_count,
            'times_moved_to_fail': get_qc_fail_count(db, ticket.ticket_id),
        }

        queue.append(item)
        if module not in by_module:
            by_module[module] = []
        by_module[module].append(item)

    # Load "Tested By Dev" flags for all tickets in queue
    ticket_ids = [t["ticket_id"] for t in queue]
    tested_by_dev_map = {}
    if ticket_ids:
        for row in db.query(QATicketFlag).filter(QATicketFlag.ticket_id.in_(ticket_ids)).all():
            tested_by_dev_map[row.ticket_id] = bool(row.tested_by_dev)
    for t in queue:
        t["tested_by_dev"] = tested_by_dev_map.get(t["ticket_id"], False)

    # Open bug counts for tickets in queue (used in ETA calendar cards)
    open_bug_statuses = ["New", "Reopened", "Fixed", "Assigned to Dev"]
    open_bugs_map = {}
    if ticket_ids:
        bug_rows = (
            db.query(Bug.ticket_id, func.count(Bug.id))
            .filter(Bug.ticket_id.in_(ticket_ids), Bug.status.in_(open_bug_statuses))
            .group_by(Bug.ticket_id)
            .all()
        )
        open_bugs_map = {ticket_id: count for ticket_id, count in bug_rows}
    for t in queue:
        t["open_bugs_count"] = open_bugs_map.get(t["ticket_id"], 0)

    # Sort queue: priority (asc), then days_in_qc desc (older first), then ticket_id
    queue.sort(key=lambda t: (t['priority_order'], -t['days_in_qc'], t['ticket_id']))

    # Sort each module's list the same way
    for mod, items in by_module.items():
        items.sort(key=lambda t: (t['priority_order'], -t['days_in_qc'], t['ticket_id']))

    # Next in queue: first 5 (or configurable) for highlighting
    next_in_queue_count = 5
    next_ticket_ids = {t['ticket_id'] for t in queue[:next_in_queue_count]}

    for t in queue:
        t['is_next_in_queue'] = t['ticket_id'] in next_ticket_ids

    # Tickets in QC testing for 10+ days (all priorities) — for count and list on click
    in_qc_10_plus = [t for t in queue if t.get('days_in_qc', 0) >= 10]

    return {
        'status_cards': {
            'QC Testing': status_counts['QC Testing'],
            'QC Testing in Progress': status_counts['QC Testing in Progress'],
            'QC Testing Hold': status_counts['QC Testing Hold'],
        },
        'total': len(queue),
        'queue': queue,
        'by_module': {k: {'count': len(v), 'tickets': v} for k, v in by_module.items()},
        'priority_order': list(PRIORITY_ORDER.keys()),
        'in_qc_10_plus': in_qc_10_plus,
    }


def get_qa_qc_review_fail_data(db: Session, today: Optional[date] = None) -> Dict[str, Any]:
    """
    Tickets currently in QC Review Fail status (or Tested - Awaiting Fixes, Code Review Failed).
    Returns a list with same relevant details as overview queue: ticket_id, title, status, priority,
    qc_tester, qa_lead, developers, module, platform, eta, estimates, moved_to_qc_on, moved_to_fail_on, days_in_fail.
    """
    today = today or date.today()
    # Only include tickets that are still in PM Tracker
    tickets = (
        db.query(TicketTracking)
        .filter(
            TicketTracking.status.in_(QC_FAIL_STATUSES),
            TicketTracking.in_pm_tracker == True
        )
        .order_by(TicketTracking.ticket_id.desc())
        .all()
    )
    queue = []
    for ticket in tickets:
        status = ticket.status or 'Unknown'
        module = get_module_for_ticket(db, ticket.ticket_id) or 'Unassigned'
        subdepartment = getattr(ticket, 'subdepartment', None)
        platform = get_platform_for_ticket(db, ticket.ticket_id, subdepartment)
        moved_qc = get_moved_to_qc_date(db, ticket.ticket_id)
        moved_fail = get_moved_to_qc_fail_date(db, ticket.ticket_id)
        moved_fail_date = moved_fail.date() if moved_fail and hasattr(moved_fail, 'date') else (moved_fail if isinstance(moved_fail, date) else None)
        days_in_fail = (today - moved_fail_date).days if moved_fail_date else 0
        times_moved_to_fail = get_qc_fail_count(db, ticket.ticket_id)
        priority = (ticket.priority or '').strip() or 'Unspecified'
        developers = []
        if ticket.backend_developer:
            developers.append(ticket.backend_developer)
        if ticket.frontend_developer:
            developers.append(ticket.frontend_developer)
        developers = list(set(developers))
        qa_lead = None
        qc_tester_str = (ticket.qc_tester or '').strip()
        if qc_tester_str:
            primary_tester = qc_tester_str.split(',')[0].strip()
            if primary_tester:
                emp = db.query(Employee).filter(Employee.name.ilike(f"%{primary_tester}%")).first()
                if emp and emp.lead:
                    qa_lead = emp.lead.strip()
        queue.append({
            'ticket_id': ticket.ticket_id,
            'title': (getattr(ticket, 'title', None) or '').strip() or f"Ticket #{ticket.ticket_id}",
            'status': status,
            'priority': priority,
            'priority_order': _priority_sort_key(priority),
            'qc_tester': (ticket.qc_tester or '').strip() or None,
            'qa_lead': qa_lead,
            'developers': developers,
            'developers_str': ', '.join(developers) if developers else 'Not Assigned',
            'eta': ticket.eta.isoformat() if ticket.eta else None,
            'qa_estimate_hours': ticket.qa_estimate_hours,
            'qa_actual_hours': ticket.actual_qa_hours,
            'dev_estimate_hours': ticket.dev_estimate_hours,
            'module': module,
            'platform': platform,
            'moved_to_qc_on': moved_qc.isoformat() if moved_qc else None,
            'moved_to_fail_on': moved_fail.isoformat() if moved_fail else None,
            'days_in_fail': days_in_fail,
            'times_moved_to_fail': times_moved_to_fail,
        })
    queue.sort(key=lambda t: (t['priority_order'], -t['days_in_fail'], t['ticket_id']))
    return {'tickets': queue, 'total': len(queue)}


# Names to exclude from QA planner display (e.g. manager)
QA_PLANNER_EXCLUDE_NAMES = {"Vishnu VS"}


def _get_qa_manager_name(db: Session) -> Optional[str]:
    """Get QA manager name from employees (role contains QA+MANAGER/LEAD). Excluded from planner."""
    emp = (
        db.query(Employee)
        .filter(
            Employee.is_active == True,
            or_(
                func.upper(Employee.role).like("%QA%MANAGER%"),
                func.upper(Employee.role).like("%QA%LEAD%"),
            ),
            func.upper(Employee.team).like("%QA%"),
        )
        .first()
    )
    return (emp.name or "").strip() if emp else None


def get_qa_employees_for_planner(db: Session, visible_employee_ids: Optional[set] = None) -> List[Any]:
    """
    QA employees for planner: excludes manager, grouped by lead.
    Returns list of (lead_name, members) in order: each lead with their reportees.
    Lead order: QA leads (those with reportees) first, sorted by name; then unassigned.
    When visible_employee_ids is provided (not None), filter to only those employee_ids.
    """
    all_qa = get_qa_employees(db, visible_employee_ids)
    manager_name = _get_qa_manager_name(db)
    exclude = QA_PLANNER_EXCLUDE_NAMES | ({manager_name} if manager_name else set())
    employees = [e for e in all_qa if (e.name or "").strip() not in exclude]

    # Group by lead: normalize key so same person clubs together (case + any whitespace).
    # Applies to all leads (Aravind, Reshma, etc.): "Reshma Madhavan Nair", "RESHMA  MADHAVAN  NAIR",
    # "ARAVIND K V", "Aravind K V" -> single group per lead.
    def _normalize_lead_key(name: str) -> str:
        if not name or name == "_unassigned":
            return "_unassigned"
        s = (name or "").strip()
        if not s:
            return "_unassigned"
        # Collapse any whitespace (spaces, tabs, Unicode) to single space, then lowercase
        return re.sub(r"\s+", " ", s).lower()

    by_lead: Dict[str, Tuple[str, List[Any]]] = {}  # normalized_key -> (display_name, members)
    for e in employees:
        lead = (getattr(e, "lead", None) or "").strip()
        if not lead or lead in exclude:
            lead = "_unassigned"
        if lead == "_unassigned":
            key = "_unassigned"
            display_name = None
        else:
            key = _normalize_lead_key(lead)
            display_name = lead
        if key not in by_lead:
            by_lead[key] = (display_name, [])
        by_lead[key][1].append(e)

    # QA leads = lead names that have reportees (exclude _unassigned). Use title-case for consistent headings.
    qa_lead_keys = sorted(k for k in by_lead if k != "_unassigned")
    ordered: List[Tuple[str, List[Any]]] = []
    for k in qa_lead_keys:
        display_name, members = by_lead[k]
        # Normalize display to title-case so "RESHMA MADHAVAN NAIR" and "Reshma Madhavan Nair" show the same
        heading = (display_name or "").title() if display_name else k
        ordered.append((heading, sorted(members, key=lambda x: (x.name or ""))))
    if "_unassigned" in by_lead:
        _, members = by_lead["_unassigned"]
        ordered.append(("_unassigned", sorted(members, key=lambda x: (x.name or ""))))

    return ordered


def get_qa_employees(db: Session, visible_employee_ids: Optional[set] = None) -> List[Any]:
    """
    QA team employees (active).
    When visible_employee_ids is provided (not None), filter to only those employee_ids.
    Includes employees whose team matches QA patterns OR who have a QA lead assigned.
    """
    # First, try to find employees with QA team designation
    qa = (
        db.query(Employee)
        .filter(
            Employee.is_active == True,
            or_(
                func.upper(Employee.team).in_(['QA', 'QUALITY ASSURANCE', 'QC', 'TESTING']),
                func.upper(Employee.team).like('%QA%'),
                func.upper(Employee.team).like('%QC%'),
                func.upper(Employee.team).like('%QUALITY%'),
                func.upper(Employee.team).like('%TESTING%'),
            ),
        )
        .filter(
            or_(
                Employee.employment_status.is_(None),
                func.upper(Employee.employment_status).like('%ONGOING%'),
                func.upper(Employee.employment_status) == 'ONGOING EMPLOYEE',
            )
        )
        .order_by(Employee.name)
        .all()
    )
    
    result = qa if qa else []
    
    # If no QA team found by team field, also include employees with QA-related roles
    if not result:
        qa_by_role = (
            db.query(Employee)
            .filter(
                Employee.is_active == True,
                or_(
                    Employee.role.like('%QA%'),
                    Employee.role.like('%QC%'),
                    Employee.role.like('%TEST%'),
                    Employee.role.like('%QUALITY%'),
                ),
            )
            .filter(
                or_(
                    Employee.employment_status.is_(None),
                    func.upper(Employee.employment_status).like('%ONGOING%'),
                    func.upper(Employee.employment_status) == 'ONGOING EMPLOYEE',
                )
            )
            .order_by(Employee.name)
            .all()
        )
        if qa_by_role:
            result = qa_by_role
    
    # If still no results, return all active employees (fallback)
    if not result:
        result = (
            db.query(Employee)
            .filter(Employee.is_active == True)
            .order_by(Employee.name)
            .all()
        )
    
    if visible_employee_ids is not None:
        result = [e for e in result if e.employee_id in visible_employee_ids]
    
    return result


# ===== QA PLANNER (Weekly planning, allocations) =====

def _allocation_not_released():
    """Condition: allocation counts (task not released, or allocation date before release date)."""
    return or_(
        QAPlannedTask.resource_released_at.is_(None),
        QAPlannedAllocation.allocation_date < cast(QAPlannedTask.resource_released_at, Date),
    )


def get_qa_allocated_hours_for_week(
    week_start: date, week_end: date, db: Session, planning_week_id: Optional[int] = None
) -> Dict[str, Dict[date, float]]:
    """Return { employee_name: { date: hours } } from QAPlannedAllocation for the week. Excludes allocations on or after resource_released_at."""
    q = (
        db.query(QAPlannedTask.employee_name, QAPlannedAllocation.allocation_date, QAPlannedAllocation.hours)
        .join(QAPlannedAllocation, QAPlannedAllocation.task_id == QAPlannedTask.id)
        .filter(
            QAPlannedTask.status == "active",
            QAPlannedAllocation.allocation_date >= week_start,
            QAPlannedAllocation.allocation_date <= week_end,
            _allocation_not_released(),
        )
    )
    if planning_week_id is not None:
        q = q.filter(QAPlannedTask.planning_week_id == planning_week_id)
    rows = q.all()
    result = {}
    for name, d, hours in rows:
        result.setdefault(name, {})
        result[name][d] = result[name].get(d, 0) + float(hours)
    return result


def get_or_create_qa_planning_week(week_start: date, db: Session, created_by: str) -> QAPlanningWeek:
    """Get existing QA planning week or create one in draft."""
    week_end = week_start + timedelta(days=4)
    pw = db.query(QAPlanningWeek).filter(QAPlanningWeek.week_start == week_start).first()
    if pw:
        return pw
    pw = QAPlanningWeek(week_start=week_start, week_end=week_end, state="draft", created_by=created_by)
    db.add(pw)
    db.commit()
    db.refresh(pw)
    return pw


def get_qa_planning_week(week_start: date, db: Session) -> Optional[QAPlanningWeek]:
    return db.query(QAPlanningWeek).filter(QAPlanningWeek.week_start == week_start).first()


def get_qa_available_hours_on_date(
    employee_name: str,
    target_date: date,
    db: Session,
    exclude_task_id: Optional[int] = None,
) -> float:
    """Get available hours for QA employee on a specific date. Excludes released allocations."""
    q = (
        db.query(func.coalesce(func.sum(QAPlannedAllocation.hours), 0))
        .join(QAPlannedTask, QAPlannedTask.id == QAPlannedAllocation.task_id)
        .filter(
            QAPlannedTask.employee_name == employee_name,
            QAPlannedTask.status == "active",
            QAPlannedAllocation.allocation_date == target_date,
            _allocation_not_released(),
        )
    )
    if exclude_task_id:
        q = q.filter(QAPlannedTask.id != exclude_task_id)
    existing = float(q.scalar() or 0)
    leave_map = get_leave_hours_for_employees([employee_name], target_date, target_date, db)
    leave_hours = leave_map.get(employee_name, {}).get(target_date, 0)
    available = HOURS_PER_DAY - existing - leave_hours
    return max(0, available)


def get_qa_next_available_date(
    employee_name: str,
    from_date: date,
    db: Session,
    max_days: int = 60,
) -> date:
    """First working date on or after from_date where the QA employee has available hours > 0."""
    end = from_date + timedelta(days=max_days)
    working_days = get_working_days_list(from_date, end, db)
    for d in working_days:
        if get_qa_available_hours_on_date(employee_name, d, db) > 0:
            return d
    return from_date


def get_qa_availability_summary(
    employee_name: str,
    week_start: date,
    db: Session,
) -> dict:
    """
    Returns next_fully_available_date (first date with 8h free) and partial_this_week
    (list of {date, available_hours} for days in the week with 0 < hours < 8).
    """
    week_end = week_start + timedelta(days=4)
    working_days = get_working_days_list(week_start, week_end, db)
    today = date.today()
    from_date = week_start if week_start >= today else today

    search_end = from_date + timedelta(days=60)
    next_fully = None
    for d in get_working_days_list(from_date, search_end, db):
        if get_qa_available_hours_on_date(employee_name, d, db) >= 8:
            next_fully = d
            break
    if next_fully is None:
        next_fully = from_date

    partial_this_week = []
    for d in working_days:
        avail = get_qa_available_hours_on_date(employee_name, d, db)
        if 0 < avail < 8:
            partial_this_week.append({"date": d.isoformat(), "available_hours": round(avail, 1)})

    return {
        "next_fully_available_date": next_fully.isoformat(),
        "partial_this_week": partial_this_week,
    }


def simulate_qa_allocation_distribution(
    employee_name: str,
    start_date: date,
    total_hours: float,
    week_start: date,
    week_end: date,
    db: Session,
    planning_week_id: Optional[int] = None,
    exclude_task_id: Optional[int] = None,
    max_hours_per_day: float = 8.0,
) -> List[Tuple[date, float]]:
    """Simulate distributing total_hours from start_date over working days."""
    num_working_days_needed = max(1, math.ceil(total_hours / max_hours_per_day))
    span_days = min(120, num_working_days_needed * 2 + 14)
    range_end = start_date + timedelta(days=span_days)

    working_days = get_working_days_list(start_date, range_end, db)
    if not working_days:
        raise ValueError(f"No working days from {start_date}")

    alloc_map = get_qa_allocated_hours_for_week(start_date, range_end, db, None)
    leave_map = get_leave_hours_for_employees([employee_name], start_date, range_end, db)

    result = []
    remaining = total_hours
    for d in working_days:
        if remaining <= 0:
            break
        existing = alloc_map.get(employee_name, {}).get(d, 0)
        leave_hours = leave_map.get(employee_name, {}).get(d, 0)
        available = HOURS_PER_DAY - existing - leave_hours
        if available <= 0:
            continue
        hours_this_day = min(remaining, max_hours_per_day, available)
        result.append((d, hours_this_day))
        remaining -= hours_this_day

    if remaining > 0:
        raise ValueError(
            f"Cannot fit {total_hours}h for {employee_name} from {start_date}: "
            f"only {total_hours - remaining:.1f}h could be allocated."
        )
    return result


def create_qa_allocations_for_task(
    task_id: int,
    employee_name: str,
    start_date: date,
    total_hours: float,
    db: Session,
    max_hours_per_day: float = 8.0,
) -> List[QAPlannedAllocation]:
    """Create QAPlannedAllocation rows distributing total_hours from start_date."""
    num_working_days_needed = max(1, math.ceil(total_hours / max_hours_per_day))
    span_days = min(120, num_working_days_needed * 2 + 14)
    range_end = start_date + timedelta(days=span_days)

    working_days = get_working_days_list(start_date, range_end, db)
    if not working_days:
        return []

    allocations = []
    remaining = total_hours
    for d in working_days:
        if remaining <= 0:
            break
        existing = (
            db.query(func.coalesce(func.sum(QAPlannedAllocation.hours), 0))
            .join(QAPlannedTask, QAPlannedTask.id == QAPlannedAllocation.task_id)
            .filter(
                QAPlannedTask.employee_name == employee_name,
                QAPlannedTask.status == "active",
                QAPlannedTask.id != task_id,
                QAPlannedAllocation.allocation_date == d,
            )
            .scalar()
        )
        existing = float(existing or 0)
        leave_map = get_leave_hours_for_employees([employee_name], d, d, db)
        leave_hours = leave_map.get(employee_name, {}).get(d, 0)
        available = HOURS_PER_DAY - existing - leave_hours
        if available <= 0:
            continue
        hours_this_day = min(remaining, max_hours_per_day, available)
        al = QAPlannedAllocation(task_id=task_id, allocation_date=d, hours=hours_this_day)
        db.add(al)
        allocations.append(al)
        remaining -= hours_this_day
    if remaining > 0:
        raise ValueError(
            f"Cannot fit all hours: {remaining:.1f}h could not be allocated."
        )
    return allocations


# ===== QC QUEUE PRIORITY SCORING =====

# Score weights for QC queue prioritization
PRIORITY_SCORES = {
    'URGENT': 30,
    'High (Bugs)': 25,
    'High (Billable)': 24,
    'EPIC!': 22,
    'Medium (Bugs)': 18,
    'High Level 1': 20,
    'High Level 2': 18,
    'High Level 3': 16,
    'High Level 4': 14,
    'Medium': 12,
    'Low': 6,
    'Quote': 4,
    'Suggestion': 2,
}


def calculate_qc_priority_score(ticket: Dict, today: Optional[date] = None) -> Dict:
    """
    Calculate a 0-100 priority score for a QC queue ticket.
    Higher score = should be picked up first.

    Returns dict with total score and per-factor breakdown for tooltip.
    """
    today = today or date.today()
    breakdown = {}

    # 1. BASE PRIORITY (0-30)
    priority = ticket.get('priority', '')
    base = PRIORITY_SCORES.get(priority, 10)
    breakdown['priority'] = {'points': base, 'max': 30, 'detail': priority or 'Default'}

    # 2. AGEING IN QC (0-25)
    days_in_qc = ticket.get('days_in_qc', 0) or 0
    if days_in_qc >= 15:
        ageing_pts = 25
    elif days_in_qc >= 10:
        ageing_pts = 20
    elif days_in_qc >= 7:
        ageing_pts = 15
    elif days_in_qc >= 5:
        ageing_pts = 10
    elif days_in_qc >= 3:
        ageing_pts = 7
    elif days_in_qc >= 1:
        ageing_pts = 3
    else:
        ageing_pts = 0
    breakdown['ageing'] = {'points': ageing_pts, 'max': 25, 'detail': f'{days_in_qc} days in QC'}

    # 3. RE-ENTRY BONUS (0-20)
    retest_cycles = ticket.get('retest_cycle_count', 0) or 0
    if retest_cycles > 0:
        reentry_pts = min(20, 10 + (retest_cycles * 5))
    else:
        reentry_pts = 0
    breakdown['reentry'] = {'points': reentry_pts, 'max': 20, 'detail': f'{retest_cycles} cycle(s)' if retest_cycles else 'First pass'}

    # 4. ETA URGENCY (0-15)
    eta_pts = 0
    eta_str = ticket.get('eta')
    eta_detail = 'No ETA'
    if eta_str:
        try:
            if isinstance(eta_str, str):
                eta_date = datetime.fromisoformat(eta_str).date()
            elif isinstance(eta_str, datetime):
                eta_date = eta_str.date()
            elif isinstance(eta_str, date):
                eta_date = eta_str
            else:
                eta_date = None
            if eta_date:
                days_to_eta = (eta_date - today).days
                if days_to_eta < 0:
                    eta_pts = 15
                    eta_detail = f'Overdue by {abs(days_to_eta)} days'
                elif days_to_eta <= 2:
                    eta_pts = 12
                    eta_detail = f'Due in {days_to_eta} days'
                elif days_to_eta <= 5:
                    eta_pts = 8
                    eta_detail = f'Due in {days_to_eta} days'
                elif days_to_eta <= 7:
                    eta_pts = 4
                    eta_detail = f'Due in {days_to_eta} days'
                else:
                    eta_detail = f'Due in {days_to_eta} days'
        except (ValueError, TypeError):
            pass
    breakdown['eta'] = {'points': eta_pts, 'max': 15, 'detail': eta_detail}

    # 5. TICKET TYPE (0-5)
    type_pts = 0
    priority_lower = (priority or '').lower()
    if 'bug' in priority_lower:
        type_pts = 5
        type_detail = 'Bug fix (quick turnaround)'
    elif 'epic' in priority_lower:
        type_pts = 3
        type_detail = 'Epic (large scope)'
    else:
        type_detail = 'Standard'
    breakdown['type'] = {'points': type_pts, 'max': 5, 'detail': type_detail}

    total = min(100, base + ageing_pts + reentry_pts + eta_pts + type_pts)

    return {
        'score': round(total, 1),
        'breakdown': breakdown,
    }


# ===== STATUS DURATION TRACKING =====


def get_status_durations(db: Session, ticket_id: int, today: Optional[date] = None,
                         history=None, created_on=None) -> Dict:
    """
    Compute business days spent in each status for a ticket.
    Uses TicketStatusHistory to walk through transitions chronologically.
    Pass a pre-sorted `history` list (and optionally `created_on`) to skip per-ticket queries
    (used by the aggregate speed endpoint to avoid N+1).
    """
    today = today or date.today()
    if history is None:
        history = (
            db.query(TicketStatusHistory)
            .filter(TicketStatusHistory.ticket_id == ticket_id)
            .order_by(TicketStatusHistory.changed_on.asc())
            .all()
        )

    if not history:
        # No history — check if ticket exists with a current status
        ticket = db.query(TicketTracking).filter(TicketTracking.ticket_id == ticket_id).first()
        if ticket and ticket.status and ticket.created_on:
            created = ticket.created_on.date() if isinstance(ticket.created_on, datetime) else ticket.created_on
            days = max(0, (today - created).days)
            return {
                'ticket_id': ticket_id,
                'durations': {ticket.status: days},
                'total_qc_days': days if ticket.status in QA_QC_STATUSES else 0,
                'total_hold_days': days if ticket.status == 'QC Testing Hold' else 0,
                'current_status': ticket.status,
                'transitions': 0,
            }
        return {'ticket_id': ticket_id, 'durations': {}, 'total_qc_days': 0, 'total_hold_days': 0, 'current_status': None, 'transitions': 0}

    durations = {}
    total_qc_days = 0
    total_hold_days = 0

    # Walk through history: for each transition, compute days in previous status
    for i, h in enumerate(history):
        status = h.previous_status or 'Unknown'
        entered = history[i - 1].changed_on if i > 0 else h.changed_on
        exited = h.changed_on

        if i == 0 and h.previous_status:
            # First record: estimate time in initial status from ticket creation
            created = created_on
            if created is None:
                ticket = db.query(TicketTracking).filter(TicketTracking.ticket_id == ticket_id).first()
                created = ticket.created_on if ticket else None
            if created:
                entered = created

        if entered and exited and entered < exited:
            entered_d = entered.date() if isinstance(entered, datetime) else entered
            exited_d = exited.date() if isinstance(exited, datetime) else exited
            days = max(0, (exited_d - entered_d).days)
            durations[status] = durations.get(status, 0) + days
            if status in QA_QC_STATUSES:
                total_qc_days += days
            if status == 'QC Testing Hold':
                total_hold_days += days

    # Time in current (last) status up to today
    last = history[-1]
    current_status = last.new_status
    if last.changed_on:
        last_d = last.changed_on.date() if isinstance(last.changed_on, datetime) else last.changed_on
        current_days = max(0, (today - last_d).days)
        durations[current_status] = durations.get(current_status, 0) + current_days
        if current_status in QA_QC_STATUSES:
            total_qc_days += current_days
        if current_status == 'QC Testing Hold':
            total_hold_days += current_days

    return {
        'ticket_id': ticket_id,
        'durations': durations,
        'total_qc_days': total_qc_days,
        'total_hold_days': total_hold_days,
        'current_status': current_status,
        'transitions': len(history),
    }


# ===== QC CYCLE DETAIL =====


def get_qc_cycle_details(db: Session, ticket_id: int, today: Optional[date] = None,
                        history=None) -> Dict:
    """
    Return cycle-by-cycle breakdown of QC testing.
    Each cycle: entered QC → testing → result (pass/fail) → exit.
    Pass a pre-sorted `history` list to skip the per-ticket query (avoids N+1).
    """
    today = today or date.today()
    if history is None:
        history = (
            db.query(TicketStatusHistory)
            .filter(TicketStatusHistory.ticket_id == ticket_id)
            .order_by(TicketStatusHistory.changed_on.asc())
            .all()
        )

    cycles = []
    current_cycle = None

    for h in history:
        if h.new_status in QA_QC_STATUSES and current_cycle is None:
            current_cycle = {
                'cycle_number': len(cycles) + 1,
                'entered_qc_on': h.changed_on.isoformat() if h.changed_on else None,
                'started_testing_on': None,
                'result': None,
                'exited_qc_on': None,
                'duration_days': None,
                'tester': h.qc_tester,
            }
        elif h.new_status == 'QC Testing in Progress' and current_cycle:
            current_cycle['started_testing_on'] = h.changed_on.isoformat() if h.changed_on else None
        elif h.new_status in QC_FAIL_STATUSES and current_cycle:
            current_cycle['result'] = 'fail'
            current_cycle['exited_qc_on'] = h.changed_on.isoformat() if h.changed_on else None
            if current_cycle.get('entered_qc_on') and h.changed_on:
                entered = datetime.fromisoformat(current_cycle['entered_qc_on'])
                current_cycle['duration_days'] = max(0, (h.changed_on.date() - entered.date()).days)
            cycles.append(current_cycle)
            current_cycle = None
        elif h.new_status == 'BIS Testing' and current_cycle:
            current_cycle['result'] = 'pass'
            current_cycle['exited_qc_on'] = h.changed_on.isoformat() if h.changed_on else None
            if current_cycle.get('entered_qc_on') and h.changed_on:
                entered = datetime.fromisoformat(current_cycle['entered_qc_on'])
                current_cycle['duration_days'] = max(0, (h.changed_on.date() - entered.date()).days)
            cycles.append(current_cycle)
            current_cycle = None

    # Open cycle (still in QC)
    if current_cycle:
        current_cycle['result'] = 'in_progress'
        if current_cycle.get('entered_qc_on'):
            entered = datetime.fromisoformat(current_cycle['entered_qc_on'])
            current_cycle['duration_days'] = max(0, (today - entered.date()).days)
        cycles.append(current_cycle)

    total = len(cycles)
    passed = sum(1 for c in cycles if c['result'] == 'pass')

    return {
        'ticket_id': ticket_id,
        'total_cycles': total,
        'passed_cycles': passed,
        'failed_cycles': sum(1 for c in cycles if c['result'] == 'fail'),
        'in_progress_cycles': sum(1 for c in cycles if c['result'] == 'in_progress'),
        'first_pass': total == 1 and cycles[0]['result'] == 'pass' if cycles else False,
        'cycles': cycles,
    }


def get_qc_cycles_summary(db: Session, today: Optional[date] = None) -> Dict:
    """
    Aggregate QC cycle stats across all tickets.
    Returns avg cycles, first-pass rate, top cyclers, cycle distribution.
    """
    today = today or date.today()

    # Get all tickets that have been in QC at least once
    ticket_ids = (
        db.query(TicketStatusHistory.ticket_id)
        .filter(TicketStatusHistory.new_status.in_(QA_QC_STATUSES))
        .distinct()
        .all()
    )
    ticket_ids = [row[0] for row in ticket_ids]

    if not ticket_ids:
        return {
            'total_tickets': 0, 'avg_cycles': 0, 'first_pass_rate': 0,
            'cycle_distribution': {}, 'top_cyclers': [],
        }

    all_details = []
    for tid in ticket_ids:
        details = get_qc_cycle_details(db, tid, today)
        if details['total_cycles'] > 0:
            all_details.append(details)

    if not all_details:
        return {
            'total_tickets': 0, 'avg_cycles': 0, 'first_pass_rate': 0,
            'cycle_distribution': {}, 'top_cyclers': [],
        }

    total_tickets = len(all_details)
    total_cycles = sum(d['total_cycles'] for d in all_details)
    first_pass_count = sum(1 for d in all_details if d['first_pass'])

    # Cycle distribution: how many tickets had 1 cycle, 2 cycles, 3+ cycles
    dist = {}
    for d in all_details:
        bucket = str(d['total_cycles']) if d['total_cycles'] <= 3 else '4+'
        dist[bucket] = dist.get(bucket, 0) + 1

    # Top cyclers (tickets with most cycles)
    top = sorted(all_details, key=lambda d: -d['total_cycles'])[:10]
    top_cyclers = [
        {'ticket_id': d['ticket_id'], 'total_cycles': d['total_cycles'],
         'failed_cycles': d['failed_cycles'], 'first_pass': d['first_pass']}
        for d in top
    ]

    return {
        'total_tickets': total_tickets,
        'total_cycles': total_cycles,
        'avg_cycles': round(total_cycles / total_tickets, 2) if total_tickets else 0,
        'first_pass_rate': round((first_pass_count / total_tickets) * 100, 1) if total_tickets else 0,
        'first_pass_count': first_pass_count,
        'cycle_distribution': dist,
        'top_cyclers': top_cyclers,
    }


# ===== AGEING ANALYTICS =====


def get_ageing_overview(db: Session, today: Optional[date] = None) -> Dict:
    """
    Team-wide ageing: tickets by age bucket, avg ageing, bottleneck tickets.
    Only includes tickets currently in QC statuses.
    """
    today = today or date.today()
    overview = get_qa_overview_data(db, today)
    queue = overview.get('queue', [])

    buckets = {'0-3 days': [], '3-7 days': [], '7-15 days': [], '15+ days': []}
    total_days = 0

    for t in queue:
        days = t.get('days_in_qc', 0)
        total_days += days
        if days >= 15:
            buckets['15+ days'].append(t)
        elif days >= 7:
            buckets['7-15 days'].append(t)
        elif days >= 3:
            buckets['3-7 days'].append(t)
        else:
            buckets['0-3 days'].append(t)

    return {
        'total_tickets': len(queue),
        'avg_ageing_days': round(total_days / len(queue), 1) if queue else 0,
        'buckets': {k: {'count': len(v), 'ticket_ids': [t['ticket_id'] for t in v]} for k, v in buckets.items()},
        'bucket_counts': {k: len(v) for k, v in buckets.items()},
        'status_cards': overview.get('status_cards', {}),
    }


def get_ageing_bottlenecks(db: Session, today: Optional[date] = None, limit: int = 20) -> List[Dict]:
    """
    Tickets with longest total QC wait time, with per-status duration breakdown.
    """
    today = today or date.today()
    overview = get_qa_overview_data(db, today)
    queue = overview.get('queue', [])

    # Sort by days_in_qc descending
    sorted_tickets = sorted(queue, key=lambda t: -(t.get('days_in_qc', 0)))[:limit]

    result = []
    for t in sorted_tickets:
        durations = get_status_durations(db, t['ticket_id'], today)
        result.append({
            'ticket_id': t['ticket_id'],
            'title': t.get('title', ''),
            'status': t.get('status', ''),
            'priority': t.get('priority', ''),
            'qc_tester': t.get('qc_tester'),
            'module': t.get('module', ''),
            'days_in_qc': t.get('days_in_qc', 0),
            'retest_cycle_count': t.get('retest_cycle_count', 0),
            'status_durations': durations.get('durations', {}),
            'total_hold_days': durations.get('total_hold_days', 0),
        })

    return result


def get_ticket_flow_rate(db: Session, weeks: int = 8) -> Dict:
    """
    Track rate of tickets entering and exiting QA per week.
    Uses TicketStatusHistory to count transitions into/out of QC statuses.
    """
    today = date.today()
    start_date = today - timedelta(weeks=weeks)

    # Tickets entering QC (new_status is a QC status, previous was not)
    entering = (
        db.query(TicketStatusHistory)
        .filter(
            TicketStatusHistory.new_status.in_(QA_QC_STATUSES),
            ~TicketStatusHistory.previous_status.in_(QA_QC_STATUSES),
            TicketStatusHistory.changed_on >= datetime.combine(start_date, datetime.min.time()),
        )
        .all()
    )

    # Tickets exiting QC (previous_status was QC, new is not QC — e.g., BIS Testing, QC Review Fail)
    exiting = (
        db.query(TicketStatusHistory)
        .filter(
            TicketStatusHistory.previous_status.in_(QA_QC_STATUSES),
            ~TicketStatusHistory.new_status.in_(QA_QC_STATUSES),
            TicketStatusHistory.changed_on >= datetime.combine(start_date, datetime.min.time()),
        )
        .all()
    )

    def _week_key(dt):
        if isinstance(dt, datetime):
            dt = dt.date()
        # Monday of that week
        monday = dt - timedelta(days=dt.weekday())
        return monday.isoformat()

    weekly_in = {}
    weekly_out = {}

    for h in entering:
        wk = _week_key(h.changed_on)
        weekly_in[wk] = weekly_in.get(wk, 0) + 1

    for h in exiting:
        wk = _week_key(h.changed_on)
        weekly_out[wk] = weekly_out.get(wk, 0) + 1

    # Build sorted weekly data
    all_weeks = sorted(set(list(weekly_in.keys()) + list(weekly_out.keys())))
    weekly_data = []
    for wk in all_weeks:
        entering_count = weekly_in.get(wk, 0)
        exiting_count = weekly_out.get(wk, 0)
        weekly_data.append({
            'week_start': wk,
            'entering_qc': entering_count,
            'exiting_qc': exiting_count,
            'net_change': entering_count - exiting_count,
        })

    return {
        'weeks': weeks,
        'total_entering': sum(weekly_in.values()),
        'total_exiting': sum(weekly_out.values()),
        'weekly_data': weekly_data,
    }


# ===== BIS TESTING → CLOSED DURATION TRACKING =====

BIS_STATUS = 'BIS Testing'
BIS_EXIT_STATUSES = ['Closed', 'Moved to Live', 'Completed']


def get_bis_to_closed_tracking(db: Session, today: Optional[date] = None) -> Dict:
    """
    Track tickets from BIS Testing through every subsequent status until Closed.
    Each status leg (BIS Testing → Approved for Live → Moved to Live → Closed) is
    tracked separately with its own duration, giving full visibility into the
    post-QC journey.
    """
    today = today or date.today()

    # Find all entries into BIS Testing
    bis_entries = (
        db.query(TicketStatusHistory)
        .filter(TicketStatusHistory.new_status == BIS_STATUS)
        .order_by(TicketStatusHistory.ticket_id, TicketStatusHistory.changed_on.asc())
        .all()
    )

    # De-duplicate: keep the LATEST entry into BIS per ticket (the final QC pass)
    latest_bis: Dict[int, TicketStatusHistory] = {}
    for h in bis_entries:
        latest_bis[h.ticket_id] = h

    closed_tickets = []
    pending_tickets = []
    total_days = 0
    closed_count = 0

    for ticket_id, bis_entry in latest_bis.items():
        bis_date = bis_entry.changed_on
        if not bis_date:
            continue

        ticket = db.query(TicketTracking).filter(TicketTracking.ticket_id == ticket_id).first()
        title = (ticket.title or '').strip() if ticket else f'Ticket #{ticket_id}'
        priority = (ticket.priority or '').strip() if ticket else ''
        qc_tester = (ticket.qc_tester or '').strip() if ticket else ''

        bis_d = bis_date.date() if isinstance(bis_date, datetime) else bis_date

        # Get all history AFTER entering BIS Testing for this ticket
        post_bis_history = (
            db.query(TicketStatusHistory)
            .filter(
                TicketStatusHistory.ticket_id == ticket_id,
                TicketStatusHistory.changed_on >= bis_date,
            )
            .order_by(TicketStatusHistory.changed_on.asc())
            .all()
        )

        # Build per-status-leg breakdown: each transition is one leg
        status_legs = []
        is_closed = False
        final_status = BIS_STATUS

        for i, h in enumerate(post_bis_history):
            entered_dt = bis_date if i == 0 else post_bis_history[i - 1].changed_on
            exited_dt = h.changed_on

            if entered_dt and exited_dt and entered_dt <= exited_dt:
                entered_d = entered_dt.date() if isinstance(entered_dt, datetime) else entered_dt
                exited_d = exited_dt.date() if isinstance(exited_dt, datetime) else exited_dt
                leg_days = max(0, (exited_d - entered_d).days)

                leg_status = h.previous_status or BIS_STATUS
                status_legs.append({
                    'status': leg_status,
                    'entered_on': entered_dt.isoformat(),
                    'exited_on': exited_dt.isoformat(),
                    'days': leg_days,
                    'next_status': h.new_status,
                })

            final_status = h.new_status
            if h.new_status in BIS_EXIT_STATUSES:
                is_closed = True

        # If still in a status (not closed), add current leg up to today
        if not is_closed:
            last_change = post_bis_history[-1].changed_on if post_bis_history else bis_date
            last_d = last_change.date() if isinstance(last_change, datetime) else last_change
            current_leg_days = max(0, (today - last_d).days)
            current_status = ticket.status if ticket else final_status
            status_legs.append({
                'status': current_status,
                'entered_on': last_change.isoformat() if last_change else bis_date.isoformat(),
                'exited_on': None,
                'days': current_leg_days,
                'next_status': None,
            })

        # Total days from BIS entry to close (or to today if pending)
        close_event_dt = None
        for h in reversed(post_bis_history):
            if h.new_status in BIS_EXIT_STATUSES:
                close_event_dt = h.changed_on
                break

        if is_closed and close_event_dt:
            close_d = close_event_dt.date() if isinstance(close_event_dt, datetime) else close_event_dt
            total_leg_days = max(0, (close_d - bis_d).days)
            total_days += total_leg_days
            closed_count += 1
            closed_tickets.append({
                'ticket_id': ticket_id,
                'title': title,
                'priority': priority,
                'qc_tester': qc_tester,
                'entered_bis_on': bis_date.isoformat(),
                'closed_on': close_event_dt.isoformat(),
                'closed_status': final_status,
                'days_bis_to_closed': total_leg_days,
                'status_legs': status_legs,
            })
        else:
            current_status = ticket.status if ticket else final_status
            days_pending = max(0, (today - bis_d).days)
            pending_tickets.append({
                'ticket_id': ticket_id,
                'title': title,
                'priority': priority,
                'qc_tester': qc_tester,
                'entered_bis_on': bis_date.isoformat(),
                'current_status': current_status,
                'days_since_bis': days_pending,
                'status_legs': status_legs,
            })

    closed_tickets.sort(key=lambda t: -t['days_bis_to_closed'])
    pending_tickets.sort(key=lambda t: -t['days_since_bis'])

    still_in_bis = [t for t in pending_tickets if (t.get('current_status') or '') == BIS_STATUS]

    avg_days = round(total_days / closed_count, 1) if closed_count else 0

    return {
        'summary': {
            'total_closed': closed_count,
            'avg_days_bis_to_closed': avg_days,
            'still_in_bis': len(still_in_bis),
            'total_pending': len(pending_tickets),
        },
        'closed_tickets': closed_tickets,
        'pending_tickets': pending_tickets,
    }


# ===== QA TEAM ACTIVITY SUMMARY / STORY =====


def _get_working_days_range(period: str, db: Session, today: Optional[date] = None) -> Tuple[date, date]:
    """
    Resolve period string to (start_date, end_date).
    - 'past_5_days': last 5 working days (may span > 5 calendar days due to weekends/holidays)
    - 'current_month': 1st of current month to today
    """
    today = today or date.today()
    if period == 'current_month':
        return date(today.year, today.month, 1), today

    # past_5_days: walk back to find 5 working days
    working_found = 0
    check = today
    while working_found < 5:
        check = check - timedelta(days=1)
        if is_working_day(check, db):
            working_found += 1
    return check, today


def get_qa_activity_summary(
    db: Session,
    period: str = 'past_5_days',
    today: Optional[date] = None,
    start_date_override: Optional[date] = None,
    end_date_override: Optional[date] = None,
) -> Dict:
    """
    Build per-member activity story for the given period.
    For each QA team member, shows:
    - Tickets they touched (status changed while they were qc_tester)
    - Full status transition timeline for each ticket
    - Hold events, priority switches, current status
    - Summary stats: tickets tested, passed, failed, on hold, avg cycle time
    Supports custom date range via start_date_override/end_date_override.
    """
    today = today or date.today()
    if start_date_override and end_date_override:
        start_date, end_date = start_date_override, end_date_override
    else:
        start_date, end_date = _get_working_days_range(period, db, today)

    start_dt = datetime.combine(start_date, datetime.min.time())
    end_dt = datetime.combine(end_date, datetime.max.time())

    # Get all status changes in the period
    changes = (
        db.query(TicketStatusHistory)
        .filter(
            TicketStatusHistory.changed_on >= start_dt,
            TicketStatusHistory.changed_on <= end_dt,
        )
        .order_by(TicketStatusHistory.changed_on.asc())
        .all()
    )

    # Collect ticket IDs that had changes
    ticket_ids_in_period = set(h.ticket_id for h in changes)

    # Load ticket metadata
    tickets_map: Dict[int, TicketTracking] = {}
    if ticket_ids_in_period:
        for t in db.query(TicketTracking).filter(TicketTracking.ticket_id.in_(ticket_ids_in_period)).all():
            tickets_map[t.ticket_id] = t

    # Map: tester_name_lower -> { ticket_id -> list of events }
    tester_activity: Dict[str, Dict[int, List[Dict]]] = {}

    for h in changes:
        ticket = tickets_map.get(h.ticket_id)
        # Use qc_tester from the history record first, fallback to ticket record
        qc_tester = (h.qc_tester or '').strip()
        if not qc_tester and ticket:
            qc_tester = (ticket.qc_tester or '').strip()
        if not qc_tester:
            continue

        # Split multiple testers
        for name in (n.strip() for n in qc_tester.split(',') if n.strip()):
            name_lower = name.lower()
            if name_lower not in tester_activity:
                tester_activity[name_lower] = {}
            if h.ticket_id not in tester_activity[name_lower]:
                tester_activity[name_lower][h.ticket_id] = []

            tester_activity[name_lower][h.ticket_id].append({
                'timestamp': h.changed_on.isoformat() if h.changed_on else None,
                'from_status': h.previous_status,
                'to_status': h.new_status,
            })

    # Build per-member stories
    qa_employees = get_qa_employees(db)
    emp_map = {(e.name or '').strip().lower(): e for e in qa_employees}

    member_stories = []

    for emp in qa_employees:
        emp_name = (emp.name or '').strip()
        emp_lower = emp_name.lower()
        activity = tester_activity.get(emp_lower, {})

        if not activity:
            member_stories.append({
                'employee_id': emp.employee_id,
                'name': emp_name,
                'designation': emp.designation,
                'platform': getattr(emp, 'platform', None) or 'Web',
                'ticket_count': 0,
                'tickets': [],
                'stats': {'tested': 0, 'passed': 0, 'failed': 0, 'on_hold': 0, 'in_progress': 0},
                'story_lines': ['No QC activity recorded in this period.'],
            })
            continue

        ticket_stories = []
        stats = {'tested': 0, 'passed': 0, 'failed': 0, 'on_hold': 0, 'in_progress': 0}
        story_lines = []

        for ticket_id, events in activity.items():
            ticket = tickets_map.get(ticket_id)
            title = (ticket.title or '').strip() if ticket else f'Ticket #{ticket_id}'
            priority = (ticket.priority or '').strip() if ticket else 'Unspecified'
            current_status = ticket.status if ticket else events[-1]['to_status']
            module = None
            if ticket:
                bug = db.query(Bug).filter(Bug.ticket_id == ticket_id).first()
                module = (bug.module or '').strip() if bug and bug.module else None

            # Full history for this ticket (not just period) for complete context
            full_history = (
                db.query(TicketStatusHistory)
                .filter(TicketStatusHistory.ticket_id == ticket_id)
                .order_by(TicketStatusHistory.changed_on.asc())
                .all()
            )

            timeline = []
            for fh in full_history:
                in_period = start_dt <= fh.changed_on <= end_dt if fh.changed_on else False
                timeline.append({
                    'timestamp': fh.changed_on.isoformat() if fh.changed_on else None,
                    'from_status': fh.previous_status,
                    'to_status': fh.new_status,
                    'in_period': in_period,
                })

            # Compute stats from period events
            had_hold = any(e['to_status'] == 'QC Testing Hold' for e in events)
            had_fail = any(e['to_status'] in QC_FAIL_STATUSES for e in events)
            had_pass = any(e['to_status'] == 'BIS Testing' for e in events)
            was_in_progress = any(e['to_status'] == 'QC Testing in Progress' for e in events)

            stats['tested'] += 1
            if had_pass:
                stats['passed'] += 1
            if had_fail:
                stats['failed'] += 1
            if had_hold:
                stats['on_hold'] += 1
            if was_in_progress and not had_pass and not had_fail:
                stats['in_progress'] += 1

            # Build narrative line for this ticket
            narrative = f'#{ticket_id} ({priority})'
            if had_hold:
                narrative += ' — was put on hold'
            if had_fail:
                narrative += ' — failed QC review'
            if had_pass:
                narrative += ' — passed to BIS Testing'
            elif current_status:
                narrative += f' — currently in {current_status}'

            story_lines.append(narrative)

            ticket_stories.append({
                'ticket_id': ticket_id,
                'title': title,
                'priority': priority,
                'module': module,
                'current_status': current_status,
                'qa_estimate_hours': ticket.qa_estimate_hours if ticket else None,
                'qa_actual_hours': ticket.actual_qa_hours if ticket else None,
                'period_events': events,
                'full_timeline': timeline,
                'had_hold': had_hold,
                'had_fail': had_fail,
                'had_pass': had_pass,
            })

        # Sort tickets: highest priority first
        ticket_stories.sort(key=lambda t: (_priority_sort_key(t['priority']), t['ticket_id']))

        member_stories.append({
            'employee_id': emp.employee_id,
            'name': emp_name,
            'designation': emp.designation,
            'platform': getattr(emp, 'platform', None) or 'Web',
            'ticket_count': len(ticket_stories),
            'tickets': ticket_stories,
            'stats': stats,
            'story_lines': story_lines,
        })

    # Sort: members with activity first (desc by ticket count), then idle
    member_stories.sort(key=lambda m: (-m['ticket_count'], m['name']))

    # Team-level stats
    total_tested = sum(m['stats']['tested'] for m in member_stories)
    total_passed = sum(m['stats']['passed'] for m in member_stories)
    total_failed = sum(m['stats']['failed'] for m in member_stories)
    active_members = sum(1 for m in member_stories if m['ticket_count'] > 0)

    return {
        'period': period,
        'start_date': start_date.isoformat(),
        'end_date': end_date.isoformat(),
        'team_stats': {
            'total_tickets_touched': total_tested,
            'total_passed': total_passed,
            'total_failed': total_failed,
            'active_members': active_members,
            'total_members': len(member_stories),
        },
        'members': member_stories,
    }
