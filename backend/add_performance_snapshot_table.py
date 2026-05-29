"""Create the performance_snapshots table (frozen leaderboard history).

Run once: python add_performance_snapshot_table.py
create_all only creates missing tables, so this is safe to re-run.
"""
from database import engine
from models import Base, PerformanceSnapshot  # noqa: F401

Base.metadata.create_all(bind=engine, tables=[PerformanceSnapshot.__table__])
print("performance_snapshots table ensured.")
