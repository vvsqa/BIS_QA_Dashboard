"""Test-plan generation queue scheduler.

Auto-enqueues tickets that have entered QC Testing FOR THE FIRST TIME with no TestRail plan yet
(so a headless runner — or manual generation — can create the plan), and auto-closes queue rows
once a TestRail plan for the ticket exists. Reuses the live QC queue which already carries
`has_test_plan`, `is_retesting` and `retest_cycle_count` per ticket.
"""
import os
import logging
import threading
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from database import SessionLocal
from models import TestPlanRequest

logger = logging.getLogger(__name__)

TPQ_INTERVAL_MINUTES = int(os.getenv("TEST_PLAN_QUEUE_INTERVAL_MINUTES", "10"))
TPQ_ENABLED = os.getenv("TEST_PLAN_QUEUE_AUTO", "true").lower() == "true"
TPQ_MAX_RETRY = int(os.getenv("TEST_PLAN_QUEUE_MAX_RETRY", "3"))  # auto-retry errored tickets up to N attempts

_scheduler: Optional[BackgroundScheduler] = None


QC_ENQUEUE_STATUSES = ("QC Testing", "QC Testing in Progress")


def _is_first_time(t) -> bool:
    """First-time in QC = not a retest/refix re-entry. Logged QA hours only disqualify a ticket still
    WAITING in QC (status exactly 'QC Testing', no tester started) — a ticket already 'in Progress'
    naturally has hours logged and is still a valid first-time plan target."""
    if t.get("is_retesting") or (t.get("retest_cycle_count") or 0) > 0:
        return False
    if (t.get("status") or "") == "QC Testing" and (t.get("qa_actual_hours") or 0) > 0:
        return False
    return True


def _has_real_plan(t) -> bool:
    """A *generated* TestRail plan/run exists for this ticket (a named plan in project 18 or 14).
    The P18 mobile-suite case cache (test_plan_source='mobile_suite') is NOT a generated plan — it
    must never block generation or auto-close a queue row, or mobile tickets get silently skipped."""
    return t.get("test_plan_source") == "plan"


def sync_test_plan_queue(db) -> dict:
    """Enqueue first-time, no-plan QC tickets; auto-close rows whose TestRail plan now exists."""
    from pm_live_data import get_live_qc_queue
    data = get_live_qc_queue() or {}
    section = data.get("queue")
    tickets = section.get("tickets") if isinstance(section, dict) else (section or [])

    by_id = {}
    for t in tickets or []:
        try:
            by_id[int(t.get("ticket_id"))] = t
        except (TypeError, ValueError):
            continue

    existing = {r.ticket_id: r for r in db.query(TestPlanRequest).all()}
    enqueued = closed = retried = 0

    # 0) auto-retry: errored tickets (still no plan) go back to pending until the attempt cap.
    for tid, r in existing.items():
        if r.status == "error" and (r.attempts or 0) < TPQ_MAX_RETRY and not (by_id.get(tid) or {}).get("has_test_plan"):
            r.status = "pending"
            r.error = None
            retried += 1

    # 1) enqueue tickets needing a plan: in QC Testing OR QC Testing in Progress, first-time (not a
    #    refix re-entry), and with NO real generated plan. "in Progress" is included because a ticket
    #    can move QC Testing -> in Progress before the scheduler runs; it still needs a plan. Skip only
    #    on a *real* plan (test_plan_source='plan') — not the flaky mobile-suite case cache.
    for tid, t in by_id.items():
        if (t.get("status") or "") not in QC_ENQUEUE_STATUSES:
            continue
        if _has_real_plan(t) or not _is_first_time(t) or tid in existing:
            continue
        db.add(TestPlanRequest(ticket_id=tid, status="pending", source="auto"))
        enqueued += 1

    # 2) auto-close rows whose *real* plan now exists in TestRail (named plan in P18/P14). Closing on
    #    the mobile-suite cache used to strand mobile tickets as 'done' with no actual plan.
    for tid, r in existing.items():
        if r.status == "done":
            continue
        t = by_id.get(tid)
        if t and _has_real_plan(t):
            r.status = "done"
            r.plan_url = t.get("testrail_plan_url") or r.plan_url
            closed += 1

    db.commit()
    return {"enqueued": enqueued, "closed": closed, "retried": retried, "checked": len(by_id)}


def _job() -> None:
    db = SessionLocal()
    try:
        res = sync_test_plan_queue(db)
        logger.info("Test-plan queue sync: %s", res)
    except Exception as e:
        logger.exception("Test-plan queue sync failed: %s", e)
        db.rollback()
    finally:
        db.close()


def start_test_plan_queue_scheduler(interval_minutes: Optional[int] = None) -> bool:
    """Start the test-plan queue scheduler (run once on start, then every interval)."""
    global _scheduler
    if not TPQ_ENABLED:
        logger.info("Test-plan queue auto is disabled (set TEST_PLAN_QUEUE_AUTO=true to enable)")
        return False
    if _scheduler is not None:
        return False
    interval = interval_minutes if interval_minutes is not None else TPQ_INTERVAL_MINUTES
    interval = max(2, min(interval, 1440))
    _scheduler = BackgroundScheduler()
    _scheduler.start()
    _scheduler.add_job(
        func=_job, trigger=IntervalTrigger(minutes=interval),
        id="test_plan_queue_sync", name="Test Plan Queue Sync",
        replace_existing=True, max_instances=1,
    )
    threading.Thread(target=_job, daemon=True).start()
    logger.info("Test-plan queue scheduler started (every %s minutes)", interval)
    return True


def stop_test_plan_queue_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
