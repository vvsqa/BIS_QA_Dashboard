"""Add a durable refix_count column to ticket_tracking and backfill it from the status history.

refix_count = number of times a ticket entered 'QC Review Fail' (one retest cycle each). It's stored on
the ticket (not the volatile JSON cycle tracker) so it survives tracker resets / history truncation and
feeds every metric. Backfill is MONOTONIC (max of existing value and the history count) so re-running
never loses an already-recorded count.
"""
from sqlalchemy import text
from database import SessionLocal, engine
from collections import Counter

FAIL_STATUSES = {"qc review fail"}  # the canonical refix trigger


def run():
    # 1. Add the column if it doesn't exist.
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE ticket_tracking ADD COLUMN IF NOT EXISTS refix_count INTEGER DEFAULT 0"))
        conn.execute(text("UPDATE ticket_tracking SET refix_count = 0 WHERE refix_count IS NULL"))
    print("column ready: ticket_tracking.refix_count")

    # 2. Count QC Review Fail transitions per ticket from the durable status-history table.
    db = SessionLocal()
    try:
        from models import TicketStatusHistory, TicketTracking
        rows = db.query(TicketStatusHistory.ticket_id, TicketStatusHistory.new_status).all()
        hist = Counter(tid for tid, st in rows if (st or "").strip().lower() in FAIL_STATUSES)
        print(f"history: {len(hist)} tickets with >=1 QC Review Fail")

        # 3. Monotonic backfill: refix_count = max(existing, history count).
        updated = 0
        for tid, cnt in hist.items():
            tt = db.query(TicketTracking).filter(TicketTracking.ticket_id == tid).first()
            if tt is None:
                continue
            new_val = max(tt.refix_count or 0, cnt)
            if new_val != (tt.refix_count or 0):
                tt.refix_count = new_val
                updated += 1
        db.commit()
        nonzero = db.query(TicketTracking).filter(TicketTracking.refix_count > 0).count()
        print(f"backfilled {updated} tickets; {nonzero} now have refix_count > 0")
    finally:
        db.close()


if __name__ == "__main__":
    run()
