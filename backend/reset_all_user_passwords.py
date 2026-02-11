"""
Reset all user passwords to their employee_id (the default password).
This does NOT touch admin accounts in AdminConfig.

Usage (from backend folder):
  python reset_all_user_passwords.py

After running, users can log in with:
  Email: their email
  Password: their employee_id (e.g., TV0877)
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import SessionLocal
from models import User
from auth import hash_password


def main():
    db = SessionLocal()
    try:
        users = db.query(User).all()
        if not users:
            print("No users found in the database.")
            return

        updated = 0
        skipped = 0

        for user in users:
            if not user.employee_id:
                print(f"  [SKIP] {user.email} - no employee_id set")
                skipped += 1
                continue

            # Set password to employee_id
            user.password_hash = hash_password(user.employee_id)
            user.password_changed_at = None  # Clear the "password changed" flag
            updated += 1
            print(f"  [OK] {user.email} -> password reset to {user.employee_id}")

        db.commit()
        print(f"\nDone. Updated: {updated}, Skipped: {skipped}")
        print("Users can now log in with their employee_id as the password.")

    except Exception as e:
        print(f"[ERROR] {e}")
        db.rollback()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
