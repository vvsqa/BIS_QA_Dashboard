"""One-off: re-map AutomationCase.automated_by from the correctly-stored automated_by_id using the
fixed BYID_TO_PERSON (TestRail truth: 1=Vishnu, 2=Varsha, 3=Vivek). An earlier swapped map mislabelled
~1,100 of Vishnu's cases as Vivek's (and vice-versa). The id was always stored correctly, so we just
recompute the name from it. Idempotent — safe to re-run."""
from collections import Counter
from database import SessionLocal
from models import AutomationCase
from automation_sync import BYID_TO_PERSON


def run():
    db = SessionLocal()
    try:
        rows = db.query(AutomationCase).filter(AutomationCase.automated_by_id.isnot(None)).all()
        before = Counter(r.automated_by for r in rows)
        fixed = 0
        for r in rows:
            correct = BYID_TO_PERSON.get(r.automated_by_id)
            if correct and r.automated_by != correct:
                r.automated_by = correct
                fixed += 1
        db.commit()
        after = Counter(r.automated_by for r in db.query(AutomationCase)
                        .filter(AutomationCase.automated_by_id.isnot(None)).all())
        print(f"rows with an id: {len(rows)} | relabelled: {fixed}")
        print("before:", dict(before))
        print("after :", dict(after))
    finally:
        db.close()


if __name__ == "__main__":
    run()
