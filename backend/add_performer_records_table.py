"""Create the performer_records table (Performer of the Month/Quarter hall-of-record). Idempotent."""
from dotenv import load_dotenv
load_dotenv()

from database import engine
from models import Base, PerformerRecord


def main():
    PerformerRecord.__table__.create(bind=engine, checkfirst=True)
    print("performer_records table ready.")


if __name__ == "__main__":
    main()
