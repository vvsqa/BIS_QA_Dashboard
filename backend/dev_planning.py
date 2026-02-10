"""
Development Task Planning: helpers and business logic.
Planning week = Monday–Friday; 8h/day, 40h/week max; no allocation on weekends/holidays/leave.
Tasks can span multiple weeks (e.g. 25h at 1h/day = 25 working days).
"""
import math
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from models import (
    Employee, Holiday, LeaveEntry, TicketTracking,
    DevPlanningWeek, DevPlannedTask, DevPlannedAllocation, DevPlanningAuditLog,
)

HOURS_PER_DAY = 8
HOURS_PER_WEEK = 40
ALLOCATION_PCT_VALID = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
GENERIC_CATEGORIES = [
    "Team Meetings",
    "Customer Support",
    "Training",
    "KT",
    "Leave",
    "Miscellaneous",
    "Generic Task",
    "Regression",
    "Live Testing",
]
TASK_CATEGORIES = [
    "Ticket",
    "Team Meetings",
    "Customer Support",
    "Training",
    "KT",
    "Leave",
    "Miscellaneous",
    "Generic Task",
    "Regression",
    "Live Testing",
]
PLANNING_STATES = ["draft", "submitted", "approved", "locked"]


def _is_weekend(d: date) -> bool:
    return d.weekday() >= 5


def _is_holiday(d: date, db: Session, include_optional: bool = False) -> bool:
    q = db.query(Holiday).filter(
        Holiday.holiday_date == d,
        Holiday.is_active == True,
    )
    if not include_optional:
        q = q.filter(Holiday.category == "Holiday")
    return q.first() is not None


def is_working_day(d: date, db: Session, include_optional_holidays: bool = False) -> bool:
    if _is_weekend(d):
        return False
    if _is_holiday(d, db, include_optional=include_optional_holidays):
        return False
    return True


def get_planning_week_dates(reference_date: Optional[date] = None) -> Tuple[date, date]:
    """Return (Monday, Friday) for the week containing reference_date. Default: current week."""
    ref = reference_date or date.today()
    if isinstance(ref, datetime):
        ref = ref.date()
    monday = ref - timedelta(days=ref.weekday())
    friday = monday + timedelta(days=4)
    return monday, friday


def get_working_days_list(week_start: date, week_end: date, db: Session) -> List[date]:
    """List of working days (Mon–Fri, excluding holidays) in [week_start, week_end]."""
    out = []
    d = week_start
    while d <= week_end:
        if is_working_day(d, db, include_optional_holidays=False):
            out.append(d)
        d += timedelta(days=1)
    return out


def get_leave_hours_for_employees(
    employee_names: List[str], start_date: date, end_date: date, db: Session
) -> Dict[str, Dict[date, float]]:
    """Return { employee_name: { date: hours } } for leave in range. Leave day = 8h (or 4 for half)."""
    result = {name: {} for name in employee_names}
    if not employee_names:
        return result
    rows = (
        db.query(LeaveEntry.employee_name, LeaveEntry.date, LeaveEntry.hours)
        .filter(
            LeaveEntry.employee_name.in_(employee_names),
            LeaveEntry.date >= start_date,
            LeaveEntry.date <= end_date,
            LeaveEntry.status == "approved",
        )
        .all()
    )
    for name, d, hours in rows:
        result.setdefault(name, {})[d] = float(hours or 8)
    return result


def get_allocated_hours_for_week(
    week_start: date, week_end: date, db: Session, planning_week_id: Optional[int] = None
) -> Dict[str, Dict[date, float]]:
    """Return { employee_name: { date: hours } } from DevPlannedAllocation for the week."""
    q = (
        db.query(DevPlannedTask.employee_name, DevPlannedAllocation.allocation_date, DevPlannedAllocation.hours)
        .join(DevPlannedAllocation, DevPlannedAllocation.task_id == DevPlannedTask.id)
        .filter(
            DevPlannedTask.status == "active",
            DevPlannedAllocation.allocation_date >= week_start,
            DevPlannedAllocation.allocation_date <= week_end,
        )
    )
    if planning_week_id is not None:
        q = q.filter(DevPlannedTask.planning_week_id == planning_week_id)
    rows = q.all()
    result = {}
    for name, d, hours in rows:
        result.setdefault(name, {})
        result[name][d] = result[name].get(d, 0) + float(hours)
    return result


def get_development_employees(db: Session, visible_employee_ids: Optional[set] = None) -> List[Employee]:
    """
    Development team employees (active). Includes team DEVELOPMENT, DEV, or any variation.
    Also includes employees with DEV-related roles.
    Fallback: all active if none match.
    When visible_employee_ids is provided (not None), filter to only those employee_ids.
    """
    # First, try to find employees with DEV team designation
    dev = (
        db.query(Employee)
        .filter(
            Employee.is_active == True,
            or_(
                func.upper(Employee.team).in_(["DEVELOPMENT", "DEV"]),
                func.upper(Employee.team).like("%DEV%"),
            ),
        )
        .filter(
            or_(
                Employee.employment_status.is_(None),
                func.upper(Employee.employment_status).like("%ONGOING%"),
                func.upper(Employee.employment_status) == "ONGOING EMPLOYEE",
            )
        )
        .order_by(Employee.name)
        .all()
    )
    
    result = dev if dev else []
    
    # If no DEV team found by team field, also include employees with DEV-related roles
    if not result:
        dev_by_role = (
            db.query(Employee)
            .filter(
                Employee.is_active == True,
                or_(
                    Employee.role.like('%DEV%'),
                    Employee.role.like('%DEVELOPER%'),
                    Employee.role.like('%BACKEND%'),
                    Employee.role.like('%FRONTEND%'),
                    Employee.role.like('%FULLSTACK%'),
                ),
            )
            .filter(
                or_(
                    Employee.employment_status.is_(None),
                    func.upper(Employee.employment_status).like("%ONGOING%"),
                    func.upper(Employee.employment_status) == "ONGOING EMPLOYEE",
                )
            )
            .order_by(Employee.name)
            .all()
        )
        if dev_by_role:
            result = dev_by_role
    
    # Fallback: show all active employees so the module is usable (e.g. team column not set)
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


def get_or_create_planning_week(week_start: date, db: Session, created_by: str) -> DevPlanningWeek:
    """Get existing planning week or create one in draft."""
    week_end = week_start + timedelta(days=4)
    pw = db.query(DevPlanningWeek).filter(DevPlanningWeek.week_start == week_start).first()
    if pw:
        return pw
    pw = DevPlanningWeek(week_start=week_start, week_end=week_end, state="draft", created_by=created_by)
    db.add(pw)
    db.commit()
    db.refresh(pw)
    return pw


def get_planning_week(week_start: date, db: Session) -> Optional[DevPlanningWeek]:
    return db.query(DevPlanningWeek).filter(DevPlanningWeek.week_start == week_start).first()


def get_available_hours_on_date(
    employee_name: str,
    target_date: date,
    db: Session,
    exclude_task_id: Optional[int] = None,
) -> float:
    """Get available hours for an employee on a specific date (8h - existing allocations - leave)."""
    # Existing allocations
    q = (
        db.query(func.coalesce(func.sum(DevPlannedAllocation.hours), 0))
        .join(DevPlannedTask, DevPlannedTask.id == DevPlannedAllocation.task_id)
        .filter(
            DevPlannedTask.employee_name == employee_name,
            DevPlannedTask.status == "active",
            DevPlannedAllocation.allocation_date == target_date,
        )
    )
    if exclude_task_id:
        q = q.filter(DevPlannedTask.id != exclude_task_id)
    existing = float(q.scalar() or 0)

    # Leave hours
    leave_map = get_leave_hours_for_employees([employee_name], target_date, target_date, db)
    leave_hours = leave_map.get(employee_name, {}).get(target_date, 0)

    available = HOURS_PER_DAY - existing - leave_hours
    return max(0, available)


def get_next_available_date(
    employee_name: str,
    from_date: date,
    db: Session,
    max_days: int = 60,
) -> date:
    """First working date on or after from_date where the employee has available hours > 0."""
    end = from_date + timedelta(days=max_days)
    working_days = get_working_days_list(from_date, end, db)
    for d in working_days:
        if get_available_hours_on_date(employee_name, d, db) > 0:
            return d
    return from_date


def get_availability_summary(
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
        if get_available_hours_on_date(employee_name, d, db) >= 8:
            next_fully = d
            break
    if next_fully is None:
        next_fully = from_date

    partial_this_week = []
    for d in working_days:
        avail = get_available_hours_on_date(employee_name, d, db)
        if 0 < avail < 8:
            partial_this_week.append({"date": d.isoformat(), "available_hours": round(avail, 1)})

    return {
        "next_fully_available_date": next_fully.isoformat(),
        "partial_this_week": partial_this_week,
    }


def check_duplicate_task(
    employee_name: str,
    ticket_id: Optional[int],
    generic_category: Optional[str],
    proposed_dates: List[date],
    db: Session,
    exclude_task_id: Optional[int] = None,
) -> Optional[str]:
    """
    Check if a task with the same ticket_id (or generic_category) already exists
    for the same employee on any of the proposed dates.
    Returns error message if duplicate found, None otherwise.
    """
    if not proposed_dates:
        return None

    # Build query for existing active tasks for this employee
    q = db.query(DevPlannedTask).filter(
        DevPlannedTask.employee_name == employee_name,
        DevPlannedTask.status == "active",
    )
    if exclude_task_id:
        q = q.filter(DevPlannedTask.id != exclude_task_id)

    if ticket_id:
        q = q.filter(DevPlannedTask.ticket_id == ticket_id)
    elif generic_category:
        q = q.filter(DevPlannedTask.generic_category == generic_category)
    else:
        return None  # Can't check without ticket or category

    existing_tasks = q.all()
    if not existing_tasks:
        return None

    # Check for overlapping allocation dates
    proposed_set = set(proposed_dates)
    for task in existing_tasks:
        allocs = db.query(DevPlannedAllocation).filter(
            DevPlannedAllocation.task_id == task.id
        ).all()
        existing_dates = {a.allocation_date for a in allocs}
        overlap = proposed_set & existing_dates
        if overlap:
            overlap_str = ", ".join(d.strftime("%Y-%m-%d") for d in sorted(overlap)[:3])
            if len(overlap) > 3:
                overlap_str += f" (+{len(overlap) - 3} more)"
            if ticket_id:
                return f"Ticket #{ticket_id} is already allocated for {employee_name} on {overlap_str}. Cannot create duplicate entries for the same task on the same days."
            else:
                return f"A '{generic_category}' task already exists for {employee_name} on {overlap_str}. Cannot create duplicate entries."
    return None


def simulate_allocation_distribution(
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
    """
    Simulate distributing total_hours from start_date over working days (max max_hours_per_day per day).
    Spans multiple weeks if needed (e.g. 25h at 1h/day = 25 working days).
    Returns list of (date, hours) for each day. Raises ValueError if cannot fit all hours.
    """
    num_working_days_needed = max(1, math.ceil(total_hours / max_hours_per_day))
    # Extend range: ~2 calendar days per working day to account for weekends
    span_days = min(120, num_working_days_needed * 2 + 14)
    range_end = start_date + timedelta(days=span_days)

    working_days = get_working_days_list(start_date, range_end, db)
    if not working_days:
        raise ValueError(f"No working days from {start_date}")

    # Use planning_week_id=None to see ALL existing allocations across weeks
    alloc_map = get_allocated_hours_for_week(start_date, range_end, db, None)
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
        # Allocate min of: remaining hours, max allowed per day, available capacity
        hours_this_day = min(remaining, max_hours_per_day, available)
        result.append((d, hours_this_day))
        remaining -= hours_this_day

    if remaining > 0:
        raise ValueError(
            f"Cannot fit {total_hours}h for {employee_name} from {start_date}: "
            f"only {total_hours - remaining:.1f}h could be allocated (days may be full or have leave)."
        )

    # Validate per-week: no week exceeds 40h (existing + leave + our allocation)
    weeks_covered = set()
    for d, h in result:
        mon = d - timedelta(days=d.weekday())
        weeks_covered.add(mon)
    for mon in weeks_covered:
        fri = mon + timedelta(days=4)
        existing_week = sum(alloc_map.get(employee_name, {}).get(d, 0) for d in alloc_map.get(employee_name, {}) if mon <= d <= fri)
        leave_total = sum(leave_map.get(employee_name, {}).get(d, 0) for d in leave_map.get(employee_name, {}) if mon <= d <= fri)
        our_hours = sum(h for d, h in result if mon <= d <= fri)
        if existing_week + leave_total + our_hours > HOURS_PER_WEEK:
            raise ValueError(
                f"Over-allocation: {employee_name} would have {existing_week + leave_total + our_hours:.1f}h "
                f"for week of {mon} (max {HOURS_PER_WEEK}h including leave)."
            )
    return result


def validate_allocation(
    employee_name: str,
    allocation_date: date,
    add_hours: float,
    week_start: date,
    week_end: date,
    db: Session,
    planning_week_id: Optional[int] = None,
    exclude_task_id: Optional[int] = None,
) -> None:
    """Raise ValueError if adding add_hours would exceed 8h/day or 40h/week."""
    # Day cap
    existing_day = 0.0
    if planning_week_id is not None:
        q = (
            db.query(func.coalesce(func.sum(DevPlannedAllocation.hours), 0))
            .join(DevPlannedTask, DevPlannedTask.id == DevPlannedAllocation.task_id)
            .filter(
                DevPlannedTask.employee_name == employee_name,
                DevPlannedTask.status == "active",
                DevPlannedAllocation.allocation_date == allocation_date,
            )
        )
        if exclude_task_id is not None:
            q = q.filter(DevPlannedTask.id != exclude_task_id)
        existing_day = float(q.scalar() or 0)
    if existing_day + add_hours > HOURS_PER_DAY:
        raise ValueError(
            f"Over-allocation: {employee_name} would have {existing_day + add_hours:.1f}h on {allocation_date} (max {HOURS_PER_DAY}h/day)."
        )

    # Week cap
    existing_week = 0.0
    if planning_week_id is not None:
        q = (
            db.query(func.coalesce(func.sum(DevPlannedAllocation.hours), 0))
            .join(DevPlannedTask, DevPlannedTask.id == DevPlannedAllocation.task_id)
            .filter(
                DevPlannedTask.employee_name == employee_name,
                DevPlannedTask.status == "active",
                DevPlannedAllocation.allocation_date >= week_start,
                DevPlannedAllocation.allocation_date <= week_end,
            )
        )
        if exclude_task_id is not None:
            q = q.filter(DevPlannedTask.id != exclude_task_id)
        existing_week = float(q.scalar() or 0)
    # Add leave for the week
    leave_map = get_leave_hours_for_employees([employee_name], week_start, week_end, db)
    leave_total = sum(leave_map.get(employee_name, {}).values())
    total_with_new = existing_week + leave_total + add_hours
    if total_with_new > HOURS_PER_WEEK:
        raise ValueError(
            f"Over-allocation: {employee_name} would have {total_with_new:.1f}h for the week (max {HOURS_PER_WEEK}h including leave)."
        )


def create_allocations_for_task(
    task_id: int,
    employee_name: str,
    start_date: date,
    total_hours: float,
    week_start: date,
    week_end: date,
    db: Session,
    planning_week_id: int,
    max_hours_per_day: float = 8.0,
) -> List[DevPlannedAllocation]:
    """
    Create DevPlannedAllocation rows distributing total_hours from start_date over working days.
    Spans multiple weeks if needed (e.g. 25h at 1h/day = 25 working days).
    Respects max_hours_per_day and 8h/day cap.
    """
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
        # How much can we put on this day?
        existing = (
            db.query(func.coalesce(func.sum(DevPlannedAllocation.hours), 0))
            .join(DevPlannedTask, DevPlannedTask.id == DevPlannedAllocation.task_id)
            .filter(
                DevPlannedTask.employee_name == employee_name,
                DevPlannedTask.status == "active",
                DevPlannedTask.id != task_id,
                DevPlannedAllocation.allocation_date == d,
            )
            .scalar()
        )
        existing = float(existing or 0)
        leave_map = get_leave_hours_for_employees([employee_name], d, d, db)
        leave_hours = leave_map.get(employee_name, {}).get(d, 0)
        available = HOURS_PER_DAY - existing - leave_hours
        if available <= 0:
            continue
        # Allocate min of: remaining hours, max allowed per day, available capacity
        hours_this_day = min(remaining, max_hours_per_day, available)
        al = DevPlannedAllocation(task_id=task_id, allocation_date=d, hours=hours_this_day)
        db.add(al)
        allocations.append(al)
        remaining -= hours_this_day
    if remaining > 0:
        raise ValueError(
            f"Cannot fit all hours: {remaining:.1f}h could not be allocated (max {max_hours_per_day}h/day, days may be full or have leave)."
        )
    return allocations


def log_audit(
    db: Session,
    planning_week_id: Optional[int],
    action: str,
    entity_type: str,
    entity_id: Optional[int],
    old_value: Optional[dict],
    new_value: Optional[dict],
    changed_by: str,
) -> None:
    entry = DevPlanningAuditLog(
        planning_week_id=planning_week_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        old_value=old_value,
        new_value=new_value,
        changed_by=changed_by,
    )
    db.add(entry)
