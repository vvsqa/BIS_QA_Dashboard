# How to run the QA Dashboard

## Local (development)

### 1. Start the backend

In a terminal (from the project root):

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

**Windows:** You can double-click `start-backend.bat` instead (it does the same).

Make sure `backend/.env` exists with at least: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET_KEY`, `PM_API_KEY`.

**Authentication (login):** Before anyone can sign in, create the auth tables and admin account once:

```bash
cd backend
python add_user_auth_tables.py
python add_client_profiles_table.py
```

This creates an **admin** login: **admin@techversantinfotech.com** / **admin123** (and syncs users from employees). If you later get **"Invalid email or password"** (e.g. after changing the admin password in Settings), reset it with:

```bash
cd backend
python reset_admin_password.py
```

Then log in again with **admin@techversantinfotech.com** / **admin123**. Regular users (from Employees) use their **email** and initial password **employee ID** until they change it.

### 2. Start the frontend

In a **second** terminal (from the project root):

```bash
cd frontend
npm install
npm start
```

Browser will open at **http://localhost:3000**. Frontend uses env-based API config:
- `REACT_APP_API_BASE` (leave empty in local dev for relative API paths)
- `REACT_APP_DEV_PROXY_TARGET` (dev proxy destination)

For local development, keep `REACT_APP_API_BASE` empty and set proxy target:

```bash
cd frontend
REACT_APP_DEV_PROXY_TARGET=http://localhost:8000 npm start
```

**Windows (PowerShell):**

```powershell
cd frontend
$env:REACT_APP_API_BASE=""
$env:REACT_APP_DEV_PROXY_TARGET="http://localhost:8000"
npm start
```

---

## Share with users on your network (before hosting)

To let others on the same Wi‑Fi/LAN use the app from their browsers:

1. **Start the backend** (same as above; keep it running):
   ```bash
   cd backend
   python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
   ```
   Or run `start-backend.bat` on Windows.

2. **Start the frontend so it accepts connections from other machines:**
   ```bash
   cd frontend
   set HOST=0.0.0.0 && npm start
   ```
   **Windows (Command Prompt):** `set HOST=0.0.0.0 && npm start`  
   **Windows (PowerShell):** `$env:HOST="0.0.0.0"; npm start`  
   **Mac/Linux:** `HOST=0.0.0.0 npm start`

3. **Get your PC’s IP address:**
   - **Windows:** Open Command Prompt and run `ipconfig`. Use the **IPv4 Address** for your active adapter (e.g. `192.168.1.105`).
   - **Mac:** System Settings → Network, or run `ipconfig getifaddr en0` in Terminal.
   - **Linux:** Run `hostname -I` or `ip addr`.

4. **Share this URL with users on your network:**
   ```text
   http://<YOUR_IP>:3000
   ```
   Example: if your IP is `192.168.1.105`, they open:
   ```text
   http://192.168.1.105:3000
   ```

They must be on the same network (same Wi‑Fi or LAN). Your firewall may need to allow inbound connections on port **3000** (and ensure the backend stays on 127.0.0.1; the proxy on your PC will forward API calls to it).

**Optional:** From the project root you can run `start-frontend-network.bat` (Windows) to start the frontend with `HOST=0.0.0.0` and print a reminder of the share URL.

### If the shared URL does not load

1. **On this PC:** Try **http://localhost:3000**. If that works but **http://10.1.0.165:3000** (or your IP) does not, the frontend may be bound to localhost only. Restart it with `start-frontend-network.bat` or `set HOST=0.0.0.0 && npm start` in the `frontend` folder.
2. **From another device:** Windows Firewall often blocks port 3000. **Double‑click `allow-network-access-firewall.bat`** (or right‑click → Run as administrator). When UAC asks, click Yes. If it still doesn’t work, add the rule manually: open **Command Prompt as Administrator** and run: `netsh advfirewall firewall add rule name="QA Dashboard 3000" dir=in action=allow protocol=TCP localport=3000`
3. **Same network:** The other device must be on the same Wi‑Fi or LAN (same subnet). Use the host PC’s IPv4 address from `ipconfig` (e.g. `10.1.0.165`), not `localhost`.
4. **Backend:** Keep the backend running (e.g. `start-backend.bat`).
5. **Frontend proxy target:** keep `REACT_APP_API_BASE` empty and point proxy to backend:
   - PowerShell:
     - `$env:REACT_APP_API_BASE=""`
     - `$env:REACT_APP_DEV_PROXY_TARGET="http://127.0.0.1:8000"; npm start`
   - Command Prompt:
     - `set REACT_APP_API_BASE=`
     - `set REACT_APP_DEV_PROXY_TARGET=http://127.0.0.1:8000 && npm start`

---

## Deployed (production)

### 1. Backend

On your server:

```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000
```

Use systemd, Docker, or another process manager in production. Set all env vars (see `HOSTING.md` §3).

### 2. Frontend build

Set the **full backend URL** when building so the app can call your API:

```bash
cd frontend
REACT_APP_API_BASE=https://your-api.example.com npm run build
```

Replace `https://your-api.example.com` with your real backend URL (no trailing slash). Then serve the `build/` folder (Nginx, Apache, S3, etc.).

---

For full hosting details, env vars, and API keys, see **HOSTING.md**.
