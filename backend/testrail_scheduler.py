"""
TestRail auto-sync scheduler.

- On application startup: optionally runs one TestRail sync in the background.
- Then runs periodic sync by invoking sync_testrail_to_db.py in a subprocess.
- This avoids importing sync_testrail_to_db.py directly because that script executes on import.
"""

import logging
import os
import subprocess
import sys
import threading
from datetime import datetime
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger(__name__)

TESTRAIL_SYNC_INTERVAL_MINUTES = int(os.getenv("TESTRAIL_SYNC_INTERVAL_MINUTES", "15"))
TESTRAIL_AUTO_SYNC_ENABLED = os.getenv("TESTRAIL_AUTO_SYNC", "true").lower() == "true"
TESTRAIL_SYNC_TIMEOUT_SECONDS = int(os.getenv("TESTRAIL_SYNC_TIMEOUT_SECONDS", "1800"))

_scheduler: Optional[BackgroundScheduler] = None
_last_sync_result: Optional[dict] = None


def _run_testrail_sync() -> dict:
    """Run sync_testrail_to_db.py and return structured result."""
    backend_dir = os.path.dirname(__file__)
    script_path = os.path.join(backend_dir, "sync_testrail_to_db.py")

    if not os.path.exists(script_path):
        return {
            "success": False,
            "error": "sync_testrail_to_db.py not found",
            "started_at": datetime.utcnow().isoformat(),
            "completed_at": datetime.utcnow().isoformat(),
            "returncode": None,
            "stdout_tail": "",
            "stderr_tail": "",
        }

    started = datetime.utcnow()
    try:
        result = subprocess.run(
            [sys.executable, script_path],
            capture_output=True,
            text=True,
            timeout=max(60, TESTRAIL_SYNC_TIMEOUT_SECONDS),
            cwd=backend_dir,
        )
        completed = datetime.utcnow()
        return {
            "success": result.returncode == 0,
            "error": None if result.returncode == 0 else "TestRail sync script failed",
            "started_at": started.isoformat(),
            "completed_at": completed.isoformat(),
            "duration_seconds": round((completed - started).total_seconds(), 3),
            "returncode": result.returncode,
            "stdout_tail": (result.stdout or "")[-3000:],
            "stderr_tail": (result.stderr or "")[-3000:],
        }
    except subprocess.TimeoutExpired as exc:
        completed = datetime.utcnow()
        stdout_tail = (exc.stdout or "")
        stderr_tail = (exc.stderr or "")
        if isinstance(stdout_tail, bytes):
            stdout_tail = stdout_tail.decode(errors="replace")
        if isinstance(stderr_tail, bytes):
            stderr_tail = stderr_tail.decode(errors="replace")
        return {
            "success": False,
            "error": f"TestRail sync timed out after {max(60, TESTRAIL_SYNC_TIMEOUT_SECONDS)} seconds",
            "started_at": started.isoformat(),
            "completed_at": completed.isoformat(),
            "duration_seconds": round((completed - started).total_seconds(), 3),
            "returncode": None,
            "stdout_tail": stdout_tail[-3000:],
            "stderr_tail": stderr_tail[-3000:],
        }
    except Exception as exc:
        completed = datetime.utcnow()
        return {
            "success": False,
            "error": str(exc),
            "started_at": started.isoformat(),
            "completed_at": completed.isoformat(),
            "duration_seconds": round((completed - started).total_seconds(), 3),
            "returncode": None,
            "stdout_tail": "",
            "stderr_tail": "",
        }


def _scheduled_sync_job() -> None:
    """Job that runs on schedule: sync TestRail data to DB."""
    global _last_sync_result
    logger.info("Starting scheduled TestRail sync...")
    result = _run_testrail_sync()
    _last_sync_result = result
    if result.get("success"):
        logger.info("Scheduled TestRail sync completed successfully")
        # Refresh the TestRail plan map + clear computed responses so synced plans show now.
        try:
            from pm_live_data import force_refresh_testrail, clear_response_cache
            clear_response_cache()
            force_refresh_testrail()
        except Exception as e:
            logger.warning("TestRail scheduled sync: cache invalidation failed: %s", e)
    else:
        logger.warning("Scheduled TestRail sync failed: %s", result.get("error"))


def start_testrail_auto_sync(interval_minutes: Optional[int] = None) -> bool:
    """
    Start the TestRail auto-sync scheduler.
    Runs sync immediately once, then every interval_minutes (default from env).
    Returns True if started, False if disabled or already running.
    """
    global _scheduler
    if not TESTRAIL_AUTO_SYNC_ENABLED:
        logger.info("TestRail auto-sync is disabled (set TESTRAIL_AUTO_SYNC=true to enable)")
        return False
    if _scheduler is not None:
        logger.warning("TestRail auto-sync scheduler already running")
        return False

    interval = interval_minutes if interval_minutes is not None else TESTRAIL_SYNC_INTERVAL_MINUTES
    interval = max(1, min(interval, 1440))

    _scheduler = BackgroundScheduler()
    _scheduler.start()
    _scheduler.add_job(
        func=_scheduled_sync_job,
        trigger=IntervalTrigger(minutes=interval),
        id="testrail_sync",
        name="TestRail Sync",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("TestRail auto-sync started (every %s minutes)", interval)

    def _run_initial_sync():
        try:
            logger.info("Running initial TestRail sync (data will be synced into the application)")
            _scheduled_sync_job()
            logger.info("Initial TestRail sync completed")
        except Exception as exc:
            logger.warning("Initial TestRail sync failed: %s", exc)

    threading.Thread(target=_run_initial_sync, daemon=True).start()
    return True


def stop_testrail_auto_sync() -> None:
    """Stop the TestRail auto-sync scheduler."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=True)
        _scheduler = None
        logger.info("TestRail auto-sync stopped")


def trigger_testrail_sync_now() -> dict:
    """Run TestRail sync immediately and return the result."""
    global _last_sync_result
    result = _run_testrail_sync()
    _last_sync_result = result
    return result


def get_testrail_scheduler_status() -> dict:
    """Return status of the TestRail sync scheduler."""
    if _scheduler is None:
        return {
            "running": False,
            "interval_minutes": TESTRAIL_SYNC_INTERVAL_MINUTES,
            "enabled": TESTRAIL_AUTO_SYNC_ENABLED,
            "timeout_seconds": max(60, TESTRAIL_SYNC_TIMEOUT_SECONDS),
            "last_sync": _last_sync_result,
        }

    job = _scheduler.get_job("testrail_sync")
    interval_minutes = None
    if job and hasattr(job.trigger, "interval"):
        interval_minutes = job.trigger.interval.total_seconds() / 60

    return {
        "running": True,
        "interval_minutes": interval_minutes or TESTRAIL_SYNC_INTERVAL_MINUTES,
        "enabled": TESTRAIL_AUTO_SYNC_ENABLED,
        "timeout_seconds": max(60, TESTRAIL_SYNC_TIMEOUT_SECONDS),
        "last_sync": _last_sync_result,
    }
