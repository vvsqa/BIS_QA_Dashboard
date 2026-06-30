"""
BIS Bug Reporter — standalone local utility for fast Redmine bug creation.

Runs entirely on a tester's machine. Starts a tiny web server on 127.0.0.1 and
opens a single-page form in the browser. The tester's own Redmine API key is
used to CREATE bugs (so the bug is authored by them). An optional "Polish with
AI" booster calls the BIS dashboard server (the only place Claude lives) to turn
a rough note into a clean, structured report — but creating a bug never needs
that server: Redmine create-time metadata is cached locally on first fetch.

Dev run:   python app.py
Packaged:  double-click BIS-Bug-Reporter.exe  (built via build.cmd)
"""

import json
import os
import re
import sys
import threading
import webbrowser

import requests
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, FileResponse, Response
from pydantic import BaseModel

# --------------------------------------------------------------------------- config
APP_NAME = "bis-bug-reporter"
APP_VERSION = "1.4.5"          # bump on each packaged release; compared against the dashboard manifest
PORT = int(os.environ.get("BUG_REPORTER_PORT", "8765"))

DEFAULT_REDMINE_URL = "https://redmine.bissafety.app"
DEFAULT_DASHBOARD_URL = "http://10.1.0.20:8000"


def _config_dir():
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    d = os.path.join(base, APP_NAME)
    os.makedirs(d, exist_ok=True)
    return d


CONFIG_PATH = os.path.join(_config_dir(), "config.json")
META_CACHE_PATH = os.path.join(_config_dir(), "bug-meta.json")

DEFAULT_CONFIG = {
    "tester_name": "",
    "redmine_api_key": "",
    "jam_pat": "",                 # per-user Jam personal access token (local only)
    "testrail_email": "",          # per-user TestRail login (for attributing the failed result)
    "testrail_api_key": "",        # per-user TestRail API key (local only; falls back to shared)
    "redmine_url": DEFAULT_REDMINE_URL,
    "dashboard_url": DEFAULT_DASHBOARD_URL,
    "auto_update": True,           # silently install a newer version on launch (background)
    # Per-user defaults so repetitive required fields are pre-filled.
    "defaults": {
        "platform": "Web",
        "os": "Windows",
        "browser": "Chrome",
        "devices": "All Devices",
        "build_version": "NA",
        "fix_version_mobile": "Not Decided",
        "environment": "Staging",
    },
}


def load_config():
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))  # deep copy
    try:
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                saved = json.load(f)
            cfg.update({k: v for k, v in saved.items() if k != "defaults"})
            if isinstance(saved.get("defaults"), dict):
                cfg["defaults"].update(saved["defaults"])
    except Exception:
        pass
    return cfg


def save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


# --------------------------------------------------------------------------- app
app = FastAPI(title="BIS Bug Reporter")


@app.get("/", response_class=HTMLResponse)
def index():
    return HTML_PAGE


@app.get("/ping")
def ping():
    """Identifies this process so a newer exe can recognise an old instance and take over its port."""
    return {"app": APP_NAME}


GUIDE_FILE = "BIS-Bug-Reporter-User-Guide.pdf"


def _resource_path(name):
    """Locate a bundled data file both when running from source and inside the PyInstaller exe."""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, name)


@app.get("/guide")
def guide():
    """The user manual, bundled in the app so it opens even offline (pinned in the header)."""
    path = _resource_path(GUIDE_FILE)
    if os.path.exists(path):
        return FileResponse(path, media_type="application/pdf", filename=GUIDE_FILE,
                            headers={"Content-Disposition": f'inline; filename="{GUIDE_FILE}"'})
    # fall back to the network copy if the bundle is missing
    return Response(status_code=307, headers={"Location": "http://10.1.0.20/BIS-Bug-Reporter-User-Guide.pdf"})


@app.post("/shutdown")
def shutdown():
    """Graceful stop — used by a newer instance taking over the port (localhost only)."""
    import time as _t

    def _bye():
        _t.sleep(0.4)
        os._exit(0)
    threading.Thread(target=_bye, daemon=True).start()
    return {"ok": True}


# --------------------------------------------------------------------------- self-update
def _vtuple(s):
    """Parse a dotted version like '1.2.0' into a comparable tuple; non-numeric parts sort as 0."""
    out = []
    for part in str(s or "").split("."):
        try:
            out.append(int(part))
        except ValueError:
            out.append(0)
    return tuple(out) or (0,)


def _is_frozen():
    return bool(getattr(sys, "frozen", False))


@app.get("/version")
def version():
    """This utility's own version (so the page can show it and the updater can compare)."""
    return {"version": APP_VERSION, "frozen": _is_frozen(), "exe": (sys.executable if _is_frozen() else None)}


@app.get("/update/check")
def update_check():
    """Ask the dashboard for the latest packaged version and report whether an update is available.
    Read-only — never downloads anything."""
    cfg = load_config()
    dash = (cfg.get("dashboard_url") or DEFAULT_DASHBOARD_URL).rstrip("/")
    try:
        r = requests.get(f"{dash}/bug-reporter/latest", timeout=10)
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Update server returned {r.status_code}.")
        m = r.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Couldn't reach the update server: {e}")
    latest = str(m.get("version") or "0.0.0")
    available = m.get("available", True) and _vtuple(latest) > _vtuple(APP_VERSION)
    return {
        "current": APP_VERSION,
        "latest": latest,
        "available": bool(available),
        "notes": m.get("notes") or "",
        "size": m.get("size") or 0,
        "built_on": m.get("built_on"),
        "frozen": _is_frozen(),
        "download_url": (dash + (m.get("download_url") or "")) if m.get("download_url") else None,
    }


@app.post("/update/apply")
def update_apply():
    """Download the latest exe next to the running one, then hand off to a tiny updater script that
    swaps the file once this process exits and relaunches it. Only works for the packaged .exe."""
    if not _is_frozen():
        raise HTTPException(status_code=400, detail="Self-update only works for the packaged BIS-Bug-Reporter.exe (you're running from source).")
    info = update_check()
    if not info["available"] or not info["download_url"]:
        raise HTTPException(status_code=409, detail="No update available.")

    cur_exe = os.path.abspath(sys.executable)
    exe_dir = os.path.dirname(cur_exe)
    new_exe = os.path.join(exe_dir, "BIS-Bug-Reporter.new.exe")

    # 1) download the new binary
    try:
        with requests.get(info["download_url"], stream=True, timeout=120) as resp:
            if resp.status_code != 200:
                raise HTTPException(status_code=502, detail=f"Download failed ({resp.status_code}).")
            written = 0
            with open(new_exe, "wb") as f:
                for chunk in resp.iter_content(chunk_size=262144):
                    if chunk:
                        f.write(chunk)
                        written += len(chunk)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Download failed: {e}")
    # sanity: a real exe is large; an error page is not
    if written < 1_000_000:
        try:
            os.remove(new_exe)
        except OSError:
            pass
        raise HTTPException(status_code=502, detail="Downloaded file looks too small to be the app — aborting.")

    # 2) updater script: waits for THIS exe to unlock, swaps in the new one, relaunches it
    # Updater bat: once THIS exe exits and unlocks, swap in the new version, then relaunch it.
    # The swap is reliable; the relaunch is best-effort (it works when the app was started normally
    # from Explorer; if it doesn't pop back up, the user just reopens — the new version is already in
    # place). `ping` is used for the waits so it works without a stdin/console.
    bat = os.path.join(exe_dir, "_bug_reporter_update.bat")
    cur_name = os.path.basename(cur_exe)
    script = (
        "@echo off\r\n"
        f'set "CUR={cur_exe}"\r\n'
        f'set "NEW={new_exe}"\r\n'
        "ping 127.0.0.1 -n 3 >nul\r\n"
        # force-close any lingering app instance so the .exe file unlocks for the swap
        f'taskkill /f /im "{cur_name}" >nul 2>&1\r\n'
        "ping 127.0.0.1 -n 2 >nul\r\n"
        "set /a tries=0\r\n"
        ":retry\r\n"
        'move /y "%NEW%" "%CUR%" >nul 2>&1\r\n'
        "if errorlevel 1 (\r\n"
        "  set /a tries+=1\r\n"
        '  if %tries% lss 40 ( ping 127.0.0.1 -n 2 >nul & goto retry )\r\n'
        ")\r\n"
        # relaunch via Explorer — launches in the user session, far more reliable than `start` from a
        # detached console (which was the part that previously failed to reopen the app)
        'start "" explorer.exe "%CUR%"\r\n'
        'del "%~f0"\r\n'
    )
    try:
        with open(bat, "w", encoding="utf-8") as f:
            f.write(script)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Couldn't write the updater: {e}")

    # 3) launch the updater in its own console, then exit so the exe file unlocks for the swap
    try:
        CREATE_NEW_CONSOLE = 0x00000010
        import subprocess
        subprocess.Popen(["cmd", "/c", bat], cwd=exe_dir, creationflags=CREATE_NEW_CONSOLE, close_fds=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Couldn't launch the updater: {e}")

    def _bye():
        import time as _t
        _t.sleep(0.8)
        os._exit(0)
    threading.Thread(target=_bye, daemon=True).start()
    return {"ok": True, "version": info["latest"], "restarting": True}


@app.get("/config")
def get_config():
    cfg = load_config()
    # never expose the raw key to the page; just whether it's set + a masked tail
    key = cfg.get("redmine_api_key") or ""
    return {
        "tester_name": cfg.get("tester_name", ""),
        "redmine_url": cfg.get("redmine_url", DEFAULT_REDMINE_URL),
        "dashboard_url": cfg.get("dashboard_url", DEFAULT_DASHBOARD_URL),
        "auto_update": cfg.get("auto_update", True),
        "defaults": cfg.get("defaults", {}),
        "key_set": bool(key),
        "key_tail": ("…" + key[-4:]) if len(key) >= 4 else "",
        "jam_set": bool(cfg.get("jam_pat")),
        "jam_tail": ("…" + cfg["jam_pat"][-4:]) if len(cfg.get("jam_pat") or "") >= 4 else "",
        "testrail_email": cfg.get("testrail_email", ""),
        "testrail_set": bool(cfg.get("testrail_api_key")),
        "testrail_tail": ("…" + cfg["testrail_api_key"][-4:]) if len(cfg.get("testrail_api_key") or "") >= 4 else "",
    }


class ConfigBody(BaseModel):
    tester_name: str = ""
    redmine_api_key: str = ""   # blank = keep existing
    jam_pat: str = ""           # blank = keep existing
    testrail_email: str = ""    # blank = keep existing
    testrail_api_key: str = ""  # blank = keep existing
    redmine_url: str = DEFAULT_REDMINE_URL
    dashboard_url: str = DEFAULT_DASHBOARD_URL
    auto_update: bool | None = None     # None = keep existing
    defaults: dict = {}


def _fetch_redmine_profile(url, key):
    """Return (name, mail, login) for the given Redmine API key, or (None, ...)."""
    try:
        r = requests.get(f"{url}/users/current.json", headers={"X-Redmine-API-Key": key}, timeout=12)
        if r.status_code == 200:
            u = r.json().get("user", {})
            name = (f"{u.get('firstname','')} {u.get('lastname','')}").strip() or u.get("login")
            return name, u.get("mail"), u.get("login")
    except Exception:
        pass
    return None, None, None


@app.post("/config")
def post_config(body: ConfigBody):
    cfg = load_config()
    cfg["redmine_url"] = (body.redmine_url or DEFAULT_REDMINE_URL).strip().rstrip("/")
    cfg["dashboard_url"] = (body.dashboard_url or DEFAULT_DASHBOARD_URL).strip().rstrip("/")
    if body.auto_update is not None:
        cfg["auto_update"] = bool(body.auto_update)
    if isinstance(body.defaults, dict):
        cfg["defaults"].update(body.defaults)

    result = {"ok": True}
    if body.jam_pat.strip():                    # only overwrite when provided
        cfg["jam_pat"] = body.jam_pat.strip()
    if body.testrail_email.strip():
        cfg["testrail_email"] = body.testrail_email.strip()
    if body.testrail_api_key.strip():
        cfg["testrail_api_key"] = body.testrail_api_key.strip()
    if body.tester_name.strip() and not body.redmine_api_key.strip():
        cfg["tester_name"] = body.tester_name.strip()  # manual override when no key change

    # Persist the non-validated fields (jam_pat, testrail creds, urls, defaults, tester name) NOW —
    # before the Redmine key validation, which can raise and would otherwise discard them silently.
    save_config(cfg)

    if body.redmine_api_key.strip():           # only overwrite when provided
        key = body.redmine_api_key.strip()
        # validate the key + auto-fetch the tester's profile (name) from Redmine
        name, mail, login = _fetch_redmine_profile(cfg["redmine_url"], key)
        if not name:
            raise HTTPException(status_code=400,
                                detail="That API key didn't work against Redmine. Check the key (Redmine → My account → API access key) and the Redmine URL.")
        cfg["redmine_api_key"] = key
        cfg["tester_name"] = name
        cfg["redmine_login"] = login
        cfg["redmine_mail"] = mail
        result["tester_name"] = name
        save_config(cfg)  # persist the validated Redmine fields too

    return result


@app.get("/meta")
def meta(refresh: bool = False):
    """Redmine create-time metadata. Fetched from the dashboard server (needs the
    admin key) and cached locally so the create path keeps working offline."""
    cfg = load_config()
    dash = cfg.get("dashboard_url", DEFAULT_DASHBOARD_URL)
    if not refresh and os.path.exists(META_CACHE_PATH):
        try:
            with open(META_CACHE_PATH, "r", encoding="utf-8") as f:
                cached = json.load(f)
            # serve cache, but try a background refresh next time
            data = cached
        except Exception:
            data = None
    else:
        data = None
    try:
        r = requests.get(f"{dash}/bug-meta", timeout=12)
        if r.status_code == 200:
            data = r.json()
            with open(META_CACHE_PATH, "w", encoding="utf-8") as f:
                json.dump(data, f)
            data["_source"] = "server"
            return data
    except Exception:
        pass
    if data:
        data["_source"] = "cache"
        return data
    raise HTTPException(status_code=502,
                        detail="Could not reach the dashboard server and no cached metadata exists. "
                               "Connect to the network once to fetch field definitions.")


class DraftBody(BaseModel):
    rough_note: str
    ticket_id: int | None = None
    severity: str | None = None


@app.post("/draft")
def draft(body: DraftBody):
    """Proxy the rough note to the dashboard AI. Returns a structured draft, or a
    plain fallback (handled server-side) — never blocks bug creation."""
    cfg = load_config()
    dash = cfg.get("dashboard_url", DEFAULT_DASHBOARD_URL)
    payload = body.dict()
    payload["reporter"] = cfg.get("tester_name", "")   # never auto-assign the bug to the reporter
    try:
        r = requests.post(f"{dash}/bug-draft", json=payload, timeout=160)
        if r.status_code == 200:
            return r.json()
        raise HTTPException(status_code=r.status_code, detail=r.text[:300])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI server unavailable: {e}. You can still fill the form manually and create the bug.")


@app.get("/case")
def case(case_id: int):
    """Proxy to the dashboard's TestRail case lookup so the bug can be pre-filled
    from the canonical test case (no AI)."""
    cfg = load_config()
    dash = cfg.get("dashboard_url", DEFAULT_DASHBOARD_URL)
    try:
        r = requests.get(f"{dash}/bug-case", params={"case_id": case_id}, timeout=25)
        if r.status_code == 200:
            return r.json()
        raise HTTPException(status_code=r.status_code, detail=r.json().get("detail", r.text[:200]) if r.headers.get("content-type","").startswith("application/json") else r.text[:200])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach the server for the test case: {e}")


# --------------------------------------------------------------------------- Jam MCP
JAM_MCP_URL = "https://mcp.jam.dev/mcp"
_JAM_ID_RE = re.compile(r"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})")


def _jam_id_from_link(link):
    m = _JAM_ID_RE.search(link or "")
    return m.group(1) if m else None


def _jam_mcp(pat, calls):
    """Minimal Jam MCP (Streamable HTTP) client. `calls` = list of (tool, args). Returns {tool: parsed_json}."""
    import json as _json
    sess = requests.Session()
    H = {"Authorization": f"Bearer {pat}", "Content-Type": "application/json",
         "Accept": "application/json, text/event-stream"}

    def _parse(resp):
        if "text/event-stream" in resp.headers.get("content-type", ""):
            out = None
            for line in resp.text.splitlines():
                if line.startswith("data:"):
                    try:
                        out = _json.loads(line[5:].strip())
                    except Exception:
                        pass
            return out
        try:
            return resp.json()
        except Exception:
            return None

    r = sess.post(JAM_MCP_URL, headers=H, timeout=40, json={
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                   "clientInfo": {"name": "bis-bug-reporter", "version": "1.0"}}})
    if r.status_code == 401:
        raise HTTPException(status_code=401, detail="Jam token rejected. Check your Jam PAT in Settings.")
    sid = r.headers.get("Mcp-Session-Id") or r.headers.get("mcp-session-id")
    sess.post(JAM_MCP_URL, headers={**H, "Mcp-Session-Id": sid} if sid else H, timeout=20,
              json={"jsonrpc": "2.0", "method": "notifications/initialized"})
    out = {}
    cid = 1
    for tool, args in calls:
        cid += 1
        rr = sess.post(JAM_MCP_URL, headers={**H, "Mcp-Session-Id": sid} if sid else H, timeout=60,
                       json={"jsonrpc": "2.0", "id": cid, "method": "tools/call",
                             "params": {"name": tool, "arguments": args}})
        res = _parse(rr) or {}
        content = (res.get("result", {}) or {}).get("content") or []
        text = content[0].get("text", "") if content else ""
        try:
            out[tool] = _json.loads(text)
        except Exception:
            # Jam returns some payloads as NDJSON (one JSON object per line)
            objs = []
            for ln in (text or "").splitlines():
                ln = ln.strip()
                if not ln:
                    continue
                try:
                    objs.append(_json.loads(ln))
                except Exception:
                    pass
            out[tool] = objs if objs else text
    return out


def _vtt_to_text(vtt):
    """WebVTT transcript -> plain narration (drop 'WEBVTT', cue numbers, timestamps)."""
    if not isinstance(vtt, str):
        return ""
    lines = []
    for ln in vtt.splitlines():
        s = ln.strip()
        if not s or s == "WEBVTT" or s.isdigit() or "-->" in s:
            continue
        lines.append(re.sub(r"\s{2,}", " ", s))
    return " ".join(lines).strip()


def _page_from_url(url):
    """Human-readable page name from a BIS url (…action=portal.systemModules → 'System Modules')."""
    m = re.search(r"[?&]action=([\w.]+)", url or "")
    if m:
        seg = m.group(1).split(".")[-1]                      # systemModules
        words = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", seg)     # system Modules
        return words[:1].upper() + words[1:]                 # System Modules
    try:
        from urllib.parse import urlparse
        p = urlparse(url)
        return (p.path.strip("/").split("/")[-1] or p.netloc) or url
    except Exception:
        return url


def _event_str_to_step(s):
    """Jam now returns user events as readable strings like
    'Clicked on <input id="..." ...>' — turn one into a clean step line."""
    s = (s or "").strip()
    if not s:
        return None
    low = s.lower()
    verb = "Interact with"
    if low.startswith("click"):            verb = "Click"
    elif low.startswith(("typed", "type", "entered", "input")): verb = "Enter into"
    elif low.startswith(("navigated", "opened", "visited")):    verb = "Open"
    elif low.startswith("scroll"):         verb = "Scroll to"
    elif low.startswith(("selected", "chose")): verb = "Select"
    # best human-readable target: visible text > id > placeholder/aria > tag
    target = None
    m = re.search(r">\s*([^<>]{2,60}?)\s*<", s)              # text between tags
    if m and not m.group(1).strip().startswith("_"):
        target = m.group(1).strip()
    for attr in ("id", "placeholder", "aria-label", "name", "value"):
        if target:
            break
        m = re.search(attr + r'="([^"]{1,60})"', s)
        if m and not m.group(1).startswith("_"):
            target = m.group(1)
    if not target:
        m = re.search(r"<(\w+)", s)
        target = m.group(1) if m else "the element"
    target = re.sub(r"\s+", " ", target).strip()
    return f"{verb} {target}"


def _summarize_events(ev):
    """User events JSON -> a clean, de-duplicated list of page visits / actions.
    Handles both the legacy dict-shaped events and Jam's current string events."""
    items = ev if isinstance(ev, list) else (ev.get("events") if isinstance(ev, dict) else None)
    if not isinstance(items, list):
        return ""
    out, last = [], None
    for e in items:
        if isinstance(e, str):                  # current Jam format: a plain action string
            line = _event_str_to_step(e)
            if line and line != last:
                out.append(line); last = line
            if len(out) >= 15:
                break
            continue
        if not isinstance(e, dict):
            continue
        jt = str(e.get("jamType") or e.get("type") or "").lower()
        payload = ((e.get("data") or {}).get("payload")) or {}
        url = (e.get("tabInfo") or {}).get("url") or payload.get("url")
        line = None
        if "navigation" in jt and url:
            page = _page_from_url(url)
            if "pm.bissafety" in url:        # skip PM comment tab — not a repro step
                continue
            line = f"Open the {page} page"
        elif "click" in jt:
            t = payload.get("text") or payload.get("selector") or payload.get("tag") or "the element"
            line = f"Click {t}"
        elif "input" in jt:
            line = "Enter the required input"
        if line and line != last:
            out.append(line)
            last = line
        if len(out) >= 15:
            break
    return "\n".join(f"{i+1}. {s}" for i, s in enumerate(out))


_JAM_ENV_HOSTS = [("staging", "Staging"), ("pre.", "Pre-production"), ("pre-", "Pre-production"),
                  ("localhost", "Staging"), ("127.0.0.1", "Staging")]


def _env_from_url(url):
    u = (url or "").lower()
    for frag, env in _JAM_ENV_HOSTS:
        if frag in u:
            return env
    if "bissafety.app" in u or "bistrainer" in u:
        return "Production"
    return ""


def _match_val(value, allowed):
    if not value or not allowed:
        return ""
    v = str(value).strip().lower()
    for a in allowed:
        if str(a).strip().lower() == v:
            return a
    return ""


def _guess_module_text(text, mods):
    if not mods:
        return ""
    hay = (text or "").lower()
    best = ""
    for mv in mods:
        mvl = str(mv).strip().lower()
        if len(mvl) >= 4 and re.search(r"\b" + re.escape(mvl) + r"\b", hay) and len(mvl) > len(best):
            best = mv
    return best


_EXPECT_CUES = ("should", "need to", "needs to", "expected", "must ", "supposed to",
                "has to", "we want", "ought to", "is meant to")
_PROBLEM_CUES = ("overlap", "not work", "not show", "not displ", "not visible", "missing", "issue",
                 "error", "wrong", "broken", "unable", "fail", "does not", "doesn", "cannot",
                 "can't", "crash", "incorrect", "mismatch", "blank", "stuck", "not able", "no longer")
_UI_WORDS = ("icon", "label", "align", "overlap", " ui", " ux", "colour", "color", "css", "layout",
             "dropdown", "drop down", "tooltip", "placeholder", "spacing", "font", "button",
             "popup", "pop up", "text", "alignment", "position")
_SEV_HIGH = ("crash", "500 error", "data loss", "cannot login", "can't login", "white screen",
             "blank screen", "freeze", "hang", "corrupt")


def _clauses(t):
    parts = re.split(r"(?i)\b(?:so just|so we|so |and also|also,? |the second thing is|secondly|"
                     r"then |but |firstly|first |next |the next thing)\b|[.;]", t or "")
    return [re.sub(r"\s{2,}", " ", p).strip(" ,.-") for p in parts if p and len(p.strip()) > 4]


def _parse_bug_from_text(transcript, note, mods, sevs, types):
    """Rule-based mapping of the recording narration + typed note into bug fields (NO AI)."""
    text = " ".join([transcript or "", note or ""]).strip()
    cls = _clauses(text)
    problems = [c for c in cls if any(w in c.lower() for w in _PROBLEM_CUES)]
    expects = [c for c in cls if any(w in c.lower() for w in _EXPECT_CUES)]
    subj_src = problems[0] if problems else (cls[0] if cls else text)
    # drop the spoken intro ("yeah hi this is ticket number N regarding …") + ticket id + leading filler
    if re.search(r"(?i)\bregarding\b", subj_src):
        subj_src = re.sub(r"(?i).*\bregarding\b\s*", "", subj_src)
    subj_src = re.sub(r"(?i)\bticket\s*(?:number\s*)?#?\s*\d{3,6}\b", "", subj_src)
    subj_src = re.sub(r"(?i)^(yeah|hi|hello|okay|ok|so|well|um+|uh+|and|the|a|an|this is)[\s,]+", "", subj_src).strip(" ,.-")
    subj_src = re.sub(r"\s{2,}", " ", subj_src)
    subject = (subj_src[:100] or "Bug")
    subject = subject[:1].upper() + subject[1:]
    # Actual = the FULL narration (lossless) + the tester's typed note, so no detail is dropped.
    actual = (transcript or "").strip()
    if note and note.strip():
        actual = (actual + ("\n\nAdditional info (typed): " + note.strip())).strip()
    if not actual:
        actual = text
    expected = " ".join(expects).strip()
    low = text.lower()
    if any(w in low for w in _SEV_HIGH):
        sev = _match_val("Critical", sevs) or _match_val("Crash", sevs)
    elif any(w in low for w in _UI_WORDS):
        sev = _match_val("Minor", sevs)
    else:
        sev = _match_val("Major", sevs)
    typ = _match_val("UI / UX", types) if any(w in low for w in _UI_WORDS) else _match_val("Functional / Logic", types)
    mod = _guess_module_text(text, mods)
    return {"subject": subject, "actual": actual, "expected": expected,
            "severity": sev or None, "type": typ or None, "module": mod or None}


# --- Test-data extraction from the Jam narration/steps -------------------------------------------
# Pull the concrete, reproducible values a tester mentions (account, files, dates, volumes, the record
# acted on) so the bug's Test Data field is populated from the recording — never the password.
# A credential only — requires an explicit value after a connector (is/was/:/=), so feature phrases
# like "password failed status", "password reset link", "OTP screen" are NOT treated as secrets.
_PWD_RE   = re.compile(r'(?i)\b(?:password|passwd|pwd|passphrase|api[ _-]?key|access[ _-]?token|auth[ _-]?token|secret)\b\s*(?:is|was|=|:)\s*["\']?[^\s"\']{3,40}')
_EMAIL_RE = re.compile(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}')
_FILE_RE  = re.compile(r'\b[\w\-]{1,50}\.(?:pdf|xlsx?|csv|docx?|pptx?|png|jpe?g|gif|txt|zip|json|xml|mp4|mov)\b', re.I)
_DATE_RE  = re.compile(r'\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?)\b', re.I)
_ROLE_RE  = re.compile(r'(?i)\b(?:logged in as|log(?:ged)? in as|signed in as|login as|as an? |as the )\s*([a-z][\w .\-]{2,38})')
# Role/persona nouns used in BIS narration ("a learner user", "the admin view", "sub-admin account").
_ROLEWORD_RE = re.compile(r'(?i)\b((?:learner|admin(?:istrator)?|sub[- ]?admin|instructor|manager|supervisor|trainer|teacher|employee|customer|client|guest|worker|contractor|student|reviewer|approver)(?:\s+(?:user|account|role|view|profile))?)\b')
_VOL_RE   = re.compile(r'(?i)\b(\d[\d,]{0,12})\s+(records?|rows?|users?|forms?|items?|entries|attendees?|tickets?|files?|attachments?|locations?)\b')
_SETVAL_RE = re.compile(r'(?i)\b([a-z][\w ]{1,22}?)\s+(?:set to|equals?|changed to|=)\s+([\$]?\d[\d.,%]*)\b')


def _mask_secrets(t):
    return _PWD_RE.sub('password ***', t or '')


def _dedupe_roles(vals):
    """Drop a bare role ('learner') when a fuller form ('learner user') is also present."""
    vals = [v.strip() for v in vals if v and v.strip()]
    out = []
    for v in vals:
        if any(v.lower() != o.lower() and o.lower().startswith(v.lower() + " ") for o in vals):
            continue
        out.append(v)
    return out


def _extract_test_data(transcript, steps, note, url):
    """Best-effort, conservative: only emits lines for values actually present. Returns '' if none."""
    raw = _mask_secrets("\n".join([note or "", steps or "", transcript or ""]))
    out, seen = [], set()

    def add(label, vals):
        keep = []
        for v in vals:
            v = (v or "").strip(" .,;:’'\"")
            k = (label + "|" + v).lower()
            if v and len(v) <= 80 and k not in seen:
                seen.add(k); keep.append(v)
        if keep:
            out.append(f"{label}: " + ", ".join(keep[:6]))

    if url:
        add("URL", [url])
    add("Account/email", _EMAIL_RE.findall(raw))
    roles = [m.group(1) for m in _ROLE_RE.finditer(raw)] + [m.group(1) for m in _ROLEWORD_RE.finditer(raw)]
    add("Role/user", _dedupe_roles(roles))
    add("Files", _FILE_RE.findall(raw))
    add("Dates", _DATE_RE.findall(raw))
    add("Volumes", [f"{m.group(1)} {m.group(2)}" for m in _VOL_RE.finditer(raw)])
    add("Values", [f"{m.group(1).strip()} = {m.group(2)}" for m in _SETVAL_RE.finditer(raw)])
    if "password ***" in raw:
        out.append("Password: (used during repro — not captured)")
    return "\n".join(out)


@app.get("/jam")
def jam(link: str, note: str = ""):
    """Pull a Jam recording's data with the tester's PAT: transcript (spoken explanation),
    user events (steps), and details (browser/OS/url/env). Returns fields to auto-fill +
    a context note for the AI. The PAT stays on this machine."""
    cfg = load_config()
    pat = cfg.get("jam_pat", "")
    if not pat:
        raise HTTPException(status_code=400, detail="No Jam token set. Open Settings and paste your Jam PAT (jam.dev → Settings → Integrations → AI Agents).")
    jid = _jam_id_from_link(link)
    if not jid:
        raise HTTPException(status_code=400, detail="Couldn't find a Jam id in that link. Paste the full Jam share URL.")
    try:
        data = _jam_mcp(pat, [
            ("getDetails", {"jamId": jid}),
            ("getVideoTranscript", {"jamId": jid}),
            ("getUserEvents", {"jamId": jid}),
            ("getConsoleLogs", {"jamId": jid, "logLevel": "error", "limit": 20}),
        ])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach Jam: {e}")

    details = data.get("getDetails") or {}
    sysinfo = details.get("systemInfo") or {}
    events = data.get("getUserEvents")
    # While Jam is still processing a fresh recording (or processing failed), getUserEvents comes back
    # as an error string ("FAILED: ... not retrievable until the upstream consumer recovers"). Treat
    # that as "no events" rather than feeding the error text into the step parser.
    events_pending = isinstance(events, str) and events.strip().upper().startswith("FAILED")
    if events_pending:
        events = None
    # URL: prefer getDetails, else the first navigation url in the events
    url = details.get("url") or (sysinfo.get("url") if isinstance(sysinfo, dict) else "") or ""
    if not url and isinstance(events, list):
        for e in events:
            if isinstance(e, dict):
                u = (e.get("tabInfo") or {}).get("url") or ((e.get("data") or {}).get("payload") or {}).get("url")
                if u:
                    url = u
                    break
    _raw_tr = (data.get("getVideoTranscript") or {}).get("transcript") if isinstance(data.get("getVideoTranscript"), dict) else data.get("getVideoTranscript")
    transcript = _vtt_to_text(_raw_tr)
    # Jam returns a placeholder when narration captions aren't ready/available — don't treat it as the bug text.
    captions_pending = "captions are not available" in (str(_raw_tr or "").lower())
    if transcript and "captions are not available" in transcript.lower():
        transcript = ""
    steps = _summarize_events(events)
    # console errors
    cl = data.get("getConsoleLogs")
    errs = []
    cl_items = cl if isinstance(cl, list) else (cl.get("logs") if isinstance(cl, dict) else None)
    for c in (cl_items or [])[:10]:
        if isinstance(c, dict):
            msg = c.get("message") or c.get("text") or ""
            if msg:
                errs.append(str(msg)[:200])

    # Ticket id: from the narration, the tester's typed note, or the page URL (not just the
    # transcript, which is often empty when captions aren't ready).
    tid = None
    _tkt = re.compile(r"(?i)ticket\s*(?:id|number|no\.?)?\s*#?\s*(\d{3,6})")
    for _hay in (transcript or "", note or ""):
        m = _tkt.search(_hay)
        if m:
            tid = int(m.group(1)); break
    if not tid and url:                                   # ...tickets/20861 or ?ticket_id=20861
        m = re.search(r"(?i)(?:tickets?/|ticket_id=|[?&]id=)(\d{3,6})", url)
        if m:
            tid = int(m.group(1))
    if not tid and note:                                  # tester just typed the ticket # in Notes
        m = re.search(r"^\s*#?(\d{3,6})\b", note.strip())
        if m:
            tid = int(m.group(1))

    # Optional parent task only if the tester explicitly wrote one ("parent 11262" / "parent task #11262").
    pid = None
    m = re.search(r"(?i)parent\s*(?:task\s*)?#?\s*(\d{3,6})", note or "")
    if m and int(m.group(1)) != (tid or 0):
        pid = int(m.group(1))

    # Parse the narration + the tester's typed note into fields (rule-based, NO AI).
    mods = sevs = types = []
    try:
        m = meta()
        f = m.get("fields", {})
        mods = (f.get("module") or {}).get("values") or []
        sevs = (f.get("severity") or {}).get("values") or []
        types = (f.get("type") or {}).get("values") or []
    except Exception:
        pass
    parsed = _parse_bug_from_text(transcript, note, mods, sevs, types)
    subject = parsed["subject"]

    browser = ((sysinfo.get("browser") or {}).get("name")) if isinstance(sysinfo, dict) else ""
    osname = ((sysinfo.get("os") or {}).get("name")) if isinstance(sysinfo, dict) else ""
    if osname:
        osname = osname.split(" ")[0]   # 'Windows (x86)' -> 'Windows'

    # Concrete reproducible values mentioned in the recording (account, files, dates, volumes…),
    # with any password/secret masked out.
    test_data = _extract_test_data(transcript, steps, note, url)

    # combined note for the AI to write the bug from
    note_parts = []
    if transcript:
        note_parts.append("Tester narration (from the Jam recording):\n" + transcript)
    if steps:
        note_parts.append("Observed actions in the recording:\n" + steps)
    if test_data:
        note_parts.append("Concrete test data observed (password masked):\n" + test_data)
    if errs:
        note_parts.append("Console errors:\n" + "\n".join(errs))

    # Nothing usable AND Jam says it's still processing → tell the caller it isn't ready yet.
    not_ready = (not transcript) and (not steps) and (events_pending or captions_pending)

    return {
        "jam_id": jid,
        "url": url,
        "ready": (not not_ready),
        "notice": ("Jam is still processing this recording (its captions and step events aren't ready yet, "
                   "or processing failed). Wait a minute and try again, or narrate the bug / type a note.")
                  if not_ready else None,
        "ticket_id": tid,
        "parent_task_id": pid,
        "subject": subject,
        "actual": parsed["actual"],
        "expected": parsed["expected"],
        "severity": parsed["severity"],
        "type": parsed["type"],
        "module": parsed["module"],
        "environment": _env_from_url(url),
        "platform": "Web",
        "browser": browser or "",
        "os": osname or "",
        "test_data": test_data,
        "transcript": transcript,
        "steps": steps,
        "errors": errs,
        "note": "\n\n".join(note_parts),
        "author": (details.get("author") or {}).get("name"),
    }


class FormatBody(BaseModel):
    subject: str = ""
    steps: str = ""
    expected: str = ""
    actual: str = ""


@app.post("/format")
def fmt(body: FormatBody):
    """Minimal AI formatting pass (numbers steps, tidies subject) over rule-extracted fields."""
    cfg = load_config()
    dash = cfg.get("dashboard_url", DEFAULT_DASHBOARD_URL)
    try:
        r = requests.post(f"{dash}/bug-format", json=body.dict(), timeout=100)
        if r.status_code == 200:
            return r.json()
        raise HTTPException(status_code=r.status_code, detail=r.text[:200])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"format unavailable: {e}")


class BatchBody(BaseModel):
    message: str
    ticket_id: int | None = None
    use_ai: bool = True
    max_bugs: int | None = None


@app.post("/batch")
def batch(body: BatchBody):
    """Proxy one free-text message to the dashboard's multi-bug parser."""
    cfg = load_config()
    dash = cfg.get("dashboard_url", DEFAULT_DASHBOARD_URL)
    payload = body.dict()
    payload["reporter"] = cfg.get("tester_name", "")
    try:
        r = requests.post(f"{dash}/bug-batch", json=payload, timeout=180)
        if r.status_code == 200:
            return r.json()
        raise HTTPException(status_code=r.status_code, detail=(r.json().get("detail") if r.headers.get("content-type","").startswith("application/json") else r.text[:300]))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach the server: {e}")


class CreateBody(BaseModel):
    subject: str
    ticket_id: int
    severity: str
    environment: str
    type: str = ""
    module: str = ""
    platform: str = ""
    os: str = ""
    browser: str = ""
    devices: str = ""
    build_version: str = ""
    fix_version_mobile: str = ""
    jam_link: str = ""               # -> Proof of Bug (links)
    steps: str = ""
    test_data: str = ""
    expected: str = ""
    actual: str = ""
    assigned_to_id: int | None = None   # developer to assign the bug to
    parent_task_id: int | None = None   # Redmine parent issue -> the bug nests under that task
    case_id: int | None = None          # TestRail case this bug came from (optional)
    fail_testrail: bool = False         # also mark that case Failed in the env's run
    testrail_run_ref: str = ""          # optional explicit run id / link (else resolved by env)
    create_testcase: bool = False       # NO case yet -> create one from this bug & add to the plan
    preconds: str = ""                  # optional preconditions for the created case
    source: str = ""                    # jam | case | notes | combo | bulk | manual (for usage stats)
    tool_seconds: float | None = None   # measured fill->create time (for time-saved stats)


def _compose_description(b: CreateBody, struct_fields=None):
    """Steps / Test Data / Expected / Actual / Proof each have their OWN Redmine custom field, so when
    those exist the Description is left blank — otherwise the bug shows everything twice (and the old
    'h3.' Textile rendered as literal text on this Redmine). Only when a structured field is missing do
    we fall back to plain-text (no 'h3.') for that part."""
    sf = struct_fields or {}
    have = lambda k: k in sf
    if all(have(k) for k in ("steps", "expected", "actual")):
        return ""  # all detail lives in the dedicated fields — no duplicate description
    parts = []
    if b.steps and not have("steps"):
        parts.append("Steps to Reproduce:\n" + b.steps)
    if b.test_data and not have("test_data"):
        parts.append("Test Data:\n" + b.test_data)
    if b.expected and not have("expected"):
        parts.append("Expected:\n" + b.expected)
    if b.actual and not have("actual"):
        parts.append("Actual:\n" + b.actual)
    if b.jam_link and not have("proof_links"):
        parts.append("Proof of testing: " + b.jam_link)
    return "\n\n".join(parts) if parts else (b.actual or b.subject)


@app.post("/create")
def create(b: CreateBody):
    cfg = load_config()
    key = cfg.get("redmine_api_key", "")
    if not key:
        raise HTTPException(status_code=400, detail="No Redmine API key set. Open Settings and paste your key (Redmine → My account → API access key).")
    url = cfg.get("redmine_url", DEFAULT_REDMINE_URL)

    # need the field-id map
    try:
        m = meta()
    except HTTPException:
        raise
    fields = m.get("fields", {})

    def cf(skey, value):
        info = fields.get(skey)
        if info and value not in (None, ""):
            # multi-value list fields (Platform/OS/Devices) must be sent as arrays
            v = [value] if info.get("multiple") else value
            return {"id": info["id"], "value": v}
        return None

    custom = []
    for skey, value in [
        ("severity", b.severity),
        ("environment", b.environment),
        ("type", b.type),
        ("module", b.module),
        ("platform", b.platform),
        ("os", b.os),
        ("browser", b.browser),
        ("devices", b.devices),
        ("build_version", b.build_version),
        ("fix_version_mobile", b.fix_version_mobile),
        ("ticket_id", str(b.ticket_id)),
        ("proof_links", b.jam_link),
        ("steps", b.steps),
        ("test_data", b.test_data),
        ("expected", b.expected),
        ("actual", b.actual),
    ]:
        entry = cf(skey, value)
        if entry:
            custom.append(entry)

    payload = {
        "issue": {
            "project_id": m.get("project", {}).get("id") or m.get("project", {}).get("identifier") or "bis-web",
            "tracker_id": m.get("tracker_bug_id", 1),
            "status_id": m.get("status_new_id", 1),
            "subject": b.subject.strip(),
            "description": _compose_description(b, fields),
            "custom_fields": custom,
        }
    }
    if b.assigned_to_id:
        payload["issue"]["assigned_to_id"] = b.assigned_to_id
    if b.parent_task_id:
        payload["issue"]["parent_issue_id"] = b.parent_task_id

    try:
        r = requests.post(f"{url}/issues.json", headers={"X-Redmine-API-Key": key, "Content-Type": "application/json"},
                          data=json.dumps(payload), timeout=30)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach Redmine: {e}")

    if r.status_code in (200, 201):
        issue = r.json().get("issue", {})
        iid = issue.get("id")
        out = {"ok": True, "id": iid, "url": f"{url}/issues/{iid}"}
        # Optionally fail the source TestRail case in the run matching this bug's environment.
        if b.fail_testrail and b.case_id:
            try:
                dash = cfg.get("dashboard_url", DEFAULT_DASHBOARD_URL)
                fr = requests.post(f"{dash}/testrail/fail-case", timeout=60, json={
                    "case_id": b.case_id, "ticket_id": b.ticket_id, "environment": b.environment,
                    "run_ref": b.testrail_run_ref or None,
                    "actual": b.actual, "expected": b.expected,
                    "testrail_email": cfg.get("testrail_email") or None,
                    "testrail_api_key": cfg.get("testrail_api_key") or None,
                })
                if fr.status_code == 200:
                    out["testrail"] = {"ok": True, **fr.json()}
                else:
                    d = fr.json().get("detail") if fr.headers.get("content-type", "").startswith("application/json") else fr.text[:200]
                    out["testrail"] = {"ok": False, "error": d}
            except Exception as e:
                out["testrail"] = {"ok": False, "error": f"Could not reach the server: {e}"}
        # No matching case -> optionally create one from this bug and add it to the ticket's plan.
        elif b.create_testcase and not b.case_id and b.ticket_id:
            try:
                dash = cfg.get("dashboard_url", DEFAULT_DASHBOARD_URL)
                cr = requests.post(f"{dash}/testrail/create-case", timeout=90, json={
                    "ticket_id": b.ticket_id, "title": b.subject, "steps": b.steps,
                    "expected": b.expected, "test_data": b.test_data, "preconds": b.preconds,
                    "environment": b.environment, "mark_failed": True,
                    "bug_id": iid, "bug_url": out["url"],
                    "testrail_email": cfg.get("testrail_email") or None,
                    "testrail_api_key": cfg.get("testrail_api_key") or None,
                })
                if cr.status_code == 200:
                    out["testcase"] = {"ok": True, **cr.json()}
                else:
                    d = cr.json().get("detail") if cr.headers.get("content-type", "").startswith("application/json") else cr.text[:200]
                    out["testcase"] = {"ok": False, "error": d}
            except Exception as e:
                out["testcase"] = {"ok": False, "error": f"Could not reach the server: {e}"}
        # Usage + time-saved tracking (fire-and-forget; never blocks bug creation).
        try:
            dash = cfg.get("dashboard_url", DEFAULT_DASHBOARD_URL)
            requests.post(f"{dash}/bug-reporter/event", timeout=8, json={
                "reporter": cfg.get("tester_name", ""), "ticket_id": b.ticket_id, "bug_id": iid,
                "source": b.source or "manual", "tracker": "redmine", "tool_seconds": b.tool_seconds,
                "testrail_failed": bool((out.get("testrail") or {}).get("ok")),
                "testcase_created": bool((out.get("testcase") or {}).get("ok")),
            })
        except Exception:
            pass
        return out
    # surface Redmine validation errors (e.g. missing required field)
    detail = r.text
    try:
        j = r.json()
        if isinstance(j, dict) and j.get("errors"):
            detail = "; ".join(j["errors"])
    except Exception:
        pass
    raise HTTPException(status_code=r.status_code, detail=f"Redmine rejected the bug: {detail[:400]}")


@app.get("/my-retests")
def my_retests(ticket_id: int | None = None):
    """The tester's OWN bugs that dev has released back for retesting
    (status 'Released to QA' / 'Reopened'), using their Redmine key. Optional
    ticket_id filters by the PM 'Ticket ID' custom field."""
    cfg = load_config()
    key = cfg.get("redmine_api_key", "")
    if not key:
        raise HTTPException(status_code=400, detail="No Redmine API key set. Open Settings and paste your key.")
    url = cfg.get("redmine_url", DEFAULT_REDMINE_URL)
    try:
        m = meta()
    except HTTPException:
        m = {}
    retest_ids = m.get("retest_status_ids") or []
    ticket_cf_id = (m.get("fields", {}).get("ticket_id") or {}).get("id", 14)

    status_param = "|".join(str(s) for s in retest_ids) if retest_ids else "open"
    params = {
        "author_id": "me",                  # bugs THIS tester reported (not just assigned to them)
        "tracker_id": m.get("tracker_bug_id", 1),
        "status_id": status_param,
        "sort": "updated_on:desc",
        "limit": 100,
    }
    if ticket_id:
        params[f"cf_{ticket_cf_id}"] = ticket_id

    try:
        r = requests.get(f"{url}/issues.json", headers={"X-Redmine-API-Key": key}, params=params, timeout=25)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach Redmine: {e}")
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=f"Redmine error: {r.text[:300]}")

    out = []
    for i in r.json().get("issues", []):
        cfs = {c.get("name"): c.get("value") for c in i.get("custom_fields", [])}
        out.append({
            "id": i.get("id"),
            "subject": i.get("subject"),
            "status": (i.get("status") or {}).get("name"),
            "severity": cfs.get("Severity"),
            "environment": cfs.get("Environment"),
            "ticket_id": cfs.get("Ticket ID"),
            "module": cfs.get("Module"),
            "updated_on": i.get("updated_on"),
            "url": f"{url}/issues/{i.get('id')}",
        })
    # Safety: keep only true retest-pending statuses (in case the status filter fell back to 'open').
    RETEST_NAMES = {"released to qa", "reopened"}
    out = [o for o in out if (o.get("status") or "").strip().lower() in RETEST_NAMES]
    # Group by PM Ticket ID so each ticket shows its own released-to-QA bug list.
    groups = {}
    for o in out:
        tid = str(o.get("ticket_id") or "").strip() or "No ticket"
        groups.setdefault(tid, []).append(o)
    def _sortkey(k):
        return (0, int(k)) if k.isdigit() else (1, k)
    grouped = [{"ticket_id": k, "bugs": v} for k, v in sorted(groups.items(), key=lambda kv: _sortkey(kv[0]), reverse=True)]
    return {"count": len(out), "issues": out, "groups": grouped}


@app.get("/my-created")
def my_created(ticket_id: int | None = None):
    """Bugs THIS tester created via the app (tracked on the dashboard), enriched with their current
    Redmine status and grouped by PM Ticket ID. Flags the ones now pending a retest."""
    cfg = load_config()
    rep = cfg.get("tester_name", "")
    dash = cfg.get("dashboard_url", DEFAULT_DASHBOARD_URL)
    url = cfg.get("redmine_url", DEFAULT_REDMINE_URL)
    key = cfg.get("redmine_api_key", "")

    # 1) app-created bug ids for this tester (from the dashboard usage log)
    events = []
    try:
        r = requests.get(f"{dash}/bug-reporter/my-bugs", params=({"reporter": rep} if rep else {}), timeout=20)
        if r.status_code == 200:
            events = r.json().get("bugs") or []
    except Exception:
        events = []
    ev_ticket = {}
    for e in events:
        if e.get("bug_id"):
            ev_ticket[int(e["bug_id"])] = e.get("ticket_id")
    bug_ids = list(ev_ticket.keys())
    if ticket_id:
        bug_ids = [b for b in bug_ids if str(ev_ticket.get(b) or "") == str(ticket_id)]
    if not bug_ids:
        return {"count": 0, "groups": []}

    # 2) current state from Redmine, batched by issue_id
    issues = {}
    if key:
        for s in range(0, len(bug_ids), 100):
            ids = bug_ids[s:s + 100]
            try:
                rr = requests.get(f"{url}/issues.json", headers={"X-Redmine-API-Key": key},
                                  params={"issue_id": ",".join(map(str, ids)), "status_id": "*", "limit": 100}, timeout=25)
                if rr.status_code == 200:
                    for i in rr.json().get("issues", []):
                        cfs = {c.get("name"): c.get("value") for c in i.get("custom_fields", [])}
                        issues[i.get("id")] = {
                            "id": i.get("id"), "subject": i.get("subject"),
                            "status": (i.get("status") or {}).get("name"),
                            "severity": cfs.get("Severity"), "environment": cfs.get("Environment"),
                            "ticket_id": cfs.get("Ticket ID") or ev_ticket.get(i.get("id")),
                            "updated_on": i.get("updated_on"), "url": f"{url}/issues/{i.get('id')}",
                        }
            except Exception:
                pass

    RETEST_NAMES = {"released to qa", "reopened"}
    rows = []
    for bid in bug_ids:
        it = issues.get(bid) or {"id": bid, "subject": "(could not load from Redmine)", "status": None,
                                 "severity": None, "environment": None, "ticket_id": ev_ticket.get(bid),
                                 "url": f"{url}/issues/{bid}"}
        it["needs_retest"] = (it.get("status") or "").strip().lower() in RETEST_NAMES
        rows.append(it)

    groups = {}
    for o in rows:
        tid = str(o.get("ticket_id") or "").strip() or "No ticket"
        groups.setdefault(tid, []).append(o)

    def _sk(k):
        return (0, int(k)) if k.isdigit() else (1, k)
    grouped = [{"ticket_id": k, "bugs": v} for k, v in sorted(groups.items(), key=lambda kv: _sk(kv[0]), reverse=True)]
    return {"count": len(rows), "groups": grouped}


@app.get("/impact-stats")
def impact_stats():
    """Proxy the dashboard's usage/time-saved stats for the in-tool Impact tab (adds the tester's
    name from local config so 'You' totals work)."""
    cfg = load_config()
    dash = cfg.get("dashboard_url", DEFAULT_DASHBOARD_URL)
    rep = cfg.get("tester_name", "")
    try:
        r = requests.get(f"{dash}/bug-reporter/stats", params=({"reporter": rep} if rep else {}), timeout=20)
        if r.status_code == 200:
            return r.json()
        raise HTTPException(status_code=r.status_code, detail="stats unavailable")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach the server: {e}")


# --------------------------------------------------------------------------- launch
_browser_port = PORT


def _port_in_use(p):
    """True if something is already LISTENING on 127.0.0.1:p. Uses connect (not bind) — on Windows a
    bind-test can wrongly pass for a port another server already holds (SO_REUSEADDR), which then made
    uvicorn fail with WinError 10048. A successful connect means an instance is already there."""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.35)
    try:
        s.connect(("127.0.0.1", p))
        return True
    except OSError:
        return False
    finally:
        try:
            s.close()
        except Exception:
            pass


def _takeover(port):
    """If a PREVIOUS BIS Bug Reporter holds this port, ask it to quit so this (newer) build can take
    over the same port — so updating is just 'run the new exe', no manual End Task, no stale instance.
    Returns True if the port is now free for us. Leaves a non-BIS app alone."""
    import time
    try:
        r = requests.get(f"http://127.0.0.1:{port}/ping", timeout=0.7)
        if r.status_code == 200 and (r.json() or {}).get("app") == APP_NAME:
            try:
                requests.post(f"http://127.0.0.1:{port}/shutdown", timeout=0.7)
            except Exception:
                pass
            for _ in range(25):                 # wait up to ~5s for it to release the port
                if not _port_in_use(port):
                    return True
                time.sleep(0.2)
    except Exception:
        pass
    return not _port_in_use(port)


def _bind_port(preferred):
    """Return a (bound_socket, port) we actually BOUND, and hand it to uvicorn so it serves on this
    exact socket — no re-bind, no WinError 10048. A port left stuck in TIME_WAIT by an earlier crash
    simply fails to bind and we move to the next one (this is what was crashing on 8765). A LIVE old
    instance on the preferred port is asked to quit first so we can reuse the standard port."""
    import socket
    if _port_in_use(preferred):
        _takeover(preferred)
    for p in [preferred, 8766, 8767, 8770, 8780, 8899, 0]:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind(("127.0.0.1", p))      # no SO_REUSEADDR: a TIME_WAIT/in-use port fails -> next port
            return s, s.getsockname()[1]
        except OSError:
            try:
                s.close()
            except Exception:
                pass
    return None, None


def _open_browser():
    import time
    time.sleep(1.2)
    try:
        webbrowser.open(f"http://127.0.0.1:{_browser_port}/")
    except Exception:
        pass


HTML_PAGE = ""  # populated below from page.py


def main():
    global HTML_PAGE, _browser_port
    log_path = os.path.join(_config_dir(), "startup.log")
    try:
        from page import HTML_PAGE as _PAGE
        HTML_PAGE = _PAGE
        sock, port = _bind_port(PORT)
        _browser_port = port or PORT
        msg = f"BIS Bug Reporter running at http://127.0.0.1:{_browser_port}/  (config: {CONFIG_PATH})"
        print(msg)
        try:
            with open(log_path, "w", encoding="utf-8") as f:
                f.write(msg + "\n")
        except Exception:
            pass
        threading.Thread(target=_open_browser, daemon=True).start()
        config = uvicorn.Config(app, host="127.0.0.1", port=_browser_port, log_level="warning")
        server = uvicorn.Server(config)
        if sock is not None:
            server.run(sockets=[sock])      # serve on the socket we already bound (no rebind/10048)
        else:
            uvicorn.run(app, host="127.0.0.1", port=_browser_port, log_level="warning")
    except Exception:
        import traceback
        tb = traceback.format_exc()
        try:
            with open(log_path, "a", encoding="utf-8") as f:
                f.write("\nSTARTUP ERROR:\n" + tb)
        except Exception:
            pass
        print("\n*** BIS Bug Reporter failed to start ***\n")
        print(tb)
        print(f"\n(Details also written to: {log_path})")
        try:
            input("\nPress Enter to close...")
        except Exception:
            pass


if __name__ == "__main__":
    main()
