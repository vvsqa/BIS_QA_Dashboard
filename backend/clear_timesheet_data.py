"""
Clear all data in the timesheet module:
- timesheet_approval_log (approval audit log)
- timesheet_entry_reviews (per-entry review decisions)
- timesheet_entries (manual time entries)
- timesheet_submissions (weekly submissions)
- enhanced_timesheet (synced from Google Sheets)
- leave_entries (leave tracking)

Run from backend directory: python clear_timesheet_data.py
"""
import sqlalchemy
from database import SessionLocal
from models import (
    TimeSheetApprovalLog,
    TimeSheetEntryReview,
    TimeSheetEntry,
    TimeSheetSubmission,
    EnhancedTimesheet,
    LeaveEntry,
)


def _delete_if_exists(db, model, name):
    try:
        count = db.query(model).delete()
        return count
    except sqlalchemy.exc.ProgrammingError as e:
        if "does not exist" in str(e.orig) or "UndefinedTable" in str(type(e.orig).__name__):
            print(f"  (table {name} does not exist, skipping)")
            db.rollback()
            return 0
        raise
    except sqlalchemy.exc.InternalError as e:
        if "InFailedSqlTransaction" in str(e.orig) or "transaction is aborted" in str(e):
            db.rollback()
            return _delete_if_exists(db, model, name)
        raise


def clear_all_timesheet_data():
    db = SessionLocal()
    try:
        # Delete in order (child tables first)
        approval_count = _delete_if_exists(db, TimeSheetApprovalLog, "timesheet_approval_log")
        review_count = _delete_if_exists(db, TimeSheetEntryReview, "timesheet_entry_reviews")
        entry_count = _delete_if_exists(db, TimeSheetEntry, "timesheet_entries")
        submission_count = _delete_if_exists(db, TimeSheetSubmission, "timesheet_submissions")
        enhanced_count = _delete_if_exists(db, EnhancedTimesheet, "enhanced_timesheet")
        leave_count = _delete_if_exists(db, LeaveEntry, "leave_entries")
        db.commit()
        print(f"Deleted: {approval_count} approval log(s), {review_count} review(s), "
              f"{entry_count} manual entry(ies), {submission_count} submission(s), "
              f"{enhanced_count} synced entry(ies), {leave_count} leave entry(ies).")
        print("All timesheet module data has been removed.")
    except Exception as e:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    clear_all_timesheet_data()
