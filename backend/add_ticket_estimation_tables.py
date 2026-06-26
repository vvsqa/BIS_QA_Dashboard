"""
Migration: create the QA Estimation tables (plan-first iterative test-effort estimation).
  - ticket_estimations        : one thread per ticket (latest round + status + final review)
  - ticket_estimation_rounds  : immutable history of every estimation round
Idempotent (create_all only makes missing tables). Run once: python add_ticket_estimation_tables.py
"""
from database import engine
from models import Base, TicketEstimation, TicketEstimationRound

if __name__ == "__main__":
    Base.metadata.create_all(
        bind=engine,
        tables=[TicketEstimation.__table__, TicketEstimationRound.__table__],
    )
    print("Done: ticket_estimations + ticket_estimation_rounds created (if missing)")
