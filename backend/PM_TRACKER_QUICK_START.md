# PM Tracker JSON API Integration - Quick Start Guide

## What Changed?

You can now sync PM Tracker data directly from their JSON API instead of downloading Excel files. If the API fails, the system can automatically fall back to Excel sync.

## Quick Setup (5 minutes)

### 1. Add Environment Variables

Create or update `.env` file in the `backend` folder:

```bash
PM_SYNC_METHOD=both
PM_API_URL=https://www.bissafety.app/rest/v.01/pm/ticket-export
PM_API_KEY=Q7vN4xA9kR2mS8pD6fH3yT5zL1cW0uB7
PM_FALLBACK_TRIGGER=connection_only
```

### 2. Test the Setup

```bash
# Test API connection
curl -X POST http://localhost:8000/ticket-tracking/test-api-connection

# You should see:
# {"success": true, "message": "Connection successful. Retrieved XXX tickets."}
```

### 3. Perform First Sync

Click "Sync Now" button in the dashboard, or:

```bash
# Trigger sync via API
curl -X POST http://localhost:8000/ticket-tracking/sync-latest
```

That's it! ✓

---

## Configuration Scenarios

### Scenario 1: API Only (Recommended for new deployments)

```bash
PM_SYNC_METHOD=api
PM_FALLBACK_TRIGGER=never
```

- Uses API exclusively
- No fallback to Excel
- Fails if API is down

### Scenario 2: Excel Only (Revert if API has issues)

```bash
PM_SYNC_METHOD=excel
```

- Uses Excel exclusively
- No API calls
- Works with manual file downloads

### Scenario 3: API with Fallback (Recommended - Safe)

```bash
PM_SYNC_METHOD=both
PM_FALLBACK_TRIGGER=connection_only
```

- Tries API first
- Falls back to Excel on connection/timeout errors
- Stays on Excel on auth errors (don't retry forever)

### Scenario 4: API with Aggressive Fallback

```bash
PM_SYNC_METHOD=both
PM_FALLBACK_TRIGGER=any_error
```

- Tries API first
- Falls back to Excel on ANY error
- Most resilient but may hide API issues

---

## Using the New Endpoints

### Check Current Configuration

```bash
GET /ticket-tracking/sync-method
```

Response shows:
- Current sync method
- Last sync status
- Fallback configuration

### View Sync History

```bash
GET /ticket-tracking/sync-history?limit=20
```

See the last 20 sync operations and their details.

### Test API Connection

```bash
POST /ticket-tracking/test-api-connection
```

Verify the API key and URL are correct without triggering a full sync.

---

## Frontend Changes

The "Sync Now" button now shows:

**Before:**
```
[⟳ Sync Now]
Updated: 2026-01-29
```

**After:**
```
[⟳ Sync Now]
Mode: BOTH
✓ API: 45 added, 123 updated
```

Or if fallback occurred:
```
[⟳ Sync Now]
Mode: BOTH
(Fallback from api - Connection timeout)
✓ EXCEL: 30 added, 98 updated
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "API key is invalid" | Check `PM_API_KEY` value and API key from dev team |
| "Connection timeout" | Network issue - increase `PM_API_TIMEOUT=60` or check URL |
| "Fallback not working" | Check `PM_FALLBACK_TRIGGER=connection_only` and check logs |
| "No sync history shown" | Ensure `PM_STORE_SYNC_HISTORY=true` in config |
| Excel sync still works? | Yes! Run `/sync-latest` and it will try API first then fallback |

---

## Quick Commands

```bash
# Restart backend after changing .env
pkill uvicorn
python -m uvicorn main:app --reload

# View recent syncs
curl http://localhost:8000/ticket-tracking/sync-history?limit=5

# Delete old sync logs (older than 30 days)
curl -X DELETE "http://localhost:8000/ticket-tracking/sync-history?days=30"

# Test API key
curl -X POST http://localhost:8000/ticket-tracking/test-api-connection
```

---

## Key Configuration Values

```
PM_SYNC_METHOD          = "both" (default)    # excel | api | both
PM_API_TIMEOUT          = 30 seconds          # Increase if API is slow
PM_API_MAX_RETRIES      = 3                   # Retry on failure
PM_FALLBACK_TRIGGER     = "connection_only"   # When to fallback to Excel
PM_ENABLE_SYNC_LOGGING  = true                # Detailed logging
PM_STORE_SYNC_HISTORY   = true                # Keep audit trail
PM_SYNC_HISTORY_RETENTION_DAYS = 90          # Keep logs for 90 days
```

---

## How It Works (Simple Version)

1. **Click Sync Now**
2. **System tries API**
   - If success → ✓ Done, show results
   - If connection error → Try Excel (if configured)
   - If auth error → ✗ Show error, don't retry
3. **System tries Excel** (if API failed & fallback enabled)
   - If success → ✓ Show results (with "Fallback" notice)
   - If error → ✗ Show error
4. **Results logged** to database for history

---

## Support

- **See all syncs:** `/ticket-tracking/sync-history`
- **Check config:** `/ticket-tracking/sync-method`
- **Test API:** `/ticket-tracking/test-api-connection`
- **Full docs:** See `PM_TRACKER_IMPLEMENTATION.md`

---

## FAQ

**Q: Can I switch methods without restarting?**  
A: Yes, change `PM_SYNC_METHOD` environment variable and it takes effect on next sync.

**Q: What if API is slow?**  
A: Set `PM_FALLBACK_TRIGGER=connection_only` to automatically fallback on timeout.

**Q: How long to keep sync history?**  
A: Default is 90 days. Set `PM_SYNC_HISTORY_RETENTION_DAYS=0` for unlimited.

**Q: Can I manually trigger sync from the dashboard?**  
A: Yes, click "Sync Now" button - works the same as before.

**Q: What happens if both API and Excel fail?**  
A: Sync fails and error message is shown. Check logs for details.

**Q: Is there auto-sync?**  
A: Not by default. Set `PM_AUTO_SYNC_ENABLED=true` to enable (experimental).

---

## Next Steps

1. ✓ Add environment variables
2. ✓ Restart backend
3. ✓ Test API connection
4. ✓ Perform first sync
5. ✓ Monitor sync history
6. ✓ Adjust fallback settings if needed
7. ✓ Done!

Enjoy automatic API sync with Excel fallback! 🎉
