"""
Verify that a given email/password can authenticate (same logic as /auth/login).
Run from backend folder: python verify_login.py <email> <password>
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import SessionLocal
from auth import authenticate_user

def main():
    if len(sys.argv) < 3:
        print("Usage: python verify_login.py <email> <password>")
        sys.exit(1)
    email = sys.argv[1]
    password = sys.argv[2]
    db = SessionLocal()
    try:
        user = authenticate_user(db, email, password)
        if user:
            print("OK: Login would succeed.")
            print(f"    Role: {user.get('role')}, Email: {user.get('email')}")
        else:
            print("FAIL: Invalid email or password (same as the API would return).")
            # Show what accounts exist for this email (for debugging)
            from models import AdminConfig, User
            admin = db.query(AdminConfig).filter(AdminConfig.email == email.strip().lower()).first()
            reg = db.query(User).filter(User.email == email.strip().lower()).first()
            if admin:
                print(f"    (An admin account exists for this email; password may not match.)")
            elif reg:
                print(f"    (A user account exists for this email; password may not match.)")
            else:
                print(f"    (No account found with this email.)")
            sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    main()
