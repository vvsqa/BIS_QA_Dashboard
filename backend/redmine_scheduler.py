"""
Redmine auto-sync scheduler.

- On application startup: runs one full sync in the background so all Redmine bug data
  is synced into the app as soon as the app is up.
- Then runs periodic sync from Redmine (interval configurable via
  REDMINE_SYNC_INTERVAL_MINUTES, default 15 minutes).
- Uses all_bugs=True to capture all bugs including closed ones (ensures accurate bug counts).
"""

import os
import logging
import threading
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from sync_redmine_to_db import sync_redmine_bugs

logger = logging.getLogger(__name__)

# Default 2 min for near real-time bug updates from Redmine
REDMINE_SYNC_INTERVAL_MINUTES = int(os.getenv("REDMINE_SYNC_INTERVAL_MINUTES", "2"))
REDMINE_AUTO_SYNC_ENABLED = os.getenv("REDMINE_AUTO_SYNC", "true").lower() == "true"

_scheduler: Optional[BackgroundScheduler] = None
_last_sync_result: Optional[dict] = None


def _scheduled_sync_job() -> None:
    """Job that runs on schedule: sync Redmine bugs to DB."""
    global _last_sync_result
    try:
        logger.info("Starting scheduled Redmine sync...")
        # Use all_bugs=True to get accurate bug counts (includes closed bugs)
        processed, created, updated = sync_redmine_bugs(all_bugs=True)
        _last_sync_result = {
            "success": True,
            "processed": processed,
            "created": created,
            "updated": updated,
            "error": None,
        }
        logger.info(f"Redmine sync completed: {processed} processed, {created} created, {updated} updated")
    except Exception as e:
        _last_sync_result = {
            "success": False,
            "processed": 0,
            "created": 0,
            "updated": 0,
            "error": str(e),
        }
        logger.exception("Redmine scheduled sync failed: %s", e)


def start_redmine_auto_sync(interval_minutes: Optional[int] = None) -> bool:
    """
    Start the Redmine auto-sync scheduler.
    Runs sync immediately once, then every interval_minutes (default from env).
    Returns True if started, False if disabled or already running.
    """
    global _scheduler
    if not REDMINE_AUTO_SYNC_ENABLED:
        logger.info("Redmine auto-sync is disabled (set REDMINE_AUTO_SYNC=true to enable)")
        return False
    if _scheduler is not None:
        logger.warning("Redmine auto-sync scheduler already running")
        return False

    interval = interval_minutes if interval_minutes is not None else REDMINE_SYNC_INTERVAL_MINUTES
    interval = max(1, min(interval, 1440))  # clamp 1–1440 minutes

    _scheduler = BackgroundScheduler()
    _scheduler.start()
    _scheduler.add_job(
        func=_scheduled_sync_job,
        trigger=IntervalTrigger(minutes=interval),
        id="redmine_sync",
        name="Redmine Bug Sync",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("Redmine auto-sync started (every %s minutes)", interval)

    # Run first sync in background so application startup is not blocked
    def _run_initial_sync():
        try:
            logger.info("Running initial Redmine sync (all bug data will be synced into the application)")
            _scheduled_sync_job()
            logger.info("Initial Redmine sync completed")
        except Exception as e:
            logger.warning("Initial Redmine sync failed: %s", e)

    threading.Thread(target=_run_initial_sync, daemon=True).start()
    return True


def stop_redmine_auto_sync() -> None:
    """Stop the Redmine auto-sync scheduler."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=True)
        _scheduler = None
        logger.info("Redmine auto-sync stopped")


def get_redmine_scheduler_status() -> dict:
    """Return status of the Redmine sync scheduler."""
    if _scheduler is None:
        return {
            "running": False,
            "interval_minutes": REDMINE_SYNC_INTERVAL_MINUTES,
            "enabled": REDMINE_AUTO_SYNC_ENABLED,
            "last_sync": _last_sync_result,
        }
    job = _scheduler.get_job("redmine_sync")
    interval_minutes = None
    if job and hasattr(job.trigger, "interval"):
        interval_minutes = job.trigger.interval.total_seconds() / 60
    return {
        "running": True,
        "interval_minutes": interval_minutes or REDMINE_SYNC_INTERVAL_MINUTES,
        "enabled": REDMINE_AUTO_SYNC_ENABLED,
        "last_sync": _last_sync_result,
    }
