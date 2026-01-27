"""
Google Sheets Auto-Sync Scheduler

This module provides automatic periodic syncing of Google Sheets data to the database.
Uses APScheduler to run sync jobs in the background.
"""

import logging
from datetime import datetime
from typing import Optional
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.events import EVENT_JOB_EXECUTED, EVENT_JOB_ERROR

from google_sheets_sync import GoogleSheetsSync
from config.google_sheets_config import GOOGLE_SHEETS_CONFIG

logger = logging.getLogger(__name__)

class SheetsSyncScheduler:
    """
    Manages automatic syncing of Google Sheets data.
    """
    
    def __init__(self):
        self.scheduler = None
        self.sync_service = None
        self.last_sync_time = None
        self.last_sync_status = None
        self.is_running = False
        self.realtime_mode = False
    
    def start(self, sync_interval_minutes: Optional[int] = None, teams: list = None, realtime: bool = False):
        """
        Start the automatic sync scheduler.
        
        Args:
            sync_interval_minutes: Sync interval in minutes. Defaults to config value.
            teams: List of teams to sync (['QA', 'DEV']). Defaults to both.
            realtime: If True, uses 2-minute interval for real-time sync. Overrides sync_interval_minutes.
        """
        if self.is_running:
            logger.warning("Scheduler is already running")
            return
        
        # Real-time mode uses 2-minute intervals
        if realtime:
            interval = 2
            logger.info("Starting in REAL-TIME mode (2-minute intervals)")
        else:
            interval = sync_interval_minutes or GOOGLE_SHEETS_CONFIG.get('sync_interval_minutes', 5)
        
        teams_to_sync = teams or ['QA', 'DEV']
        
        self.sync_service = GoogleSheetsSync()
        self.scheduler = BackgroundScheduler()
        self.scheduler.start()
        
        # Add sync job - use seconds for intervals less than 1 minute
        if interval < 1:
            trigger = IntervalTrigger(seconds=int(interval * 60))
            interval_display = f"{int(interval * 60)} seconds"
        else:
            trigger = IntervalTrigger(minutes=interval)
            interval_display = f"{interval} minutes"
        
        self.scheduler.add_job(
            func=self._sync_job,
            trigger=trigger,
            id='google_sheets_sync',
            name='Google Sheets Auto Sync',
            args=[teams_to_sync],
            replace_existing=True,
            max_instances=1  # Prevent overlapping syncs
        )
        
        # Add event listeners
        self.scheduler.add_listener(self._on_job_executed, EVENT_JOB_EXECUTED | EVENT_JOB_ERROR)
        
        self.is_running = True
        self.realtime_mode = realtime
        logger.info(f"Google Sheets auto-sync started. Interval: {interval_display}. Teams: {teams_to_sync}")
        
        # Run initial sync
        self._sync_job(teams_to_sync)
    
    def stop(self):
        """Stop the scheduler."""
        if self.scheduler and self.is_running:
            self.scheduler.shutdown(wait=True)
            self.is_running = False
            logger.info("Google Sheets auto-sync stopped")
    
    def _sync_job(self, teams: list):
        """Internal sync job that runs on schedule."""
        try:
            logger.info(f"Starting scheduled sync for teams: {teams}")
            results = {}
            
            for team in teams:
                try:
                    result = self.sync_service.sync_team(team)
                    results[team] = result
                    logger.info(f"Sync completed for {team}: {result.get('timesheets_added', 0)} added, "
                              f"{result.get('timesheets_updated', 0)} updated, "
                              f"{result.get('errors', 0)} errors")
                except Exception as e:
                    logger.error(f"Sync failed for {team}: {e}", exc_info=True)
                    results[team] = {'error': str(e)}
            
            self.last_sync_time = datetime.utcnow()
            self.last_sync_status = {
                'success': True,
                'results': results,
                'synced_at': self.last_sync_time.isoformat()
            }
            
        except Exception as e:
            logger.error(f"Scheduled sync job failed: {e}", exc_info=True)
            self.last_sync_time = datetime.utcnow()
            self.last_sync_status = {
                'success': False,
                'error': str(e),
                'synced_at': self.last_sync_time.isoformat()
            }
    
    def _on_job_executed(self, event):
        """Handle job execution events."""
        if event.exception:
            logger.error(f"Sync job raised an exception: {event.exception}")
        else:
            logger.debug("Sync job executed successfully")
    
    def get_status(self) -> dict:
        """Get scheduler status."""
        if not self.scheduler:
            return {
                'running': False,
                'last_sync': None,
                'next_sync': None
            }
        
        job = self.scheduler.get_job('google_sheets_sync')
        next_run = job.next_run_time.isoformat() if job and job.next_run_time else None
        
        job = self.scheduler.get_job('google_sheets_sync')
        interval_seconds = None
        if job and hasattr(job.trigger, 'interval'):
            interval_seconds = job.trigger.interval.total_seconds()
        
        return {
            'running': self.is_running,
            'realtime_mode': self.realtime_mode,
            'last_sync': self.last_sync_time.isoformat() if self.last_sync_time else None,
            'last_sync_status': self.last_sync_status,
            'next_sync': next_run,
            'interval_seconds': interval_seconds,
            'interval_minutes': (interval_seconds / 60) if interval_seconds else GOOGLE_SHEETS_CONFIG.get('sync_interval_minutes', 5)
        }
    
    def trigger_manual_sync(self, teams: Optional[list] = None) -> dict:
        """Manually trigger a sync (runs immediately)."""
        teams_to_sync = teams or ['QA', 'DEV']
        logger.info(f"Manual sync triggered for teams: {teams_to_sync}")
        self._sync_job(teams_to_sync)
        return self.last_sync_status or {'success': False, 'error': 'Sync not completed'}


# Global scheduler instance
_scheduler_instance: Optional[SheetsSyncScheduler] = None


def get_scheduler() -> SheetsSyncScheduler:
    """Get or create the global scheduler instance."""
    global _scheduler_instance
    if _scheduler_instance is None:
        _scheduler_instance = SheetsSyncScheduler()
    return _scheduler_instance


def start_auto_sync():
    """Start auto-sync if enabled in config. Uses real-time mode by default."""
    if GOOGLE_SHEETS_CONFIG.get('auto_sync_enabled', False):
        scheduler = get_scheduler()
        # Use real-time mode (2-minute intervals) by default
        realtime = GOOGLE_SHEETS_CONFIG.get('realtime_sync', True)
        scheduler.start(realtime=realtime)
        return True
    return False


def stop_auto_sync():
    """Stop auto-sync."""
    scheduler = get_scheduler()
    scheduler.stop()
