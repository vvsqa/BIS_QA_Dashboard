"""
PM Tracker API configuration.

Reads from environment; defaults support API-only sync.
Do not commit PM_API_KEY to the repo; use .env or system env.
"""

import os


def _as_bool(value: str, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


# PM API v1 endpoint and auth (legacy, kept as fallback)
PM_API_URL = os.environ.get(
    "PM_API_URL",
    "https://www.bissafety.app/rest/v.01/pm/ticket-export",
)
PM_API_KEY = os.environ.get("PM_API_KEY", "")

# PM API v2 endpoint and auth (Bearer token)
PM_API_V2 = _as_bool(os.environ.get("PM_API_V2", "false"), default=False)
PM_API_URL_V2 = os.environ.get(
    "PM_API_URL_V2",
    "https://www.bissafety.app/rest/mcp.v1/pm/ticketlist",
)
PM_API_KEY_V2 = os.environ.get("PM_API_KEY_V2", "")

# Request tuning
PM_API_TIMEOUT = int(os.environ.get("PM_API_TIMEOUT", "30"))
PM_API_MAX_RETRIES = int(os.environ.get("PM_API_MAX_RETRIES", "3"))
PM_API_RETRY_DELAY = int(os.environ.get("PM_API_RETRY_DELAY", "5"))

# Sync logging (main.py)
ENABLE_SYNC_LOGGING = os.environ.get("PM_SYNC_LOGGING", "true").lower() == "true"

# Sync history (sync_utils)
STORE_SYNC_HISTORY = os.environ.get("PM_STORE_SYNC_HISTORY", "true").lower() == "true"
SYNC_HISTORY_RETENTION_DAYS = int(os.environ.get("PM_SYNC_HISTORY_RETENTION_DAYS", "30"))
