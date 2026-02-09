"""
Set up a dedicated admin login and make vishnu.vs@techversantinfotech.com a QA Manager.

- Admin: admin@techversantinfotech.com (default password: admin123)
- QA Manager: vishnu.vs@techversantinfotech.com with role MANAGER_QA (password: Eva@2022)

Run from backend folder: python setup_admin_and_qa_manager.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import SessionLocal
from models import AdminConfig, User, Employee
from auth import hash_password

ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@techversantinfotech.com")
ADMIN_PASSWORD = os.getenv("ADMIN_DEFAULT_PASSWORD", "admin123")
QA_MANAGER_EMAIL = "vishnu.vs@techversantinfotech.com"
QA_MANAGER_PASSWORD = os.getenv("QA_MANAGER_PASSWORD", "Eva@2022")


def main():
    db = SessionLocal()
    try:
        # 1. Set admin account to dedicated admin email
        admin = db.query(AdminConfig).first()
        admin_hash = hash_password(ADMIN_PASSWORD)
        if admin:
            admin.email = ADMIN_EMAIL.strip().lower()
            admin.password_hash = admin_hash
            print(f"[OK] Admin login set to: {ADMIN_EMAIL} (password: {ADMIN_PASSWORD})")
        else:
            db.add(AdminConfig(email=ADMIN_EMAIL.strip().lower(), password_hash=admin_hash))
            print(f"[OK] Admin created: {ADMIN_EMAIL} (password: {ADMIN_PASSWORD})")

        # 2. Ensure vishnu.vs@techversantinfotech.com is a User with role MANAGER_QA
        email_lower = QA_MANAGER_EMAIL.strip().lower()
        employee = db.query(Employee).filter(Employee.email.ilike(email_lower)).first()
        employee_id = employee.employee_id if employee else None

        user = db.query(User).filter(User.email == email_lower).first()
        qa_manager_hash = hash_password(QA_MANAGER_PASSWORD)
        if user:
            user.role = "MANAGER_QA"
            user.password_hash = qa_manager_hash
            if employee_id and not user.employee_id:
                user.employee_id = employee_id
            print(f"[OK] Updated user to QA Manager: {QA_MANAGER_EMAIL} (password: {QA_MANAGER_PASSWORD})")
        else:
            db.add(User(
                email=email_lower,
                password_hash=qa_manager_hash,
                role="MANAGER_QA",
                employee_id=employee_id,
                password_changed_at=None,
            ))
            print(f"[OK] Created QA Manager user: {QA_MANAGER_EMAIL} (password: {QA_MANAGER_PASSWORD})")

        db.commit()
        print("")
        print("Summary:")
        print(f"  Admin:        {ADMIN_EMAIL} / {ADMIN_PASSWORD}")
        print(f"  QA Manager:   {QA_MANAGER_EMAIL} / {QA_MANAGER_PASSWORD}")
    except Exception as e:
        print(f"[ERROR] {e}")
        db.rollback()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
