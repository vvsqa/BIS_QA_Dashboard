from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DB_USER = "postgres"
DB_PASSWORD = "Eva%402022"   # ← IMPORTANT FIX
DB_HOST = "localhost"
DB_PORT = "5432"
DB_NAME = "qa_dashboard"

DATABASE_URL = (
    f"postgresql+psycopg2://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    connect_args={"connect_timeout": 5}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
