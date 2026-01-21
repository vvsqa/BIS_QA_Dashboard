from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

class Bug(Base):
    __tablename__ = "bugs"

    id = Column(Integer, primary_key=True)
    bug_id = Column(Integer, unique=True, index=True)  # Redmine bug ID (#)

    ticket_id = Column(Integer, index=True)             # PM Tracker ID
    parent_task_id = Column(Integer, index=True)        # Redmine task ID

    tracker = Column(String(50))
    status = Column(String(50), index=True)
    priority = Column(String(50))
    severity = Column(String(50), index=True)
    environment = Column(String(50), index=True)

    subject = Column(String(500))
    assignee = Column(String(100), index=True)
    author = Column(String(100))

    module = Column(String(100), index=True)
    feature = Column(String(150))

    platform = Column(String(50))
    browser = Column(String(50))
    os = Column(String(50))

    project = Column(String(100), index=True)

    created_on = Column(DateTime)
    updated_on = Column(DateTime)
    closed_on = Column(DateTime, nullable=True)
