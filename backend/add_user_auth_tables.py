"""
Create users and admin_config tables, seed admin, backfill User records from Employees.
"""
import sys
import os
from datetime import datetime

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bcrypt
from sqlalchemy import text
from database import engine
from models import Base, User, AdminConfig, Employee

# Use a dedicated admin email so it does not conflict with manager/user logins (e.g. vishnu.vs@...).
# Set ADMIN_EMAIL in env to override (e.g. for existing deployments).
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@techversantinfotech.com")
ADMIN_DEFAULT_PASSWORD = os.getenv("ADMIN_DEFAULT_PASSWORD", "admin123")


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def _derive_role(db, employee) -> str:
    """Derive role from lead/manager/team. Returns MANAGER_DEV, MANAGER_QA, LEAD_DEV, LEAD_QA, or EMPLOYEE."""
    from sqlalchemy import func
    team_upper = (employee.team or "").upper()
    is_dev = "DEV" in team_upper or team_upper == "DEVELOPMENT"
    team_suffix = "DEV" if is_dev else "QA"

    # Check if this person is a manager (anyone has them as manager)
    manager_count = db.query(Employee).filter(
        Employee.manager.ilike(f"%{employee.name}%"),
        Employee.is_active == True,
    ).count()
    if manager_count > 0:
        return f"MANAGER_{team_suffix}"

    # Check if this person is a lead (anyone has them as lead)
    lead_count = db.query(Employee).filter(
        Employee.lead.ilike(f"%{employee.name}%"),
        Employee.is_active == True,
    ).count()
    if lead_count > 0:
        return f"LEAD_{team_suffix}"

    return "EMPLOYEE"


def create_tables():
    """Create users and admin_config tables."""
    with engine.connect() as conn:
        # Create users table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(150) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(50) NOT NULL,
                employee_id VARCHAR(20),
                password_changed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_users_email ON users(email)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_users_role ON users(role)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_users_employee_id ON users(employee_id)"))
        conn.commit()
        print("[OK] users table ready")

        # Create admin_config table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS admin_config (
                id SERIAL PRIMARY KEY,
                email VARCHAR(150) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                updated_at TIMESTAMP
            )
        """))
        conn.commit()
        print("[OK] admin_config table ready")


def seed_admin():
    """Seed or update admin config."""
    from database import SessionLocal
    from models import AdminConfig

    db = SessionLocal()
    try:
        existing = db.query(AdminConfig).first()
        pw_hash = _hash_password(ADMIN_DEFAULT_PASSWORD)
        if existing:
            existing.email = ADMIN_EMAIL
            existing.password_hash = pw_hash
            print(f"[OK] Admin config updated: {ADMIN_EMAIL}")
        else:
            db.add(AdminConfig(email=ADMIN_EMAIL, password_hash=pw_hash))
            print(f"[OK] Admin config created: {ADMIN_EMAIL} (default password: {ADMIN_DEFAULT_PASSWORD})")
        db.commit()
    finally:
        db.close()


def backfill_users():
    """Create User records for all employees. Skip if user already exists for email."""
    from sqlalchemy.orm import Session
    from database import SessionLocal

    db = SessionLocal()
    try:
        employees = db.query(Employee).filter(Employee.is_active == True, Employee.email.isnot(None)).all()
        created = 0
        for emp in employees:
            if not emp.email or not emp.email.strip():
                continue
            existing = db.query(User).filter(User.email == emp.email.strip().lower()).first()
            if existing:
                continue
            role = _derive_role(db, emp)
            pw_hash = _hash_password(emp.employee_id or "changeme")
            user = User(
                email=emp.email.strip().lower(),
                password_hash=pw_hash,
                role=role,
                employee_id=emp.employee_id,
                password_changed_at=None,
            )
            db.add(user)
            created += 1
        db.commit()
        print(f"[OK] Backfilled {created} user(s) from employees")
    finally:
        db.close()


if __name__ == "__main__":
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
    print("Setting up auth tables...")
    create_tables()
    seed_admin()
    backfill_users()
    print("Done.")
