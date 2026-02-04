"""
PM Tracker API sync runner.

Shared logic for syncing from the PM API (used by the sync endpoint and the auto-sync scheduler).
Two-phase sync: first sync all active (open) tickets, then sync all closed tickets so all data
is applied successfully.
"""

import logging
import time
from typing import Tuple, Optional
from sqlalchemy.orm import Session

from pm_api_sync import PMApiClient
from sync_utils import upsert_tickets, log_sync_operation, _is_closed_status

logger = logging.getLogger(__name__)


def run_pm_api_sync(
    db: Session,
    start_time: Optional[float] = None,
) -> Tuple[bool, str, dict, str]:
    """
    Fetch tickets from PM Tracker API and upsert into DB by ticket_id.
    Phase 1: Sync all active (open) tickets first.
    Phase 2: Sync all closed tickets and apply full API data so all fields are stored.

    Returns:
        (success, message, stats, sync_source)
    """
    if start_time is None:
        start_time = time.time()
    try:
        logger.info("Starting PM Tracker API sync...")
        client = PMApiClient()
        success, tickets, api_message = client.fetch_tickets()

        if not success:
            log_sync_operation(
                db,
                sync_source="api",
                success=False,
                message=api_message,
                duration_seconds=time.time() - start_time,
            )
            return False, api_message, {}, "api"

        mapped_tickets = client.map_api_fields(tickets)
        # Phase 1: Active tickets first
        active = [t for t in mapped_tickets if not _is_closed_status(t.get("status"))]
        # Phase 2: Closed tickets (all data applied so qa_estimate, closed_on, etc. come in)
        closed = [t for t in mapped_tickets if _is_closed_status(t.get("status"))]

        logger.info("Phase 1: Syncing %d active tickets...", len(active))
        stats_active = upsert_tickets(db, active, sync_source="api")
        logger.info("Phase 2: Syncing %d closed tickets (full data check)...", len(closed))
        stats_closed = upsert_tickets(db, closed, sync_source="api")

        # Merge stats
        stats = {
            "total_records": len(mapped_tickets),
            "records_added": stats_active["records_added"] + stats_closed["records_added"],
            "records_updated": stats_active["records_updated"] + stats_closed["records_updated"],
            "records_skipped": stats_active["records_skipped"] + stats_closed["records_skipped"],
            "records_skipped_unchanged_closed": stats_active.get("records_skipped_unchanged_closed", 0)
            + stats_closed.get("records_skipped_unchanged_closed", 0),
            "errors": stats_active["errors"] + stats_closed["errors"],
            "error_messages": stats_active["error_messages"] + stats_closed["error_messages"],
            "phase1_active_count": len(active),
            "phase2_closed_count": len(closed),
        }

        message = (
            f"API sync completed: {stats['records_added']} added, {stats['records_updated']} updated"
            f" (active: {stats_active['records_added'] + stats_active['records_updated']}, closed: {stats_closed['records_added'] + stats_closed['records_updated']})"
        )

        log_sync_operation(
            db,
            sync_source="api",
            success=True,
            message=message,
            stats=stats,
            duration_seconds=time.time() - start_time,
            response_size_bytes=sum(len(str(t)) for t in tickets) if tickets else 0,
        )
        logger.info(message)
        return True, message, stats, "api"

    except Exception as e:
        error_msg = f"API sync error: {str(e)}"
        logger.exception(error_msg)
        log_sync_operation(
            db,
            sync_source="api",
            success=False,
            message=error_msg,
            duration_seconds=time.time() - start_time,
        )
        return False, error_msg, {}, "api"
