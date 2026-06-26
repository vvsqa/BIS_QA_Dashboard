"""
PM Tracker API auto-sync scheduler.

- On application startup: runs one full sync in the background so all PM Tracker data
  is synced into the app as soon as the app is up.
- Then runs periodic sync from the PM API (interval configurable via
  PM_SYNC_INTERVAL_MINUTES, default 2). Closed tickets (already closed in DB and
  in API) are not updated; reopened tickets are still updated.
- Tracks consecutive failures via sync_health and auto-pauses if threshold is reached.
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
from sync_health import sync_health

logger = logging.getLogger(__name__)

# Default 2 min for near real-time ticket updates from PM Tracker
PM_SYNC_INTERVAL_MINUTES = int(os.getenv("PM_SYNC_INTERVAL_MINUTES", "2"))
PM_AUTO_SYNC_ENABLED = os.getenv("PM_AUTO_SYNC", "true").lower() == "true"

_scheduler: Optional[BackgroundScheduler] = None


def _scheduled_sync_job() -> None:
    """Job that runs on schedule: sync PM API data to DB (by ticket_id)."""
    health = sync_health.get_source("pm_tracker")

    # Skip if paused due to consecutive failures
    if health.is_paused:
        logger.warning(
            "PM sync skipped — paused after %d consecutive failures. "
            "Unpause via /sync/health/pm_tracker/unpause or fix the auth issue.",
            health.consecutive_failures,
        )
        return

    db = SessionLocal()
    try:
        run_pm_api_sync(db, start_time=time.time())
        # Drop the live caches so the dashboard reflects the just-synced DB immediately.
        try:
            from pm_live_data import invalidate_pm_cache
            invalidate_pm_cache()
        except Exception as e:
            logger.warning("PM scheduled sync: cache invalidation failed: %s", e)
    except Exception as e:
        logger.exception("PM scheduled sync failed: %s", e)
        health.record_failure(str(e))
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
    # Run first sync in background so application startup is not blocked
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


def unpause_pm_sync() -> dict:
    """Unpause PM sync after consecutive failures have been resolved."""
    health = sync_health.get_source("pm_tracker")
    was_paused = health.is_paused
    health.unpause()
    return {
        "was_paused": was_paused,
        "is_paused": health.is_paused,
        "message": "PM sync unpaused — next scheduled run will attempt sync." if was_paused else "PM sync was not paused.",
    }


def get_pm_scheduler_status() -> dict:
    """Return status of the PM sync scheduler including health info."""
    health = sync_health.get_source("pm_tracker")
    health_status = health.get_status()

    if _scheduler is None:
        return {
            "running": False,
            "interval_minutes": PM_SYNC_INTERVAL_MINUTES,
            "enabled": PM_AUTO_SYNC_ENABLED,
            "health": health_status,
        }
    job = _scheduler.get_job("pm_tracker_sync")
    interval_minutes = None
    if job and hasattr(job.trigger, "interval"):
        interval_minutes = job.trigger.interval.total_seconds() / 60
    return {
        "running": True,
        "interval_minutes": interval_minutes or PM_SYNC_INTERVAL_MINUTES,
        "enabled": PM_AUTO_SYNC_ENABLED,
        "health": health_status,
    }
