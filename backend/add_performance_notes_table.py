"""
Migration: create performance_notes (manager comments/incidents that feed the rating via Diligence).
Run once: python add_performance_notes_table.py
"""
from database import engine
from models import Base, PerformanceNote  # noqa: F401

if __name__ == "__main__":
    Base.metadata.create_all(engine, tables=[PerformanceNote.__table__])
    print("Done: performance_notes table created (if it didn't exist)")
