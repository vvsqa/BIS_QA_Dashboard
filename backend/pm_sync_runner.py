"""
PM Tracker API sync runner.

Shared logic for syncing from the PM API (used by the sync endpoint and the auto-sync scheduler).
Three independent phases:
  Phase 1: Sync active (open) tickets
  Phase 2: Sync closed tickets with full data
  Phase 3: Mark missing tickets as stale
Each phase runs independently — a failure in one does not block the others.
"""

import logging
import time
from typing import Tuple, Optional, Dict, List
from sqlalchemy.orm import Session

from pm_api_sync import PMApiClient
from sync_utils import upsert_tickets, log_sync_operation, _is_closed_status, mark_missing_tickets_stale
from sync_health import sync_health

logger = logging.getLogger(__name__)


def _empty_stats() -> Dict:
    return {
        "records_added": 0, "records_updated": 0, "records_skipped": 0,
        "records_skipped_unchanged_closed": 0, "errors": 0, "error_messages": [],
    }


def run_pm_api_sync(
    db: Session,
    start_time: Optional[float] = None,
) -> Tuple[bool, str, dict, str]:
    """
    Fetch tickets from PM Tracker API and upsert into DB by ticket_id.
    Phases run independently — partial success is better than total failure.

    Returns:
        (success, message, stats, sync_source)
    """
    if start_time is None:
        start_time = time.time()

    health = sync_health.get_source("pm_tracker")

    # Check if sync is paused due to consecutive failures
    if health.is_paused:
        msg = f"PM sync is paused: {health.pause_reason}"
        logger.warning(msg)
        return False, msg, {}, "api"

    try:
        logger.info("Starting PM Tracker API sync...")
        client = PMApiClient()

        # Pre-sync validation: lightweight fetch to check auth
        success, tickets, api_message = client.fetch_tickets()

        if not success:
            duration = time.time() - start_time
            log_sync_operation(
                db, sync_source="api", success=False,
                message=api_message, duration_seconds=duration,
            )
            health.record_failure(api_message, duration)
            return False, api_message, {}, "api"

        # Refresh the developer id->name map (v2 returns dev fields as numeric ids) before mapping,
        # so map_api_fields resolves them to names. Cheap (TTL-guarded), never raises.
        try:
            import pm_user_map
            pm_user_map.rebuild(db, tickets)
        except Exception as e:
            logger.warning("pm_user_map rebuild during sync failed: %s", e)

        mapped_tickets = client.map_api_fields(tickets)
        active = [t for t in mapped_tickets if not _is_closed_status(t.get("status"))]
        closed = [t for t in mapped_tickets if _is_closed_status(t.get("status"))]

        # --- Phase 1: Active tickets (independent) ---
        stats_active = _empty_stats()
        phase1_ok = True
        try:
            logger.info("Phase 1: Syncing %d active tickets...", len(active))
            stats_active = upsert_tickets(db, active, sync_source="api")
        except Exception as e:
            phase1_ok = False
            logger.exception("Phase 1 (active tickets) failed: %s", e)
            stats_active["errors"] += 1
            stats_active["error_messages"].append(f"Phase 1 error: {e}")

        # --- Phase 2: Closed tickets (independent) ---
        stats_closed = _empty_stats()
        phase2_ok = True
        try:
            logger.info("Phase 2: Syncing %d closed tickets (full data)...", len(closed))
            stats_closed = upsert_tickets(db, closed, sync_source="api")
        except Exception as e:
            phase2_ok = False
            logger.exception("Phase 2 (closed tickets) failed: %s", e)
            stats_closed["errors"] += 1
            stats_closed["error_messages"].append(f"Phase 2 error: {e}")

        # --- Phase 3: Mark stale tickets (independent) ---
        stale_count = 0
        phase3_ok = True
        try:
            all_pm_ticket_ids = []
            for t in mapped_tickets:
                tid = t.get("ticket_id") or t.get("id")
                if tid:
                    try:
                        all_pm_ticket_ids.append(int(tid))
                    except (ValueError, TypeError):
                        pass
            logger.info("Phase 3: Marking tickets not in PM response as stale...")
            stale_count = mark_missing_tickets_stale(db, all_pm_ticket_ids)
        except Exception as e:
            phase3_ok = False
            logger.exception("Phase 3 (stale marking) failed: %s", e)

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
            "phase1_ok": phase1_ok,
            "phase2_closed_count": len(closed),
            "phase2_ok": phase2_ok,
            "phase3_ok": phase3_ok,
            "records_marked_stale": stale_count,
        }

        overall_success = phase1_ok and phase2_ok and phase3_ok
        duration = time.time() - start_time

        phase_status = []
        if not phase1_ok:
            phase_status.append("Phase1:FAIL")
        if not phase2_ok:
            phase_status.append("Phase2:FAIL")
        if not phase3_ok:
            phase_status.append("Phase3:FAIL")

        message = (
            f"API sync {'completed' if overall_success else 'partial'}: "
            f"{stats['records_added']} added, {stats['records_updated']} updated"
            f" (active: {stats_active['records_added'] + stats_active['records_updated']}"
            f", closed: {stats_closed['records_added'] + stats_closed['records_updated']})"
        )
        if phase_status:
            message += f" [{', '.join(phase_status)}]"

        log_sync_operation(
            db, sync_source="api", success=overall_success,
            message=message, stats=stats, duration_seconds=duration,
            response_size_bytes=sum(len(str(t)) for t in tickets) if tickets else 0,
        )

        # Update health tracker
        if overall_success:
            health.record_success(message, len(mapped_tickets), duration)
        else:
            # Partial success — still record as success for freshness (data was updated)
            # but log the phase failures
            if stats["records_added"] + stats["records_updated"] > 0:
                health.record_success(message, len(mapped_tickets), duration)
            else:
                health.record_failure(message, duration)

        logger.info(message)
        return overall_success, message, stats, "api"

    except Exception as e:
        error_msg = f"API sync error: {str(e)}"
        duration = time.time() - start_time
        logger.exception(error_msg)
        log_sync_operation(
            db, sync_source="api", success=False,
            message=error_msg, duration_seconds=duration,
        )
        health.record_failure(error_msg, duration)
        return False, error_msg, {}, "api"
