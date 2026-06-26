"""Auto-advance Draft test cases to Reviewed once a plan's execution has started.

Rule (confirmed with the team): when ANY test in a ticket's TestRail plan gets a result
(Passed/Failed/Blocked/Retest — i.e. execution has begun), the new cases have effectively been
accepted by the tester, so flip every **Draft** case (`custom_case_tc_review` = 1) in that plan to
**Reviewed** (= 2). It NEVER touches cases that are already Reviewed/Obsolete.

Efficiency: only scans tickets currently in QC ('QC Testing*') that have a plan; tracks each plan by
its case count in data/review_autostatus.json so a plan is processed once — and re-scanned only if
cases were later added (count changed). A few plans per cycle to stay under TestRail rate limits.
"""
import os
import json
import time
import base64
import logging
import threading
from typing import Optional

import requests
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger(__name__)

RAS_INTERVAL_MINUTES = int(os.getenv("REVIEW_AUTOSTATUS_INTERVAL_MINUTES", "15"))
RAS_ENABLED = os.getenv("REVIEW_AUTOSTATUS_AUTO", "true").lower() == "true"
RAS_MAX_PLANS_PER_CYCLE = int(os.getenv("REVIEW_AUTOSTATUS_MAX_PLANS", "4"))
# Once a plan's execution starts, also remove the pre-execution review Excel from the plan.
RAS_REMOVE_EXCEL = os.getenv("REVIEW_REMOVE_EXCEL_ON_EXEC", "true").lower() == "true"
_TRACKER_FILE = os.path.join(os.path.dirname(__file__), "data", "review_autostatus.json")
_EXCEL_TRACKER_FILE = os.path.join(os.path.dirname(__file__), "data", "review_excel_removed.json")
_EXECUTED_STATUSES = {1, 2, 4, 5}   # Passed, Blocked, Retest, Failed (3 = Untested)
DRAFT, REVIEWED = 1, 2

_scheduler: Optional[BackgroundScheduler] = None


def _detach_plan_excel(api, h, plan_id, ticket_id):
    """Remove our TestPlan_<id>.xlsx attachment(s) from the plan. Returns count removed."""
    name = f"TestPlan_{ticket_id}.xlsx"
    removed = 0
    try:
        g = requests.get(f"{api}/get_attachments_for_plan/{plan_id}", headers=h, timeout=30).json()
        atts = g.get("attachments", g) if isinstance(g, dict) else g
        for aid in {a["id"] for a in (atts or []) if (a.get("filename") or a.get("name")) == name}:
            r = requests.post(f"{api}/delete_attachment/{aid}", headers=h, timeout=30)
            if r.status_code == 200:
                removed += 1
    except Exception as e:
        logger.warning("review-autostatus: detach Excel failed for plan %s: %s", plan_id, e)
    return removed


def _auth():
    url = os.environ.get("TESTRAIL_URL", "https://bistrainer.testrail.io")
    email = os.environ.get("TESTRAIL_EMAIL", "")
    key = os.environ.get("TESTRAIL_API_KEY", "")
    if not email or not key:
        return None, None
    cred = base64.b64encode(f"{email}:{key}".encode()).decode()
    return url, {"Authorization": f"Basic {cred}", "Content-Type": "application/json"}


def _load_tracker() -> dict:
    try:
        with open(_TRACKER_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_tracker(d: dict) -> None:
    os.makedirs(os.path.dirname(_TRACKER_FILE), exist_ok=True)
    with open(_TRACKER_FILE, "w") as f:
        json.dump(d, f)


def sync_review_autostatus() -> dict:
    """One pass: flip Draft→Reviewed for plans whose execution has started."""
    url, h = _auth()
    if not h:
        logger.info("review-autostatus: TestRail creds not configured; skipping")
        return {"skipped": "no-creds"}
    api = f"{url}/index.php?/api/v2"
    from pm_live_data import get_live_qc_queue, _fetch_testrail_plans
    data = get_live_qc_queue() or {}
    section = data.get("queue")
    tickets = section.get("tickets") if isinstance(section, dict) else (section or [])
    plans_map = _fetch_testrail_plans() or {}
    tracker = _load_tracker()
    try:
        with open(_EXCEL_TRACKER_FILE) as f:
            excel_removed = json.load(f)
    except Exception:
        excel_removed = {}
    excel_changed = False

    plans_done = cases_flipped = 0
    for t in (tickets or []):
        if plans_done >= RAS_MAX_PLANS_PER_CYCLE:
            break
        if not t.get("has_test_plan"):
            continue
        if not str(t.get("status") or "").startswith("QC Testing"):
            continue
        try:
            tid = int(t.get("ticket_id"))
        except (TypeError, ValueError):
            continue
        info = plans_map.get(tid) or plans_map.get(str(tid))
        if not info or not info.get("plan_id"):
            continue
        plan_id = info["plan_id"]
        try:
            plan = requests.get(f"{api}/get_plan/{plan_id}", headers=h, timeout=30).json()
            case_ids, executed = set(), False
            for e in plan.get("entries", []):
                for run in e.get("runs", []):
                    tr = requests.get(f"{api}/get_tests/{run['id']}", headers=h, timeout=30).json()
                    tl = tr.get("tests", tr) if isinstance(tr, dict) else tr
                    if not isinstance(tl, list):
                        continue  # error/rate-limit response — skip this run
                    for x in tl:
                        if not isinstance(x, dict):
                            continue
                        case_ids.add(x.get("case_id"))
                        if x.get("status_id") in _EXECUTED_STATUSES:
                            executed = True
            if not executed:
                continue  # execution not started — leave Draft as-is and keep the review Excel
            count = len(case_ids)
            flip_needed = tracker.get(str(plan_id)) != count
            excel_needed = RAS_REMOVE_EXCEL and str(plan_id) not in excel_removed
            if not flip_needed and not excel_needed:
                continue  # this executed plan is fully handled already
            n = 0
            if flip_needed:
                for cid in case_ids:
                    c = requests.get(f"{api}/get_case/{cid}", headers=h, timeout=30).json()
                    if c.get("custom_case_tc_review") == DRAFT:
                        requests.post(f"{api}/update_case/{cid}", headers=h,
                                      json={"custom_case_tc_review": REVIEWED}, timeout=30)
                        n += 1
                        time.sleep(0.3)
                tracker[str(plan_id)] = count
                cases_flipped += n
            if excel_needed:
                rm = _detach_plan_excel(api, h, plan_id, tid)
                excel_removed[str(plan_id)] = True
                excel_changed = True
                if rm:
                    logger.info("review-autostatus: removed %s Excel attachment(s) from plan %s "
                                "(execution started)", rm, plan_id)
            plans_done += 1
            if n:
                logger.info("review-autostatus: ticket %s plan %s — %s Draft→Reviewed (execution started)",
                            tid, plan_id, n)
        except Exception as e:
            logger.warning("review-autostatus: ticket %s (plan %s) failed: %s", tid, plan_id, e)

    _save_tracker(tracker)
    if excel_changed:
        try:
            with open(_EXCEL_TRACKER_FILE, "w") as f:
                json.dump(excel_removed, f)
        except Exception as e:
            logger.warning("review-autostatus: could not save excel tracker: %s", e)
    return {"plans_processed": plans_done, "cases_flipped": cases_flipped}


def _job() -> None:
    try:
        res = sync_review_autostatus()
        logger.info("review-autostatus sync: %s", res)
    except Exception as e:
        logger.exception("review-autostatus sync failed: %s", e)


def start_review_autostatus_scheduler(interval_minutes: Optional[int] = None) -> bool:
    global _scheduler
    if not RAS_ENABLED:
        logger.info("review-autostatus is disabled (set REVIEW_AUTOSTATUS_AUTO=true to enable)")
        return False
    if _scheduler is not None:
        return False
    interval = interval_minutes if interval_minutes is not None else RAS_INTERVAL_MINUTES
    interval = max(5, min(interval, 1440))
    _scheduler = BackgroundScheduler()
    _scheduler.start()
    _scheduler.add_job(
        func=_job, trigger=IntervalTrigger(minutes=interval),
        id="review_autostatus_sync", name="Review Auto-Status (Draft→Reviewed on execution)",
        replace_existing=True, max_instances=1,
    )
    threading.Thread(target=_job, daemon=True).start()
    logger.info("review-autostatus scheduler started (every %s minutes)", interval)
    return True


def stop_review_autostatus_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
