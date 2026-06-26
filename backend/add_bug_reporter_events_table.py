"""Create the bug_reporter_events table (usage + time-saved tracking). Idempotent."""
from dotenv import load_dotenv
load_dotenv()
from database import engine
from models import Base, BugReporterEvent


def main():
    BugReporterEvent.__table__.create(bind=engine, checkfirst=True)
    print("bug_reporter_events table ready.")


if __name__ == "__main__":
    main()
