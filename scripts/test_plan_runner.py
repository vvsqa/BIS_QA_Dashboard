#!/usr/bin/env python3
r"""
Test-Plan Runner - STEP 2 of the QC planning automation.

Runs on the machine that has the `/create-test-plan` Claude command set up (the bis-automation
repo clone, Claude Code CLI, gh auth, .env.vvsstaging). It polls the QA dashboard's test-plan
queue, and for each pending ticket invokes the headless generator:

    claude -p "create test plan for <ticketId>"      (cwd = the bis-automation repo)

The generator fetches the PM ticket + PR, creates the TestRail cases/plan (named
"#<ticketId> — <Module>: ... ") and the review Excel. The runner reports status back to the
dashboard; the dashboard's "Test Plan ✓" column flips automatically once the plan exists in
TestRail (it detects project-18 plans named with the ticket id).

Stdlib only (urllib + subprocess) so it runs anywhere Python 3.8+ is installed.

USAGE
  set ANTHROPIC_API_KEY=sk-ant-...            (required for headless claude -p)
  set BIS_AUTOMATION_DIR=C:\path\to\bis-automation
  set DASHBOARD_BASE=http://10.1.0.20:8000    (the QA dashboard)
  python test_plan_runner.py                  (loop; Ctrl-C to stop)
  python test_plan_runner.py --once           (one cycle)
  python test_plan_runner.py --dry-run        (poll + show what it WOULD run; no claude call)

Run continuously via Windows Task Scheduler (every few minutes, --once) or leave the loop running.
"""
import argparse
import glob
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

DASHBOARD_BASE = os.environ.get("DASHBOARD_BASE", "http://10.1.0.20:8000").rstrip("/")
# Browser-reachable dashboard URL for links posted into PM comments (DASHBOARD_BASE may be 127.0.0.1).
PUBLIC_DASHBOARD_BASE = os.environ.get("PUBLIC_DASHBOARD_BASE", "http://10.1.0.20:8000").rstrip("/")
BIS_AUTOMATION_DIR = os.environ.get("BIS_AUTOMATION_DIR", "")
CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude")
# Flags so the headless run never blocks on a permission prompt (the generator drives gh/node/
# python via Bash). bypass = fully unattended; review/adjust to your trust level.
CLAUDE_EXTRA_ARGS = os.environ.get("CLAUDE_EXTRA_ARGS", "--dangerously-skip-permissions").split()
# Explicit priority tickets (comma-separated) — generated before assigned/everything else, in order.
PRIORITY_TICKETS = [int(x) for x in os.environ.get("TPR_PRIORITY_TICKETS", "").replace(" ", "").split(",") if x.strip().isdigit()]
POLL_SECONDS = int(os.environ.get("TPR_POLL_SECONDS", "60"))
MAX_PER_CYCLE = int(os.environ.get("TPR_MAX_PER_CYCLE", "2"))
PER_TICKET_TIMEOUT = int(os.environ.get("TPR_TIMEOUT_SECONDS", "1800"))  # 30 min/ticket


def _claude_cmd(prompt):
    """Build the claude command. On Windows a .cmd/.bat (npm shim) can't be exec'd directly by
    subprocess with a list — route it through `cmd /c`."""
    base = [CLAUDE_BIN, "-p", prompt] + CLAUDE_EXTRA_ARGS
    if CLAUDE_BIN.lower().endswith((".cmd", ".bat")):
        return ["cmd", "/c"] + base
    return base


def _get(path):
    with urllib.request.urlopen(f"{DASHBOARD_BASE}{path}", timeout=30) as r:
        return json.loads(r.read().decode())


def _post(path, body=None):
    data = json.dumps(body).encode() if body is not None else b""
    req = urllib.request.Request(f"{DASHBOARD_BASE}{path}", data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def _report(ticket_id, status, error=None, plan_url=None):
    try:
        _post(f"/live/test-plan-queue/{ticket_id}/status",
              {"status": status, "error": error, "plan_url": plan_url})
    except Exception as e:
        print(f"  ! could not report {status} for {ticket_id}: {e}")


def _upload_excel(ticket_id):
    """Find the generated review Excel (ticket-analysis/<id>-*.xlsx) and upload its bytes so the
    dashboard's Test Plan cell can offer it for download."""
    pattern = os.path.join(BIS_AUTOMATION_DIR, "ticket-analysis", f"{ticket_id}*.xlsx")
    matches = sorted(glob.glob(pattern), key=os.path.getmtime, reverse=True)
    if not matches:
        return
    try:
        with open(matches[0], "rb") as f:
            blob = f.read()
        req = urllib.request.Request(f"{DASHBOARD_BASE}/live/test-plan-queue/{ticket_id}/excel",
                                     data=blob, method="POST",
                                     headers={"Content-Type": "application/octet-stream"})
        with urllib.request.urlopen(req, timeout=60) as r:
            r.read()
        print(f"    uploaded Excel: {os.path.basename(matches[0])}")
    except Exception as e:
        print(f"    ! Excel upload failed for {ticket_id}: {e}")


def _find_plan_url(ticket_id):
    """Best-effort: read scripts/output/<id>-results.json for the TestRail plan URL."""
    path = os.path.join(BIS_AUTOMATION_DIR, "scripts", "output", f"{ticket_id}-results.json")
    if not os.path.exists(path):
        cand = glob.glob(os.path.join(BIS_AUTOMATION_DIR, "scripts", "output", f"{ticket_id}*results*.json"))
        path = cand[0] if cand else None
    if not path or not os.path.exists(path):
        return None
    try:
        blob = json.load(open(path, encoding="utf-8"))
    except Exception:
        return None

    def walk(o):
        if isinstance(o, str) and "/plans/view/" in o:
            return o
        if isinstance(o, dict):
            for v in o.values():
                u = walk(v)
                if u:
                    return u
        if isinstance(o, list):
            for v in o:
                u = walk(v)
                if u:
                    return u
        return None
    return walk(blob)


def _already_has_plan(ticket_id):
    """Guard against duplicates: True if a TestRail plan already exists for this ticket.
    Authoritative LIVE check first (closes the cache-race that let refix/re-entry create a 2nd plan),
    then fall back to the cached test_cases count."""
    try:
        with urllib.request.urlopen(f"{DASHBOARD_BASE}/live/testrail-plan-exists?ticket_id={ticket_id}", timeout=30) as r:
            info = json.loads(r.read().decode())
        if info.get("exists") is True:
            return True
    except Exception:
        pass
    try:
        with urllib.request.urlopen(f"{DASHBOARD_BASE}/live/ticket-lookup?ticket_id={ticket_id}", timeout=20) as r:
            info = json.loads(r.read().decode())
        return (info.get("test_cases") or 0) > 0
    except Exception:
        return False  # if unsure, let the generator's own "never duplicate" hard-rule decide


# Mobile tickets' plans live in TestRail project 14 (SafeTapp), not the Web project 18. The generator,
# its MCP server and the TS client all read TESTRAIL_PROJECT_ID/TESTRAIL_SUITE_ID from the env, so we
# just set them per-ticket before launching `claude`. Web (anything else) keeps the 18/137 defaults.
MOBILE_PROJECT_ID = "14"
MOBILE_SUITE_ID = "118"


def _is_mobile_ticket(ticket_id):
    """True when the ticket's PM subdepartment is 'Mobile' (the routing signal for project 14)."""
    try:
        with urllib.request.urlopen(f"{DASHBOARD_BASE}/live/ticket-lookup?ticket_id={ticket_id}", timeout=20) as r:
            info = json.loads(r.read().decode())
        sd = (info.get("subdepartment") or info.get("module") or "").strip().lower()
        return sd == "mobile"
    except Exception:
        return False


def _ticket_env(ticket_id):
    """Subprocess env for the generator: project 14 / suite 118 for Mobile tickets, else inherit."""
    env = dict(os.environ)
    if _is_mobile_ticket(ticket_id):
        env["TESTRAIL_PROJECT_ID"] = MOBILE_PROJECT_ID
        env["TESTRAIL_SUITE_ID"] = MOBILE_SUITE_ID
        print(f"  [mobile] {ticket_id}: routing TestRail to project {MOBILE_PROJECT_ID} / suite {MOBILE_SUITE_ID} (SafeTapp)")
    return env


_PM_CREDS = None


def _pm_creds():
    """Read PM_API_URL + PM_BEARER_TOKEN from the repo's .env.vvsstaging (for the PR check)."""
    global _PM_CREDS
    if _PM_CREDS is not None:
        return _PM_CREDS
    url = tok = None
    envf = os.path.join(BIS_AUTOMATION_DIR, "e2e_tests", "helper", "env", ".env.vvsstaging")
    try:
        for line in open(envf, encoding="utf-8"):
            line = line.strip()
            if line.startswith("PM_API_URL="):
                url = line.split("=", 1)[1].strip()
            elif line.startswith("PM_BEARER_TOKEN="):
                tok = line.split("=", 1)[1].strip()
    except Exception:
        pass
    _PM_CREDS = (url, tok)
    return _PM_CREDS


def _has_pr(ticket_id):
    """True if the PM ticket has a PR / Release Note (the generator's context source). Skip-on-no-PR
    relies on this. On any error or missing creds, return True (don't wrongly hold the ticket)."""
    url, tok = _pm_creds()
    if not url or not tok:
        return True
    try:
        req = urllib.request.Request(f"{url}/ticket/{ticket_id}", headers={"Authorization": "Bearer " + tok})
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read().decode("utf-8", "replace")
        # A real PR/MR link, any repo/host: github.com/<org>/<repo>/pull/<n>, gitlab .../merge_requests/<n>,
        # or the legacy bistrainerdev form. The empty PR-Link template scaffold has no such URL, so this
        # won't false-positive on tickets that only have the (blank) Release Note section.
        return bool(re.search(r"/(?:pull|merge_requests)/\d+", body))
    except Exception as e:
        print(f"  ! PR check failed for {ticket_id}: {e} (proceeding)")
        return True


# ---- Test-plan link comment on the PM ticket -------------------------------------------------
TPC_FILE = os.path.join(BIS_AUTOMATION_DIR, "data", "test_plan_comments.json")
# Off by default until the PM comment POST body shape is confirmed; enable with TPR_COMMENT_PLAN=1.
TPC_ENABLED = os.environ.get("TPR_COMMENT_PLAN", "0") == "1"
TPC_MAX = int(os.environ.get("TPR_COMMENT_MAX", "15"))


def _load_commented():
    try:
        with open(TPC_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_commented(d):
    try:
        os.makedirs(os.path.dirname(TPC_FILE), exist_ok=True)
        with open(TPC_FILE, "w") as f:
            json.dump(d, f)
    except Exception as e:
        print(f"  ! could not save comment tracker: {e}")


def _ticket_has_plan_comment(ticket_id, plan_url):
    """True if the PM ticket already carries a 'Test Plan - <id>' comment (idempotency guard)."""
    url, tok = _pm_creds()
    if not url or not tok:
        return True  # can't verify -> don't post
    try:
        req = urllib.request.Request(f"{url}/ticket/{ticket_id}", headers={"Authorization": "Bearer " + tok})
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read().decode("utf-8", "replace"))
        obj = data if isinstance(data, dict) else (data[0] if isinstance(data, list) and data else {})
        marker = f"Test Plan - {ticket_id}"
        view = plan_url.split("/plans/view/")[-1] if "/plans/view/" in (plan_url or "") else None
        for c in obj.get("comments", []):
            body = c.get("comment") or ""
            if marker in body or (view and f"/plans/view/{view}" in body):
                return True
        return False
    except Exception as e:
        print(f"  ! comment check failed for {ticket_id}: {e}")
        return True  # err toward not double-posting


def _post_test_plan_comment(ticket_id, plan_url, label=None):
    """POST a visible PM comment with a hyperlink to the TestRail plan. `label` overrides the default
    'Test Plan - <id>' link text (e.g. 'Test Plan (Mobile) - <id>' when a ticket has separate plans)."""
    url, tok = _pm_creds()
    if not url or not tok:
        print(f"  ! no PM creds; cannot comment {ticket_id}")
        return False
    # PM rejects comments with internal/HTTP links (403), so the comment carries only the TestRail
    # plan link (the test plan itself, reviewable in TestRail; the Excel is attached to the plan).
    # Pinned so it stays at the top of the ticket's comments.
    html = f'<p><a href="{plan_url}">{label or f"Test Plan - {ticket_id}"}</a></p>'
    body = json.dumps({"comment": html, "isPrivate": False, "isPinned": True}).encode()
    req = urllib.request.Request(f"{url}/ticket/{ticket_id}/comment", data=body, method="POST",
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            ok = 200 <= r.status < 300
            print(f"    commented test plan on {ticket_id} (HTTP {r.status})")
            return ok
    except Exception as e:
        print(f"  ! comment POST failed for {ticket_id}: {e}")
        return False


def comment_test_plans():
    """Post the 'Test Plan - <id>' link comment on EVERY ticket that has a TestRail plan — any status,
    assigned or not — so the plan link is always present in PM. Idempotent via a local tracker + an
    on-ticket existing-comment check."""
    if not TPC_ENABLED:
        return
    try:
        d = _get("/live/qc-queue")
    except Exception as e:
        print(f"  ! comment pass: cannot reach dashboard: {e}")
        return
    def _sec(name):
        s = d.get(name)
        return (s.get("tickets") if isinstance(s, dict) else s) or []
    seen = set(); ts = []
    for t in _sec("queue") + _sec("qc_failed") + _sec("bis_testing") + _sec("approved_for_live"):
        tid = t.get("ticket_id")
        if tid in seen:
            continue
        seen.add(tid); ts.append(t)
    # ALWAYS comment the plan link once a TestRail plan exists — any status, assigned or not (idempotent).
    targets = [t for t in ts if t.get("has_test_plan") and t.get("testrail_plan_url")]
    tracker = _load_commented()
    posted = 0
    changed = False
    for t in targets:
        if posted >= TPC_MAX:
            break
        tid = str(t.get("ticket_id"))
        if tid in tracker:
            continue
        plan_url = t.get("testrail_plan_url")
        if _ticket_has_plan_comment(tid, plan_url):
            tracker[tid] = "exists"; changed = True
            continue
        if _post_test_plan_comment(tid, plan_url):
            tracker[tid] = "posted"; posted += 1; changed = True
        time.sleep(0.8)
    if changed:
        _save_commented(tracker)
    if posted:
        print(f"  posted {posted} test-plan link comment(s)")


# ---- Share the test plan (TestRail link + Excel download) to a Teams channel ------------------
TEAMS_WEBHOOK_URL = os.environ.get("TEAMS_WEBHOOK_URL", "")
TEAMS_TRACKER = os.path.join(BIS_AUTOMATION_DIR, "data", "teams_posted.json")
TEAMS_MAX = int(os.environ.get("TPR_TEAMS_MAX", "5"))


def _load_json_file(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_json_file(path, d):
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(d, f)
    except Exception as e:
        print(f"  ! could not save {path}: {e}")


def _post_teams_test_plan(ticket_id, title, plan_url, excel_url):
    """Post a Teams MessageCard with 'View Plan' (TestRail) + 'Download Excel' buttons to the
    configured Incoming Webhook. Teams accepts internal links, unlike the PM comment API."""
    if not TEAMS_WEBHOOK_URL:
        return False
    card = {
        "@type": "MessageCard", "@context": "http://schema.org/extensions",
        "summary": f"Test plan ready - {ticket_id}", "themeColor": "0076D7",
        "title": f"Test Plan ready - #{ticket_id}", "text": (title or "")[:300],
        "potentialAction": [
            {"@type": "OpenUri", "name": "View Plan (TestRail)",
             "targets": [{"os": "default", "uri": plan_url}]},
            {"@type": "OpenUri", "name": "Download Excel",
             "targets": [{"os": "default", "uri": excel_url}]},
        ],
    }
    data = json.dumps(card).encode()
    req = urllib.request.Request(TEAMS_WEBHOOK_URL, data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            ok = 200 <= r.status < 300
            print(f"    shared test plan {ticket_id} to Teams (HTTP {r.status})")
            return ok
    except Exception as e:
        print(f"  ! Teams post failed for {ticket_id}: {e}")
        return False


def share_test_plans_to_teams():
    """Post the test plan (TestRail + Excel links) to Teams for UNASSIGNED 'QC Testing' tickets that
    have a plan. Idempotent via data/teams_posted.json. No-op unless TEAMS_WEBHOOK_URL is set."""
    if not TEAMS_WEBHOOK_URL:
        return
    try:
        d = _get("/live/qc-queue")
    except Exception as e:
        print(f"  ! teams pass: cannot reach dashboard: {e}")
        return
    sec = d.get("queue")
    ts = (sec.get("tickets") if isinstance(sec, dict) else sec) or []
    targets = [t for t in ts if t.get("status") == "QC Testing" and not t.get("qc_tester")
               and t.get("has_test_plan") and t.get("testrail_plan_url")]
    tracker = _load_json_file(TEAMS_TRACKER)
    posted = 0
    changed = False
    for t in targets:
        if posted >= TEAMS_MAX:
            break
        tid = str(t.get("ticket_id"))
        if tid in tracker:
            continue
        excel_url = f"{PUBLIC_DASHBOARD_BASE}/live/test-plan-excel/{tid}"
        if _post_teams_test_plan(tid, t.get("title"), t.get("testrail_plan_url"), excel_url):
            tracker[tid] = "posted"
            posted += 1
            changed = True
        time.sleep(0.8)
    if changed:
        _save_json_file(TEAMS_TRACKER, tracker)
    if posted:
        print(f"  shared {posted} test plan(s) to Teams")


# ---- Attach the Excel to the TestRail plan (universal: every QC plan) -------------------------
ATTACH_TRACKER = os.path.join(BIS_AUTOMATION_DIR, "data", "excel_attached.json")
ATTACH_ENABLED = os.environ.get("TPR_ATTACH_EXCEL", "1") == "1"
ATTACH_MAX = int(os.environ.get("TPR_ATTACH_MAX", "5"))


def attach_excels_to_plans():
    """Ask the dashboard to attach the Excel to the TestRail plan for every QC ticket that has a plan.
    The dashboard does the build + TestRail upload (idempotent). Local tracker avoids re-asking."""
    if not ATTACH_ENABLED:
        return
    try:
        d = _get("/live/qc-queue")
    except Exception as e:
        print(f"  ! attach pass: cannot reach dashboard: {e}")
        return
    sec = d.get("queue")
    ts = (sec.get("tickets") if isinstance(sec, dict) else sec) or []
    # Attach only to plans where execution hasn't started yet (the Excel is for pre-execution review;
    # once a case is executed the scheduler removes it). Execution = any passed/failed result.
    def _started(t):
        return (t.get("test_passed") or 0) > 0 or (t.get("test_failed") or 0) > 0
    targets = [t for t in ts if t.get("has_test_plan") and t.get("testrail_plan_url")
               and str(t.get("status") or "").startswith("QC Testing") and not _started(t)]
    tracker = _load_json_file(ATTACH_TRACKER)
    done = 0
    changed = False
    for t in targets:
        if done >= ATTACH_MAX:
            break
        tid = str(t.get("ticket_id"))
        if tid in tracker:
            continue
        try:
            r = _post(f"/live/test-plan-queue/{tid}/attach-excel")
            if r.get("attached"):
                tracker[tid] = "attached"; changed = True; done += 1
                print(f"    attached Excel to TestRail plan for {tid}")
            elif r.get("reason") == "already attached":
                tracker[tid] = "exists"; changed = True
        except Exception as e:
            print(f"  ! attach-excel failed for {tid}: {e}")
        time.sleep(0.8)
    if changed:
        _save_json_file(ATTACH_TRACKER, tracker)
    if done:
        print(f"  attached Excel to {done} plan(s)")


def process_ticket(ticket_id, dry_run=False):
    prompt = f"/create-test-plan {ticket_id} [AUTO-HEADLESS]"
    cmd = _claude_cmd(prompt)
    if dry_run:
        print(f"  [dry-run] would run: {' '.join(cmd)}  (cwd={BIS_AUTOMATION_DIR})")
        return
    # Skip if a plan already exists — mark done so the dashboard stops showing it as queued.
    if _already_has_plan(ticket_id):
        _report(ticket_id, "done")
        print(f"  [skip] {ticket_id}: TestRail plan already exists — marked done (no duplicate)")
        return
    print(f"  -> generating test plan for {ticket_id} ...")
    _report(ticket_id, "generating")
    try:
        proc = subprocess.run(cmd, cwd=BIS_AUTOMATION_DIR, capture_output=True, text=True, encoding="utf-8", errors="replace",
                              env=_ticket_env(ticket_id), timeout=PER_TICKET_TIMEOUT)
    except subprocess.TimeoutExpired:
        _report(ticket_id, "error", error=f"timed out after {PER_TICKET_TIMEOUT}s")
        print(f"  [fail] {ticket_id}: timed out")
        return
    except Exception as e:
        _report(ticket_id, "error", error=str(e))
        print(f"  [fail] {ticket_id}: {e}")
        return
    if proc.returncode == 0:
        plan_url = _find_plan_url(ticket_id)
        _upload_excel(ticket_id)
        _report(ticket_id, "done", plan_url=plan_url)
        _warm_doc_confidence(ticket_id)
        print(f"  [done] {ticket_id}{(' - ' + plan_url) if plan_url else ''}")
    else:
        tail = (proc.stderr or proc.stdout or "claude exited non-zero").strip()[-800:]
        _report(ticket_id, "error", error=tail)
        print(f"  [fail] {ticket_id}: claude rc={proc.returncode}")


def _report_pr(ticket_id, pr_status):
    try:
        _post(f"/live/test-plan-queue/{ticket_id}/pr-status", {"pr_status": pr_status})
    except Exception:
        pass


def _warm_doc_confidence(ticket_id, deep=True):
    """Ask the dashboard to compute + cache the Documentation Confidence flag (Scope ⇄ RN ⇄ PR) for
    this ticket, so the QC queue can show the THIN_RN / weak-docs badge. Best-effort."""
    try:
        _post("/live/doc-confidence/warm", {"ticket_ids": [int(ticket_id)], "deep": deep, "limit": 1})
    except Exception as e:
        print(f"    ! doc-confidence warm failed for {ticket_id}: {e}")


def _rebuild_excel(ticket_id):
    """Ask the dashboard to regenerate the downloadable Excel from the live TestRail plan (and
    refresh the case count). Used after a review-apply so the download mirrors the real plan."""
    try:
        r = _post(f"/live/test-plan-queue/{ticket_id}/rebuild-excel")
        print(f"    rebuilt Excel from TestRail for {ticket_id} (removed_prebuilt={r.get('removed_prebuilt')}, rebuilt={r.get('rebuilt')})")
    except Exception as e:
        print(f"    ! rebuild-excel request failed for {ticket_id}: {e}")


def _assigned_ids():
    """Ticket ids that are in QC Testing WITH a tester (Assigned-Not-Started) — processed first."""
    try:
        with urllib.request.urlopen(f"{DASHBOARD_BASE}/live/qc-queue", timeout=60) as r:
            d = json.loads(r.read().decode())
        sec = d.get("queue")
        ts = sec.get("tickets") if isinstance(sec, dict) else sec
        out = set()
        for t in (ts or []):
            if t.get("status") == "QC Testing" and t.get("qc_tester"):
                try:
                    out.add(int(t.get("ticket_id")))
                except (TypeError, ValueError):
                    pass
        return out
    except Exception:
        return set()


def _clear_review(ticket_id, error=None):
    try:
        _post(f"/live/test-plan-queue/{ticket_id}/review", {"review_action": "none", "review_error": error})
    except Exception as e:
        print(f"  ! could not clear review action for {ticket_id}: {e}")


def process_review_apply(ticket_id, dry_run=False):
    """Download the reviewed Excel and run the generator's 'update as per excel' to apply comments."""
    dest = os.path.join(BIS_AUTOMATION_DIR, "ticket-analysis", f"{ticket_id}-reviewed.xlsx")
    cmd = _claude_cmd(f"{dest} update as per excel for ticket {ticket_id}")
    if dry_run:
        print(f"  [dry-run] review-apply {ticket_id}: download review file -> {' '.join(cmd)}")
        return
    try:
        with urllib.request.urlopen(f"{DASHBOARD_BASE}/live/test-plan-review-file/{ticket_id}", timeout=60) as r:
            blob = r.read()
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(blob)
    except Exception as e:
        _clear_review(ticket_id, f"could not fetch reviewed file: {e}")
        print(f"  [fail] review-apply {ticket_id}: {e}")
        return
    print(f"  -> applying reviewed comments for {ticket_id} ...")
    try:
        proc = subprocess.run(cmd, cwd=BIS_AUTOMATION_DIR, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=PER_TICKET_TIMEOUT)
    except Exception as e:
        _clear_review(ticket_id, str(e)); print(f"  [fail] review-apply {ticket_id}: {e}"); return
    if proc.returncode == 0:
        _rebuild_excel(ticket_id)  # regenerate the download from the LIVE TestRail plan (not the input sheet)
        _clear_review(ticket_id)
        print(f"  [done] review-apply {ticket_id}")
    else:
        _clear_review(ticket_id, (proc.stderr or proc.stdout or "").strip()[-600:])
        print(f"  [fail] review-apply {ticket_id}: rc={proc.returncode}")


def process_review_sync(ticket_id, target_status, dry_run=False):
    """Set the TestRail review status (custom_case_tc_review) for the ticket's cases to target_status."""
    cmd = _claude_cmd(f"For ticket {ticket_id}, set custom_case_tc_review to '{target_status}' on every "
                      f"TestRail case in its plan (project 18, suite 137). Use the matching dropdown option id.")
    if dry_run:
        print(f"  [dry-run] review-sync {ticket_id} -> {target_status}: {' '.join(cmd)}")
        return
    print(f"  -> syncing TestRail review status for {ticket_id} -> {target_status} ...")
    try:
        proc = subprocess.run(cmd, cwd=BIS_AUTOMATION_DIR, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=PER_TICKET_TIMEOUT)
    except Exception as e:
        _clear_review(ticket_id, str(e)); print(f"  [fail] review-sync {ticket_id}: {e}"); return
    if proc.returncode == 0:
        _clear_review(ticket_id)
        print(f"  [done] review-sync {ticket_id} -> {target_status}")
    else:
        _clear_review(ticket_id, (proc.stderr or proc.stdout or "").strip()[-600:])
        print(f"  [fail] review-sync {ticket_id}: rc={proc.returncode}")


def run_cycle(dry_run=False):
    try:
        data = _get("/live/test-plan-queue?status=pending")
        apply_jobs = _get("/live/test-plan-queue?review_action=apply").get("requests", [])
        sync_jobs = _get("/live/test-plan-queue?review_action=sync_status").get("requests", [])
    except Exception as e:
        print(f"! cannot reach dashboard at {DASHBOARD_BASE}: {e}")
        return
    # 1) review jobs first (cheap, keep TestRail in sync).
    # Review-APPLY (creating/editing cases from reviewer comments) is a major manual check that
    # needs human judgment + reliable TestRail writes, so it is handled INTERACTIVELY in the CLI
    # (`/apply-review <id>`), NOT headlessly. Set TPR_AUTO_REVIEW_APPLY=1 to re-enable headless apply.
    if os.environ.get("TPR_AUTO_REVIEW_APPLY", "0") == "1":
        for r in apply_jobs[:MAX_PER_CYCLE]:
            process_review_apply(r["ticket_id"], dry_run=dry_run)
    elif apply_jobs:
        ids = ", ".join(str(r["ticket_id"]) for r in apply_jobs)
        print(f"{len(apply_jobs)} review-apply job(s) pending [{ids}] — apply in the CLI with "
              f"`/apply-review <id>` (headless apply disabled).")
    # Status sync (Draft/Reviewed/Obsolete → TestRail) stays headless; it's simple and reliable.
    for r in sync_jobs[:MAX_PER_CYCLE]:
        process_review_sync(r["ticket_id"], r.get("review_status") or "Draft", dry_run=dry_run)
    # 1b) post the 'Test Plan - <id>' link comment on unassigned QC-Testing tickets that have a plan.
    if not dry_run:
        comment_test_plans()
        share_test_plans_to_teams()
        attach_excels_to_plans()
    # 2) new generation
    reqs = data.get("requests", [])
    if not reqs and not apply_jobs and not sync_jobs:
        print("nothing to do (no pending generation or review jobs).")
        return
    if not reqs:
        return
    # Order: explicit priority tickets (in listed order) → Assigned-Not-Started → the rest by id.
    assigned = _assigned_ids()
    prio_index = {t: i for i, t in enumerate(PRIORITY_TICKETS)}
    reqs.sort(key=lambda r: (
        prio_index.get(r["ticket_id"], 10**6),
        0 if r["ticket_id"] in assigned else 1,
        r["ticket_id"],
    ))
    # PR pass: evaluate + report PR/release-note status for every pending ticket (drives the
    # dashboard's PR filter + export). Skip re-checking ones already known PR-ready.
    prmap = {}
    for r in reqs:
        tid = r["ticket_id"]
        ready = True if r.get("pr_status") == "ready" else _has_pr(tid)
        prmap[tid] = ready
        _report_pr(tid, "ready" if ready else "pre_release")
        _warm_doc_confidence(tid, deep=False)  # structural flag (no PR / no RN) for the queue badge
    nready = sum(1 for v in prmap.values() if v)
    print(f"{len(reqs)} pending ({nready} PR-ready, {len(reqs) - nready} pre-release); processing up to {MAX_PER_CYCLE}, assigned first")
    processed = 0
    for r in reqs:
        if processed >= MAX_PER_CYCLE:
            break
        tid = r["ticket_id"]
        if not prmap.get(tid) and r.get("source") != "manual":
            continue  # auto pre-release: reported & left queued. A manual (human) request overrides the wait.
        process_ticket(tid, dry_run=dry_run)
        processed += 1
    if processed == 0:
        print("  (nothing generated — all pending are pre-release / no PR yet)")


def backfill_excels():
    """One-time: upload every existing ticket-analysis/<id>-*.xlsx to the dashboard so already-
    created test plans become downloadable too. Newest file per ticket; skips *-reviewed.xlsx."""
    import re
    files = glob.glob(os.path.join(BIS_AUTOMATION_DIR, "ticket-analysis", "*.xlsx"))
    by_tid = {}
    for f in files:
        name = os.path.basename(f)
        if name.endswith("-reviewed.xlsx"):
            continue
        m = re.match(r"(\d+)", name)
        if not m:
            continue
        tid = int(m.group(1))
        if tid not in by_tid or os.path.getmtime(f) > os.path.getmtime(by_tid[tid]):
            by_tid[tid] = f
    print(f"Backfilling {len(by_tid)} ticket Excel(s) from ticket-analysis/ -> {DASHBOARD_BASE}")
    ok = 0
    for tid, f in sorted(by_tid.items()):
        try:
            with open(f, "rb") as fh:
                blob = fh.read()
            req = urllib.request.Request(f"{DASHBOARD_BASE}/live/test-plan-queue/{tid}/excel",
                                         data=blob, method="POST",
                                         headers={"Content-Type": "application/octet-stream"})
            with urllib.request.urlopen(req, timeout=60) as r:
                r.read()
            ok += 1
            print(f"  [ok] {tid}  ({os.path.basename(f)})")
        except Exception as e:
            print(f"  [fail] {tid}: {e}")
    print(f"Done — {ok}/{len(by_tid)} uploaded.")


def main():
    ap = argparse.ArgumentParser(description="QC test-plan generation runner")
    ap.add_argument("--once", action="store_true", help="run a single cycle then exit")
    ap.add_argument("--dry-run", action="store_true", help="poll and print, do not invoke claude")
    ap.add_argument("--backfill-excel", action="store_true",
                    help="one-time: upload all existing ticket-analysis Excels to the dashboard")
    ap.add_argument("--comment-once", metavar="TICKET",
                    help="post the 'Test Plan - <id>' link comment to ONE ticket (to confirm the PM POST), then exit")
    ap.add_argument("--force", action="store_true", help="with --comment-once: post even if a comment already exists")
    ap.add_argument("--plan-url", help="with --comment-once: link THIS exact plan URL (override auto-resolve, e.g. a mobile plan when the ticket also has a web plan)")
    ap.add_argument("--label", help="with --comment-once: override the link text (e.g. 'Test Plan (Mobile) - <id>')")
    ap.add_argument("--teams-once", metavar="TICKET",
                    help="share ONE ticket's test plan (TestRail + Excel links) to the Teams webhook, then exit")
    args = ap.parse_args()

    if args.backfill_excel:
        if not BIS_AUTOMATION_DIR or not os.path.isdir(BIS_AUTOMATION_DIR):
            sys.exit("Set BIS_AUTOMATION_DIR to the bis-automation repo clone.")
        backfill_excels()
        return

    if args.comment_once:
        tid = str(args.comment_once)
        plan_url = args.plan_url  # explicit override wins (e.g. a ticket's mobile plan vs its web plan)
        if plan_url:
            print(f"posting '{args.label or ('Test Plan - ' + tid)}' comment -> {plan_url}")
            print("posted OK" if _post_test_plan_comment(tid, plan_url, label=args.label) else "POST failed")
            return
        try:
            d = _get("/live/qc-queue")
            sec = d.get("queue"); ts = (sec.get("tickets") if isinstance(sec, dict) else sec) or []
            t = next((x for x in ts if str(x.get("ticket_id")) == tid), None)
            plan_url = (t or {}).get("testrail_plan_url")
        except Exception as e:
            print(f"could not fetch qc-queue: {e}")
        if not plan_url:
            try:
                q = _get("/live/test-plan-queue")
                r = next((x for x in q.get("requests", []) if str(x.get("ticket_id")) == tid), None)
                plan_url = (r or {}).get("plan_url")
            except Exception:
                pass
        if not plan_url:
            # Final fallback: single-ticket lookup resolves the plan for ANY ticket (incl. closed /
            # not in the QC queue), so we can comment manually-created plans too.
            try:
                lk = _get(f"/live/ticket-lookup?ticket_id={tid}")
                plan_url = lk.get("testrail_plan_url")
            except Exception:
                pass
        if not plan_url:
            sys.exit(f"No TestRail plan URL found for {tid}")
        print(f"posting 'Test Plan - {tid}' comment -> {plan_url}")
        if not args.force and _ticket_has_plan_comment(tid, plan_url):
            print("ticket already has a Test Plan comment; nothing posted (use --force to re-post).")
            return
        print("posted OK" if _post_test_plan_comment(tid, plan_url) else "POST failed (see error above)")
        return

    if args.teams_once:
        tid = str(args.teams_once)
        if not TEAMS_WEBHOOK_URL:
            sys.exit("TEAMS_WEBHOOK_URL is not set (export it or add to runner-task.cmd).")
        title = plan_url = None
        try:
            d = _get("/live/qc-queue")
            sec = d.get("queue"); ts = (sec.get("tickets") if isinstance(sec, dict) else sec) or []
            t = next((x for x in ts if str(x.get("ticket_id")) == tid), None)
            if t:
                title = t.get("title"); plan_url = t.get("testrail_plan_url")
        except Exception as e:
            print(f"could not fetch qc-queue: {e}")
        if not plan_url:
            try:
                q = _get("/live/ticket-lookup?ticket_id=" + tid)
                title = title or q.get("title"); plan_url = q.get("testrail_plan_url")
            except Exception:
                pass
        if not plan_url:
            sys.exit(f"No TestRail plan URL found for {tid}")
        excel_url = f"{PUBLIC_DASHBOARD_BASE}/live/test-plan-excel/{tid}"
        print(f"sharing test plan {tid} to Teams -> plan={plan_url} excel={excel_url}")
        print("shared OK" if _post_teams_test_plan(tid, title, plan_url, excel_url) else "Teams post FAILED (see above)")
        return

    if not args.dry_run:
        if not BIS_AUTOMATION_DIR or not os.path.isdir(BIS_AUTOMATION_DIR):
            sys.exit("Set BIS_AUTOMATION_DIR to the bis-automation repo clone (where /create-test-plan runs).")
        if not os.environ.get("ANTHROPIC_API_KEY"):
            # `claude -p` uses the CLI's existing auth (subscription login OR api key); only warn.
            print("note: ANTHROPIC_API_KEY not set — relying on the logged-in `claude` CLI auth on this machine.")
    print(f"Test-plan runner -> dashboard {DASHBOARD_BASE} | repo {BIS_AUTOMATION_DIR or '(dry-run)'}")
    if args.once or args.dry_run:
        run_cycle(dry_run=args.dry_run)
        return
    while True:
        run_cycle()
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
