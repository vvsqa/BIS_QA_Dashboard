# Running the QA Dashboard – Local vs Hosted

This app is designed to work in two modes: **local development** and **hosted (production)**. Use the right env and commands for each.

---

## Local development (your machine)

### 1. Backend

```bash
cd backend
# Ensure .env exists (copy from .env.example if needed)
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Backend will be at `http://127.0.0.1:8000`.

### 2. Frontend

```bash
cd frontend
# Uses .env.development: REACT_APP_API_BASE= (empty), proxy target = http://127.0.0.1:8000
npm start
```

- App runs at `http://localhost:3000` (or next free port if 3000 is in use).
- **Proxy**: All API requests (`/auth`, `/tickets`, `/bugs`, etc.) are proxied to the backend by `setupProxy.js`. No CORS issues.
- **Do not** set `REACT_APP_API_BASE` in `.env.development` for normal local use; leave it empty so the proxy is used.

### 3. Verify locally

- Open `http://localhost:3000` → Login → Ticket Dashboard, Tickets Overview, Task Planning, etc. should all work.
- If you get "Cannot reach the server", ensure the backend is running on port 8000 and restart `npm start` after changing `setupProxy.js` or `.env.development`.

---

## Hosted (production / staging server)

### 1. Backend

- Run the FastAPI app (e.g. with gunicorn/uvicorn behind a reverse proxy).
- Set env vars in the environment (e.g. `DB_*`, `JWT_SECRET_KEY`, `REDMINE_API_KEY`, etc.). See `backend/.env.example` and `DEVOPS_HANDOFF.md`.
- Ensure the backend is reachable at a URL like `https://api.yourdomain.com` (or your chosen base URL).

### 2. Frontend build

- Set the **backend base URL** at **build time**:

  **Option A – env file (recommended)**  
  Copy `frontend/.env.production.example` to `frontend/.env.production` and set:

  ```bash
  REACT_APP_API_BASE=https://api.yourdomain.com
  ```
  (No trailing slash. Use your real backend URL.)

  **Option B – inline**  
  ```bash
  cd frontend
  REACT_APP_API_BASE=https://api.yourdomain.com npm run build
  ```

- Then build:
  ```bash
  cd frontend
  npm run build
  ```

- Serve the `frontend/build` folder as static files (nginx, Apache, or any static host). The app will call `REACT_APP_API_BASE` for all API requests; no proxy is used in production.

### 3. Reverse proxy (if frontend and backend share a domain)

If you serve the frontend at `https://app.yourdomain.com` and the backend at `https://app.yourdomain.com/api`, then:

- Set `REACT_APP_API_BASE=https://app.yourdomain.com` (same origin; or use a path like `https://app.yourdomain.com/api` if your backend is mounted at `/api`).
- Configure the server so that requests to `/auth`, `/tickets`, `/bugs`, etc. are proxied to the backend (see `DEVOPS_HANDOFF.md`).

### 4. Verify hosted

- Open the hosted app URL → Login.
- In DevTools → Network, confirm login and API calls go to your backend URL and return 200 (or 401 for bad credentials), not 404.

---

## Summary

| Scenario        | REACT_APP_API_BASE     | REACT_APP_DEV_PROXY_TARGET | Command        |
|----------------|------------------------|----------------------------|----------------|
| Local          | Empty (use proxy)      | `http://127.0.0.1:8000`    | `npm start`    |
| Hosted build   | Backend base URL       | Not used                   | `npm run build` |

- **Local**: proxy handles API routing; leave `REACT_APP_API_BASE` empty in `.env.development`.
- **Hosted**: set `REACT_APP_API_BASE` to the backend URL when building; serve the built app and ensure the backend is reachable at that URL.
