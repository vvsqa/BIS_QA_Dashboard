"""Weekly QA Ticket Review — the single per-ticket signal aggregator + revised-estimate suggestion.

`get_ticket_review_signals(db, ticket_id, reviewee)` is the ONE source of truth consumed by BOTH the
Ticket Review insight panel and the performance matrix, so the "expected vs actual vs time vs diligence"
math never diverges. `suggest_revision(signals)` produces a rule baseline + an AI narrative (via
llm_client — Claude API key OR Claude Code subscription CLI). Everything is pure-read and never raises.
"""
import re
from datetime import datetime, date

import qa_planning as QP
import ticket_complexity as TC
import llm_client
from models import TicketTracking, Bug, TicketStatusHistory, EnhancedTimesheet, TimeSheetEntry

QA_TARGET_FRACTION_OF_DEV = 0.33   # default QA target = 33% of dev estimate when no QA estimate
HOLD_IDLE_DAYS = 3                  # a hold this long with no logged effort = idle
_MINOR_SEV = ("minor", "low", "low bug", "trivial", "cosmetic")
_MAJOR_SEV = ("critical", "major", "high", "blocker")
_LIVE_ENV = ("live", "production", "prod")
_OPEN_BUG = {"new", "open", "reopened", "assigned to dev", "in progress", "fixed", "assigned"}


# --------------------------------------------------------------------------- name matching
def _norm(name):
    n = re.sub(r"\(.*?\)", "", name or "")
    return re.sub(r"\s+", " ", n).strip().lower()


def _name_keys(name):
    """Match keys for a person: normalized + compact + initials-stripped (so 'Amal Raj' ~ 'Amalraj R')."""
    n = _norm(name)
    if not n:
        return set()
    keys = {n, n.replace(" ", "")}
    core = [t for t in n.split() if len(t) > 1]
    if core and len(core) != len(n.split()):
        keys.add(" ".join(core))
        keys.add("".join(core))
    return keys


def _same_person(a, b):
    return bool(_name_keys(a) & _name_keys(b))


# --------------------------------------------------------------------------- helpers
def _f(v):
    try:
        return float(v) if v is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def target_qa_hours(qa_estimate, dev_estimate):
    qa = _f(qa_estimate)
    if qa > 0:
        return qa, "qa_estimate"
    dev = _f(dev_estimate)
    if dev > 0:
        return round(dev * QA_TARGET_FRACTION_OF_DEV, 2), "33%_of_dev"
    return 0.0, "none"


def _sev_bucket(sev):
    s = (sev or "").strip().lower()
    if any(k in s for k in _MAJOR_SEV):
        return "major"
    if any(k in s for k in _MINOR_SEV):
        return "minor"
    return "other"


def _timesheet_hours(db, ticket_id, reviewee):
    """Hours the reviewee logged against this ticket. Uses the larger of the two timesheet sources
    (EnhancedTimesheet from Sheets, TimeSheetEntry manual) to avoid double-counting overlaps."""
    tid = str(ticket_id)
    enh = 0.0
    try:
        for e in db.query(EnhancedTimesheet).filter(EnhancedTimesheet.ticket_id == tid).all():
            if _same_person(e.employee_name, reviewee):
                enh += _f(e.productive_hours) if _f(e.productive_hours) > 0 else _f(e.hours_logged)
    except Exception:
        pass
    man = 0.0
    try:
        for e in db.query(TimeSheetEntry).filter(TimeSheetEntry.ticket_id == tid).all():
            if _same_person(e.employee_name, reviewee):
                man += _f(e.productive_hours) if _f(e.productive_hours) > 0 else _f(e.hours)
    except Exception:
        pass
    return round(max(enh, man), 2)


def timesheet_activity(db, ticket_id, reviewee=None, limit=60):
    """The actual activity the QA logged on this ticket — consolidated timesheet entries
    (date · hours · who · description). Filtered to `reviewee` when it resolves; otherwise returns
    all QA entries for the ticket so the activity still shows for unresolved/unassigned testers."""
    tid = str(ticket_id)
    rows = []
    has_reviewee = bool(reviewee and _name_keys(reviewee))
    try:
        q = db.query(EnhancedTimesheet).filter(EnhancedTimesheet.ticket_id == tid)
        for e in q.all():
            if has_reviewee:
                if not _same_person(e.employee_name, reviewee):
                    continue
            elif (getattr(e, "team", "") or "").strip().upper() == "DEV":
                continue  # no resolved tester → show QA-side activity only (skip dev entries)
            hrs = _f(e.productive_hours) if _f(e.productive_hours) > 0 else _f(e.hours_logged)
            desc = (getattr(e, "task_description", "") or "").strip()
            if hrs <= 0 and not desc:
                continue
            rows.append({"date": e.date.isoformat() if e.date else None, "hours": round(hrs, 2),
                         "who": (e.employee_name or "").strip(), "desc": desc})
    except Exception:
        pass
    rows.sort(key=lambda r: (r["date"] or ""))
    total = round(sum(r["hours"] for r in rows), 2)
    return {"entries": rows[:limit], "count": len(rows), "total_hours": total}


def _bis_pass_dt(history):
    """First transition into BIS Testing (the QC-pass moment) — datetime or None."""
    for h in history:
        if (h.new_status or "") == "BIS Testing":
            return h.changed_on
    return None


# --------------------------------------------------------------------------- main aggregator
def get_ticket_review_signals(db, ticket_id, reviewee, ticket=None, history=None, bugs=None,
                              cx_entry=None, timesheet_hours=None):
    """Compute the expected/actual/time/diligence snapshot for one ticket + reviewee. Never raises.
    Pass preloaded `ticket`/`history`/`bugs`/`cx_entry` (e.g. batched by the leaderboard) to skip queries."""
    t = ticket
    if t is None:
        try:
            t = db.query(TicketTracking).filter(TicketTracking.ticket_id == ticket_id).first()
        except Exception:
            t = None
    if history is None:
        try:
            history = (db.query(TicketStatusHistory)
                       .filter(TicketStatusHistory.ticket_id == ticket_id)
                       .order_by(TicketStatusHistory.changed_on.asc()).all())
        except Exception:
            history = []
    if bugs is None:
        try:
            bugs = db.query(Bug).filter(Bug.ticket_id == ticket_id).all()
        except Exception:
            bugs = []

    qa_est = _f(getattr(t, "qa_estimate_hours", 0))
    dev_est = _f(getattr(t, "dev_estimate_hours", 0))
    actual_qa = _f(getattr(t, "actual_qa_hours", 0))
    target, target_basis = target_qa_hours(qa_est, dev_est)

    cx = cx_entry if cx_entry is not None else {}
    if not cx:
        try:
            cx = TC.get_cached(ticket_id) or {}
        except Exception:
            cx = {}

    # ---- bugs by severity + environment ----
    by_sev, by_env = {}, {}
    bis_dt = _bis_pass_dt(history)
    escaped_live = 0
    for b in bugs:
        sev = _sev_bucket(b.severity)
        by_sev[sev] = by_sev.get(sev, 0) + 1
        env = (b.environment or "Unknown").strip() or "Unknown"
        by_env[env] = by_env.get(env, 0) + 1
        if (b.environment or "").strip().lower() in _LIVE_ENV:
            # Escaped only if the Live bug appeared AFTER the ticket passed QC into BIS.
            if bis_dt is None or (b.created_on and b.created_on >= bis_dt):
                escaped_live += 1

    # ---- status durations + cycles ----
    try:
        dur = QP.get_status_durations(db, ticket_id, history=history)
    except Exception:
        dur = {"total_qc_days": 0, "total_hold_days": 0, "current_status": getattr(t, "status", None)}
    try:
        cyc = QP.get_qc_cycle_details(db, ticket_id, history=history)
    except Exception:
        cyc = {"total_cycles": 0, "failed_cycles": 0, "first_pass": False, "cycles": []}

    hold_days = int(dur.get("total_hold_days") or 0)
    qc_days = int(dur.get("total_qc_days") or 0)
    current_status = dur.get("current_status") or getattr(t, "status", None)

    # ---- movement to BIS ----
    reached_bis = bis_dt is not None
    days_to_bis = None
    if reached_bis:
        first_qc = next((h.changed_on for h in history if (h.new_status or "") in QP.QA_QC_STATUSES), None)
        if first_qc and bis_dt and bis_dt >= first_qc:
            days_to_bis = max(0, (bis_dt.date() - first_qc.date()).days)

    # ---- time ----
    ts_hours = timesheet_hours if timesheet_hours is not None else _timesheet_hours(db, ticket_id, reviewee)
    effort = round(max(ts_hours, actual_qa), 2)

    # ---- diligence (deterministic) ----
    found_major = by_sev.get("major", 0) > 0
    failed = int(cyc.get("failed_cycles") or 0) > 0
    # trivial fail: a fail happened and NO major/critical bug was found (only minor/low)
    trivial_fail = failed and not found_major and by_sev.get("minor", 0) > 0
    idle_hold = hold_days >= HOLD_IDLE_DAYS and ts_hours == 0
    legit_parking = (failed or hold_days >= HOLD_IDLE_DAYS) and found_major
    if legit_parking:
        trivial_fail = False
        idle_hold = False

    dsignals = []
    if escaped_live:
        dsignals.append(f"{escaped_live} Live-environment bug(s) after QC pass (escaped defect)")
    if idle_hold:
        dsignals.append(f"Held {hold_days}d with no logged effort")
    if trivial_fail:
        dsignals.append("Failed the ticket only for minor/low severity bug(s)")
    if legit_parking:
        dsignals.append("Parked legitimately — major/critical bug(s) found (no penalty)")

    return {
        "ticket_id": ticket_id,
        "title": getattr(t, "title", "") or "",
        "reviewee": reviewee,
        "module": (getattr(t, "subdepartment", "") or "").strip() or "Unassigned",
        "expected": {
            "qa_estimate_hours": qa_est, "dev_estimate_hours": dev_est,
            "target_qa_hours": target, "target_basis": target_basis,
            "complexity": {"level": cx.get("level"), "score": cx.get("score")},
        },
        "actual": {
            "bugs_total": len(bugs),
            "bugs_by_severity": by_sev, "bugs_by_env": by_env,
            "qc_cycles": int(cyc.get("total_cycles") or 0),
            "failed_cycles": int(cyc.get("failed_cycles") or 0),
            "first_pass": bool(cyc.get("first_pass")),
            "hold_days": hold_days, "qc_days": qc_days,
            "movement": {"reached_bis": reached_bis, "days_to_bis": days_to_bis,
                         "current_status": current_status,
                         "refix_count": int(getattr(t, "refix_count", 0) or 0)},
        },
        "time": {"timesheet_hours": ts_hours, "actual_qa_hours": actual_qa, "effort_hours": effort},
        "diligence": {
            "escaped_defect_live": bool(escaped_live), "escaped_count": escaped_live,
            "idle_hold": idle_hold, "trivial_fail": trivial_fail, "legit_parking": legit_parking,
            "signals": dsignals,
        },
    }


# --------------------------------------------------------------------------- suggestion (rule + AI)
def _rule_suggest(sig):
    target = _f(sig["expected"]["target_qa_hours"])
    effort = _f(sig["time"]["effort_hours"])
    level = (sig["expected"]["complexity"] or {}).get("level")
    revised = effort if effort > 0 else target
    # nudge up when high-complexity work was under-targeted
    if level == "High" and target and revised < target * 1.2:
        revised = target * 1.2
    # clamp to a sane band around the target so a one-off anomaly can't blow it up
    if target > 0:
        revised = max(0.5 * target, min(3.0 * target, revised))
    revised = round(revised, 1)
    delta = round(revised - target, 1)
    if delta > 0.5:
        rationale = f"Actual effort {effort:g}h vs target {target:g}h — add {delta:g}h."
    elif delta < -0.5:
        rationale = f"Actual effort {effort:g}h below target {target:g}h — reduce {abs(delta):g}h."
    else:
        rationale = f"Effort {effort:g}h ≈ target {target:g}h — estimate looks right."
    # verdict leaning from diligence
    d = sig["diligence"]
    if d["escaped_defect_live"]:
        verdict = "not_genuine"
    elif d["idle_hold"] or d["trivial_fail"]:
        verdict = "mixed"
    else:
        verdict = "genuine"
    return {"revised_hours": revised, "delta": delta, "rationale": rationale, "verdict": verdict}


_AI_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["summary", "verdict", "suggested_hours", "add_or_remove_hours"],
    "properties": {
        "summary": {"type": "string"},
        "verdict": {"type": "string", "enum": ["genuine", "not_genuine", "mixed"]},
        "suggested_hours": {"type": "number"},
        "add_or_remove_hours": {"type": "number"},
    },
}

_AI_SYS = (
    "You are a QA manager judging whether a tester's effort on ONE ticket was genuine and what the QA "
    "time estimate should have been. Be fair: finding real bugs and parking a buggy ticket is good work, "
    "not a fault. The strongest negative is a defect that escaped to the Live environment. In 2-3 sentences "
    "summarize what was expected vs what they actually did vs the time they spent, state the verdict, and "
    "recommend the revised QA hours (and how many hours to add or remove vs the target). Emit via the tool."
)


def suggest_revision(sig, use_ai=True):
    """Rule baseline + optional AI narrative. Returns {summary, verdict, suggested_hours, delta, source}."""
    rule = _rule_suggest(sig)
    out = {"summary": rule["rationale"], "verdict": rule["verdict"],
           "suggested_hours": rule["revised_hours"], "delta": rule["delta"], "source": "rule"}
    if not use_ai:
        return out
    try:
        if not llm_client.available():
            return out
        exp, act, tm, dl = sig["expected"], sig["actual"], sig["time"], sig["diligence"]
        user = (
            f"TICKET #{sig['ticket_id']} ({sig['module']}) — tester: {sig['reviewee']}\n"
            f"EXPECTED: target {exp['target_qa_hours']}h ({exp['target_basis']}); "
            f"qa_est {exp['qa_estimate_hours']}h, dev_est {exp['dev_estimate_hours']}h; "
            f"complexity {exp['complexity'].get('level')}.\n"
            f"ACTUAL: bugs {act['bugs_total']} by_sev {act['bugs_by_severity']} by_env {act['bugs_by_env']}; "
            f"QC cycles {act['qc_cycles']} (failed {act['failed_cycles']}, first_pass {act['first_pass']}); "
            f"hold {act['hold_days']}d, qc {act['qc_days']}d; "
            f"movement {act['movement']}.\n"
            f"TIME: timesheet {tm['timesheet_hours']}h, actual_qa {tm['actual_qa_hours']}h, effort {tm['effort_hours']}h.\n"
            f"DILIGENCE: {dl['signals'] or 'clean'}.\n"
            f"Rule baseline suggests {rule['revised_hours']}h ({rule['rationale']})."
        )
        ai = llm_client.complete_json(_AI_SYS, user, _AI_SCHEMA, tool_name="emit", max_tokens=600)
        if ai and "suggested_hours" in ai:
            tgt = _f(exp["target_qa_hours"])
            out = {"summary": ai.get("summary") or rule["rationale"],
                   "verdict": ai.get("verdict") or rule["verdict"],
                   "suggested_hours": round(_f(ai.get("suggested_hours")), 1),
                   "delta": round(_f(ai.get("suggested_hours")) - tgt, 1),
                   "source": "ai"}
    except Exception:
        pass
    return out


# --------------------------------------------------------------------------- BIS time validation
# QA activity phases. Manager rule: FULL regression belongs in PRE/STAGING; LIVE gets HIGH-LEVEL
# SANITY only (never a full live regression). Bug retest + regression-from-breakage are credited only
# when real breakage occurred. Test-data/DB setup is legit when multi-env / heavy data is implied.
QA_PHASES = ("functional", "pre_staging_regression", "live_sanity",
             "bug_retest", "regression_from_breakage", "test_data_db_setup")

_PHASE_DEFAULT_TOTAL = {"High": 10.0, "Medium": 6.0, "Low": 3.0}  # fallback total when no target/effort


def parse_time_request(text):
    """Parse a pasted QA time-request message into [{ticket_id, requested_hours, reason}].

    Handles the manager's usual shape, e.g.:
      "Need additional time for tickets 10177, 20524.
       10177 - ... Total Estimated Hours for this ticket will become 21 hrs.
       20524 - ... Total Estimated Hours ... 20 hrs"
    A ticket named only in the header (no own block) yields requested_hours=None.
    """
    if not text or not text.strip():
        return []
    # Split into per-ticket blocks: a line that STARTS with a ticket id begins a new block.
    lines = text.splitlines()
    blocks = []          # (ticket_id, [lines])
    header_ids = []
    cur = None
    id_start = re.compile(r"^\s*#?(\d{4,6})\b")
    for ln in lines:
        m = id_start.match(ln)
        if m:
            cur = {"ticket_id": int(m.group(1)), "lines": [ln]}
            blocks.append(cur)
        elif cur is not None:
            cur["lines"].append(ln)
        else:
            # pre-block header line: collect any ticket ids mentioned (e.g. "tickets 10177, 20524")
            header_ids.extend(int(x) for x in re.findall(r"\b(\d{4,6})\b", ln))

    def _hours(block_text):
        m = re.search(r"(?:total\s+estimated\s+hours[^0-9]*|become[^0-9]*|=\s*)(\d+(?:\.\d+)?)\s*(?:hr|hrs|hours|h)\b",
                      block_text, re.I)
        if not m:
            m = re.search(r"(\d+(?:\.\d+)?)\s*(?:hr|hrs|hours)\b", block_text, re.I)
        return round(float(m.group(1)), 2) if m else None

    out, seen = [], set()
    for b in blocks:
        btxt = "\n".join(b["lines"]).strip()
        out.append({"ticket_id": b["ticket_id"], "requested_hours": _hours(btxt), "reason": btxt})
        seen.add(b["ticket_id"])
    # header-only tickets (mentioned but no block of their own)
    for tid in header_ids:
        if tid not in seen:
            out.append({"ticket_id": tid, "requested_hours": None, "reason": ""})
            seen.add(tid)
    return out


def _cx_factor_score(cx, key):
    """0-3 score for a complexity factor from the cached entry; 0 if absent."""
    try:
        return int(((cx.get("factors") or {}).get(key) or {}).get("score") or 0)
    except (TypeError, ValueError, AttributeError):
        return 0


def _cx_factor_reason(cx, key):
    try:
        return (((cx.get("factors") or {}).get(key) or {}).get("reason") or "").strip()
    except (AttributeError, TypeError):
        return ""


def _verdict_for(requested, recommended):
    """Compare QA's requested total against the system recommendation."""
    if requested is None or requested <= 0:
        return None, None
    delta = round(requested - recommended, 1)
    band = max(1.0, 0.10 * recommended)
    if requested <= recommended + band:
        return "justified", delta
    if requested <= recommended * 1.30:
        return "partially_justified", delta
    return "over_asked", delta


def _rule_phase_breakdown(sig, requested_hours, cx=None):
    """Deterministic per-phase recommendation. Anchors a sane total on target/effort (with the
    same High-complexity nudge + [0.5x,3x] clamp as _rule_suggest), then splits it across phases by
    complexity-factor scores + bug/cycle signals, enforcing the manager's live-sanity-only rule."""
    exp, act, tm = sig["expected"], sig["actual"], sig["time"]
    level = (exp["complexity"] or {}).get("level")
    target = _f(exp["target_qa_hours"])
    effort = _f(tm["effort_hours"])
    cx = cx or {}

    # These requests are usually FORWARD-looking (time to DO regression/sanity not yet logged), so
    # logged effort is an incomplete anchor. Drive the total off complexity + the original target, and
    # use logged effort only as a floor (never recommend less than what's already been spent).
    floor = _PHASE_DEFAULT_TOTAL.get(level, 5.0)
    base = max(target, floor)
    if level == "High" and base < target * 1.2:   # under-targeted high-complexity work
        base = target * 1.2
    base = max(base, effort)
    # generous upper sanity bound so a single anomaly can't produce an absurd figure
    base = min(base, max(40.0, 4.0 * target))
    total = round(base, 1) or floor

    tt = _cx_factor_score(cx, "testing_types")
    td = _cx_factor_score(cx, "test_data_effort")
    rh = _cx_factor_score(cx, "retest_history")
    cm = _cx_factor_score(cx, "cross_module")
    by_sev = act.get("bugs_by_severity") or {}
    major = int(by_sev.get("major", 0))
    bugs_total = int(act.get("bugs_total", 0))
    failed_cycles = int(act.get("failed_cycles", 0))
    refix = int((act.get("movement") or {}).get("refix_count", 0))

    # relative weights per phase (0 = phase doesn't apply)
    w = {
        "functional": 1.0 + 0.3 * (cm / 3.0),
        "pre_staging_regression": 0.5 + 0.5 * (tt / 3.0),   # full regression in pre, scaled by testing breadth
        "live_sanity": 0.15,                                  # small fixed slice only — capped below
        "bug_retest": (0.20 + 0.15 * min(major, 3) + 0.10 * min(refix, 3)) if (bugs_total > 0 or refix > 0) else 0.0,
        "regression_from_breakage": (0.30 + 0.15 * min(failed_cycles, 3)) if (failed_cycles > 0 or rh >= 2) else 0.0,
        "test_data_db_setup": (0.20 + 0.30 * (td / 3.0)) if td > 0 else 0.0,
    }
    sumw = sum(w.values()) or 1.0
    hours = {p: total * (wt / sumw) for p, wt in w.items()}

    # Enforce live-sanity-only: cap at a small slice and push the trimmed time back into pre regression.
    live_cap = max(1.0, 0.15 * total)
    if hours["live_sanity"] > live_cap:
        hours["pre_staging_regression"] += hours["live_sanity"] - live_cap
        hours["live_sanity"] = live_cap

    reasons = {
        "functional": "Core functional verification" + (f" — {_cx_factor_reason(cx, 'cross_module')}" if cm >= 2 else ""),
        "pre_staging_regression": "Full regression in pre/staging" + (f" — {_cx_factor_reason(cx, 'testing_types')}" if tt >= 1 else ""),
        "live_sanity": "High-level sanity check in Live only (capped — no full live regression)",
        "bug_retest": f"Retest of {bugs_total} bug(s)" + (f", {major} major" if major else "") + (f"; {refix} refix cycle(s)" if refix else ""),
        "regression_from_breakage": f"Regression from real breakage — {failed_cycles} failed QC cycle(s)" + (f"; {_cx_factor_reason(cx, 'retest_history')}" if rh >= 2 else ""),
        "test_data_db_setup": "Test-data / DB setup" + (f" — {_cx_factor_reason(cx, 'test_data_effort')}" if td else ""),
    }

    phases = []
    for p in QA_PHASES:
        h = round(hours.get(p, 0.0), 1)
        if h <= 0:
            continue
        phases.append({"phase": p, "recommended_hours": h, "rationale": reasons[p]})
    recommended_total = round(sum(x["recommended_hours"] for x in phases), 1)
    verdict, delta = _verdict_for(requested_hours, recommended_total)
    if verdict == "justified":
        summary = f"Requested {requested_hours:g}h is in line with the {recommended_total:g}h the activities justify."
    elif verdict == "partially_justified":
        summary = f"Requested {requested_hours:g}h is somewhat above the {recommended_total:g}h justified by the activities (+{delta:g}h)."
    elif verdict == "over_asked":
        summary = f"Requested {requested_hours:g}h exceeds the {recommended_total:g}h the activities justify (+{delta:g}h)."
    else:
        summary = f"Activities justify about {recommended_total:g}h of QA time across the phases below."
    return {"phases": phases, "recommended_total": recommended_total,
            "requested_hours": requested_hours, "delta": delta,
            "verdict": verdict, "summary": summary, "source": "rule"}


_PHASE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["phases", "recommended_total", "verdict", "summary"],
    "properties": {
        "phases": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["phase", "recommended_hours", "rationale"],
            "properties": {
                "phase": {"type": "string", "enum": list(QA_PHASES)},
                "recommended_hours": {"type": "number"},
                "rationale": {"type": "string"},
            }}},
        "recommended_total": {"type": "number"},
        "verdict": {"type": "string", "enum": ["justified", "partially_justified", "over_asked"]},
        "summary": {"type": "string"},
    },
}

_PHASE_SYS = (
    "You are a QA manager validating whether a tester's requested ADDITIONAL time on ONE ticket (being "
    "moved to BIS Testing) is justified, broken down by QA activity phase. Rules: (1) FULL regression "
    "belongs in PRE/STAGING; in LIVE only HIGH-LEVEL SANITY checks are warranted — never credit a full "
    "live regression. (2) Credit genuine bug retest and regression caused by REAL breakage (failed QC "
    "cycles / refixes). (3) Test-data/DB-setup time is legitimate when multi-environment or heavy data "
    "manipulation is implied. Use the complexity level, required testing types, bug counts/severity/env, "
    "QC cycles and refix count to decide hours per phase. Omit phases that don't apply. Be fair but do "
    "not rubber-stamp: if the requested total exceeds what the phases justify, mark over_asked and show "
    "the smaller recommended total. Return phases (with one-sentence rationales), a recommended_total, a "
    "verdict comparing the requested total, and a 2-3 sentence summary. Emit via the tool."
)


def suggest_phase_breakdown(sig, requested_hours=None, reason=None, use_ai=True, cx=None):
    """Per-phase QA time recommendation for a BIS-bound ticket: rule baseline + optional AI refinement.
    On-demand only (never auto-warmed). Fail-soft to the rule result. Returns the breakdown dict plus
    `logged_hours` (the tester's actual logged/effort hours — the only hard actual)."""
    if cx is None:
        try:
            cx = TC.get_cached(sig["ticket_id"]) or {}
        except Exception:
            cx = {}
    rule = _rule_phase_breakdown(sig, requested_hours, cx=cx)
    out = dict(rule)
    out["logged_hours"] = _f(sig["time"]["effort_hours"])
    if not use_ai:
        return out
    try:
        if not llm_client.available():
            return out
        exp, act, tm = sig["expected"], sig["actual"], sig["time"]
        fac = {k: (_cx_factor_score(cx, k), _cx_factor_reason(cx, k))
               for k in ("testing_types", "test_data_effort", "retest_history", "cross_module")}
        user = (
            f"TICKET #{sig['ticket_id']} ({sig['module']}) — tester: {sig['reviewee']}\n"
            f"EXPECTED: target {exp['target_qa_hours']}h ({exp['target_basis']}); "
            f"qa_est {exp['qa_estimate_hours']}h, dev_est {exp['dev_estimate_hours']}h; "
            f"complexity {exp['complexity'].get('level')}.\n"
            f"COMPLEXITY FACTORS (0-3): " + "; ".join(f"{k}={s} ({r})" for k, (s, r) in fac.items()) + "\n"
            f"ACTUAL: bugs {act['bugs_total']} by_sev {act['bugs_by_severity']} by_env {act['bugs_by_env']}; "
            f"QC cycles {act['qc_cycles']} (failed {act['failed_cycles']}); refix {act['movement'].get('refix_count')}; "
            f"reached_bis {act['movement'].get('reached_bis')} days_to_bis {act['movement'].get('days_to_bis')}.\n"
            f"TIME LOGGED: effort {tm['effort_hours']}h (timesheet {tm['timesheet_hours']}h, actual_qa {tm['actual_qa_hours']}h).\n"
            f"QA REQUESTED TOTAL: {requested_hours if requested_hours is not None else 'not stated'}h. "
            f"QA REASON: {reason or 'not provided'}\n"
            f"Rule baseline: total {rule['recommended_total']}h across {[p['phase'] for p in rule['phases']]}."
        )
        ai = llm_client.complete_json(_PHASE_SYS, user, _PHASE_SCHEMA, tool_name="emit", max_tokens=900)
        if ai and isinstance(ai.get("phases"), list) and ai["phases"]:
            phases = [{"phase": p.get("phase"), "recommended_hours": round(_f(p.get("recommended_hours")), 1),
                       "rationale": (p.get("rationale") or "").strip()}
                      for p in ai["phases"] if p.get("phase") in QA_PHASES]
            rec_total = round(_f(ai.get("recommended_total")) or sum(p["recommended_hours"] for p in phases), 1)
            verdict, delta = _verdict_for(requested_hours, rec_total)
            out = {"phases": phases, "recommended_total": rec_total,
                   "requested_hours": requested_hours, "delta": delta,
                   "verdict": ai.get("verdict") or verdict,
                   "summary": (ai.get("summary") or rule["summary"]).strip(),
                   "source": "ai", "logged_hours": _f(tm["effort_hours"])}
    except Exception:
        pass
    return out


# --------------------------------------------------------------------------- planned estimate (at plan time)
def compute_planned_estimate(db, ticket_id, use_ai=True):
    """Claude's planned QA-activity estimate for a ticket, generated at test-plan time. Reuses the
    forward-looking phase engine (data setup / staging+pre / capped live sanity / retest / regression /
    failure buffer). Returns {planned_qa_estimate_hours, planned_qa_breakdown} (breakdown has phases,
    recommended_total, source). Never raises; rule fallback when the LLM is unavailable."""
    try:
        t = db.query(TicketTracking).filter(TicketTracking.ticket_id == ticket_id).first()
    except Exception:
        t = None
    reviewee = (getattr(t, "qc_tester", "") or "").split(",")[0].strip() if t else ""
    sig = get_ticket_review_signals(db, ticket_id, reviewee)
    breakdown = suggest_phase_breakdown(sig, requested_hours=None, reason=None, use_ai=use_ai)
    return {"planned_qa_estimate_hours": breakdown.get("recommended_total"),
            "planned_qa_breakdown": breakdown}


# =========================================================================== QA ESTIMATION (plan-first)
# Plan-first iterative test-effort estimation. The QA member submits the activities + time they expect
# to need; Claude validates each (required?), suggests a balanced time, and applies the manager's rules:
# full testing in staging+pre, high-level only in live, subtract pre-existing AUTOMATED cases (no manual
# effort), and add a FLAT 10% buffer to bug-reporting/retesting/regression. AI on-demand; rule fallback.
ESTIMATION_BUFFER_RATE = 0.10                       # flat 10% buffer (decision)
EXEC_MIN_PER_CASE = 15                              # manual functional execution per case (full pass, per env)
# At REVIEW, time added per bug found (reporting + retesting) + regression per major bug fixed.
# Reporting is now data-driven: when the BIS Bug Reporter logged this ticket's bugs we use the tool's
# REAL measured fill->create time (avg ~1.5-3 min) instead of a hand-filing estimate. The constant below
# is only the FALLBACK for tickets with no tool data (the tool is the standing way to file bugs now).
BUG_REPORT_MIN_PER_BUG = 3           # fallback reporting min/bug when no Bug-Reporter data (was 10, pre-tool)
BUG_REPORT_RATE_MIN_CLAMP = (1.0, 10.0)   # clamp tool-derived reporting rate to a sane min/bug band
BUG_RETEST_MIN_PER_BUG = 12          # retest/verify a fix per bug (was 15)
BUG_REGRESSION_MIN_PER_MAJOR = 30    # regression sweep per major bug fixed
# Activity phases whose hours are reduced when automated cases already exist (no manual effort).
_EXEC_PHASES = ("functional", "pre_staging_regression", "regression_from_breakage")
# Activity phases the 10% buffer applies to (bug reporting / retesting / regression).
_BUFFER_PHASES = ("bug_retest", "pre_staging_regression", "regression_from_breakage")


def parse_activity_plan(text):
    """Parse a pasted QA activity plan into [{activity, environment, hours}].

    Lenient: one activity per line, fields separated by '|' or '-' (em/en dashes too) or tab/multi-space,
    in the order  activity | environment | hours  (environment optional → defaults to 'staging,pre').
    Examples:
      Data generation | staging | 4
      Test case execution - staging,pre - 10
      Regression  pre  3
    """
    out = []
    if not text or not text.strip():
        return out
    for raw in text.splitlines():
        ln = raw.strip()
        if not ln or ln.startswith("#"):
            continue
        parts = [p.strip() for p in re.split(r"\s*[|]\s*|\s+[-–—]\s+|\t+|\s{2,}", ln) if p.strip()]
        if not parts:
            continue
        # find the trailing hours token (last part that looks like a number, possibly with h/hr)
        hours, env, name_parts = None, None, []
        for p in parts:
            hm = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours)?", p, re.I)
            if hm and hours is None and p is parts[-1]:
                hours = round(float(hm.group(1)), 2)
            elif re.fullmatch(r"(?:staging|stg|pre|preprod|pre-prod|live|prod|production|all)(?:\s*[,/&]\s*(?:staging|stg|pre|preprod|live|prod|production))*", p, re.I):
                env = p.lower()
            else:
                name_parts.append(p)
        if hours is None:
            m = re.search(r"(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours)\b", ln, re.I)
            if m:
                hours = round(float(m.group(1)), 2)
        name = " ".join(name_parts).strip() or ln
        out.append({"activity": name, "environment": env or "staging,pre",
                    "hours": hours if hours is not None else 0.0})
    return out


def _classify_activity(name, env=""):
    """Map a free-text activity name (+env) to one of the canonical QA_PHASES."""
    s = f"{name} {env}".lower()
    if any(k in s for k in ("live sanity", "sanity", "high level", "high-level")) or \
            (("live" in s or "prod" in s) and "regress" not in s):
        return "live_sanity"
    if any(k in s for k in ("data", "setup", "db ", "database", "fixture", "seed")):
        return "test_data_db_setup"
    if any(k in s for k in ("breakage", "re-regress", "failed", "rework")):
        return "regression_from_breakage"
    if any(k in s for k in ("bug", "retest", "re-test", "defect", "report")):
        return "bug_retest"
    if "regress" in s:
        return "pre_staging_regression"
    return "functional"


# Execution order: Staging block -> Pre block -> Live; within a block, data setup first, sanity last.
_ENV_ORDER = {"Staging": 0, "Pre": 1, "Live": 2}
_PHASE_ORDER = {"test_data_db_setup": 0, "functional": 1, "pre_staging_regression": 2,
                "bug_retest": 3, "regression_from_breakage": 4, "live_sanity": 5}
_PHASE_LABEL = {"test_data_db_setup": "Data creation / setup", "functional": "Functional testing",
                "pre_staging_regression": "Regression", "bug_retest": "Bug retest",
                "regression_from_breakage": "Regression from breakage", "live_sanity": "Live sanity check"}
# How each phase's hours split across environments (full functional + regression in BOTH staging and pre).
_PHASE_ENV_SPLIT = {
    "test_data_db_setup": {"Staging": 0.6, "Pre": 0.4},
    "functional": {"Staging": 0.5, "Pre": 0.5},
    "pre_staging_regression": {"Staging": 0.5, "Pre": 0.5},
    "bug_retest": {"Staging": 0.4, "Pre": 0.6},
    "regression_from_breakage": {"Pre": 1.0},
    "live_sanity": {"Live": 1.0},
}


def _sort_and_seq(activities):
    """Sort into execution order (Staging->Pre->Live, data setup first) and number the steps."""
    activities.sort(key=lambda a: (_ENV_ORDER.get(a.get("environment"), 9),
                                   _PHASE_ORDER.get(a.get("phase"), 9)))
    for i, a in enumerate(activities, 1):
        a["seq"] = i
    return activities


def _per_env_steps(phases):
    """Split rule phase rows into an ordered per-environment sequence: Staging (data creation ->
    functional -> regression -> retest) -> Pre (same) -> Live (sanity)."""
    steps = []
    for p in phases:
        ph = p.get("phase")
        hrs = _f(p.get("recommended_hours"))
        if hrs <= 0:
            continue
        for env, frac in _PHASE_ENV_SPLIT.get(ph, {"Staging": 1.0}).items():
            h = round(hrs * frac, 1)
            if h <= 0:
                continue
            steps.append({"activity": f"{_PHASE_LABEL.get(ph, ph)} – {env}", "phase": ph,
                          "environment": env, "required": True, "suggested_hours": h,
                          "rationale": p.get("rationale", "")})
    return _sort_and_seq(steps)


def _apply_automation_and_buffer(activities, automated_cases, manual_cases):
    """Deterministic guards applied AFTER validation (so they hold even when the AI ignores them):
    (1) scale execution-type activities by manual/(manual+automated) when known;
    (2) add a flat 10% buffer on bug-reporting/retesting/regression as an explicit line.
    Returns (activities, automation_info, buffer_hours, recommended_total)."""
    ac = int(automated_cases or 0)
    mc = int(manual_cases or 0)
    factor, adjustment = 1.0, 0.0
    if ac > 0 and (ac + mc) > 0:
        factor = mc / float(ac + mc)
        for a in activities:
            if a.get("phase") in _EXEC_PHASES:
                before = _f(a.get("suggested_hours"))
                after = round(before * factor, 1)
                adjustment += round(before - after, 2)
                a["suggested_hours"] = after
                if before != after:
                    a["rationale"] = (a.get("rationale", "") + f" (−{round(before-after,1)}h: {ac} automated case(s) excluded)").strip()
    automation_info = {"automated_cases": ac, "manual_cases": mc,
                       "factor": round(factor, 3), "adjustment_hours": round(adjustment, 1)}
    # Case-count floor: manual functional EXECUTION must reflect the manual case count — a full pass is
    # cases × EXEC_MIN_PER_CASE, run in BOTH staging and pre (regression ≈ half a pass). Applied after
    # automation scaling (the floor IS the manual work, so it isn't reduced again). No-op if count unknown.
    if mc > 0:
        exec_per_env = round(mc * EXEC_MIN_PER_CASE / 60.0, 1)
        note = f"{mc} manual case(s) × {EXEC_MIN_PER_CASE} min"
        for a in activities:
            ph = a.get("phase")
            floor = exec_per_env if ph == "functional" else (round(0.5 * exec_per_env, 1) if ph == "pre_staging_regression" else 0)
            if floor and _f(a.get("suggested_hours")) < floor:
                a["suggested_hours"] = floor
                if "manual case" not in (a.get("rationale") or ""):
                    a["rationale"] = (f"{a.get('rationale', '')} · {note}").strip(" ·")
    buffer_base = sum(_f(a.get("suggested_hours")) for a in activities if a.get("phase") in _BUFFER_PHASES)
    buffer_hours = round(ESTIMATION_BUFFER_RATE * buffer_base, 1)
    recommended_total = round(sum(_f(a.get("suggested_hours")) for a in activities) + buffer_hours, 1)
    return activities, automation_info, buffer_hours, recommended_total


_EST_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["activities", "approach_notes"],
    "properties": {
        "activities": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["activity", "phase", "environment", "required", "suggested_hours", "rationale"],
            "properties": {
                "activity": {"type": "string"},
                "phase": {"type": "string", "enum": list(QA_PHASES)},
                "environment": {"type": "string", "enum": ["Staging", "Pre", "Live"]},
                "required": {"type": "boolean"},
                "suggested_hours": {"type": "number"},
                "rationale": {"type": "string"},
            }}},
        "approach_notes": {"type": "string"},
    },
}

_EST_SYS = (
    "You are a QA manager producing a clear, ORDERED test-execution plan for ONE ticket, BEFORE testing "
    "starts. Output the activities IN EXECUTION ORDER as a per-environment sequence: first the STAGING "
    "block, then the PRE block, then LIVE. Within Staging and within Pre, order them: data creation/setup "
    "→ functional testing → regression → bug retest. LIVE gets only a HIGH-LEVEL sanity check (never a "
    "full live round). Give a SEPARATE step for data creation in Staging AND in Pre. Each activity: a "
    "clear name (e.g. 'Data creation – Staging', 'Functional testing – Pre'), its environment (Staging/"
    "Pre/Live), one phase (test_data_db_setup, functional, pre_staging_regression, bug_retest, "
    "regression_from_breakage, live_sanity), required (true unless not warranted), base MANUAL hours "
    "(do NOT subtract automation, do NOT add buffer — applied separately), and a one-line rationale. "
    "If the tester pasted a proposed plan, read it and judge genuineness — keep their time when fair, "
    "adjust when too strict/lenient. Also give 'approach_notes' (2-4 sentences). Emit via the tool."
)


def suggest_estimation_plan(sig, submitted_activities, automated_cases=None, manual_cases=None,
                            trigger="initial", use_ai=True, cx=None, tester_text=None):
    """Produce a balanced, rule-compliant, ORDERED per-environment test plan (Staging → Pre → Live).
    rule baseline (+ optional AI) → deterministic automation subtraction + flat 10% buffer. Returns
    {activities (ordered, with seq+environment Staging/Pre/Live), approach_notes, automation,
    buffer_hours, recommended_total, submitted_total, verdict, delta, summary, source}. The tester's
    pasted free text (tester_text) is read by the AI to judge genuineness. Fail-soft to rule."""
    if cx is None:
        try:
            cx = TC.get_cached(sig["ticket_id"]) or {}
        except Exception:
            cx = {}
    submitted_activities = submitted_activities or []
    submitted_total = round(sum(_f(a.get("hours")) for a in submitted_activities), 1)
    rule = _rule_phase_breakdown(sig, submitted_total or None, cx=cx)
    activities = _per_env_steps(rule["phases"])
    approach_notes = ("Full functional + regression in staging and pre; high-level sanity only in live. "
                      "Credit genuine bug retest and regression from real breakage; validate test-data setup.")
    source = "rule"

    if use_ai:
        try:
            if llm_client.available():
                exp, act, tm = sig["expected"], sig["actual"], sig["time"]
                fac = {k: (_cx_factor_score(cx, k), _cx_factor_reason(cx, k))
                       for k in ("testing_types", "test_data_effort", "retest_history", "cross_module")}
                sub_txt = "; ".join(f"{a.get('activity')} [{a.get('environment')}] {a.get('hours')}h"
                                    for a in submitted_activities)
                proposal = (tester_text or "").strip() or sub_txt or "none submitted"
                user = (
                    f"TICKET #{sig['ticket_id']} ({sig['module']}) — tester: {sig['reviewee']} — trigger: {trigger}\n"
                    f"EXPECTED: target {exp['target_qa_hours']}h ({exp['target_basis']}); complexity {exp['complexity'].get('level')}.\n"
                    f"COMPLEXITY FACTORS (0-3): " + "; ".join(f"{k}={s} ({r})" for k, (s, r) in fac.items()) + "\n"
                    f"ACTUAL SO FAR: bugs {act['bugs_total']} by_sev {act['bugs_by_severity']}; "
                    f"QC cycles {act['qc_cycles']} (failed {act['failed_cycles']}); refix {act['movement'].get('refix_count')}.\n"
                    f"PRE-EXISTING AUTOMATED CASES: {automated_cases if automated_cases is not None else 'unknown'} "
                    f"(manual {manual_cases if manual_cases is not None else 'unknown'}) — informational; do NOT subtract here.\n"
                    f"TESTER'S PROPOSED PLAN (read verbatim, any format; total {submitted_total or '?'}h):\n{proposal}\n"
                    f"Rule baseline phases: {[(p['phase'], p['recommended_hours']) for p in rule['phases']]}.\n"
                    f"Return the ORDERED per-environment plan (Staging → Pre → Live; data creation first in each)."
                )
                ai = llm_client.complete_json(_EST_SYS, user, _EST_SCHEMA, tool_name="emit", max_tokens=1300)
                if ai and isinstance(ai.get("activities"), list) and ai["activities"]:
                    norm = []
                    for a in ai["activities"]:
                        ph = a.get("phase") if a.get("phase") in QA_PHASES else _classify_activity(a.get("activity", ""))
                        env = (a.get("environment") or "").strip().title()
                        if env not in _ENV_ORDER:
                            env = "Live" if ph == "live_sanity" else "Staging"
                        req = bool(a.get("required", True))
                        norm.append({
                            "activity": (a.get("activity") or "").strip() or f"{_PHASE_LABEL.get(ph, ph)} – {env}",
                            "phase": ph, "environment": env, "required": req,
                            "suggested_hours": round(_f(a.get("suggested_hours")), 1) if req else 0.0,
                            "rationale": (a.get("rationale") or "").strip(),
                        })
                    activities = _sort_and_seq(norm)
                    approach_notes = (ai.get("approach_notes") or approach_notes).strip()
                    source = "ai"
        except Exception:
            pass

    activities, automation_info, buffer_hours, recommended_total = _apply_automation_and_buffer(
        activities, automated_cases, manual_cases)
    verdict, delta = _verdict_for(submitted_total or None, recommended_total)
    if verdict == "justified":
        summary = f"Submitted {submitted_total:g}h is in line with the {recommended_total:g}h the activities justify."
    elif verdict == "partially_justified":
        summary = f"Submitted {submitted_total:g}h is somewhat above the {recommended_total:g}h justified (+{delta:g}h)."
    elif verdict == "over_asked":
        summary = f"Submitted {submitted_total:g}h exceeds the {recommended_total:g}h the activities justify (+{delta:g}h)."
    else:
        summary = f"Activities justify about {recommended_total:g}h of QA time (incl. {buffer_hours:g}h buffer)."
    return {"activities": activities, "approach_notes": approach_notes,
            "automation": automation_info, "buffer_hours": buffer_hours,
            "recommended_total": recommended_total, "submitted_total": submitted_total,
            "verdict": verdict, "delta": delta, "summary": summary, "source": source}


# --------------------------------------------------------------------------- review recalculation (post-delivery)
_RECALC_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["allowed_total", "verdict", "summary"],
    "properties": {
        "allowed_total": {"type": "number"},
        "verdict": {"type": "string", "enum": ["within_allowed", "slight_overrun", "over_allowed"]},
        "summary": {"type": "string"},
    },
}

_RECALC_SYS = (
    "You are a QA manager deciding the FAIR ALLOWED time for a finished ticket, given (a) the time PLANNED, "
    "(b) the ACTUAL time the tester logged, (c) the tester's COMMENTS, and (d) the BUG-HANDLING time the bugs "
    "found justify (reporting + retesting per bug, plus regression for major-bug fixes). ALWAYS add the "
    "bug-handling time on top of the plan. Then move the allowance toward ACTUAL when an overrun is genuinely "
    "justified (real scope growth, failed QC cycles, blockers in the comments); keep it near PLANNED+bug-time "
    "otherwise. Never exceed ~2x the plan plus bug-handling. Return allowed_total (hours), a verdict comparing "
    "actual vs allowed (within_allowed / slight_overrun / over_allowed), and a 1-2 sentence summary. Emit via the tool."
)


def suggest_review_recalc(sig, planned_total, actual_hours, qa_comments=None, use_ai=True, bugrep=None):
    """At review time, recommend the ALLOWED QA time by weighing PLANNED + ACTUAL + the tester's COMMENTS
    (plus real bug/cycle signals). Returns {allowed_total, verdict, summary, planned_total, actual_hours,
    source}. AI on-demand with a deterministic rule fallback; never raises.

    `bugrep` (optional) is the BIS Bug-Reporter rollup for THIS ticket
    ({bugs, avg_tool_minutes, saved_minutes, testrail_coupled, reporters}). When it carries a measured
    avg tool time, the per-bug REPORTING allowance uses that real rate instead of the pre-tool fallback —
    i.e. the tool's efficiency tightens the allowed time."""
    planned = _f(planned_total)
    actual = _f(actual_hours)
    act = sig.get("actual") or {}
    bugs = int(act.get("bugs_total", 0) or 0)
    major = int((act.get("bugs_by_severity") or {}).get("major", 0) or 0)
    failed = int(act.get("failed_cycles", 0) or 0)
    has_just = bool((qa_comments or "").strip()) or bugs > 0 or failed > 0
    # Reporting rate: real measured tool time when the Bug Reporter logged this ticket's bugs, else fallback.
    report_rate = float(BUG_REPORT_MIN_PER_BUG)
    report_basis = "fallback"
    if bugrep and bugrep.get("avg_tool_minutes"):
        lo, hi = BUG_REPORT_RATE_MIN_CLAMP
        report_rate = min(hi, max(lo, _f(bugrep.get("avg_tool_minutes"))))
        report_basis = "tool_measured"
    # Bug-driven time to ADD at review: reporting + retesting per bug, regression per major bug.
    bug_report = round(bugs * report_rate / 60.0, 1)
    bug_retest = round(bugs * BUG_RETEST_MIN_PER_BUG / 60.0, 1)
    bug_regression = round(major * BUG_REGRESSION_MIN_PER_MAJOR / 60.0, 1)
    bug_addition = round(bug_report + bug_retest + bug_regression, 1)
    bug_time = {"reporting": bug_report, "retest": bug_retest, "regression": bug_regression,
                "total": bug_addition, "bugs": bugs, "major": major,
                "report_rate_min": round(report_rate, 1), "report_basis": report_basis,
                "tool_bugs": int((bugrep or {}).get("bugs", 0) or 0),
                "tool_saved_minutes": round(_f((bugrep or {}).get("saved_minutes", 0)), 1)}
    base = planned if planned > 0 else actual
    if base <= 0:
        base = actual or 1.0
    # Planned time + the bug-handling time the bugs justify, then allow toward actual if comments justify.
    allowed = round(base + bug_addition, 1)
    if actual > allowed and has_just:
        allowed = round(min(actual, base * 2.0 + bug_addition), 1)
    allowed = round(allowed, 1)

    def _verdict(allowed_v):
        band = max(1.0, 0.10 * allowed_v)
        if actual <= allowed_v + band:
            return "within_allowed", f"Actual {actual:g}h is within the {allowed_v:g}h allowed."
        if actual <= allowed_v * 1.3:
            return "slight_overrun", f"Actual {actual:g}h slightly exceeds the {allowed_v:g}h allowed."
        return "over_allowed", f"Actual {actual:g}h exceeds the {allowed_v:g}h allowed (+{round(actual-allowed_v,1):g}h)."

    verdict, summary = _verdict(allowed)
    if bug_addition > 0:
        _rep_note = (f"reporting {bug_report:g}h @ {round(report_rate,1):g}min/bug"
                     + (" (Bug Reporter measured)" if report_basis == "tool_measured" else ""))
        summary += (f" Includes +{bug_addition:g}h for {bugs} bug(s): {_rep_note}, "
                    f"retest {bug_retest:g}h, regression {bug_regression:g}h.")
    out = {"allowed_total": allowed, "verdict": verdict, "summary": summary,
           "planned_total": planned, "actual_hours": actual, "bug_time": bug_time, "source": "rule"}
    if not use_ai:
        return out
    try:
        if llm_client.available():
            exp = sig.get("expected") or {}
            user = (
                f"TICKET #{sig.get('ticket_id')} ({sig.get('module')}) — tester: {sig.get('reviewee')}\n"
                f"PLANNED: {planned}h (complexity {exp.get('complexity', {}).get('level')}, "
                f"target {exp.get('target_qa_hours')}h).\n"
                f"ACTUAL LOGGED: {actual}h.\n"
                f"SIGNALS: bugs {bugs} ({major} major) by_sev {act.get('bugs_by_severity')}; QC cycles {act.get('qc_cycles')} "
                f"(failed {failed}); refix {act.get('movement', {}).get('refix_count')}.\n"
                f"BUG-HANDLING TIME TO ADD (reporting+retest per bug, regression per major): "
                f"reporting {bug_report}h (@ {round(report_rate,1)}min/bug, basis={report_basis}) "
                f"+ retest {bug_retest}h + regression {bug_regression}h = {bug_addition}h.\n"
                f"NOTE: bug reporting is now done via the BIS Bug Reporter tool, so reporting time is small — "
                f"do not inflate it; keep allowed time tight.\n"
                f"TESTER COMMENTS: {qa_comments or 'none provided'}\n"
                f"Rule baseline allowed (planned + bug-handling): {allowed}h."
            )
            ai = llm_client.complete_json(_RECALC_SYS, user, _RECALC_SCHEMA, tool_name="emit", max_tokens=500)
            if ai and ai.get("allowed_total") is not None:
                a_total = round(_f(ai.get("allowed_total")), 1)
                v, s = _verdict(a_total)
                out = {"allowed_total": a_total, "verdict": ai.get("verdict") or v,
                       "summary": (ai.get("summary") or s).strip(),
                       "planned_total": planned, "actual_hours": actual, "bug_time": bug_time, "source": "ai"}
    except Exception:
        pass
    return out


# --------------------------------------------------------------------------- review allocation (per-activity allowed)
_ALLOC_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["activities", "allowed_total", "summary"],
    "properties": {
        "activities": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["activity", "actual_hours", "allowed_hours"],
            "properties": {
                "activity": {"type": "string"},
                "actual_hours": {"type": "number"},
                "allowed_hours": {"type": "number"},
                "rationale": {"type": "string"},
            }}},
        "allowed_total": {"type": "number"},
        "verdict": {"type": "string", "enum": ["within_allowed", "slight_overrun", "over_allowed"]},
        "summary": {"type": "string"},
    },
}

_ALLOC_SYS = (
    "You are a QA manager reviewing a tester's RAW activity-and-time log for a finished ticket. "
    "First PARSE the raw text into discrete QA activities, each with the ACTUAL hours the tester spent "
    "(convert any minutes to hours; merge obvious duplicates; ignore non-activity chatter). Then for EACH "
    "activity decide the MAXIMUM ALLOWABLE QA time — the time a competent tester should reasonably need — "
    "considering the planned baseline, the ticket complexity/target, and that bug REPORTING is done via the "
    "BIS Bug Reporter so reporting time must stay tight. allowed_hours may be at, below, or modestly above "
    "actual; do NOT rubber-stamp inflated entries, and never exceed ~1.5x an activity's fair time. Give a "
    "short rationale per activity. allowed_total = the sum of allowed_hours (round to 0.1). Also return a "
    "verdict comparing the tester's total actual vs allowed and a 1-2 sentence summary. Emit via the tool."
)

_ALLOC_UNIT_RE = re.compile(r'(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b', re.I)
_ALLOC_BARE_RE = re.compile(r'(\d+(?:\.\d+)?)')


def _line_hours(text):
    """Return (hours, time_token_start) for one line. Prefers numbers that carry an explicit time unit
    (summing composites like '1h 15m'); only falls back to a bare trailing number — as hours — when no
    unit is present, so counts like '(8 bugs)' aren't mistaken for time."""
    units = list(_ALLOC_UNIT_RE.finditer(text))
    if units:
        total = 0.0
        for m in units:
            v = float(m.group(1))
            total += v / 60.0 if m.group(2).lower().startswith("m") else v
        return round(total, 2), units[0].start()
    bares = list(_ALLOC_BARE_RE.finditer(text))
    if bares:
        return round(float(bares[-1].group(1)), 2), bares[-1].start()
    return None, None


def _parse_activity_lines(raw):
    """Best-effort parse of a pasted 'activity — time' log into [(label, hours)]. Fallback when AI is off."""
    out = []
    for line in (raw or "").splitlines():
        line = line.strip().lstrip("-•*0123456789.) \t")
        if not line:
            continue
        hours, start = _line_hours(line)
        if not hours or hours <= 0:
            continue
        label = line[:start].strip(" :-–—\t") or line.strip()
        out.append((label, round(hours, 2)))
    return out


def _split_cells(line):
    """Split a pasted table row into cells: tabs if present, else runs of 2+ spaces."""
    cells = line.split("\t") if "\t" in line else re.split(r"\s{2,}", line.strip())
    return [c.strip() for c in cells]


def _parse_activity_table(raw):
    """Parse a pasted TABLE (a header row with Activity + Hours columns, e.g. copied from Excel) into
    [{activity, actual_hours, allowed_hours, rationale}]. The Hours column is read explicitly so a number
    buried in a description ('8 reported bugs') is never mistaken for the time. None if not a table."""
    lines = [l for l in (raw or "").splitlines() if l.strip()]
    header = h_idx = None
    for i, l in enumerate(lines[:4]):
        cells = [c.lower() for c in _split_cells(l)]
        if len(cells) >= 2 and any(("hour" in c or c == "time" or "time)" in c) for c in cells) \
                and any(("activ" in c or "task" in c or "why" in c or "descr" in c) for c in cells):
            header, h_idx = cells, i
            break
    if header is None:
        return None

    def col(*names):
        for j, c in enumerate(header):
            if any(n in c for n in names):
                return j
        return None

    a_col, h_col = col("activ", "task"), col("hour", "time")
    e_col, w_col = col("environ", "env"), col("why", "descr", "rationale", "note", "comment")
    if a_col is None or h_col is None:
        return None
    rows = []
    for l in lines[h_idx + 1:]:
        cells = _split_cells(l)
        if len(cells) <= max(a_col, h_col):
            continue
        hrs, _ = _line_hours(cells[h_col])
        if not hrs or hrs <= 0:
            continue
        label = cells[a_col].strip()
        if e_col is not None and e_col < len(cells):
            env = cells[e_col].strip()
            if env and env.lower() not in label.lower():
                label = f"{label} – {env}"
        rationale = cells[w_col].strip() if (w_col is not None and w_col < len(cells)) else ""
        rows.append({"activity": label or "Activity", "actual_hours": round(hrs, 2),
                     "allowed_hours": round(hrs, 1), "rationale": rationale or "as logged"})
    return rows or None


def suggest_review_allocation(sig, planned_total, raw_text, qa_comments=None, use_ai=True, bugrep=None):
    """Parse a tester's RAW activity+time log and return a per-activity MAX-ALLOWED allocation:
    {activities:[{activity,actual_hours,allowed_hours,rationale}], actual_total, allowed_total, verdict,
    summary, planned_total, source}. AI-first with a regex fallback; never raises."""
    planned = _f(planned_total)
    exp = sig.get("expected") or {}
    act = sig.get("actual") or {}
    bugs = int(act.get("bugs_total", 0) or 0)

    def _verdict(actual_v, allowed_v):
        band = max(1.0, 0.10 * allowed_v)
        if actual_v <= allowed_v + band:
            return "within_allowed", f"Actual {actual_v:g}h is within the {allowed_v:g}h allowed."
        if actual_v <= allowed_v * 1.3:
            return "slight_overrun", f"Actual {actual_v:g}h slightly exceeds the {allowed_v:g}h allowed."
        return "over_allowed", f"Actual {actual_v:g}h exceeds the {allowed_v:g}h allowed (+{round(actual_v-allowed_v,1):g}h)."

    # deterministic fallback: a pasted table (Excel columns incl. Hours) first, else line-by-line.
    activities = _parse_activity_table(raw_text)
    if not activities:
        parsed = _parse_activity_lines(raw_text)
        activities = [{"activity": lbl, "actual_hours": hrs, "allowed_hours": round(hrs, 1),
                       "rationale": "as logged"} for lbl, hrs in parsed]
    actual_total = round(sum(a["actual_hours"] for a in activities), 1)
    allowed_total = round(sum(a["allowed_hours"] for a in activities), 1)
    verdict, summary = (_verdict(actual_total, allowed_total) if activities
                        else ("within_allowed", "No activities could be parsed from the text."))
    out = {"activities": activities, "actual_total": actual_total, "allowed_total": allowed_total,
           "verdict": verdict, "summary": summary, "planned_total": planned, "source": "rule"}
    if not use_ai or not (raw_text or "").strip():
        return out
    try:
        if llm_client.available():
            user = (
                f"TICKET #{sig.get('ticket_id')} ({sig.get('module')}) — tester: {sig.get('reviewee')}\n"
                f"PLANNED QA: {planned}h (complexity {exp.get('complexity', {}).get('level')}, "
                f"target {exp.get('target_qa_hours')}h).\n"
                f"SIGNALS: bugs {bugs}; QC cycles {act.get('qc_cycles')} (failed {act.get('failed_cycles')}).\n"
                f"NOTE: bug reporting uses the BIS Bug Reporter — keep reporting time tight.\n"
                + (f"TESTER NOTE: {qa_comments}\n" if (qa_comments or "").strip() else "")
                + f"RAW ACTIVITY + TIME LOG (parse this):\n{raw_text.strip()}\n"
            )
            ai = llm_client.complete_json(_ALLOC_SYS, user, _ALLOC_SCHEMA, tool_name="emit", max_tokens=1100)
            if ai and ai.get("activities"):
                acts = []
                for a in ai["activities"]:
                    acts.append({"activity": (a.get("activity") or "").strip() or "Activity",
                                 "actual_hours": round(_f(a.get("actual_hours")), 2),
                                 "allowed_hours": round(_f(a.get("allowed_hours")), 2),
                                 "rationale": (a.get("rationale") or "").strip()})
                a_tot = round(sum(x["actual_hours"] for x in acts), 1)
                l_tot = (round(_f(ai.get("allowed_total")), 1) if ai.get("allowed_total") is not None
                         else round(sum(x["allowed_hours"] for x in acts), 1))
                v, s = _verdict(a_tot, l_tot)
                out = {"activities": acts, "actual_total": a_tot, "allowed_total": l_tot,
                       "verdict": ai.get("verdict") or v, "summary": (ai.get("summary") or s).strip(),
                       "planned_total": planned, "source": "ai"}
    except Exception:
        pass
    return out


# --------------------------------------------------------------------------- scoring helpers (leaderboard)
def complexity_multiplier(level):
    return {"High": 1.4, "Medium": 1.0, "Low": 0.7}.get(level, 1.0)


def diligence_points(sig):
    """Per-ticket diligence delta (start from 100 elsewhere) + human lines. Legit parking => no penalty."""
    d = sig["diligence"]
    delta, lines = 0, []
    if d["escaped_defect_live"]:
        pen = min(40 * d["escaped_count"], 60)
        delta -= pen
        lines.append(f"escaped Live defect (−{pen})")
    if d["idle_hold"]:
        delta -= 15
        lines.append("idle hold (−15)")
    if d["trivial_fail"]:
        delta -= 10
        lines.append("failed for minor bug (−10)")
    if d["legit_parking"]:
        lines.append("legit parking (no penalty)")
    if not lines and sig["actual"]["first_pass"]:
        delta += 5
        lines.append("clean first-pass (+5)")
    return delta, lines
