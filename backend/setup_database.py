"""
Database Setup Script - Creates all tables and admin user from scratch.

Usage:
    python setup_database.py          # Create tables (keeps existing data)
    python setup_database.py --reset  # DROP all tables and recreate (DESTROYS ALL DATA)

Run this on the server after setting up the database connection in .env
"""
import sys
import os
from pathlib import Path

# Add backend directory to path
sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import text
from database import engine, SessionLocal
from models import Base, User, Employee
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def drop_all_tables():
    """Drop all tables - USE WITH CAUTION!"""
    print("\n⚠️  WARNING: Dropping all tables...")
    Base.metadata.drop_all(bind=engine)
    print("✓ All tables dropped")


def create_all_tables():
    """Create all tables defined in models.py"""
    print("\n📦 Creating all tables...")
    Base.metadata.create_all(bind=engine)
    print("✓ All tables created")


def create_admin_user(email="admin@techversant.com", password="admin123", name="Admin"):
    """Create the admin user if not exists"""
    print(f"\n👤 Setting up admin user: {email}")
    db = SessionLocal()
    try:
        # Check if admin exists
        existing = db.query(User).filter(User.email == email).first()
        if existing:
            print(f"  Admin user already exists (id={existing.id})")
            # Update password to ensure it's correct
            existing.hashed_password = pwd_context.hash(password)
            db.commit()
            print(f"  ✓ Password updated")
            return existing
        
        # Create admin user
        admin = User(
            email=email,
            hashed_password=pwd_context.hash(password),
            name=name,
            role="ADMIN",
            is_active=True
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        print(f"  ✓ Admin user created (id={admin.id})")
        return admin
    finally:
        db.close()


def verify_database_connection():
    """Test database connection"""
    print("\n🔌 Testing database connection...")
    try:
        with engine.connect() as conn:
            result = conn.execute(text("SELECT 1"))
            print("  ✓ Database connection successful")
            return True
    except Exception as e:
        print(f"  ✗ Database connection failed: {e}")
        return False


def list_tables():
    """List all tables in the database"""
    print("\n📋 Tables in database:")
    try:
        with engine.connect() as conn:
            result = conn.execute(text("""
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public'
                ORDER BY table_name
            """))
            tables = [row[0] for row in result]
            if tables:
                for t in tables:
                    print(f"  - {t}")
                print(f"\n  Total: {len(tables)} tables")
            else:
                print("  (no tables found)")
            return tables
    except Exception as e:
        print(f"  Error listing tables: {e}")
        return []


def main():
    print("=" * 60)
    print("QA Dashboard - Database Setup")
    print("=" * 60)
    
    # Check for --reset flag
    reset_mode = "--reset" in sys.argv
    
    if reset_mode:
        print("\n🚨 RESET MODE - This will DELETE ALL DATA!")
        confirm = input("Type 'YES' to confirm: ")
        if confirm != "YES":
            print("Aborted.")
            return
    
    # Test connection
    if not verify_database_connection():
        print("\n❌ Cannot proceed without database connection.")
        print("   Check your .env file for correct DB_HOST, DB_USER, DB_PASSWORD, DB_NAME")
        return
    
    # Show existing tables
    list_tables()
    
    # Reset if requested
    if reset_mode:
        drop_all_tables()
    
    # Create tables
    create_all_tables()
    
    # Create admin user
    create_admin_user()
    
    # Show final state
    list_tables()
    
    print("\n" + "=" * 60)
    print("✅ Database setup complete!")
    print("=" * 60)
    print("\nAdmin login credentials:")
    print("  Email: admin@techversant.com")
    print("  Password: admin123")
    print("\n⚠️  Change the admin password after first login!")


if __name__ == "__main__":
    main()
