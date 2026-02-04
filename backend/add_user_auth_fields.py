"""
Add user_role and password_hash fields to employees table if missing.
"""
import sys
from sqlalchemy import text
from database import engine


def add_user_auth_fields():
    with engine.connect() as conn:
        # Add user_role column
        role_check = conn.execute(text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'employees' AND column_name = 'user_role'
        """)).fetchone()
        if not role_check:
            conn.execute(text("ALTER TABLE employees ADD COLUMN user_role VARCHAR(50) DEFAULT 'EMPLOYEE'"))
            print("[OK] Added 'user_role' column")
        else:
            print("[OK] Column 'user_role' already exists")

        # Add password_hash column
        pass_check = conn.execute(text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'employees' AND column_name = 'password_hash'
        """)).fetchone()
        if not pass_check:
            conn.execute(text("ALTER TABLE employees ADD COLUMN password_hash VARCHAR(255)"))
            print("[OK] Added 'password_hash' column")
        else:
            print("[OK] Column 'password_hash' already exists")

        conn.commit()


if __name__ == "__main__":
    if sys.platform == 'win32':
        sys.stdout.reconfigure(encoding='utf-8')
    print("Adding user auth fields to employees table...")
    add_user_auth_fields()
