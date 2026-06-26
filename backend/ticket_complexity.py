"""QA Ticket Complexity — an explainable High / Medium / Low rating for how hard a ticket is to TEST.

Hybrid scorer: ten factors, each scored 0-3 from a concrete signal, weighted and rolled up to a 0-100
score that bands into High / Medium / Low. Four qualitative factors (scope, cross-module integration,
testing types, test-data effort) can be sharpened by an AI pass that READS the scope / release note /
PR file list — but every factor has a deterministic fallback, so the engine works fully offline (no
ANTHROPIC_API_KEY). Results cache to data/ticket_complexity.json with a TTL (mirrors doc_confidence).

This is SEPARATE from main._ticket_complexity() (a depth-of-effort weight for leaderboards).
Nothing here ever raises — callers get a populated rating or a cached/UNKNOWN one.
"""
import os
import re
import json
import time

import doc_confidence as DC
import llm_client

_HERE = os.path.dirname(__file__)
_CACHE_FILE = os.path.join(_HERE, "data", "ticket_complexity.json")
_OVERRIDE_FILE = os.path.join(_HERE, "data", "complexity_override.json")
_MODULE_FILE = os.path.join(_HERE, "data", "module_ownership.json")
_TTL_SECONDS = int(os.environ.get("COMPLEXITY_TTL", str(3 * 24 * 3600)))
_BAND_HIGH = int(os.environ.get("COMPLEXITY_BAND_HIGH", "60"))
_BAND_MED = int(os.environ.get("COMPLEXITY_BAND_MED", "35"))

LEVELS = ("Low", "Medium", "High")

# Factor key -> (display label, weight, is-LLM-capable). Weights sum to 100.
FACTORS = [
    ("scope",            "Scope size & clarity",        12, True),
    ("release_note",     "Release-note confidence",     10, False),
    ("pr_breadth",       "PR breadth",                  12, False),
    ("cross_module",     "Cross-module integration",    14, True),
    ("impact",           "Impact / criticality",        12, False),
    ("testing_types",    "Testing types needed",        12, True),
    ("test_data_effort", "Test-data effort (envs)",     10, True),
    ("retest_history",   "Retest / refix history",      10, False),
    ("test_case_volume", "Test-case volume",             4, False),
    ("effort_hours",     "Estimated effort",             4, False),
]
_WEIGHT = {k: w for k, _l, w, _ in FACTORS}
_LABEL = {k: l for k, l, _w, _ in FACTORS}
_LLM_FACTORS = [k for k, _l, _w, is_llm in FACTORS if is_llm]

# Keyword banks for the deterministic fallback of the qualitative factors.
_TYPE_BANK = {
    "api/integration": ("api", "integration", "endpoint", "webhook", "sync", "third party", "third-party", "interface"),
    "performance":     ("performance", "load", "concurrent", "scalab", "timeout", "large data", "bulk"),
    "security/access": ("permission", "role", "access control", "security", "auth", "privilege", "restrict"),
    "data/migration":  ("migration", "migrate", "backfill", "import", "data fix", "script", "sql"),
    "notification":    ("email", "notification", "reminder", "alert", "sms"),
}
_DATA_BANK = {
    "accounts/orgs":   ("account", "organisation", "organization", "company", "tenant", "client"),
    "courses/training":("course", "enrol", "enroll", "training", "curriculum", "lesson", "module"),
    "billing":         ("billing", "payment", "invoice", "subscription", "purchase", "e-commerce", "ecommerce", "checkout"),
    "assessment":      ("certificate", "assessment", "exam", "quiz", "grade"),
    "roles/perms":     ("role", "permission", "group", "user type"),
    "bulk/import":     ("import", "bulk", "upload", "csv", "spreadsheet"),
}
_ENV_HINTS = ("staging", "pre-live", "pre live", "preprod", "pre-prod", "production", "live environment",
              "multiple environment", "across environment", "each environment")


# --------------------------------------------------------------------------- cache (mirror doc_confidence)
def _load_cache():
    try:
        with open(_CACHE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_cache(cache):
    # Atomic write (temp + os.replace) so a concurrent/interrupted write can never truncate the file
    # and leave _load_cache returning {} — which previously wiped the whole cache to a tiny rebuild.
    try:
        os.makedirs(os.path.dirname(_CACHE_FILE), exist_ok=True)
        tmp = f"{_CACHE_FILE}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cache, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, _CACHE_FILE)
    except Exception:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except Exception:
            pass


def _put_cache_entry(key, entry):
    """Concurrency-tolerant single-key write: reload latest, merge just this key, save."""
    cache = _load_cache()
    cache[key] = entry
    _save_cache(cache)
    return entry


def get_cached(ticket_id):
    """Cached entry (any age), no network — for the queue hot path. None if absent."""
    return _load_cache().get(str(ticket_id))


# --------------------------------------------------------------------------- manual override store
def load_overrides():
    try:
        with open(_OVERRIDE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def get_override(ticket_id):
    return load_overrides().get(str(ticket_id))


def set_override(ticket_id, level, by=None, note=None):
    if level not in LEVELS:
        raise ValueError("level must be one of " + ", ".join(LEVELS))
    ov = load_overrides()
    ov[str(ticket_id)] = {"level": level, "by": by, "note": note, "at": time.time()}
    try:
        os.makedirs(os.path.dirname(_OVERRIDE_FILE), exist_ok=True)
        with open(_OVERRIDE_FILE, "w", encoding="utf-8") as f:
            json.dump(ov, f)
    except Exception:
        pass
    return ov[str(ticket_id)]


def clear_override(ticket_id):
    ov = load_overrides()
    removed = ov.pop(str(ticket_id), None)
    if removed is not None:
        try:
            with open(_OVERRIDE_FILE, "w", encoding="utf-8") as f:
                json.dump(ov, f)
        except Exception:
            pass
    return removed


# --------------------------------------------------------------------------- module map
_MODULE_KW = None


def _module_keywords():
    """{module_name: [keyword, ...]} from module_ownership.testrail_mapping (+ the name itself)."""
    global _MODULE_KW
    if _MODULE_KW is not None:
        return _MODULE_KW
    out = {}
    try:
        cfg = json.load(open(_MODULE_FILE, encoding="utf-8"))
        for mod, meta in (cfg.get("testrail_mapping") or {}).items():
            kws = set(k.lower() for k in (meta.get("keywords") or []) if k)
            kws.add(mod.lower())
            out[mod] = [k for k in kws if len(k) >= 3]
        for mod in (cfg.get("main_modules") or []):
            out.setdefault(mod, [mod.lower()])
    except Exception:
        pass
    _MODULE_KW = out
    return out


# --------------------------------------------------------------------------- signal gathering
def _strip(s):
    return DC._strip_html(s or "")  # unescaped, tags removed, lowercased


def _plain(s, limit=4000):
    """Human-readable plain text (tags stripped, case preserved) for the LLM prompt."""
    import html as _html
    txt = _html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt[:limit]


def _pm_str(v):
    """PM API fields like priority/type can be plain strings OR objects ({Name:...}); normalize to str."""
    if isinstance(v, dict):
        for k in ("Name", "name", "Value", "value", "Label", "label", "title"):
            if v.get(k):
                return str(v[k])
        return ""
    return str(v) if v is not None else ""


def _gather_signals(ticket_id, queue_ticket=None):
    qt = queue_ticket or {}
    ticket = DC._fetch_ticket(ticket_id) or {}
    title = _pm_str(qt.get("title")) or _pm_str(ticket.get("title"))
    desc_raw = ticket.get("description") or ""
    module = (qt.get("module") or _pm_str(ticket.get("subdepartment")) or "").strip() or "Unassigned"

    pr_url = DC.detect_pr(ticket)
    rn_html = DC.detect_release_note(ticket)
    pr_files = DC._pr_files(pr_url) if pr_url else []
    func_files = [p for p in pr_files if DC._is_functional(p)]

    # doc-confidence flag (prefer the value already on the queue ticket, else the cache).
    dc = DC.get_cached(ticket_id) or {}
    flag = qt.get("doc_confidence") or dc.get("flag")
    thin = qt.get("doc_rn_thin_tier") or dc.get("rn_thin_tier")

    scope_text = (title + ". " + _plain(desc_raw)).strip()
    return {
        "ticket_id": ticket_id,
        "title": title,
        "module": module,
        "scope_text": scope_text,
        "scope_low": _strip(title + " " + desc_raw),
        "desc_len": len(_plain(desc_raw, limit=10000)),
        "rn_text": _plain(rn_html, limit=2000) if rn_html else "",
        "doc_flag": flag,
        "doc_thin": thin,
        "pr_url": pr_url,
        "func_files": func_files,
        "platform": _pm_str(qt.get("platform") or ticket.get("platform")) or "Web",
        "priority": qt.get("priority") or _pm_str(ticket.get("priority")),
        "ticket_type": qt.get("ticket_type") or _pm_str(ticket.get("type")),
        "test_cases": int(qt.get("test_cases") or 0),
        "bugs_open": int(qt.get("bugs_open") or 0),
        "bugs_total": int(qt.get("bugs_total") or 0),
        "retest_cycle_count": int(qt.get("retest_cycle_count") or 0),
        "is_retesting": bool(qt.get("is_retesting")),
        "qa_estimate_hours": qt.get("qa_estimate_hours"),
        "dev_estimate_hours": qt.get("dev_estimate_hours"),
    }


def _infer_cross_module(sig):
    """Distinct modules (other than the ticket's own) implied by PR file paths + scope text."""
    own = (sig["module"] or "").lower()
    hay_paths = " ".join(sig["func_files"]).lower()
    hay_scope = sig["scope_low"]
    hit = set()
    for mod, kws in _module_keywords().items():
        if mod.lower() == own:
            continue
        for kw in kws:
            if kw in hay_paths or (len(kw) >= 5 and kw in hay_scope):
                hit.add(mod)
                break
    return sorted(hit)


# --------------------------------------------------------------------------- deterministic factors
def _band_count(n, b1, b2, b3):
    return 0 if n < b1 else 1 if n < b2 else 2 if n < b3 else 3


def _f(score, reason, source="rule"):
    return {"score": int(max(0, min(3, score))), "reason": reason, "source": source}


def _priority_score(priority, ticket_type, bugs_open):
    p = (priority or "").lower()
    if "urgent" in p or "critical" in p or "blocker" in p:
        s = 3
    elif "high" in p or "epic" in p:
        s = 2
    elif "medium" in p:
        s = 1
    elif p:
        s = 0
    else:
        s = 1
    if "bug" in (ticket_type or "").lower() and bugs_open > 0:
        s = max(s, 2)
    return s


def _count_bank(hay, bank):
    return [name for name, kws in bank.items() if any(k in hay for k in kws)]


def _rule_factors(sig):
    f = {}
    # 1 scope
    s = _band_count(sig["desc_len"], 300, 900, 2200)
    f["scope"] = _f(s, f"Description ~{sig['desc_len']} chars" + ("; very brief" if s == 0 else "; sizable scope" if s >= 2 else ""))
    # 2 release_note
    flag = sig["doc_flag"]
    rn_map = {"ALIGNED": 0, "RN_REVIEW": 1, "PR_NO_RN": 2, "RN_NO_PR": 2, "THIN_RN": 3, "NO_PR_NO_RN": 3}
    s = rn_map.get(flag, 1)
    f["release_note"] = _f(s, f"Doc-confidence: {flag or 'unknown'}")
    # 3 pr_breadth
    n = len(sig["func_files"])
    s = _band_count(n, 1, 4, 11)
    f["pr_breadth"] = _f(s, (f"{n} functional file(s) changed" if sig["pr_url"] else "No PR detected"))
    # 4 cross_module
    mods = _infer_cross_module(sig)
    s = _band_count(len(mods), 1, 2, 3)
    f["cross_module"] = _f(s, ("Touches " + ", ".join(mods)) if mods else "No other modules implied")
    # 5 impact
    s = _priority_score(sig["priority"], sig["ticket_type"], sig["bugs_open"])
    f["impact"] = _f(s, f"Priority '{sig['priority'] or 'n/a'}'" + (f", {sig['bugs_open']} open bug(s)" if sig["bugs_open"] else ""))
    # 6 testing_types
    types = _count_bank(sig["scope_low"], _TYPE_BANK)
    base = min(3, len(types))
    if (sig["platform"] or "").lower() == "mobile":
        base = max(base, 1)
    f["testing_types"] = _f(base, ("Beyond functional: " + ", ".join(types)) if types else "Functional testing")
    # 7 test_data_effort
    data = _count_bank(sig["scope_low"], _DATA_BANK)
    multi_env = any(h in sig["scope_low"] for h in _ENV_HINTS)
    s = min(3, len(data) + (1 if multi_env else 0))
    f["test_data_effort"] = _f(s, ((", ".join(data) or "minimal data") + ("; multi-env" if multi_env else "")))
    # 8 retest_history
    cyc, bo = sig["retest_cycle_count"], sig["bugs_open"]
    s = 0
    if cyc >= 3 or bo > 5:
        s = 3
    elif cyc == 2 or bo >= 3:
        s = 2
    elif cyc == 1 or bo >= 1 or sig["is_retesting"]:
        s = 1
    f["retest_history"] = _f(s, f"{cyc} retest cycle(s)" + (f", {bo} open bug(s)" if bo else ""))
    # 9 test_case_volume
    tc = sig["test_cases"]
    s = _band_count(tc, 11, 31, 61)
    f["test_case_volume"] = _f(s, f"{tc} test case(s)")
    # 10 effort_hours
    hrs = sig["qa_estimate_hours"] or sig["dev_estimate_hours"] or 0
    try:
        hrs = float(hrs)
    except (TypeError, ValueError):
        hrs = 0.0
    s = _band_count(hrs, 5, 13, 25)
    f["effort_hours"] = _f(s, f"~{hrs:g}h estimated")
    return f


# --------------------------------------------------------------------------- LLM factors
_LLM_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["factors", "overall_level", "rationale"],
    "properties": {
        "factors": {
            "type": "object",
            "additionalProperties": False,
            "required": _LLM_FACTORS,
            "properties": {k: {
                "type": "object", "additionalProperties": False,
                "required": ["score", "reason"],
                "properties": {"score": {"type": "integer", "minimum": 0, "maximum": 3},
                               "reason": {"type": "string"}},
            } for k in _LLM_FACTORS},
        },
        "overall_level": {"type": "string", "enum": list(LEVELS)},
        "rationale": {"type": "string"},
    },
}

_SYS = (
    "You are a senior QA lead rating how COMPLEX a software ticket is to TEST (not to build). "
    "Rate strictly from the evidence given. Score each factor 0-3 (0=trivial, 3=very complex):\n"
    "- scope: size/ambiguity of what must be verified from the scope text.\n"
    "- cross_module: how much this work integrates with OTHER modules (ripple/regression surface).\n"
    "- testing_types: breadth of testing needed (functional, regression, API/integration, "
    "cross-platform Web+Mobile, performance, security/permissions, non-functional).\n"
    "- test_data_effort: effort to build the test data/preconditions across environments "
    "(accounts, roles, courses, billing states, Staging/Pre/Live).\n"
    "Emit via the emit tool only. Keep each reason to one short sentence."
)


def _llm_factors(sig):
    if not llm_client.available():
        return None
    mods = _infer_cross_module(sig)
    user = (
        f"TICKET #{sig['ticket_id']} — module: {sig['module']} | platform: {sig['platform']} | "
        f"priority: {sig['priority'] or 'n/a'} | type: {sig['ticket_type'] or 'n/a'}\n\n"
        f"SCOPE:\n{sig['scope_text'] or '(none)'}\n\n"
        f"RELEASE NOTE:\n{sig['rn_text'] or '(none)'}\n\n"
        f"PR FUNCTIONAL FILES ({len(sig['func_files'])}):\n" + ("\n".join(sig['func_files'][:60]) or "(none)") + "\n\n"
        f"MODULES IMPLIED BY PR/SCOPE (besides {sig['module']}): {', '.join(mods) or '(none)'}\n"
        f"STRUCTURED SIGNALS: test_cases={sig['test_cases']}, open_bugs={sig['bugs_open']}, "
        f"retest_cycles={sig['retest_cycle_count']}, doc_confidence={sig['doc_flag'] or 'unknown'}"
    )
    system = [{"type": "text", "text": _SYS, "cache_control": {"type": "ephemeral"}}]
    return llm_client.complete_json(system, user, _LLM_SCHEMA, tool_name="emit", max_tokens=1200)


def _blend(rule, llm):
    """For the four LLM-capable factors, nudge the rule score toward the LLM score but clamp to ±1
    (grounded: the model refines, it doesn't override). Other factors stay rule-only."""
    out = dict(rule)
    if not llm:
        return out, None, None
    lf = llm.get("factors") or {}
    for k in _LLM_FACTORS:
        item = lf.get(k) or {}
        if "score" not in item:
            continue
        base = rule[k]["score"]
        clamped = max(base - 1, min(base + 1, int(item["score"])))
        out[k] = {"score": int(max(0, min(3, clamped))),
                  "reason": (item.get("reason") or rule[k]["reason"])[:240],
                  "source": "blended" if clamped == base else "llm"}
    return out, llm.get("overall_level"), (llm.get("rationale") or None)


# --------------------------------------------------------------------------- rollup
def _rollup(factors):
    score = sum((factors[k]["score"] / 3.0) * _WEIGHT[k] for k in _WEIGHT)
    score = round(score)
    level = "High" if score >= _BAND_HIGH else "Medium" if score >= _BAND_MED else "Low"
    # Hard escalations — a single severe factor can lift the band regardless of the weighted total.
    esc = []
    if factors["cross_module"]["score"] == 3:
        esc.append("Cross-module: " + factors["cross_module"]["reason"])
    if factors["impact"]["score"] == 3:
        esc.append("High impact: " + factors["impact"]["reason"])
    if factors["release_note"]["score"] == 3:
        esc.append("Weak docs: " + factors["release_note"]["reason"])
    if factors["retest_history"]["score"] == 3:
        esc.append("Repeated refixes: " + factors["retest_history"]["reason"])
    if len(esc) >= 2:
        level = "High"
    elif esc and level == "Low":
        level = "Medium"
    return score, level, esc


def _rationale_fallback(factors, level):
    top = sorted(factors.items(), key=lambda kv: -kv[1]["score"])[:3]
    bits = "; ".join(f"{_LABEL[k]} ({v['score']}/3)" for k, v in top if v["score"] > 0)
    return f"{level} complexity — driven by {bits}." if bits else f"{level} complexity — limited signals."


# --------------------------------------------------------------------------- public API
def compute(ticket_id, queue_ticket=None, use_llm=True, force=False):
    """Compute (and cache) the complexity rating for one ticket. TTL-cached; a fresh LLM-mode entry is
    preferred over a rule-mode one. Returns the entry dict. Never raises."""
    key = str(ticket_id)
    try:
        cache = _load_cache()
        hit = cache.get(key)
        want_llm = bool(use_llm and llm_client.available())
        if hit and not force:
            fresh = (time.time() - hit.get("computed_on", 0)) < _TTL_SECONDS
            # A rule pass must not clobber a fresh LLM entry; refresh its timestamp and keep it.
            if fresh and (hit.get("engine_mode") == "llm" or not want_llm):
                return hit
            if not want_llm and hit.get("engine_mode") == "llm":
                hit["computed_on"] = time.time()
                return _put_cache_entry(key, hit)

        sig = _gather_signals(ticket_id, queue_ticket)
        rule = _rule_factors(sig)
        llm = _llm_factors(sig) if want_llm else None
        factors, llm_level, rationale = _blend(rule, llm)
        score, level, esc = _rollup(factors)
        if not rationale:
            rationale = _rationale_fallback(factors, level)
        entry = {
            "level": level, "score": score,
            "factors": {k: {**factors[k], "label": _LABEL[k], "weight": _WEIGHT[k]} for k in _WEIGHT},
            "escalations": esc, "rationale": rationale,
            "engine_mode": "llm" if llm else "rule",
            "model": llm_client.model_name() if llm else None,
            "module": sig["module"], "computed_on": time.time(),
        }
        return _put_cache_entry(key, entry)
    except Exception:
        return get_cached(ticket_id) or {
            "level": "Unknown", "score": None, "factors": {}, "escalations": [],
            "rationale": "Could not compute.", "engine_mode": "error", "computed_on": time.time()}
