"""Create the weekly_ticket_reviews table for the Ticket Review module.

Run once: python add_weekly_ticket_review_table.py
create_all only creates missing tables, so this is safe to re-run.
"""
from database import engine
from models import Base, WeeklyTicketReview  # noqa: F401

Base.metadata.create_all(bind=engine, tables=[WeeklyTicketReview.__table__])
print("weekly_ticket_reviews table ensured.")
