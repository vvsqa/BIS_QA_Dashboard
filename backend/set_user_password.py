"""
Set a user's password so they can log in with the given email and password.

Usage (from project root):
  cd backend
  python set_user_password.py <email> <new_password>

Example:
  python set_user_password.py vishnu.vs@techversantinfotech.com Eva@2022

This updates either the admin account (AdminConfig) or a regular user (User) matching the email.
If no account exists, run add_user_auth_tables.py first to create users from employees.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import SessionLocal
from models import User, AdminConfig
from auth import hash_password


def main():
    if len(sys.argv) < 3:
        print("Usage: python set_user_password.py <email> <new_password>")
        print("Example: python set_user_password.py vishnu.vs@techversantinfotech.com Eva@2022")
        sys.exit(1)

    email = sys.argv[1].strip().lower()
    password = sys.argv[2]
    if not email or not password:
        print("Email and password are required.")
        sys.exit(1)

    db = SessionLocal()
    try:
        pw_hash = hash_password(password)

        # Check admin first
        admin = db.query(AdminConfig).filter(AdminConfig.email == email).first()
        if admin:
            admin.password_hash = pw_hash
            db.commit()
            print(f"[OK] Admin password updated for: {email}")
            return
        # Regular user
        user = db.query(User).filter(User.email == email).first()
        if user:
            user.password_hash = pw_hash
            db.commit()
            print(f"[OK] Password updated for: {email}")
            print("    You can now log in with this email and the new password.")
            return

        print(f"[ERROR] No account found with email: {email}")
        print("        Run: python add_user_auth_tables.py   to create users from employees.")
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] {e}")
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
