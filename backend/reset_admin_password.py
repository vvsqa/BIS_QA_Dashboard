"""
Reset the admin login password so you can sign in when you get "Invalid email or password".

Usage (from project root):
  cd backend
  python reset_admin_password.py

This creates or updates the admin account:
  - Email: admin@techversantinfotech.com (or set ADMIN_EMAIL in .env)
  - Password: admin123 (or set ADMIN_DEFAULT_PASSWORD in .env)

After running, use these credentials on the login page.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import SessionLocal
from models import AdminConfig
from auth import hash_password

ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@techversantinfotech.com")
ADMIN_PASSWORD = os.getenv("ADMIN_DEFAULT_PASSWORD", "admin123")


def main():
    db = SessionLocal()
    try:
        admin = db.query(AdminConfig).first()
        pw_hash = hash_password(ADMIN_PASSWORD)
        if admin:
            admin.email = ADMIN_EMAIL.strip().lower()
            admin.password_hash = pw_hash
            print(f"[OK] Admin password reset: {ADMIN_EMAIL}")
        else:
            db.add(AdminConfig(email=ADMIN_EMAIL.strip().lower(), password_hash=pw_hash))
            print(f"[OK] Admin created: {ADMIN_EMAIL}")
        db.commit()
        print(f"     Log in with:  {ADMIN_EMAIL}  /  {ADMIN_PASSWORD}")
    except Exception as e:
        print(f"[ERROR] {e}")
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
