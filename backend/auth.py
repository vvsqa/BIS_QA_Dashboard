"""
Authentication: JWT, password hashing, get_current_user, visibility helpers.
"""
import os
from datetime import datetime, timedelta
from typing import Optional, Set, Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials, OAuth2PasswordBearer
import bcrypt
from sqlalchemy.orm import Session

from database import SessionLocal
from models import User, AdminConfig, Employee

# JWT config
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "qa-dashboard-secret-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login", auto_error=False)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8") if isinstance(hashed, str) else hashed)
    except Exception:
        return False


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def authenticate_user(db: Session, email: str, password: str) -> Optional[Any]:
    """Authenticate by email and password. Returns User-like object or AdminConfig for admin."""
    email_lower = email.strip().lower()
    if not email_lower or not password:
        return None

    # Check admin first
    admin = db.query(AdminConfig).filter(AdminConfig.email == email_lower).first()
    if admin and verify_password(password, admin.password_hash):
        return {
            "id": f"admin_{admin.id}",
            "email": admin.email,
            "role": "ADMIN",
            "employee_id": None,
            "password_changed_at": None,
            "is_admin": True,
        }

    # Check regular user
    user = db.query(User).filter(User.email == email_lower).first()
    if user and verify_password(password, user.password_hash):
        return {
            "id": user.id,
            "email": user.email,
            "role": user.role,
            "employee_id": user.employee_id,
            "password_changed_at": user.password_changed_at,
            "is_admin": False,
        }
    return None


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False)),
    db: Session = Depends(get_db),
) -> dict:
    """Extract and validate JWT, return current user dict."""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    payload = decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    email = payload.get("sub")
    role = payload.get("role")
    employee_id = payload.get("employee_id")
    if not email or not role:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    return {
        "email": email,
        "role": role,
        "employee_id": employee_id,
        "id": payload.get("id"),
    }


def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False)),
    db: Session = Depends(get_db),
) -> Optional[dict]:
    """Optional auth - returns None if no/invalid token."""
    if not credentials:
        return None
    token = credentials.credentials
    payload = decode_token(token)
    if not payload:
        return None
    return {
        "email": payload.get("sub"),
        "role": payload.get("role"),
        "employee_id": payload.get("employee_id"),
        "id": payload.get("id"),
    }


def require_role(allowed_roles: list):
    """Dependency that checks if current user has one of the allowed roles."""

    def _check(current_user: dict = Depends(get_current_user)):
        if current_user.get("role") not in allowed_roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return current_user

    return _check


def require_reports_access(current_user: dict = Depends(get_current_user)):
    """
    Require authenticated user. Reports are accessible to all logged-in users;
    can_access_reports is True for everyone in auth/me. Kept as a dedicated
    dependency so report endpoints consistently require auth (managers, leads, admins, employees).
    """
    return current_user


def get_visible_employee_ids(db: Session, current_user: dict) -> Optional[Set[str]]:
    """
    Return set of employee_ids the current user can access for PROFILE viewing/editing.
    Returns None for ADMIN or MANAGER (all access).
    LEAD: self + direct reportees
    EMPLOYEE: self only
    
    NOTE: This is for PROFILE access only. All users can see all DATA (names, ticket info, etc.)
    """
    role = current_user.get("role", "")
    
    # ADMIN and MANAGER roles have full access to all profiles
    if role == "ADMIN" or "MANAGER" in role:
        return None  # All access

    employee_id = current_user.get("employee_id")
    if not employee_id:
        return set()

    employee = db.query(Employee).filter(Employee.employee_id == employee_id).first()
    if not employee:
        return {employee_id}  # Fallback to self only

    visible = {employee.employee_id}

    # LEAD role: can access self + direct reportees
    if "LEAD" in role:
        direct = db.query(Employee).filter(
            Employee.lead.ilike(f"%{employee.name}%"),
            Employee.is_active == True,
            Employee.employee_id != employee.employee_id,
        ).all()
        visible.update(e.employee_id for e in direct)

    # Regular EMPLOYEE: only self (already in visible set)
    return visible


def is_planning_lead(db: Session, current_user: dict) -> bool:
    """
    True if this user should see the full department in Task Planning (Weekly Planner,
    Resource Blocked Until, Calendar). Uses User.role first, then falls back to
    Employee record: job title contains LEAD or user has direct reportees.
    """
    role = (current_user.get("role") or "").strip()
    role_upper = role.upper()
    if role == "ADMIN" or "MANAGER" in role_upper or "LEAD" in role_upper:
        return True

    employee_id = current_user.get("employee_id")
    if not employee_id:
        return False

    employee = db.query(Employee).filter(Employee.employee_id == employee_id).first()
    if not employee:
        return False

    # Job title (Employee.role) contains LEAD, e.g. "ASSOCIATE LEAD - QA"
    emp_role = (getattr(employee, "role", None) or "").strip().upper()
    if "LEAD" in emp_role:
        return True

    # Has reportees: other employees list this person as their lead
    reportees = db.query(Employee).filter(
        Employee.lead.ilike(f"%{employee.name}%"),
        Employee.is_active == True,
        Employee.employee_id != employee.employee_id,
    ).limit(1).first()
    return reportees is not None


def can_access_employee_profile(db: Session, current_user: dict, target_employee_id: str) -> bool:
    """
    Check if current user can ACCESS/EDIT a specific employee's PROFILE.
    - ADMIN/MANAGER: all profiles
    - LEAD: self + reportees
    - EMPLOYEE: self only
    """
    visible = get_visible_employee_ids(db, current_user)
    if visible is None:
        return True  # Admin/Manager
    return target_employee_id in visible


def can_edit_employee_profile(db: Session, current_user: dict, target_employee_id: str) -> bool:
    """
    Check if current user can EDIT a specific employee's profile.
    - ADMIN/MANAGER: can edit all
    - LEAD: can edit reportees (not self - self uses My Profile for basic details)
    - EMPLOYEE: can edit own profile only (basic details in My Profile)
    """
    role = current_user.get("role", "")
    employee_id = current_user.get("employee_id")
    
    if role == "ADMIN" or "MANAGER" in role:
        return True
    
    # Employee can edit their own profile (My Profile page)
    if employee_id and target_employee_id == employee_id:
        return True
    
    if "LEAD" in role:
        if not employee_id or target_employee_id == employee_id:
            return False  # Lead cannot edit own profile via Employees list (use My Profile)
        
        employee = db.query(Employee).filter(Employee.employee_id == employee_id).first()
        if not employee:
            return False
        
        # Check if target is a direct reportee
        target = db.query(Employee).filter(
            Employee.employee_id == target_employee_id,
            Employee.lead.ilike(f"%{employee.name}%"),
            Employee.is_active == True,
        ).first()
        return target is not None
    
    return False


def can_manage_tasks_for(db: Session, current_user: dict, target_employee_id: str) -> bool:
    """
    Check if current user can add/edit tasks for a specific employee.
    - ADMIN/MANAGER: all employees
    - LEAD (User.role or Employee job title / has reportees): self + reportees
    - EMPLOYEE: self only
    """
    role = (current_user.get("role") or "").strip().upper()
    if role == "ADMIN" or "MANAGER" in role:
        return True

    employee_id = current_user.get("employee_id")
    if not employee_id:
        return False

    if target_employee_id == employee_id:
        return True

    employee = db.query(Employee).filter(Employee.employee_id == employee_id).first()
    if not employee:
        return False

    # User.role contains LEAD, or Employee job title contains LEAD, or has reportees
    if "LEAD" in role:
        pass  # treat as lead below
    else:
        emp_role = (getattr(employee, "role", None) or "").strip().upper()
        if "LEAD" in emp_role:
            pass  # job title lead
        else:
            reportees = db.query(Employee).filter(
                Employee.lead.ilike(f"%{employee.name}%"),
                Employee.is_active == True,
                Employee.employee_id != employee.employee_id,
            ).limit(1).first()
            if reportees is None:
                return False  # not a lead, can only manage self (already handled above)

    # Lead: can manage tasks for reportees
    target = db.query(Employee).filter(
        Employee.employee_id == target_employee_id,
        Employee.lead.ilike(f"%{employee.name}%"),
        Employee.is_active == True,
    ).first()
    return target is not None


# Backward compatibility alias
def can_access_employee(db: Session, current_user: dict, target_employee_id: str) -> bool:
    """Backward compatible - now checks profile access."""
    return can_access_employee_profile(db, current_user, target_employee_id)
