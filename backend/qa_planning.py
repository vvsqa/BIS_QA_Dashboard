"""
QA Task Planning: helpers and business logic.
Provides QA active tickets overview with priority queue, ageing, activity types, and sub-department grouping.
Excludes BIS Testing tickets - only QC Testing, QC Testing in Progress, QC Testing Hold.
Includes QA planner: week data, tasks, allocations (mirrors dev_planning for QA team).
"""
import math
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
    Helps the lead pick the next ticket to assign based on:
    - next_in_queue: By priority, unassigned first, then ageing
    - on_hold: Tickets in QC Testing Hold (next when hold is released)
    - for_retesting: Tickets that failed QC and came back for retesting
    - ageing: Most days in QA (longest waiting)
    When assignee is provided, prioritizes tickets for that tester (retesting, on hold).
    """
    today = today or date.today()
    tickets = (
        db.query(TicketTracking)
        .filter(TicketTracking.status.in_(QA_QC_STATUSES))
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
    tickets = (
        db.query(TicketTracking)
        .filter(TicketTracking.status.in_(QA_QC_STATUSES))
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
    tickets = (
        db.query(TicketTracking)
        .filter(TicketTracking.status.in_(QC_FAIL_STATUSES))
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

    # Group by lead (case-insensitive key so "Reshma Madhavan Nair" and "RESHMA MADHAVAN NAIR" merge into one team)
    by_lead: Dict[str, Tuple[str, List[Any]]] = {}  # normalized_key -> (display_name, members)
    for e in employees:
        lead = (getattr(e, "lead", None) or "").strip()
        if not lead or lead in exclude:
            lead = "_unassigned"
        if lead == "_unassigned":
            key = "_unassigned"
            display_name = None
        else:
            key = lead.lower()
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
