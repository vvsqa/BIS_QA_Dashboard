"""Automation sync scheduler (TestRail Project 18) — fixed clock-time schedule.

Uses CronTrigger (NOT intervals) so syncs fire at predictable wall-clock times and are NOT
pushed back by backend restarts:
- Cases-only refresh at AUTOMATION_CASES_HOURS (default 08,12,16,20) — keeps status / attribution
  / planning fresh through the day (~6-7 min each, rate-limited).
- Full sync (cases + executions + snapshot) nightly at AUTOMATION_SYNC_HOUR:MINUTE — utilization
  / time-saved + the daily growth point.
- Startup catch-up: on boot, if the last successful sync is older than AUTOMATION_STALE_HOURS
  (or there is none), run a cases refresh once so a restart brings data current immediately —
  but rapid restarts within the window are skipped (no redundant 7-min scans).
"""
import os
import logging
import threading
from datetime import datetime
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from database import SessionLocal
from models import SyncLog
from automation_sync import run_automation_sync

logger = logging.getLogger(__name__)

AUTOMATION_AUTO_SYNC_ENABLED = os.getenv("AUTOMATION_AUTO_SYNC", "true").lower() == "true"
AUTOMATION_SYNC_HOUR = int(os.getenv("AUTOMATION_SYNC_HOUR", "23"))
AUTOMATION_SYNC_MINUTE = int(os.getenv("AUTOMATION_SYNC_MINUTE", "30"))
AUTOMATION_CASES_HOURS = os.getenv("AUTOMATION_CASES_HOURS", "8,12,16,20")  # fixed clock hours
AUTOMATION_STALE_HOURS = float(os.getenv("AUTOMATION_STALE_HOURS", "4"))

_scheduler: Optional[BackgroundScheduler] = None


def _full_job():
    try:
        run_automation_sync(include_executions=True)
    except Exception as e:
        logger.exception("Automation full sync failed: %s", e)


def _cases_job():
    try:
        run_automation_sync(include_executions=False)
    except Exception as e:
        logger.exception("Automation cases refresh failed: %s", e)


def _last_sync_age_hours():
    """Hours since the last SUCCESSFUL automation sync completed, or None if never."""
    db = SessionLocal()
    try:
        row = (db.query(SyncLog)
               .filter(SyncLog.sync_source == "automation", SyncLog.success == True)
               .order_by(SyncLog.started_at.desc()).first())
        ts = (row.completed_at or row.started_at) if row else None
        if not ts:
            return None
        return (datetime.now() - ts).total_seconds() / 3600.0
    finally:
        db.close()


def start_automation_auto_sync() -> bool:
    global _scheduler
    if not AUTOMATION_AUTO_SYNC_ENABLED:
        logger.info("Automation auto-sync disabled (set AUTOMATION_AUTO_SYNC=true)")
        return False
    if _scheduler is not None:
        return False
    _scheduler = BackgroundScheduler()
    _scheduler.start()
    _scheduler.add_job(
        func=_cases_job,
        trigger=CronTrigger(hour=AUTOMATION_CASES_HOURS, minute=5),
        id="automation_cases_refresh", name="Automation Cases Refresh",
        replace_existing=True, max_instances=1, coalesce=True,
    )
    _scheduler.add_job(
        func=_full_job,
        trigger=CronTrigger(hour=AUTOMATION_SYNC_HOUR, minute=AUTOMATION_SYNC_MINUTE),
        id="automation_full_daily", name="Automation Full Daily Sync",
        replace_existing=True, max_instances=1, coalesce=True,
    )
    logger.info("Automation auto-sync started (cases at %s:05, full daily %02d:%02d)",
                AUTOMATION_CASES_HOURS, AUTOMATION_SYNC_HOUR, AUTOMATION_SYNC_MINUTE)
    age = _last_sync_age_hours()
    if age is None or age >= AUTOMATION_STALE_HOURS:
        threading.Thread(target=_cases_job, daemon=True).start()
        logger.info("Automation startup catch-up sync started (last sync age: %s h)",
                    "none" if age is None else round(age, 1))
    else:
        logger.info("Automation startup sync skipped (last sync %.1f h ago, < %.1f h)",
                    age, AUTOMATION_STALE_HOURS)
    return True


def stop_automation_auto_sync() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
