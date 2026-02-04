"""
PM Tracker API configuration.

Reads from environment; defaults support API-only sync.
Do not commit PM_API_KEY to the repo; use .env or system env.
"""

import os

# API endpoint and auth
PM_API_URL = os.environ.get(
    "PM_API_URL",
    "https://www.bissafety.app/rest/v.01/pm/ticket-export"
)
PM_API_KEY = os.environ.get("PM_API_KEY", "")

# Request tuning
PM_API_TIMEOUT = int(os.environ.get("PM_API_TIMEOUT", "30"))
PM_API_MAX_RETRIES = int(os.environ.get("PM_API_MAX_RETRIES", "3"))
PM_API_RETRY_DELAY = int(os.environ.get("PM_API_RETRY_DELAY", "5"))

# Sync logging (main.py)
ENABLE_SYNC_LOGGING = os.environ.get("PM_SYNC_LOGGING", "true").lower() == "true"

# Sync history (sync_utils)
STORE_SYNC_HISTORY = os.environ.get("PM_STORE_SYNC_HISTORY", "true").lower() == "true"
SYNC_HISTORY_RETENTION_DAYS = int(os.environ.get("PM_SYNC_HISTORY_RETENTION_DAYS", "30"))
