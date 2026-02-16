"""
Shared sync utilities for PM Tracker synchronization.

Two-phase sync: active tickets are synced first, then closed tickets. For closed tickets
we always apply full API data so all fields (qa_estimate_hours, closed_on, etc.) are stored
and data comes in successfully.
"""

import logging
from typing import Dict, List, Tuple, Optional
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func

from models import TicketTracking, TicketStatusHistory, TicketPriorityHistory, SyncLog
from config.pm_tracker_config import STORE_SYNC_HISTORY, SYNC_HISTORY_RETENTION_DAYS

logger = logging.getLogger("sync_utils")

# Statuses that mean the ticket is closed (no further changes expected).
# Used to skip DB updates when both existing and API data are closed.
CLOSED_STATUSES = frozenset({
    'closed', 'moved to live', 'completed',
})


def _is_closed_status(status: Optional[str]) -> bool:
    """Return True if status is considered closed (case-insensitive)."""
    if not status:
        return False
    return str(status).strip().lower() in CLOSED_STATUSES


def parse_field_value(value, field_type='str'):
    """
    Parse and clean field values from sync sources
    
    Args:
        value: Raw value from source
        field_type: Expected type ('str', 'int', 'float', 'datetime')
        
    Returns:
        Parsed value or None if invalid
    """
    if value is None or value == '' or value == 'NULL' or value == 'null':
        return None
    
    try:
        if field_type == 'int':
            return int(value)
        elif field_type == 'float':
            return float(value)
        elif field_type == 'datetime':
            if isinstance(value, str):
                s = value.strip()
                if not s:
                    return None
                # ISO format (e.g. from PM API: 2026-02-15T00:00:00 or 2026-02-15T00:00:00.000Z)
                if 'T' in s:
                    try:
                        normalized = s.replace('Z', '+00:00')
                        dt = datetime.fromisoformat(normalized)
                        return dt.replace(tzinfo=None) if dt.tzinfo else dt
                    except ValueError:
                        pass
                # Common date formats (including PM/Excel-style: dd-mm-yyyy, dd/mm/yyyy, etc.)
                for fmt in [
                    '%Y-%m-%d', '%d-%m-%Y', '%Y-%m-%d %H:%M:%S', '%d-%m-%Y %H:%M:%S',
                    '%d/%m/%Y', '%m/%d/%Y', '%Y/%m/%d', '%d/%m/%Y %H:%M:%S',
                    '%d-%b-%Y', '%d %b %Y', '%b %d %Y',  # 15-Feb-2026, 15 Feb 2026
                ]:
                    try:
                        return datetime.strptime(s, fmt)
                    except ValueError:
                        continue
            elif isinstance(value, datetime):
                return value
            elif isinstance(value, (int, float)):
                # Excel serial date or Unix timestamp (seconds or ms)
                try:
                    if value > 1e10:  # milliseconds
                        return datetime.utcfromtimestamp(value / 1000.0).replace(tzinfo=None)
                    elif value > 1e9:  # seconds
                        return datetime.utcfromtimestamp(value).replace(tzinfo=None)
                    elif value >= 1:  # Excel serial (days since 1899-12-30)
                        return (datetime(1899, 12, 30) + timedelta(days=float(value))).replace(tzinfo=None)
                except (ValueError, OSError):
                    pass
            return None
        else:  # str
            return str(value).strip() if value else None
    except (ValueError, TypeError):
        return None


def upsert_tickets(
    db: Session,
    tickets: List[Dict],
    sync_source: str = 'api',
    dry_run: bool = False
) -> Dict:
    """
    Upsert tickets into TicketTracking table.
    
    Creates new tickets or updates existing ones by ticket_id.
    Tracks status changes for historical reporting.
    
    Args:
        db: Database session
        tickets: List of ticket dicts with normalized field names
        sync_source: Source of sync ('excel' or 'api') for logging
        dry_run: If True, don't commit changes to database
        
    Returns:
        Dict with sync statistics:
        {
            'total_records': int,
            'records_added': int,
            'records_updated': int,
            'records_skipped': int,
            'errors': int,
            'error_messages': List[str]
        }
    """
    stats = {
        'total_records': len(tickets),
        'records_added': 0,
        'records_updated': 0,
        'records_skipped': 0,
        'records_skipped_unchanged_closed': 0,  # closed in DB and in API – no update needed
        'errors': 0,
        'error_messages': []
    }
    
    for ticket_data in tickets:
        try:
            # Extract and validate ticket_id
            ticket_id = ticket_data.get('ticket_id') or ticket_data.get('id')
            
            if not ticket_id:
                logger.warning(f"Skipping ticket with no ID: {ticket_data}")
                stats['records_skipped'] += 1
                continue
            
            ticket_id = parse_field_value(ticket_id, 'int')
            if ticket_id is None:
                logger.warning(f"Could not parse ticket_id from: {ticket_data.get('ticket_id')}")
                stats['records_skipped'] += 1
                continue
            
            # Parse field values
            parsed_data = {
                'ticket_id': ticket_id,
                'title': parse_field_value(ticket_data.get('title')),
                'status': parse_field_value(ticket_data.get('status')),
                'priority': parse_field_value(ticket_data.get('priority')),
                'backend_developer': parse_field_value(ticket_data.get('backend_developer')),
                'frontend_developer': parse_field_value(ticket_data.get('frontend_developer')),
                'qc_tester': parse_field_value(ticket_data.get('qc_tester')),
                'eta': parse_field_value(ticket_data.get('eta'), 'datetime'),
                'current_assignee': parse_field_value(ticket_data.get('current_assignee')),
                'dev_estimate_hours': parse_field_value(ticket_data.get('dev_estimate_hours'), 'float'),
                'actual_dev_hours': parse_field_value(ticket_data.get('actual_dev_hours'), 'float'),
                'qa_estimate_hours': parse_field_value(ticket_data.get('qa_estimate_hours'), 'float'),
                'actual_qa_hours': parse_field_value(ticket_data.get('actual_qa_hours'), 'float'),
                'developer_assigned': parse_field_value(ticket_data.get('developer_assigned')),
                'subdepartment': parse_field_value(ticket_data.get('subdepartment')),
                'updated_on': parse_field_value(ticket_data.get('updated_on'), 'datetime') or datetime.utcnow(),
                'created_on': parse_field_value(ticket_data.get('created_on'), 'datetime'),
                'closed_on': parse_field_value(ticket_data.get('closed_on'), 'datetime'),
            }
            
            # Check if ticket exists
            existing = db.query(TicketTracking).filter(
                TicketTracking.ticket_id == ticket_id
            ).first()
            
            if existing:
                old_status = existing.status
                new_status = parsed_data.get('status')
                existing_closed = _is_closed_status(old_status)
                new_closed = _is_closed_status(new_status)
                
                # When both are closed: still apply full API data so all fields (qa_estimate_hours, closed_on, etc.) come in successfully
                if existing_closed and new_closed:
                    for key, value in parsed_data.items():
                        setattr(existing, key, value)
                    stats['records_updated'] += 1
                    logger.debug(f"Updated closed ticket {ticket_id} with full API data")
                    continue
                
                # When status changes to closed, ensure we have closed_on for ageing (use API value or now)
                if new_closed and not parsed_data.get('closed_on'):
                    parsed_data['closed_on'] = datetime.utcnow()

                # Track status change if status changed (e.g. reopened, or moved to closed)
                if old_status != new_status and new_status:
                    status_history = TicketStatusHistory(
                        ticket_id=ticket_id,
                        previous_status=old_status,
                        new_status=new_status,
                        changed_on=datetime.utcnow(),
                        current_assignee=parsed_data.get('current_assignee'),
                        qc_tester=parsed_data.get('qc_tester'),
                    )
                    db.add(status_history)
                    logger.debug(f"Status change tracked for ticket {ticket_id}: {old_status} -> {new_status}")

                # Track priority change if priority changed
                new_priority = parsed_data.get('priority')
                existing_priority = getattr(existing, 'priority', None)
                new_priority_str = str(new_priority).strip() if new_priority else None
                existing_priority_str = str(existing_priority).strip() if existing_priority else None
                if new_priority_str and new_priority_str != existing_priority_str:
                    priority_history = TicketPriorityHistory(
                        ticket_id=ticket_id,
                        previous_priority=existing_priority_str or None,
                        new_priority=new_priority_str,
                        changed_on=datetime.utcnow(),
                        source=sync_source,
                    )
                    db.add(priority_history)
                    logger.debug(f"Priority change tracked for ticket {ticket_id}: {existing_priority_str} -> {new_priority_str}")
                
                # Track ETA change (for "ETA rescheduled" highlight in ETA calendar)
                new_eta = parsed_data.get('eta')
                existing_eta = getattr(existing, 'eta', None)
                if new_eta is not None and existing_eta is not None:
                    existing_eta_d = existing_eta.date() if hasattr(existing_eta, 'date') else existing_eta
                    new_eta_d = new_eta.date() if hasattr(new_eta, 'date') else new_eta
                    if existing_eta_d != new_eta_d:
                        existing.previous_eta = existing_eta
                        logger.debug(f"ETA change tracked for ticket {ticket_id}: {existing_eta_d} -> {new_eta_d}")
                elif new_eta is not None and existing_eta is None:
                    existing.previous_eta = None  # was unset, now set (optional: treat as no "reschedule")

                # Update existing record (open ticket, or status changed e.g. reopened)
                for key, value in parsed_data.items():
                    setattr(existing, key, value)
                
                stats['records_updated'] += 1
                logger.debug(f"Updated ticket {ticket_id}")
            
            else:
                # Create new record (new ticket)
                new_ticket = TicketTracking(**parsed_data)
                db.add(new_ticket)
                stats['records_added'] += 1
                logger.debug(f"Added new ticket {ticket_id}")
                # Record initial priority so we have a baseline for ageing/history
                first_priority = parsed_data.get('priority')
                if first_priority and str(first_priority).strip():
                    db.add(TicketPriorityHistory(
                        ticket_id=ticket_id,
                        previous_priority=None,
                        new_priority=str(first_priority).strip(),
                        changed_on=datetime.utcnow(),
                        source=sync_source,
                    ))
        
        except Exception as e:
            error_msg = f"Error processing ticket {ticket_id}: {str(e)}"
            logger.error(error_msg)
            stats['error_messages'].append(error_msg)
            stats['errors'] += 1
    
    # Commit changes
    if not dry_run:
        try:
            db.commit()
            skipped_closed = stats.get('records_skipped_unchanged_closed', 0)
            log_msg = f"Sync completed: {stats['records_added']} added, {stats['records_updated']} updated, {stats['errors']} errors"
            if skipped_closed:
                log_msg += f", {skipped_closed} closed (unchanged, skipped)"
            logger.info(log_msg)
        except Exception as e:
            db.rollback()
            error_msg = f"Failed to commit to database: {str(e)}"
            logger.error(error_msg)
            stats['error_messages'].append(error_msg)
            stats['errors'] += 1
            raise
    
    return stats


def log_sync_operation(
    db: Session,
    sync_source: str,
    success: bool,
    message: str,
    stats: Optional[Dict] = None,
    fallback_from: Optional[str] = None,
    fallback_reason: Optional[str] = None,
    duration_seconds: float = 0,
    response_size_bytes: Optional[int] = None
) -> SyncLog:
    """
    Log a sync operation to the database for audit trail
    
    Args:
        db: Database session
        sync_source: Source of sync ('excel', 'api', etc.)
        success: Whether sync succeeded
        message: Status message or error details
        stats: Sync statistics dict from upsert_tickets()
        fallback_from: If fallback occurred, original source
        fallback_reason: Reason for fallback
        duration_seconds: How long the sync took
        response_size_bytes: Size of API response
        
    Returns:
        Created SyncLog record
    """
    if not STORE_SYNC_HISTORY:
        logger.debug("Sync history logging disabled")
        return None
    
    sync_log = SyncLog(
        sync_source=sync_source,
        success=success,
        message=message,
        total_records=stats.get('total_records') if stats else None,
        records_added=stats.get('records_added') if stats else None,
        records_updated=stats.get('records_updated') if stats else None,
        records_skipped=stats.get('records_skipped') if stats else None,
        errors=stats.get('errors') if stats else None,
        fallback_from=fallback_from,
        fallback_reason=fallback_reason,
        duration_seconds=duration_seconds,
        completed_at=datetime.utcnow(),
        response_size_bytes=response_size_bytes
    )
    
    db.add(sync_log)
    try:
        db.commit()
        logger.info(f"Logged sync operation: {sync_source} - {message}")
    except Exception as e:
        logger.error(f"Failed to log sync operation: {str(e)}")
        db.rollback()
    
    return sync_log


def cleanup_sync_history(db: Session) -> int:
    """
    Delete old sync logs based on retention policy
    
    Returns:
        Number of records deleted
    """
    if SYNC_HISTORY_RETENTION_DAYS <= 0:
        logger.debug("Sync history retention disabled (unlimited)")
        return 0
    
    cutoff_date = datetime.utcnow() - timedelta(days=SYNC_HISTORY_RETENTION_DAYS)
    
    result = db.query(SyncLog).filter(
        SyncLog.started_at < cutoff_date
    ).delete(synchronize_session=False)
    
    db.commit()
    
    logger.info(f"Deleted {result} old sync logs (older than {SYNC_HISTORY_RETENTION_DAYS} days)")
    return result


def get_last_sync_info(db: Session, sync_source: Optional[str] = None) -> Optional[Dict]:
    """
    Get information about the last sync operation
    
    Args:
        db: Database session
        sync_source: Filter by specific source (None = any source)
        
    Returns:
        Dict with last sync info or None if no syncs found
    """
    query = db.query(SyncLog)
    
    if sync_source:
        query = query.filter(SyncLog.sync_source == sync_source)
    
    last_sync = query.order_by(SyncLog.started_at.desc()).first()
    
    if not last_sync:
        return None
    
    return {
        'sync_source': last_sync.sync_source,
        'success': last_sync.success,
        'message': last_sync.message,
        'started_at': last_sync.started_at.isoformat() if last_sync.started_at else None,
        'completed_at': last_sync.completed_at.isoformat() if last_sync.completed_at else None,
        'records_added': last_sync.records_added,
        'records_updated': last_sync.records_updated,
        'duration_seconds': last_sync.duration_seconds,
        'fallback_from': last_sync.fallback_from,
        'fallback_reason': last_sync.fallback_reason,
    }
