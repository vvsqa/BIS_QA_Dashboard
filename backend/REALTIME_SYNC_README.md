# Real-Time Google Sheets Sync

## Overview

The application now supports **real-time automatic syncing** of Google Sheets data. The sync runs every 2 minutes by default, keeping your calendar data up-to-date automatically.

## Features

- **Real-Time Sync**: Automatically syncs every 2 minutes
- **Auto-Start**: Starts automatically when the backend server starts
- **Manual Control**: Start/stop sync from the Calendar UI
- **Status Monitoring**: See last sync time and next sync time
- **Auto-Refresh**: Calendar data refreshes automatically when sync completes

## Configuration

### Enable/Disable Auto-Sync

Edit `backend/config/google_sheets_config.py`:

```python
"auto_sync_enabled": os.getenv("SHEETS_AUTO_SYNC", "true").lower() == "true",
"realtime_sync": os.getenv("SHEETS_REALTIME_SYNC", "true").lower() == "true",
```

Or set environment variables:
- `SHEETS_AUTO_SYNC=true` (default: true)
- `SHEETS_REALTIME_SYNC=true` (default: true, uses 2-minute intervals)

### Sync Interval

- **Real-time mode**: 2 minutes (default)
- **Custom interval**: Set `SHEETS_SYNC_INTERVAL=5` for 5-minute intervals (or any value)

## API Endpoints

### Start Auto-Sync
```
POST /sync/google-sheets/start?realtime=true
POST /sync/google-sheets/start?interval_minutes=5&realtime=false
```

### Stop Auto-Sync
```
POST /sync/google-sheets/stop
```

### Get Sync Status
```
GET /sync/google-sheets/status
```

Returns:
```json
{
  "scheduler": {
    "running": true,
    "realtime_mode": true,
    "last_sync": "2026-01-27T10:30:00",
    "next_sync": "2026-01-27T10:32:00",
    "interval_minutes": 2
  }
}
```

## How It Works

1. **On Server Start**: Auto-sync starts automatically if enabled
2. **Background Scheduler**: Uses APScheduler to run sync jobs
3. **Sync Process**: 
   - Fetches data from Google Sheets
   - Updates database (EnhancedTimesheet, LeaveEntry tables)
   - Logs sync statistics
4. **Frontend Updates**: Calendar UI automatically refreshes when sync completes

## Monitoring

### Backend Logs
Check backend console for sync logs:
```
INFO: Starting scheduled sync for teams: ['QA', 'DEV']
INFO: Sync completed for QA: 150 added, 50 updated, 0 errors
```

### Frontend UI
- **Calendar Module**: Shows sync status in header
- **Real-time indicator**: ⚡ icon when real-time mode is active
- **Last sync time**: Displayed next to sync controls
- **Next sync time**: Shows when next sync will run

## Troubleshooting

### Sync Not Running
1. Check if auto-sync is enabled: `GET /sync/google-sheets/status`
2. Check backend logs for errors
3. Verify Google Sheets credentials are configured
4. Manually start: `POST /sync/google-sheets/start?realtime=true`

### Sync Errors
- Check Google Sheets API quota limits
- Verify sheet access permissions
- Check network connectivity
- Review error logs in backend console

## Performance

- **Real-time mode (2 min)**: Best for active monitoring
- **5-minute intervals**: Balanced performance
- **30-minute intervals**: Lower server load

The sync process is optimized to:
- Prevent overlapping syncs
- Handle errors gracefully
- Continue syncing even if one team fails
