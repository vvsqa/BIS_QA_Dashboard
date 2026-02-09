"""
Diagnose authentication issues - check DB connection, list accounts, test bcrypt.
Run: cd backend && python diagnose_auth.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def main():
    print("=" * 60)
    print("AUTH DIAGNOSTICS")
    print("=" * 60)

    # 1. Test DB connection
    print("\n[1] Testing database connection...")
    try:
        from database import SessionLocal, engine
        from sqlalchemy import text
        with engine.connect() as conn:
            result = conn.execute(text("SELECT 1"))
            print("    OK: Database connection works.")
    except Exception as e:
        print(f"    FAIL: Cannot connect to database: {e}")
        return

    # 2. Check admin_config table
    print("\n[2] Checking admin_config table...")
    db = SessionLocal()
    try:
        from models import AdminConfig, User
        admins = db.query(AdminConfig).all()
        if not admins:
            print("    WARNING: No admin accounts in admin_config table.")
            print("    Run: python add_user_auth_tables.py")
        else:
            for a in admins:
                print(f"    Admin: {a.email}")
                print(f"           Hash starts with: {a.password_hash[:20]}..." if a.password_hash else "    (no hash)")
    except Exception as e:
        print(f"    ERROR checking admin_config: {e}")

    # 3. Check users table
    print("\n[3] Checking users table...")
    try:
        users = db.query(User).limit(10).all()
        if not users:
            print("    WARNING: No user accounts in users table.")
            print("    Run: python add_user_auth_tables.py")
        else:
            print(f"    Found {db.query(User).count()} user(s). First 10:")
            for u in users:
                hash_preview = u.password_hash[:20] + "..." if u.password_hash else "(no hash)"
                print(f"      - {u.email} | role={u.role} | hash={hash_preview}")
    except Exception as e:
        print(f"    ERROR checking users: {e}")

    # 4. Test bcrypt
    print("\n[4] Testing bcrypt...")
    try:
        import bcrypt
        test_pw = "testpassword123"
        hashed = bcrypt.hashpw(test_pw.encode("utf-8"), bcrypt.gensalt(rounds=12))
        if bcrypt.checkpw(test_pw.encode("utf-8"), hashed):
            print("    OK: bcrypt hash/verify works.")
        else:
            print("    FAIL: bcrypt checkpw returned False for known password!")
    except Exception as e:
        print(f"    ERROR with bcrypt: {e}")

    # 5. Test verify_password from auth.py
    print("\n[5] Testing verify_password function...")
    try:
        from auth import hash_password, verify_password
        test_pw = "Eva@2022"
        hashed = hash_password(test_pw)
        print(f"    Hash for '{test_pw}': {hashed[:30]}...")
        if verify_password(test_pw, hashed):
            print("    OK: verify_password works for freshly hashed password.")
        else:
            print("    FAIL: verify_password returned False!")
    except Exception as e:
        print(f"    ERROR: {e}")

    # 6. Test actual admin password from DB
    print("\n[6] Testing admin password from database...")
    try:
        from models import AdminConfig
        from auth import verify_password
        admin = db.query(AdminConfig).first()
        if admin:
            print(f"    Admin email: {admin.email}")
            # Try common passwords
            test_passwords = ["admin123", "Eva@2022", "password", "changeme"]
            for pw in test_passwords:
                result = verify_password(pw, admin.password_hash)
                if result:
                    print(f"    OK: Password '{pw}' MATCHES the stored hash!")
                    break
            else:
                print(f"    None of the test passwords matched.")
                print(f"    Stored hash: {admin.password_hash}")
        else:
            print("    No admin in database.")
    except Exception as e:
        print(f"    ERROR: {e}")

    # 7. Test a regular user
    print("\n[7] Testing first regular user password...")
    try:
        from models import User
        from auth import verify_password
        user = db.query(User).first()
        if user:
            print(f"    User email: {user.email}, employee_id: {user.employee_id}")
            # Default password is employee_id
            if user.employee_id:
                result = verify_password(user.employee_id, user.password_hash)
                if result:
                    print(f"    OK: Default password (employee_id={user.employee_id}) MATCHES.")
                else:
                    print(f"    Default password (employee_id) does NOT match.")
        else:
            print("    No users in database.")
    except Exception as e:
        print(f"    ERROR: {e}")

    db.close()
    print("\n" + "=" * 60)
    print("DIAGNOSTICS COMPLETE")
    print("=" * 60)

if __name__ == "__main__":
    main()
