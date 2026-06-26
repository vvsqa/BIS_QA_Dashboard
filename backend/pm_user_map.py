"""Resolve PM v2 numeric developer user-IDs to names.

The v2 PM ticketlist API returns BackendDeveloper/FrontendDeveloper as integer user IDs with no name
anywhere in the payload, and there is no PM users endpoint. So we derive an id->name map AUTOMATICALLY
from our own data by majority vote: the dev-stage assignee in TicketStatusHistory and the Redmine bug
assignee on each dev's tickets. Cached to data/pm_user_map.json and refreshed on sync (TTL).

This is heuristic (a name is accepted only with a clear vote winner); unmapped/uncertain ids fall back
to the raw id string so nothing crashes. Other PM fields (QCTester, CurrentAssignee, ReportedBy) already
come as names and are untouched.
"""
import os
import json
import time
import logging
from collections import defaultdict, Counter

logger = logging.getLogger("pm_user_map")

_FILE = os.path.join(os.path.dirname(__file__), "data", "pm_user_map.json")
_TTL = 24 * 3600  # rebuild the map at most once a day
# Statuses where the CurrentAssignee is the developer (not QA / reviewer).
_DEV_STATUSES = {"In Progress", "Start Code Review", "Code Review Passed", "Code Review Failed", "Reopened"}
_MIN_VOTES = 3  # require a confident winner before trusting a name

# Authoritative manual id->name roster that ALWAYS wins over the heuristic and is NEVER clobbered by
# rebuild(). Lives in data/pm_user_map_manual.json (the BIS PM team's canonical user list).
# Why this exists: the co-occurrence heuristic derives a name from the people who *currently work* an
# id's tickets. A FROZEN BackendDeveloper id (e.g. a developer whose old tickets were reassigned)
# therefore picks up whatever name now appears on those tickets — a different, currently-active dev.
# That let two distinct ids resolve to the same name (e.g. both 4241014 and 2359593 -> "Jithin Joy"),
# piling several devs' tickets under one person. The manual roster removes the guesswork; map an id to
# "" to SUPPRESS a wrong name (falls back to the raw id rather than impersonating a real person).
_OVERRIDE_FILE = os.path.join(os.path.dirname(__file__), "data", "pm_user_map_manual.json")
_override_cache = {"data": None}


def _overrides():
    if _override_cache["data"] is None:
        try:
            with open(_OVERRIDE_FILE, "r", encoding="utf-8") as f:
                _override_cache["data"] = {str(k): v for k, v in json.load(f).items() if not str(k).startswith("_")}
        except Exception:
            _override_cache["data"] = {}
    return _override_cache["data"]


_cache = {"map": None, "ts": 0}


def _load():
    if _cache["map"] is None:
        try:
            with open(_FILE, "r", encoding="utf-8") as f:
                d = json.load(f)
            _cache["map"] = {str(k): v for k, v in (d.get("map") or {}).items()}
            _cache["ts"] = d.get("ts", 0)
        except Exception:
            _cache["map"] = {}
            _cache["ts"] = 0
    return _cache["map"]


def _save():
    try:
        with open(_FILE, "w", encoding="utf-8") as f:
            json.dump({"map": _cache["map"], "ts": _cache["ts"]}, f)
    except Exception as e:
        logger.warning("pm_user_map save failed: %s", e)


def get_name(uid):
    """Name for a dev user-id; falls back to the id (stringified) if unknown.
    A manual _OVERRIDE entry wins over the heuristic map; an override of "" suppresses a wrong name
    (falls back to the raw id so we never mis-attribute the ticket to a real, different person)."""
    if uid is None or uid == "":
        return ""
    s = str(uid)
    ov = _overrides()
    if s in ov:
        return ov[s] or s
    return _load().get(s) or s


def resolve(v):
    """Resolve a BackendDeveloper/FrontendDeveloper field. Int id -> name; an existing name string
    passes through unchanged; an empty/None -> ''."""
    if v is None or v == "":
        return ""
    if isinstance(v, str) and not v.strip().isdigit():
        return v.strip()  # already a name
    return get_name(v)


def needs_refresh():
    _load()
    return (not _cache["map"]) or (time.time() - _cache["ts"]) > _TTL


def rebuild(db, raw_tickets, force=False):
    """Rebuild the id->name map from co-occurrence. `raw_tickets` = PM v2 ticket dicts. Never raises.
    Skips work unless forced or the cache is stale/empty."""
    if not force and not needs_refresh():
        return _load()
    try:
        from models import TicketStatusHistory, Bug

        # ticket_id -> set of numeric dev ids on that ticket (backend + frontend)
        bid = defaultdict(set)
        for t in raw_tickets or []:
            try:
                tid = int(t.get("TicketNumber") or t.get("ticket_id") or 0)
            except (TypeError, ValueError):
                tid = 0
            if not tid:
                continue
            for val in (t.get("BackendDeveloper"), t.get("FrontendDeveloper")):
                if isinstance(val, int):
                    bid[tid].add(val)
        if not bid:
            return _load()

        tids = list(bid.keys())
        cand = defaultdict(Counter)

        def _chunks(lst, n=900):
            for i in range(0, len(lst), n):
                yield lst[i:i + n]

        for ch in _chunks(tids):
            for h in (db.query(TicketStatusHistory.ticket_id, TicketStatusHistory.new_status,
                               TicketStatusHistory.current_assignee)
                      .filter(TicketStatusHistory.ticket_id.in_(ch)).all()):
                if h.current_assignee and h.new_status in _DEV_STATUSES:
                    nm = h.current_assignee.strip()
                    for idv in bid.get(h.ticket_id, ()):
                        cand[idv][nm] += 1
            for b in db.query(Bug.ticket_id, Bug.assignee).filter(Bug.ticket_id.in_(ch)).all():
                if b.assignee:
                    nm = b.assignee.strip()
                    for idv in bid.get(b.ticket_id, ()):
                        cand[idv][nm] += 2  # weight the Redmine assignee a little higher

        ov = _overrides()
        new_map = dict(_load())
        # A name may belong to only ONE id. Pre-claim every override name (highest priority) and the
        # name each id ALREADY holds in the map, then process candidates strongest-evidence first so
        # the best-supported id keeps a contested name and weaker/frozen ids don't duplicate it.
        owner = {}  # name -> (id_str, score)
        for oid, onm in ov.items():
            if onm:
                owner[onm] = (str(oid), float("inf"))
        ordered = sorted(cand.items(), key=lambda kv: -(kv[1].most_common(1)[0][1] if kv[1] else 0))
        for idv, c in ordered:
            sid = str(idv)
            if sid in ov:
                continue  # pinned id — never let the heuristic touch it
            if not c:
                continue
            top = c.most_common(2)
            name, score = top[0]
            if score < _MIN_VOTES or not (len(top) == 1 or top[0][1] > top[1][1]):
                continue
            held = owner.get(name)
            if held and held[0] != sid and held[1] >= score:
                continue  # another id owns this name with >= evidence — don't create a duplicate
            owner[name] = (sid, score)
            new_map[sid] = name
        # Drop any stale duplicate: if an override (or a stronger id) owns a name, no other id may keep it.
        for nm, (winner_id, _s) in owner.items():
            for k in [k for k, v in new_map.items() if v == nm and k != winner_id]:
                new_map.pop(k, None)
        # An override of "" means "suppress" — make sure no stale heuristic name lingers for that id.
        for oid, onm in ov.items():
            if not onm:
                new_map.pop(str(oid), None)
        _cache["map"] = new_map
        _cache["ts"] = time.time()
        _save()
        logger.info("pm_user_map rebuilt: %d ids mapped", len(new_map))
    except Exception as e:
        logger.warning("pm_user_map rebuild failed: %s", e)
    return _load()


def maybe_rebuild_async(raw_tickets):
    """Fire-and-forget rebuild on its own DB session (used from the live fetch path which has no db).
    Runs synchronously when the map is empty (cold start) so names appear on first load; otherwise
    refreshes in a background thread so it never blocks a request."""
    if not needs_refresh():
        return
    cold = not _load()

    def _run():
        try:
            from database import SessionLocal
            db = SessionLocal()
            try:
                rebuild(db, raw_tickets)
            finally:
                db.close()
        except Exception as e:
            logger.warning("pm_user_map async rebuild failed: %s", e)

    if cold:
        _run()
    else:
        import threading
        threading.Thread(target=_run, daemon=True).start()
