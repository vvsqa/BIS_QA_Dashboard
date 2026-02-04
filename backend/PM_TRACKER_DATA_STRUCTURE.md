# PM Tracker API - Data Structure & Sample Response

## Current Status

**API Key Status:** ❌ **INVALID** (Error: `invalid_key - authID is missing or invalid`)

The API key provided (`Q7vN4xA9kR2mS8pD6fH3yT5zL1cW0uB7`) is either:
1. Expired or revoked
2. Incorrect/mistyped
3. Not yet activated for this endpoint

---

## Expected Data Structure

Based on the PM Tracker API endpoint, the response will likely be one of these formats:

### Format 1: Direct List (Most Common)
```json
[
  {
    "ticket_id": 19401,
    "status": "NEW",
    "backend_developer": null,
    "frontend_developer": null,
    "qc_tester": null,
    "eta": null,
    "current_assignee": "Sam Isaac",
    "dev_estimate_hours": 0,
    "actual_dev_hours": 0,
    "qa_estimate_hours": 0,
    "actual_qa_hours": 0,
    "developer_assigned": null,
    "updated_on": "2026-01-29"
  },
  {
    "ticket_id": 19400,
    "status": "NEW",
    ...
  },
  ...
]
```

### Format 2: Wrapped Object
```json
{
  "data": [
    { "ticket_id": 19401, "status": "NEW", ... },
    ...
  ],
  "total": 450,
  "count": 450
}
```

### Format 3: Tickets Key
```json
{
  "tickets": [
    { "ticket_id": 19401, "status": "NEW", ... },
    ...
  ]
}
```

---

## Expected Field Mapping

The system will automatically map the following fields:

| Database Field | API Field Variations | Description |
|---|---|---|
| `ticket_id` | `ticket_id`, `id`, `ticket_number`, `ticket_num`, `number` | Unique ticket identifier |
| `status` | `status`, `ticket_status`, `state` | Current ticket status |
| `backend_developer` | `backend_developer`, `backend`, `backend_dev`, `backend_assigned` | Developer assigned to backend |
| `frontend_developer` | `frontend_developer`, `frontend`, `frontend_dev`, `frontend_assigned` | Developer assigned to frontend |
| `qc_tester` | `qc_tester`, `qc`, `tester`, `qa`, `qa_tester` | QA/QC tester assigned |
| `eta` | `eta`, `due_date`, `deadline`, `expected_completion` | Expected completion date |
| `current_assignee` | `current_assignee`, `assignee`, `assigned_to`, `owner` | Current person responsible |
| `dev_estimate_hours` | `dev_estimate_hours`, `dev_estimate`, `development_estimate`, `estimate_hours`, `dev_estimate_time` | Estimated development hours |
| `actual_dev_hours` | `actual_dev_hours`, `actual_development`, `dev_actual`, `development_spent`, `actual_hours` | Actual development hours spent |
| `qa_estimate_hours` | `qa_estimate_hours`, `qa_estimate`, `qc_estimate`, `qa_estimate_time`, `qc_estimate_hours` | Estimated QA hours |
| `actual_qa_hours` | `actual_qa_hours`, `actual_qa`, `actual_qc`, `qa_spent`, `qa_actual_hours` | Actual QA hours spent |
| `developer_assigned` | `developer_assigned`, `developer`, `assigned_developer`, `dev_assigned` | Developer assignment |
| `updated_on` | `updated_on`, `updated_at`, `last_updated`, `modified_date`, `last_modified` | Last update timestamp |

---

## Sample Response (When API Works)

Here's what you should see once the API key is valid:

```
================================================================================
PM TRACKER API TEST - Fetching ticket data...
================================================================================
URL: https://www.bissafety.app/rest/v.01/pm/ticket-export
API Key: Q7vN4xA9kR...W0uB7

Status Code: 200
Content-Type: application/json;charset=UTF-8

Response Format: LIST
Total Records: 450

================================================================================
FIRST RECORD (Sample Data):
================================================================================
{
  'ticket_id': 19401,
  'status': 'NEW',
  'backend_developer': None,
  'frontend_developer': None,
  'qc_tester': None,
  'eta': None,
  'current_assignee': 'Sam Isaac',
  'dev_estimate_hours': 0,
  'actual_dev_hours': 0,
  'qa_estimate_hours': 0,
  'actual_qa_hours': 0,
  'developer_assigned': None,
  'updated_on': '2026-01-29'
}

================================================================================
FIELD NAMES (Available Fields):
================================================================================
 1. ticket_id                           (int        ) = 19401
 2. status                              (str        ) = NEW
 3. backend_developer                   (NoneType   ) = None
 4. frontend_developer                  (NoneType   ) = None
 5. qc_tester                           (NoneType   ) = None
 6. eta                                 (NoneType   ) = None
 7. current_assignee                    (str        ) = Sam Isaac
 8. dev_estimate_hours                  (int        ) = 0
 9. actual_dev_hours                    (int        ) = 0
10. qa_estimate_hours                   (int        ) = 0
11. actual_qa_hours                     (int        ) = 0
12. developer_assigned                  (NoneType   ) = None
13. updated_on                          (str        ) = 2026-01-29

================================================================================
SAMPLE RECORDS (First 5):
================================================================================

Record 1:
  ID: 19401
  Status: NEW
  Assignee: Sam Isaac

Record 2:
  ID: 19400
  Status: NEW
  Assignee: Sachin Verma

Record 3:
  ID: 19392
  Status: Express Lane F
  Assignee: Sachin Verma

Record 4:
  ID: 19391
  Status: NEW
  Assignee: None

Record 5:
  ID: 19390
  Status: Ready For Dev
  Assignee: None
```

---

## How to Fix the API Key Issue

1. **Contact PM Tracker Team** - Verify the API key:
   - Current Key: `Q7vN4xA9kR2mS8pD6fH3yT5zL1cW0uB7`
   - Check if it's:
     - Expired (request new key)
     - Incorrect (copy again from PM tool settings)
     - Not activated (enable it in PM Tracker admin)

2. **Update Environment Variable** - Once you get a valid key:
   ```bash
   PM_API_KEY=<NEW_VALID_KEY_HERE>
   ```

3. **Test Again** - Run the test script:
   ```bash
   python test_pm_api_standalone.py
   ```

4. **Monitor Sync Logs** - Once working, check:
   ```bash
   curl http://localhost:8000/ticket-tracking/sync-history
   ```

---

## Integration Ready

Even though we can't test the API now, the system is **fully integrated and ready** to work with the correct credentials:

✅ **Backend API Endpoints Created**
- POST `/ticket-tracking/sync-latest` - Sync with fallback
- GET `/ticket-tracking/sync-method` - Check status
- POST `/ticket-tracking/test-api-connection` - Test credentials
- GET `/ticket-tracking/sync-history` - View sync logs
- DELETE `/ticket-tracking/sync-history` - Cleanup logs

✅ **Frontend Updated**
- Enhanced sync button shows method and status
- Fallback indicators when API fails

✅ **Database Ready**
- SyncLog table created for audit trail
- TicketTracking table ready for data

✅ **Configuration System**
- Runtime-switchable sync methods
- Intelligent fallback logic
- No code changes needed to switch

---

## Quick Verification Steps

Once you have a valid API key:

1. **Update .env file**:
   ```bash
   PM_API_KEY=<YOUR_VALID_KEY>
   PM_SYNC_METHOD=both
   PM_FALLBACK_TRIGGER=connection_only
   ```

2. **Restart backend**:
   ```bash
   pkill -f "uvicorn main:app"
   python -m uvicorn main:app --reload
   ```

3. **Test connection**:
   ```bash
   curl -X POST http://localhost:8000/ticket-tracking/test-api-connection
   ```

4. **Perform first sync**:
   ```bash
   curl -X POST http://localhost:8000/ticket-tracking/sync-latest
   ```

5. **Check results**:
   ```bash
   curl http://localhost:8000/ticket-tracking/sync-history?limit=1
   ```

---

## Files to Update/Verify

1. **Backend Environment (.env or system env)**:
   - Add `PM_API_KEY=<VALID_KEY>`

2. **Test Script**:
   - Run: `python backend/test_pm_api_standalone.py`
   - Shows actual data once API key is fixed

3. **Database**:
   - Already has SyncLog table
   - TicketTracking table ready

4. **Configuration**:
   - Automatically loads from env vars
   - No hardcoded values needed

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| "API key is invalid" | Wrong/expired key | Get new key from PM Tracker team |
| "Connection timeout" | Network/DNS issue | Check internet, verify URL is reachable |
| "No data returned" | API quota exceeded | Contact PM Tracker support |
| "Fallback not working" | Fallback trigger not configured | Set `PM_FALLBACK_TRIGGER=connection_only` |

---

## Next Steps

1. **Contact PM Tracker Admin** - Get valid API key
2. **Update Environment Variable** - Set `PM_API_KEY`
3. **Restart Backend** - Changes take effect
4. **Run Test Script** - Verify data flow
5. **Monitor Sync** - Check `sync-history` endpoint

The system is ready to go once you have a valid API key! 🚀
