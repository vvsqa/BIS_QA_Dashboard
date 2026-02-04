# Timesheet Module – Get It Running

The Timesheet page talks to the **backend API** on **port 8000**. If the backend is not running or not reachable, you see "Backend not running" or "Timesheet service unavailable".

## Step-by-step (do this once per session)

### 1. Start the backend

Open a terminal and run:

```bash
cd backend
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Leave this terminal open. Wait until you see:

```
INFO:     Application startup complete.
```

### 2. Check the backend (optional)

In a browser, open:

- **http://localhost:8000/**  
  You should see: `{"status":"ok","message":"QA Dashboard API",...}`

- **http://localhost:8000/timesheet/health**  
  You should see: `{"status":"ok","message":"Timesheet API is available"}`

If you get "Connection refused" or "Not Found", the backend is not running or not the right app.

### 3. Start the frontend

Open a **second** terminal and run:

```bash
cd frontend
npm start
```

The app will open at **http://localhost:3000** (or 3004 if 3000 is in use).

### 4. Use Timesheet

1. Log in.
2. Go to **Timesheet** (sidebar or route `/timesheet`).
3. If you see "Backend not running", go back to step 1 and start the backend, then click **Retry** on the Timesheet page.

## Why this is needed

- **Frontend** (React) runs on port **3000** or **3004**.
- **Backend** (FastAPI) must run on port **8000**.
- The frontend is configured (via `.env.development`) to call **http://localhost:8000** for all API requests, including Timesheet.
- If nothing is listening on port 8000, the Timesheet page cannot load data and shows an error.

## One-command start (Windows PowerShell)

From the **project root**:

```powershell
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000"
```

Then in a **second** terminal:

```powershell
cd frontend
npm start
```

## Troubleshooting

| Symptom | What to do |
|--------|-------------|
| "Backend not running" / "Cannot reach backend" | Start the backend (step 1). Then click **Retry** on the Timesheet page. |
| "Timesheet API not found (404)" | You are running an old or different backend. Use this project’s `backend` folder and run `uvicorn main:app --reload` from there. |
| Port 8000 already in use | Stop the other process using 8000, or run backend on another port and set `REACT_APP_API_BASE=http://localhost:NEW_PORT` in `frontend/.env.development`. |
| Port 3000 already in use | The frontend will use 3004 (or another port). Use the URL shown in the terminal (e.g. http://localhost:3004). |
