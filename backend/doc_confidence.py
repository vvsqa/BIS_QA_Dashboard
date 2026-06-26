"""Documentation Confidence — reconcile a PM ticket's Scope ⇄ Release Note ⇄ PR.

Cheap, fleet-wide classifier behind the QA dashboard's "weak documentation" triage and the
test-plan skill's Phase 1c. It answers two questions per ticket:

  1. Which of the three sources exist?   (PR link, Release Note comment)
  2. Does the Release Note actually describe what the PR built, or did extra/undocumented work
     ship in the PR?  (the 20158 → 20742 class of escape)

Flags (precedence high→low):
  NO_PR_NO_RN  no PR link AND no Release Note            -> nothing to verify the build against
  PR_NO_RN     PR exists, no Release Note
  RN_NO_PR     Release Note exists, no extractable PR link
  THIN_RN      RN under-documents the PR (>30% of functional PR files unexplained)   [hard]
  RN_REVIEW    RN omits ≥1 functional PR file (≤30%)                                 [soft]
  ALIGNED      RN covers every functional PR file
  UNKNOWN      could not fetch / no creds

Structural detection (PR present, RN present) is always available from one PM fetch. The tiered
THIN_RN / RN_REVIEW split needs the PR's changed files and runs only when deep=True (uses `gh`).
Results are cached to data/doc_confidence.json with a TTL so the queue can read them for free.
"""
import os
import re
import json
import time
import html
import subprocess
import urllib.request

_HERE = os.path.dirname(__file__)
_CACHE_FILE = os.path.join(_HERE, "data", "doc_confidence.json")
_TTL_SECONDS = int(os.environ.get("DOC_CONFIDENCE_TTL", str(3 * 24 * 3600)))  # deep flags persist ~3 days
_THIN_RATIO = float(os.environ.get("DOC_CONFIDENCE_THIN_RATIO", "0.30"))

_PR_RE = re.compile(r"https?://[^\s\"'<>]+/(?:pull|merge_requests)/\d+", re.I)
_PR_REPO_RE = re.compile(r"github\.com/([^/]+)/([^/]+)/pull/(\d+)", re.I)
# Path tokens too generic to count as a "behavior" mention in the release note.
_STOP_TOKENS = {
    "src", "views", "view", "js", "ts", "jsx", "tsx", "components", "component", "public",
    "learner", "cv", "model", "models", "services", "service", "controllers", "controller",
    "actions", "action", "dist", "build", "assets", "common", "shared", "utils", "util",
    "index", "main", "app", "core", "lib", "api", "html", "cfm", "cfc", "css", "less",
}
_CREDS = None


# --------------------------------------------------------------------------- PM access
def _pm_creds():
    """PM_API_URL + PM_BEARER_TOKEN from the runner's .env.vvsstaging (only working token on this box)."""
    global _CREDS
    if _CREDS is not None:
        return _CREDS
    url = tok = None
    for envf in (r"C:\Apps\bis-automation\e2e_tests\helper\env\.env.vvsstaging",
                 os.path.join(_HERE, "..", "..", "bis-automation",
                              "e2e_tests", "helper", "env", ".env.vvsstaging")):
        try:
            for line in open(envf, encoding="utf-8"):
                line = line.strip()
                if line.startswith("PM_API_URL="):
                    url = line.split("=", 1)[1].strip()
                elif line.startswith("PM_BEARER_TOKEN="):
                    tok = line.split("=", 1)[1].strip()
            if url and tok:
                break
        except Exception:
            continue
    _CREDS = (url, tok)
    return _CREDS


def _fetch_ticket(ticket_id):
    url, tok = _pm_creds()
    if not url or not tok:
        return None
    try:
        req = urllib.request.Request(f"{url}/ticket/{ticket_id}",
                                     headers={"Authorization": "Bearer " + tok})
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read().decode("utf-8", "replace"))
        return data if isinstance(data, dict) else (data[0] if isinstance(data, list) and data else None)
    except Exception:
        return None


# --------------------------------------------------------------------------- detection
def _strip_html(s):
    return html.unescape(re.sub(r"<[^>]+>", " ", s or "")).lower()


def detect_pr(ticket):
    """Return the first PR/MR URL found in the description or any comment, else None."""
    if not ticket:
        return None
    blobs = [ticket.get("description") or ""]
    blobs += [(c.get("comment") or "") for c in (ticket.get("comments") or [])]
    for b in blobs:
        m = _PR_RE.search(b or "")
        if m:
            return m.group(0)
    return None


def detect_release_note(ticket):
    """Return the Release Note comment HTML (heuristic: contains 'release note' + 'pr link'), else None."""
    if not ticket:
        return None
    for c in (ticket.get("comments") or []):
        body = c.get("comment") or ""
        low = _strip_html(body)
        if "release note" in low and "pr link" in low:
            return body
    # Some templates put the release note in the description.
    desc = ticket.get("description") or ""
    if "release note" in _strip_html(desc) and "pr link" in _strip_html(desc):
        return desc
    return None


# --------------------------------------------------------------------------- PR files (deep)
def _gh_bin():
    for cand in (os.environ.get("GH_BIN"), r"C:\Apps\gh\bin\gh.exe", "gh"):
        if not cand:
            continue
        if cand == "gh" or os.path.exists(cand):
            return cand
    return "gh"


def _pr_files(pr_url):
    """List the PR's changed source-file paths via gh (excludes build artifacts). [] on any failure."""
    m = _PR_REPO_RE.search(pr_url or "")
    if not m:
        return []
    owner, repo, num = m.group(1), m.group(2), m.group(3)
    try:
        out = subprocess.run(
            [_gh_bin(), "pr", "view", num, "--repo", f"{owner}/{repo}", "--json", "files"],
            capture_output=True, text=True, timeout=60)
        if out.returncode != 0:
            return []
        files = (json.loads(out.stdout) or {}).get("files", [])
        return [f.get("path", "") for f in files if f.get("path")]
    except Exception:
        return []


def _is_build_artifact(path):
    p = path.lower()
    return ("public/bundle" in p or p.endswith(".map")
            or (p.endswith((".less", ".css")) and "bundle" not in p))


def _is_functional(path):
    """HIGH/MEDIUM test-impact source file (mirror the skill's step-3 test-impact table)."""
    if _is_build_artifact(path):
        return False
    return path.lower().endswith((".js", ".jsx", ".ts", ".tsx", ".cfc", ".cfm", ".html", ".sql"))


def _path_tokens(path):
    base = re.split(r"[\\/]", path)
    toks = set()
    for seg in base:
        seg = re.sub(r"\.[a-z0-9]+$", "", seg, flags=re.I)              # drop extension
        for piece in re.split(r"[^A-Za-z0-9]+", seg):                  # split kebab/snake
            for w in re.findall(r"[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])", piece):  # split camelCase
                w = w.lower()
                if len(w) >= 4 and w not in _STOP_TOKENS:
                    toks.add(w)
    return toks


def _unexplained_functional(pr_files, rn_html):
    """Functional PR files whose path tokens are NOT mentioned in the release note text."""
    rn = _strip_html(rn_html)
    func = [p for p in pr_files if _is_functional(p)]
    unexplained = []
    for p in func:
        toks = _path_tokens(p)
        if toks and not any(t in rn for t in toks):
            unexplained.append(p)
    return func, unexplained


# --------------------------------------------------------------------------- cache
def _load_cache():
    try:
        with open(_CACHE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_cache(cache):
    try:
        os.makedirs(os.path.dirname(_CACHE_FILE), exist_ok=True)
        with open(_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f)
    except Exception:
        pass


def _put_cache_entry(key, entry):
    """Concurrency-tolerant single-key write: RELOAD the latest cache and merge just this key, so a
    write doesn't blow away entries another writer (backend warm / runner / lookup) added meanwhile.
    The whole-file read-modify-write otherwise loses entries when several writers overlap."""
    cache = _load_cache()
    cache[key] = entry
    _save_cache(cache)
    return entry


def get_cached(ticket_id):
    """Return a cached entry (any age) without any network call — for the queue hot path. None if absent."""
    return _load_cache().get(str(ticket_id))


# --------------------------------------------------------------------------- classify
def _classify(pr_url, rn_html, pr_files, deep):
    pr_present = bool(pr_url)
    rn_present = bool(rn_html)
    out = {"pr_present": pr_present, "rn_present": rn_present, "pr_url": pr_url,
           "rn_thin_tier": None, "functional_total": None, "unexplained": [], "deep": bool(deep)}
    if not pr_present and not rn_present:
        out["flag"] = "NO_PR_NO_RN"
        return out
    if pr_present and not rn_present:
        out["flag"] = "PR_NO_RN"
        return out
    if rn_present and not pr_present:
        out["flag"] = "RN_NO_PR"
        return out
    # Both present. A shallow pass CANNOT judge completeness, so it must NOT claim ALIGNED — that would
    # mask a real THIN_RN. Mark it pending; a deep pass assigns the real flag.
    if not deep or not pr_files:
        out["flag"] = "UNKNOWN"
        out["rn_thin_tier"] = "pending"
        return out
    func, unexplained = _unexplained_functional(pr_files, rn_html)
    out["functional_total"] = len(func)
    out["unexplained"] = unexplained
    ratio = (len(unexplained) / len(func)) if func else 0.0
    if unexplained and ratio > _THIN_RATIO:
        out["flag"], out["rn_thin_tier"] = "THIN_RN", "hard"
    elif unexplained:
        out["flag"], out["rn_thin_tier"] = "RN_REVIEW", "soft"
    else:
        out["flag"], out["rn_thin_tier"] = "ALIGNED", "none"
    return out


def compute(ticket_id, deep=False, force=False):
    """Classify one ticket. Cached (TTL); a deep result is preferred over a cached shallow one.
    deep=True fetches PR files via gh to split THIN_RN vs RN_REVIEW (single-ticket / runner use)."""
    key = str(ticket_id)
    cache = _load_cache()
    hit = cache.get(key)
    if hit and not force:
        fresh = (time.time() - hit.get("computed_on", 0)) < _TTL_SECONDS
        if fresh and (hit.get("deep") or not deep):
            return hit
        # A shallow pass must NEVER overwrite an existing DEEP result with a worse provisional flag.
        # Keep the deep flag (and refresh its timestamp so it stays the answer). Only an explicit
        # deep pass (or force) is allowed to recompute a deep entry.
        if not deep and hit.get("deep"):
            hit["computed_on"] = time.time()
            return _put_cache_entry(key, hit)
    ticket = _fetch_ticket(ticket_id)
    if ticket is None:
        return hit or {"flag": "UNKNOWN", "pr_present": None, "rn_present": None,
                       "rn_thin_tier": None, "functional_total": None, "unexplained": [], "deep": False}
    pr_url = detect_pr(ticket)
    rn_html = detect_release_note(ticket)
    pr_files = _pr_files(pr_url) if (deep and pr_url) else []
    res = _classify(pr_url, rn_html, pr_files, deep)
    res["computed_on"] = time.time()
    res.pop("pr_url", None)  # don't persist the full URL in the cache payload (kept lean)
    return _put_cache_entry(key, res)
