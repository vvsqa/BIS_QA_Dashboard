"""
PM Tracker API auto-sync scheduler.

- On application startup: runs one full sync in the background so all PM Tracker data
  is synced into the app as soon as the app is up.
- Then runs periodic sync from the PM API (interval configurable via
  PM_SYNC_INTERVAL_MINUTES, default 10). Closed tickets (already closed in DB and
  in API) are not updated; reopened tickets are still updated.
"""

import os
import logging
import threading
import time
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from database import SessionLocal
from pm_sync_runner import run_pm_api_sync

logger = logging.getLogger(__name__)

# Default 10 min – closed tickets are skipped in upsert, so this focuses on open/new tickets
PM_SYNC_INTERVAL_MINUTES = int(os.getenv("PM_SYNC_INTERVAL_MINUTES", "10"))
PM_AUTO_SYNC_ENABLED = os.getenv("PM_AUTO_SYNC", "true").lower() == "true"

_scheduler: Optional[BackgroundScheduler] = None


def _scheduled_sync_job() -> None:
    """Job that runs on schedule: sync PM API data to DB (by ticket_id)."""
    db = SessionLocal()
    try:
        run_pm_api_sync(db, start_time=time.time())
    except Exception as e:
        logger.exception("PM scheduled sync failed: %s", e)
    finally:
        db.close()


def start_pm_auto_sync(interval_minutes: Optional[int] = None) -> bool:
    """
    Start the PM Tracker API auto-sync scheduler.
    Runs sync immediately once, then every interval_minutes (default from env).
    Returns True if started, False if disabled or already running.
    """
    global _scheduler
    if not PM_AUTO_SYNC_ENABLED:
        logger.info("PM auto-sync is disabled (set PM_AUTO_SYNC=true to enable)")
        return False
    if _scheduler is not None:
        logger.warning("PM auto-sync scheduler already running")
        return False

    interval = interval_minutes if interval_minutes is not None else PM_SYNC_INTERVAL_MINUTES
    interval = max(1, min(interval, 1440))  # clamp 1–1440 minutes

    _scheduler = BackgroundScheduler()
    _scheduler.start()
    _scheduler.add_job(
        func=_scheduled_sync_job,
        trigger=IntervalTrigger(minutes=interval),
        id="pm_tracker_sync",
        name="PM Tracker API Sync",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("PM Tracker auto-sync started (every %s minutes)", interval)
    # Run first sync in background so application startup is not blocked; all PM data syncs once app is up
    def _run_initial_sync():
        try:
            logger.info("Running initial PM Tracker sync (all data from PM Tracker will be synced into the application)")
            _scheduled_sync_job()
            logger.info("Initial PM Tracker sync completed")
        except Exception as e:
            logger.warning("Initial PM sync failed: %s", e)

    threading.Thread(target=_run_initial_sync, daemon=True).start()
    return True


def stop_pm_auto_sync() -> None:
    """Stop the PM Tracker auto-sync scheduler."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=True)
        _scheduler = None
        logger.info("PM Tracker auto-sync stopped")


def get_pm_scheduler_status() -> dict:
    """Return status of the PM sync scheduler."""
    if _scheduler is None:
        return {
            "running": False,
            "interval_minutes": PM_SYNC_INTERVAL_MINUTES,
            "enabled": PM_AUTO_SYNC_ENABLED,
        }
    job = _scheduler.get_job("pm_tracker_sync")
    interval_minutes = None
    if job and hasattr(job.trigger, "interval"):
        interval_minutes = job.trigger.interval.total_seconds() / 60
    return {
        "running": True,
        "interval_minutes": interval_minutes or PM_SYNC_INTERVAL_MINUTES,
        "enabled": PM_AUTO_SYNC_ENABLED,
    }
