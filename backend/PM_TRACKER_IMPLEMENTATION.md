# PM Tracker JSON API Integration - Implementation Guide

## Overview

The PM Tracker sync system has been enhanced to support dual synchronization methods:
- **Excel-based sync** (legacy, file-based)
- **API-based sync** (new, real-time JSON REST API)
- **Hybrid mode** with intelligent fallback

This provides redundancy and allows you to roll back to Excel sync if the API encounters issues, without code changes or redeployment.

---

## Architecture Overview

### New Modules Created

#### 1. **config/pm_tracker_config.py**
Central configuration module for PM Tracker sync settings.

**Configuration Options** (via Environment Variables):

| Variable | Default | Options | Purpose |
|----------|---------|---------|---------|
| `PM_SYNC_METHOD` | `both` | `excel`, `api`, `both` | Which sync method to use |
| `PM_API_URL` | `https://www.bissafety.app/rest/v.01/pm/ticket-export` | URL string | PM API endpoint |
| `PM_API_KEY` | `` | API key string | Authentication token |
| `PM_API_TIMEOUT` | `30` | seconds | Request timeout |
| `PM_API_MAX_RETRIES` | `3` | count | Retry attempts on failure |
| `PM_API_RETRY_DELAY` | `5` | seconds | Delay between retries |
| `PM_FALLBACK_TRIGGER` | `connection_only` | `never`, `any_error`, `connection_only`, `timeout_only` | When to fallback to Excel |
| `PM_ENABLE_SYNC_LOGGING` | `true` | bool | Enable detailed logging |
| `PM_STORE_SYNC_HISTORY` | `true` | bool | Keep sync audit trail |
| `PM_SYNC_HISTORY_RETENTION_DAYS` | `90` | days | How long to keep logs (0=unlimited) |
| `PM_AUTO_SYNC_ENABLED` | `false` | bool | Auto-sync on schedule |
| `PM_AUTO_SYNC_INTERVAL_MINUTES` | `5` | minutes | Scheduled sync interval |

#### 2. **pm_api_sync.py**
REST API client for PM Tracker with authentication, error handling, and flexible JSON parsing.

**Key Classes:**
- `PMApiClient(api_url, api_key)` - Main client for API communication

**Key Methods:**
- `fetch_tickets(**kwargs)` - Fetch ticket data from API with retry logic
- `map_api_fields(tickets)` - Map API response fields to database schema
- `test_connection()` - Verify API connection and authentication

**Features:**
- Automatic retry on connection errors, timeouts
- Support for multiple JSON response formats (list, wrapped object, etc.)
- Flexible field mapping with case-insensitive matching
- Comprehensive error logging and status reporting

#### 3. **sync_utils.py**
Shared synchronization utilities used by both Excel and API sync methods.

**Key Functions:**
- `parse_field_value(value, field_type)` - Parse and clean field values
- `upsert_tickets(db, tickets, sync_source, dry_run)` - Insert/update tickets in database
- `log_sync_operation(...)` - Record sync operation to audit trail
- `cleanup_sync_history(db)` - Delete old sync logs
- `get_last_sync_info(db, sync_source)` - Get most recent sync details

#### 4. **models.py - SyncLog Model**
Audit trail for all sync operations.

```python
class SyncLog(Base):
    id: int  # Primary key
    sync_source: str  # 'excel' or 'api'
    success: bool  # Whether sync succeeded
    message: str  # Status/error message
    total_records: int  # Records processed
    records_added: int
    records_updated: int
    records_skipped: int
    errors: int
    fallback_from: str | None  # Original source if fallback occurred
    fallback_reason: str | None  # Why fallback happened
    duration_seconds: float  # How long the sync took
    started_at: datetime
    completed_at: datetime
    response_size_bytes: int  # API response size
```

---

## Backend API Endpoints

### 1. **POST /ticket-tracking/sync-latest**
Perform a sync operation using configured method(s).

**Request:**
```
POST /ticket-tracking/sync-latest
```

**Response:**
```json
{
  "success": true,
  "message": "API sync completed: 45 added, 123 updated",
  "sync_source": "api",
  "fallback_occurred": false,
  "fallback_reason": null,
  "records_added": 45,
  "records_updated": 123,
  "records_skipped": 2,
  "errors": 0,
  "duration_seconds": 3.42
}
```

**Behavior by `PM_SYNC_METHOD`:**
- `api`: Try API only
- `excel`: Try Excel only
- `both`: Try API first → fallback to Excel on error (if `PM_FALLBACK_TRIGGER` allows)

### 2. **GET /ticket-tracking/sync-method**
Get current sync configuration and last sync status.

**Response:**
```json
{
  "current_method": "both",
  "available_methods": ["api", "excel"],
  "fallback_trigger": "connection_only",
  "last_sync": {
    "sync_source": "api",
    "success": true,
    "started_at": "2026-01-29T05:15:00Z",
    "duration_seconds": 3.42,
    "records_added": 45,
    "records_updated": 123,
    "fallback_from": null,
    "message": "API sync completed: 45 added, 123 updated"
  },
  "config": {
    "sync_method": "both",
    "api_url": "https://...",
    "api_key_set": true,
    "fallback_trigger": "connection_only",
    ...
  }
}
```

### 3. **POST /ticket-tracking/test-api-connection**
Test PM Tracker API connection and authentication.

**Response:**
```json
{
  "success": true,
  "message": "Connection successful. Retrieved 450 tickets."
}
```

### 4. **GET /ticket-tracking/sync-history**
Get sync operation history (most recent first).

**Query Parameters:**
- `limit` (int, default: 50, max: 500) - Maximum records to return

**Response:**
```json
[
  {
    "id": 42,
    "sync_source": "api",
    "success": true,
    "message": "API sync completed: 45 added, 123 updated",
    "records_added": 45,
    "records_updated": 123,
    "records_skipped": 2,
    "errors": 0,
    "duration_seconds": 3.42,
    "fallback_from": null,
    "fallback_reason": null,
    "started_at": "2026-01-29T05:15:00Z",
    "completed_at": "2026-01-29T05:15:03.42Z"
  },
  ...
]
```

### 5. **DELETE /ticket-tracking/sync-history**
Delete old sync history logs.

**Query Parameters:**
- `days` (int, default: 0) - Delete logs older than N days (0 = all)

**Response:**
```json
{
  "success": true,
  "message": "Deleted 25 sync log records",
  "records_deleted": 25
}
```

---

## Configuration & Environment Setup

### Setting Up Environment Variables

Create or update your `.env` file (or set in your deployment environment):

```bash
# PM Tracker API Settings
PM_SYNC_METHOD=both
PM_API_URL=https://www.bissafety.app/rest/v.01/pm/ticket-export
PM_API_KEY=Q7vN4xA9kR2mS8pD6fH3yT5zL1cW0uB7
PM_API_TIMEOUT=30
PM_API_MAX_RETRIES=3
PM_API_RETRY_DELAY=5

# Fallback Configuration
PM_FALLBACK_TRIGGER=connection_only

# Logging & Audit
PM_ENABLE_SYNC_LOGGING=true
PM_STORE_SYNC_HISTORY=true
PM_SYNC_HISTORY_RETENTION_DAYS=90

# Auto-sync (optional)
PM_AUTO_SYNC_ENABLED=false
PM_AUTO_SYNC_INTERVAL_MINUTES=5
```

### Quick Switch Between Sync Methods

**Without restarting the server**, change the sync method via environment:

```bash
# Revert to Excel-only sync if API is problematic
export PM_SYNC_METHOD=excel

# Or go back to API with fallback
export PM_SYNC_METHOD=both
```

---

## How It Works: Sync Flow

### 1. **API Sync Attempt (if PM_SYNC_METHOD is "api" or "both")**

```
┌─────────────────────┐
│   Sync Triggered    │
└──────────┬──────────┘
           │
           ├──> Try API Sync
           │    - Authenticate with API key
           │    - Fetch ticket data (with retries)
           │    - Parse flexible JSON format
           │    - Map fields to database schema
           │    - Upsert into database
           │
           ├──> Success?
           │    ├─> YES: Log and return ✓
           │    │
           │    └─> NO: Evaluate error
           │         - Connection/Timeout? → Try Fallback (if enabled)
           │         - Auth error? → Return error (don't fallback)
           │         - Other? → Check fallback trigger setting
```

### 2. **Fallback to Excel (if configured & API fails)**

```
           │    └─> NO: Check fallback trigger
           │         │
           │         ├──> PM_FALLBACK_TRIGGER = "never"
           │         │    └─> Return error (no fallback)
           │         │
           │         ├──> PM_FALLBACK_TRIGGER = "any_error"
           │         │    └─> Try Excel sync
           │         │
           │         ├──> PM_FALLBACK_TRIGGER = "connection_only"
           │         │    └─> Connection/timeout errors only → Try Excel
           │         │
           │         └──> PM_FALLBACK_TRIGGER = "timeout_only"
           │              └─> Timeout errors only → Try Excel
           │
           ├──> Try Excel Sync (if fallback triggered)
           │    - Run sync_excel_to_db.py --import-latest
           │    - Parse Excel TicketReport file
           │    - Upsert into database
           │
           └──> Return result with fallback metadata
                - fallback_occurred: true
                - fallback_from: "api"
                - fallback_reason: "Connection timeout"
```

### 3. **Audit Trail**

Every sync operation is logged to the `SyncLog` table:

```python
SyncLog entry contains:
- Which method was used (api/excel)
- Success/failure status
- Records processed, added, updated, skipped, errors
- If fallback occurred: original method + reason
- Sync duration
- Timestamp
```

---

## Frontend Integration

### Updated TicketsDashboard.js

**New State:**
```javascript
const [syncMethodInfo, setSyncMethodInfo] = useState(null);
```

**New Function:**
```javascript
const fetchSyncMethodInfo = useCallback(async () => {
  const res = await fetch(`${BACKEND_URL}/ticket-tracking/sync-method`);
  const data = await res.json();
  setSyncMethodInfo(data);
}, []);
```

**Updated Sync Button UI:**
- Shows current sync method (API, Excel, Both)
- Displays last sync source and status
- Shows fallback warning if fallback occurred
- Enhanced result messages with record counts per method

**Example Display:**
```
[⟳ Sync Now]
Mode: BOTH
✓ API: 45 added, 123 updated
```

Or with fallback:
```
[⟳ Sync Now]
Mode: BOTH
(Fallback from api)
✓ EXCEL: 45 added, 123 updated
```

---

## Testing the Implementation

### 1. **Test API Connection**

```bash
curl -X POST http://localhost:8000/ticket-tracking/test-api-connection
```

Expected response:
```json
{
  "success": true,
  "message": "Connection successful. Retrieved 450 tickets."
}
```

### 2. **Perform a Sync**

```bash
curl -X POST http://localhost:8000/ticket-tracking/sync-latest
```

### 3. **Check Sync Method & Status**

```bash
curl http://localhost:8000/ticket-tracking/sync-method
```

### 4. **View Sync History**

```bash
curl "http://localhost:8000/ticket-tracking/sync-history?limit=10"
```

### 5. **Test Fallback (Manual Testing)**

1. Set `PM_SYNC_METHOD=both`
2. Verify API works: `curl POST /test-api-connection` ✓
3. Change `PM_API_KEY` to invalid value (simulate API failure)
4. Trigger sync: `curl -X POST /sync-latest`
5. Should see fallback to Excel
6. Restore valid API key
7. Verify sync works normally again

---

## Troubleshooting

### "API: invalid_key, authID is missing or invalid"

**Cause:** API key is incorrect or expired  
**Solution:**
1. Verify `PM_API_KEY` environment variable is set correctly
2. Check API key with dev team
3. Set `PM_SYNC_METHOD=excel` as fallback
4. Monitor sync-history for API attempts

### "Connection timeout"

**Cause:** API endpoint unreachable or slow  
**Solution:**
1. Check network connectivity to `PM_API_URL`
2. Increase `PM_API_TIMEOUT` (currently 30s)
3. Enable `PM_FALLBACK_TRIGGER=connection_only` to auto-fallback
4. Check API service status

### "Quota exceeded" (Google Sheets, unrelated)

**Cause:** Separate issue with Timesheet sync  
**Solution:**
1. Reduce Google Sheets sync frequency
2. Request quota increase from Google
3. Does NOT affect PM Tracker sync

### Database Connection Issues

**Cause:** `SyncLog` table doesn't exist  
**Solution:**
1. Run database migrations: `alembic upgrade head`
2. Or manually create table (see models.py)
3. Check database connectivity

---

## Deployment Checklist

- [ ] Install new dependencies (if any) - `pip install -r requirements.txt`
- [ ] Create `.env` file with `PM_API_URL` and `PM_API_KEY`
- [ ] Set `PM_SYNC_METHOD` (recommend starting with `both`)
- [ ] Run database migration to create `SyncLog` table
- [ ] Test API connection: POST `/test-api-connection`
- [ ] Test sync: POST `/sync-latest`
- [ ] Verify sync history is recorded: GET `/sync-history`
- [ ] Monitor first few syncs for any errors
- [ ] Update frontend code (TicketsDashboard.js changes)
- [ ] Test fallback behavior if needed

---

## Security Notes

1. **API Key Storage:**
   - Never commit `PM_API_KEY` to repository
   - Store in environment variables or secrets manager
   - Use `.env.local` or deployment secrets

2. **Fallback Security:**
   - Excel files should be in secure location (Downloads folder monitored by script)
   - Restrict access to `backend/imports/` folder
   - Audit trail (`SyncLog`) logs all operations

3. **Logging:**
   - Sync logs contain record counts and operation details
   - Sensitive data (API keys) are never logged
   - Clean up old logs periodically (default: 90 days)

---

## Monitoring & Maintenance

### Regular Checks

```sql
-- Last 10 syncs
SELECT * FROM sync_logs 
ORDER BY started_at DESC LIMIT 10;

-- Success rate
SELECT sync_source, 
       COUNT(*) total,
       SUM(CASE WHEN success=true THEN 1 ELSE 0 END) successful,
       ROUND(100.0 * SUM(CASE WHEN success=true THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM sync_logs
WHERE started_at > now() - interval '7 days'
GROUP BY sync_source;

-- Fallback frequency
SELECT fallback_from, COUNT(*) as fallback_count
FROM sync_logs
WHERE fallback_from IS NOT NULL
GROUP BY fallback_from;
```

### Health Check Endpoint (Optional)

Add to frontend health check:

```javascript
const checkPMSyncHealth = async () => {
  const res = await fetch(`${BACKEND_URL}/ticket-tracking/sync-method`);
  const data = await res.json();
  console.log(`PM Sync Method: ${data.current_method}`);
  console.log(`Last sync: ${data.last_sync?.started_at}`);
  console.log(`Success: ${data.last_sync?.success}`);
};
```

---

## Future Enhancements

1. **Scheduled API Sync:**
   - Enable `PM_AUTO_SYNC_ENABLED=true`
   - API will sync every `PM_AUTO_SYNC_INTERVAL_MINUTES`
   - Integration with APScheduler (already in use for Google Sheets)

2. **Incremental Sync:**
   - Add `since=<timestamp>` parameter to API
   - Only fetch tickets updated since last sync
   - Reduces API traffic and improves performance

3. **Field Mapping UI:**
   - Admin dashboard to configure API field mappings
   - Visual mapping tool instead of hardcoded

4. **Webhook Support:**
   - API pushes changes to webhook
   - Real-time sync instead of polling

5. **Multi-API Support:**
   - Support multiple PM trackers (Redmine, Jira, etc.)
   - Unified sync interface

---

## Files Modified/Created

### Created:
- `backend/config/pm_tracker_config.py` - Configuration module
- `backend/pm_api_sync.py` - API client
- `backend/sync_utils.py` - Shared sync utilities

### Modified:
- `backend/models.py` - Added `SyncLog` model
- `backend/main.py` - Added 5 new endpoints + imports
- `frontend/src/TicketsDashboard.js` - Enhanced sync UI

### Existing (unchanged):
- `backend/sync_excel_to_db.py` - Still works as before
- Database connection pool remains the same

---

## Support & Questions

For issues or questions:
1. Check sync-history: `GET /ticket-tracking/sync-history`
2. Test API: `POST /ticket-tracking/test-api-connection`
3. Review logs in terminal/application logs
4. Check `SyncLog` table for detailed error messages
5. Review this guide for configuration options
