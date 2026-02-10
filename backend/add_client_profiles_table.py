"""
Migration: Create Client Profiles table.
Run once: python add_client_profiles_table.py
"""
from database import engine
from models import Base, ClientProfile

if __name__ == "__main__":
    print("Creating client_profiles table...")
    Base.metadata.create_all(
        bind=engine,
        tables=[
            ClientProfile.__table__,
        ],
    )
    print("Done: client_profiles")
