"""
Sync Health Tracking Module

Centralized health monitoring for all sync sources (PM Tracker, Redmine, Google Sheets).
Tracks consecutive failures, data freshness, and provides a unified health endpoint.
"""

import logging
import threading
from datetime import datetime, timedelta
from typing import Dict, Optional, Any
from enum import Enum

logger = logging.getLogger("sync_health")


class FreshnessLevel(str, Enum):
    FRESH = "FRESH"       # < 5 min since last successful sync
    STALE = "STALE"       # 5-30 min since last successful sync
    CRITICAL = "CRITICAL"  # > 30 min since last successful sync
    UNKNOWN = "UNKNOWN"    # Never synced


# Thresholds in seconds
FRESH_THRESHOLD = 5 * 60       # 5 minutes
STALE_THRESHOLD = 30 * 60      # 30 minutes

# Failure thresholds
CONSECUTIVE_FAILURE_WARNING = 3   # Mark CRITICAL after N failures
CONSECUTIVE_FAILURE_PAUSE = 5     # Pause auto-sync after N failures


class SyncSourceHealth:
    """Track health for a single sync source."""

    def __init__(self, source_name: str):
        self.source_name = source_name
        self._lock = threading.RLock()
        self.last_sync_time: Optional[datetime] = None
        self.last_sync_success: bool = False
        self.last_sync_message: str = ""
        self.last_success_time: Optional[datetime] = None
        self.consecutive_failures: int = 0
        self.total_syncs: int = 0
        self.total_failures: int = 0
        self.total_tickets_synced: int = 0
        self.is_paused: bool = False
        self.pause_reason: str = ""
        self.last_duration_seconds: float = 0

    def record_success(self, message: str = "", tickets_synced: int = 0, duration: float = 0):
        """Record a successful sync."""
        with self._lock:
            now = datetime.utcnow()
            self.last_sync_time = now
            self.last_sync_success = True
            self.last_sync_message = message
            self.last_success_time = now
            self.consecutive_failures = 0
            self.total_syncs += 1
            self.total_tickets_synced = tickets_synced
            self.last_duration_seconds = duration
            # Auto-unpause on success
            if self.is_paused:
                self.is_paused = False
                self.pause_reason = ""
                logger.info(f"[{self.source_name}] Auto-unpaused after successful sync")

    def record_failure(self, message: str = "", duration: float = 0) -> bool:
        """
        Record a failed sync. Returns True if auto-sync should be paused.
        """
        with self._lock:
            self.last_sync_time = datetime.utcnow()
            self.last_sync_success = False
            self.last_sync_message = message
            self.consecutive_failures += 1
            self.total_syncs += 1
            self.total_failures += 1
            self.last_duration_seconds = duration

            if self.consecutive_failures >= CONSECUTIVE_FAILURE_PAUSE and not self.is_paused:
                self.is_paused = True
                self.pause_reason = (
                    f"Auto-paused after {self.consecutive_failures} consecutive failures. "
                    f"Last error: {message}. Re-authentication may be required."
                )
                logger.warning(
                    f"[{self.source_name}] Auto-sync PAUSED after {self.consecutive_failures} "
                    f"consecutive failures. Last error: {message}"
                )
                return True

            if self.consecutive_failures >= CONSECUTIVE_FAILURE_WARNING:
                logger.warning(
                    f"[{self.source_name}] {self.consecutive_failures} consecutive sync failures. "
                    f"Last error: {message}"
                )
            return False

    def unpause(self):
        """Manually unpause sync."""
        with self._lock:
            self.is_paused = False
            self.pause_reason = ""
            self.consecutive_failures = 0
            logger.info(f"[{self.source_name}] Manually unpaused")

    def get_freshness(self) -> FreshnessLevel:
        """Calculate current data freshness."""
        with self._lock:
            if self.last_success_time is None:
                return FreshnessLevel.UNKNOWN

            # If paused due to failures, always CRITICAL
            if self.is_paused:
                return FreshnessLevel.CRITICAL

            # If recent consecutive failures even without pause
            if self.consecutive_failures >= CONSECUTIVE_FAILURE_WARNING:
                return FreshnessLevel.CRITICAL

            seconds_since = (datetime.utcnow() - self.last_success_time).total_seconds()
            if seconds_since < FRESH_THRESHOLD:
                return FreshnessLevel.FRESH
            elif seconds_since < STALE_THRESHOLD:
                return FreshnessLevel.STALE
            else:
                return FreshnessLevel.CRITICAL

    def get_status(self) -> Dict[str, Any]:
        """Get full status dict for this source."""
        with self._lock:
            now = datetime.utcnow()
            seconds_since = None
            if self.last_success_time:
                seconds_since = round((now - self.last_success_time).total_seconds())

            return {
                "source": self.source_name,
                "last_sync_time": self.last_sync_time.isoformat() if self.last_sync_time else None,
                "last_sync_success": self.last_sync_success,
                "last_sync_message": self.last_sync_message,
                "last_success_time": self.last_success_time.isoformat() if self.last_success_time else None,
                "seconds_since_last_success": seconds_since,
                "consecutive_failures": self.consecutive_failures,
                "total_syncs": self.total_syncs,
                "total_failures": self.total_failures,
                "total_tickets_synced": self.total_tickets_synced,
                "freshness": self.get_freshness().value,
                "is_paused": self.is_paused,
                "pause_reason": self.pause_reason,
                "last_duration_seconds": round(self.last_duration_seconds, 2),
            }


class SyncHealthTracker:
    """Central tracker for all sync source health."""

    def __init__(self):
        self.sources: Dict[str, SyncSourceHealth] = {
            "pm_tracker": SyncSourceHealth("pm_tracker"),
            "redmine": SyncSourceHealth("redmine"),
            "google_sheets": SyncSourceHealth("google_sheets"),
        }

    def get_source(self, source_name: str) -> SyncSourceHealth:
        """Get or create a sync source tracker."""
        if source_name not in self.sources:
            self.sources[source_name] = SyncSourceHealth(source_name)
        return self.sources[source_name]

    def get_overall_health(self) -> Dict[str, Any]:
        """Get health status for all sync sources."""
        result = {}
        overall_freshness = FreshnessLevel.FRESH
        any_paused = False

        for name, source in self.sources.items():
            status = source.get_status()
            result[name] = status

            # Overall freshness is the worst of all sources
            source_freshness = FreshnessLevel(status["freshness"])
            if source_freshness == FreshnessLevel.CRITICAL:
                overall_freshness = FreshnessLevel.CRITICAL
            elif source_freshness == FreshnessLevel.STALE and overall_freshness != FreshnessLevel.CRITICAL:
                overall_freshness = FreshnessLevel.STALE
            elif source_freshness == FreshnessLevel.UNKNOWN and overall_freshness == FreshnessLevel.FRESH:
                overall_freshness = FreshnessLevel.UNKNOWN

            if status["is_paused"]:
                any_paused = True

        result["_overall"] = {
            "freshness": overall_freshness.value,
            "any_paused": any_paused,
            "checked_at": datetime.utcnow().isoformat(),
        }
        return result


# Global singleton
sync_health = SyncHealthTracker()
