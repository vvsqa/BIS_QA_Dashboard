"""
Check why a client user cannot log in.
Usage: python check_client_login.py <client_email>
Example: python check_client_login.py preeti.maan@bistraining.ca
"""
import os
import sys

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except ImportError:
    pass

from database import SessionLocal
from models import User, ClientProfile
from auth import verify_password

CLIENT_DEFAULT_PASSWORD = os.getenv("CLIENT_DEFAULT_PASSWORD", "BIS@123")


def main():
    if len(sys.argv) < 2:
        print("Usage: python check_client_login.py <client_email>")
        print("Example: python check_client_login.py preeti.maan@bistraining.ca")
        sys.exit(1)

    email = sys.argv[1].strip().lower()
    if not email:
        print("Error: provide a valid email")
        sys.exit(1)

    db = SessionLocal()
    try:
        print("=" * 60)
        print(f"Client login check: {email}")
        print("=" * 60)

        # 1. ClientProfile
        profile = db.query(ClientProfile).filter(ClientProfile.email == email).first()
        if not profile:
            print("[FAIL] No ClientProfile found for this email.")
            print("       Fix: Admin should create this client in Client Profiles, or fix the email.")
            sys.exit(1)
        print(f"[OK]   ClientProfile exists: id={profile.id}, name={profile.name}, is_active={profile.is_active}")

        if not profile.is_active:
            print("[FAIL] ClientProfile is INACTIVE. Client cannot log in.")
            print("       Fix: In Client Profiles, set this client to Active.")
            sys.exit(1)
        print("[OK]   ClientProfile is active.")

        # 2. User record
        user = db.query(User).filter(User.email == email).first()
        if not user:
            print("[FAIL] No User record for this email. Login credentials don't exist.")
            print("       Fix: In Client Profiles, click 'Reset Password' for this client.")
            print("       That will create the User and set password to:", CLIENT_DEFAULT_PASSWORD)
            sys.exit(1)
        print(f"[OK]   User exists: id={user.id}, role={user.role}")

        if user.role != "CLIENT":
            print(f"[WARN] User role is '{user.role}', not CLIENT. They may log in as non-client.")

        # 3. Password check (use default)
        if verify_password(CLIENT_DEFAULT_PASSWORD, user.password_hash):
            print(f"[OK]   Password matches default ({CLIENT_DEFAULT_PASSWORD}).")
        else:
            print(f"[FAIL] Password does NOT match default ({CLIENT_DEFAULT_PASSWORD}).")
            print("       The client may have changed their password, or it was set differently.")
            print("       Fix: In Client Profiles, click 'Reset Password' to set password to default.")
            sys.exit(1)

        print("=" * 60)
        print("All checks passed. This client should be able to log in with:")
        print(f"  Email:    {email}")
        print(f"  Password: {CLIENT_DEFAULT_PASSWORD}")
        print("=" * 60)
    finally:
        db.close()


if __name__ == "__main__":
    main()
