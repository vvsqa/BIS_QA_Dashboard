"""One-off: seed the empty employees table from distinct timesheet contributors.

Temporary roster so Calendar / Performance modules work before the authoritative
employee Excel is imported. sync_employees_to_db.py matches existing rows by NAME, so a
later Excel import enriches/overrides these rows in place (no duplicates).

Run: python bootstrap_employees_from_timesheets.py
"""
from collections import defaultdict, Counter
from datetime import datetime

from database import SessionLocal
from models import Employee, EnhancedTimesheet

TEAM_MAP = {"QA": "QA", "DEV": "DEVELOPMENT", "DEVELOPMENT": "DEVELOPMENT"}


def main():
    db = SessionLocal()
    try:
        existing = db.query(Employee).count()
        if existing:
            print(f"employees table already has {existing} rows — aborting (no overwrite).")
            return

        # Tally team per distinct name from the timesheet feed.
        name_team = defaultdict(Counter)
        for e in db.query(EnhancedTimesheet.employee_name, EnhancedTimesheet.team).all():
            nm = (e.employee_name or "").strip()
            if not nm:
                continue
            team = TEAM_MAP.get((e.team or "").strip().upper(), "DEVELOPMENT")
            name_team[nm][team] += 1

        created = 0
        for i, (nm, teams) in enumerate(sorted(name_team.items()), start=1):
            team = teams.most_common(1)[0][0]
            db.add(Employee(
                employee_id=f"SEED{i:04d}",
                name=nm,
                team=team,
                is_active=True,
                archived=False,
                created_on=datetime.utcnow(),
                updated_on=datetime.utcnow(),
            ))
            created += 1
        db.commit()
        qa = sum(1 for t in name_team.values() if t.most_common(1)[0][0] == "QA")
        print(f"Seeded {created} employees ({qa} QA, {created - qa} DEVELOPMENT).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
