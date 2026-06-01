"""
PM Live Data Module - Fetches directly from PM API for real-time dashboard data.
No database dependency. All computations done on live API response.
"""
import os
import logging
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dotenv import load_dotenv

load_dotenv()

from pm_api_sync import PMApiClient
import time

logger = logging.getLogger("pm_live_data")

# ===== RESPONSE CACHING =====
# Caches computed API responses so repeat requests within 60s are instant
_response_cache = {}
_RESPONSE_TTL = 60  # seconds


def _cached_response(key, compute_fn):
    """Return cached response or compute fresh one."""
    now = time.time()
    entry = _response_cache.get(key)
    if entry and (now - entry['ts']) < _RESPONSE_TTL:
        return entry['data']
    result = compute_fn()
    _response_cache[key] = {'data': result, 'ts': now}
    return result


def clear_response_cache():
    """Clear all response caches and force external re-fetch (called on force refresh)."""
    _response_cache.clear()
    # Reset external cache timestamps so TestRail/Redmine re-fetch on next page load
    _testrail_cache['timestamp'] = 0
    _redmine_cache['timestamp'] = 0


# Simple in-memory cache for PM API results (avoids hitting API on every page load)
_PM_DISK_CACHE = os.path.join(os.path.dirname(__file__), 'data', 'pm_tickets_cache.json')
_ticket_cache = {'data': None, 'timestamp': 0}
_CACHE_TTL = 300  # seconds - refresh from PM API at most once per 5 minutes

import json as _json

_AGEING_FILE = os.path.join(os.path.dirname(__file__), 'data', 'status_ageing.json')


def _load_ageing_tracker() -> Dict:
    """Load {ticket_id: {status, first_seen}} from file."""
    try:
        with open(_AGEING_FILE, 'r') as f:
            return _json.load(f)
    except (FileNotFoundError, _json.JSONDecodeError):
        return {}


_CYCLE_FILE = os.path.join(os.path.dirname(__file__), 'data', 'qc_cycle_tracker.json')


def _load_cycle_tracker() -> Dict:
    """Load {ticket_id: {cycle_count, status_history: [{status, timestamp}], last_status}}"""
    try:
        with open(_CYCLE_FILE, 'r') as f:
            return _json.load(f)
    except (FileNotFoundError, _json.JSONDecodeError):
        return {}


def _save_cycle_tracker(data: Dict):
    os.makedirs(os.path.dirname(_CYCLE_FILE), exist_ok=True)
    with open(_CYCLE_FILE, 'w') as f:
        _json.dump(data, f)


def _update_cycle_tracker(tickets: List[Dict], today: date) -> Dict:
    """
    Track QC cycles for all tickets. Detects the pattern:
    QC Testing -> QC Review Fail -> In Progress -> QC Testing (cycle +1)

    Returns {ticket_id_str: {cycle_count, last_status, is_retesting, status_history}}
    """
    tracker = _load_cycle_tracker()
    today_str = today.isoformat()

    for t in tickets:
        tid = str(t['ticket_id'])
        status = t['status']
        entry = tracker.get(tid)

        if entry is None:
            # First time seeing this ticket
            tracker[tid] = {
                'cycle_count': 0,
                'last_status': status,
                'is_retesting': False,
                'status_history': [{'status': status, 'date': today_str}],
            }
            continue

        last_status = entry.get('last_status', '')
        if status == last_status:
            continue  # No change

        # Status changed — record it
        history = entry.get('status_history', [])
        history.append({'status': status, 'date': today_str})
        # Keep last 20 entries to avoid bloat
        if len(history) > 20:
            history = history[-20:]
        entry['status_history'] = history
        entry['last_status'] = status

        # Detect cycle: ticket came BACK to QC Testing after being in QC Review Fail or In Progress
        # Pattern: was in QC Review Fail (or went through it) and now back in QC Testing
        if status == 'QC Testing' and last_status in ('In Progress', 'Start Code Review', 'Code Review Passed', 'Ready For Development'):
            # Check if there was a QC Review Fail in recent history
            recent_statuses = [h['status'] for h in history[-10:]]
            if 'QC Review Fail' in recent_statuses:
                entry['cycle_count'] = entry.get('cycle_count', 0) + 1
                entry['is_retesting'] = True
        elif status == 'QC Review Fail':
            # Mark as having failed
            entry['is_retesting'] = False  # will become True when it returns to QC Testing
        elif status in ('BIS Testing', 'Closed', 'Moved to Live', 'Approved for Live'):
            entry['is_retesting'] = False  # Passed this cycle

        tracker[tid] = entry

    _save_cycle_tracker(tracker)
    return tracker


def _save_ageing_tracker(data: Dict):
    """Save ageing tracker to file."""
    os.makedirs(os.path.dirname(_AGEING_FILE), exist_ok=True)
    with open(_AGEING_FILE, 'w') as f:
        _json.dump(data, f)


def _get_ageing_tracked(ticket_id: int, current_status: str, today: date, tracker: Dict) -> Dict:
    """
    Track when a ticket first entered its current status.
    If ticket+status combo is new, record today as first_seen.
    If ticket changed status, reset first_seen to today.
    Returns days since first_seen in this status.
    """
    key = str(ticket_id)
    entry = tracker.get(key)

    if entry and entry.get('status') == current_status:
        # Same status — compute days since first_seen
        first_seen = _parse_date(entry['first_seen'])
        if first_seen:
            days = max(0, (today - first_seen).days)
            return {'days_in_status': days, 'first_seen': entry['first_seen']}

    # New ticket or status changed — record today
    tracker[key] = {'status': current_status, 'first_seen': today.isoformat()}
    return {'days_in_status': 0, 'first_seen': today.isoformat()}

# QA statuses
QC_STATUSES = ['QC Testing', 'QC Testing in Progress', 'QC Testing Hold']
QC_FAIL_STATUSES = ['QC Review Fail']
BIS_STATUS = 'BIS Testing'
APPROVED_STATUS = 'Approved for Live'
POST_QC_STATUSES = [BIS_STATUS, APPROVED_STATUS]  # After QC, before close
CLOSED_STATUSES = ['Closed', 'Moved to Live']

# Priority scoring
PRIORITY_SCORES = {
    'URGENT': 30, 'High (Bugs)': 25, 'High (Billable)': 24, 'EPIC!': 22,
    'Medium (Bugs)': 18, 'High Level 1': 20, 'High Level 2': 18, 'High Level 3': 16,
    'High Level 4': 14, 'Medium': 12, 'Low': 6, 'Quote': 4, 'Suggestion': 2,
}
PRIORITY_ORDER = {
    'URGENT': 1, 'High (Bugs)': 2, 'High (Billable)': 3, 'EPIC!': 4,
    'Medium (Bugs)': 5, 'High Level 1': 6, 'High Level 2': 7, 'High Level 3': 8,
    'High Level 4': 9, 'Medium': 10, 'Low': 11, 'Quote': 12, 'Suggestion': 13,
}


def _get_pm_client() -> PMApiClient:
    return PMApiClient(api_key=os.environ.get('PM_API_KEY'))


def _parse_date(val) -> Optional[date]:
    if not val:
        return None
    if isinstance(val, date):
        return val
    if isinstance(val, datetime):
        return val.date()
    try:
        return datetime.fromisoformat(str(val).replace('Z', '+00:00')).date()
    except (ValueError, TypeError):
        pass
    for fmt in ('%Y-%m-%d', '%Y-%m-%dT%H:%M:%S', '%d/%m/%Y', '%m/%d/%Y'):
        try:
            return datetime.strptime(str(val).split('T')[0].split(' ')[0], fmt).date()
        except (ValueError, TypeError):
            continue
    return None


def _parse_float(val) -> float:
    if val is None:
        return 0.0
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0


def _normalize_ticket(raw: Dict) -> Dict:
    """Map PM API PascalCase fields to normalized dict."""
    ticket_id = raw.get('TicketNumber') or raw.get('ticket_id') or raw.get('id')
    status = (raw.get('Status') or '').strip()
    qc_tester = (raw.get('QCTester') or '').strip()
    priority = (raw.get('Priority') or '').strip()
    platform = (raw.get('Subdepartment') or '').strip()
    if platform.lower() == 'mobile':
        platform = 'Mobile'
    elif platform:
        platform = platform  # Keep as-is (module name like "Classroom Calendar")
    else:
        platform = 'Web'

    # For platform filtering, derive Web/Mobile from subdepartment
    platform_category = 'Mobile' if platform.lower() == 'mobile' else 'Web'

    eta = _parse_date(raw.get('ETA'))
    created = _parse_date(raw.get('TicketCreatedDate'))
    closed = _parse_date(raw.get('TicketClosedDate'))

    backend_dev = (raw.get('BackendDeveloper') or '').strip()
    frontend_dev = (raw.get('FrontendDeveloper') or '').strip()
    developers = []
    if backend_dev:
        developers.append(backend_dev)
    if frontend_dev:
        developers.append(frontend_dev)

    return {
        'ticket_id': int(ticket_id) if ticket_id else 0,
        'title': (raw.get('TicketTitle') or '').strip(),
        'status': status,
        'priority': priority or 'Unspecified',
        'priority_order': PRIORITY_ORDER.get(priority, 99),
        'qc_tester': qc_tester or None,
        'module': platform if platform not in ('Web', 'Mobile', '') else (raw.get('Subdepartment') or 'Unassigned'),
        'platform': platform_category,
        'eta': eta.isoformat() if eta else None,
        'created_on': created.isoformat() if created else None,
        'closed_on': closed.isoformat() if closed else None,
        'qa_estimate_hours': _parse_float(raw.get('OtherEstimatedHours')),
        'qa_actual_hours': _parse_float(raw.get('ActualQAQCHours')),
        'dev_estimate_hours': _parse_float(raw.get('DevEstimatedHours')),
        'actual_dev_hours': _parse_float(raw.get('ActualDevHours')),
        'backend_developer': backend_dev,
        'frontend_developer': frontend_dev,
        'developers': developers,
        'developers_str': ', '.join(developers) if developers else 'Not Assigned',
        'current_assignee': (raw.get('CurrentAssignee') or '').strip(),
        'reported_by': (raw.get('ReportedBy') or '').strip(),
        'ticket_type': (raw.get('Type') or '').strip(),
        'billable': raw.get('Billable'),
        'follow_up_date': raw.get('FollowUpDate'),
    }


def _calculate_score(ticket: Dict, today: date) -> Dict:
    """Priority score 0-100."""
    breakdown = {}
    priority = ticket.get('priority', '')
    base = PRIORITY_SCORES.get(priority, 10)
    breakdown['priority'] = {'points': base, 'max': 30, 'detail': priority or 'Default'}

    # Ageing (from created date as proxy since we don't have status change history from live API)
    days_in_qc = 0
    created = _parse_date(ticket.get('created_on'))
    if created:
        days_in_qc = max(0, (today - created).days)
    if days_in_qc >= 15:
        ageing_pts = 25
    elif days_in_qc >= 10:
        ageing_pts = 20
    elif days_in_qc >= 7:
        ageing_pts = 15
    elif days_in_qc >= 5:
        ageing_pts = 10
    elif days_in_qc >= 3:
        ageing_pts = 7
    elif days_in_qc >= 1:
        ageing_pts = 3
    else:
        ageing_pts = 0
    breakdown['ageing'] = {'points': ageing_pts, 'max': 25, 'detail': f'{days_in_qc} days since created'}

    # ETA urgency
    eta_pts = 0
    eta_detail = 'No ETA'
    eta_date = _parse_date(ticket.get('eta'))
    if eta_date:
        days_to = (eta_date - today).days
        if days_to < 0:
            eta_pts = 15
            eta_detail = f'Overdue by {abs(days_to)} days'
        elif days_to <= 2:
            eta_pts = 12
            eta_detail = f'Due in {days_to} days'
        elif days_to <= 5:
            eta_pts = 8
            eta_detail = f'Due in {days_to} days'
        elif days_to <= 7:
            eta_pts = 4
            eta_detail = f'Due in {days_to} days'
        else:
            eta_detail = f'Due in {days_to} days'
    breakdown['eta'] = {'points': eta_pts, 'max': 15, 'detail': eta_detail}

    # Ticket type bonus
    type_pts = 0
    priority_lower = (priority or '').lower()
    if 'bug' in priority_lower or ticket.get('ticket_type', '').lower() == 'bug':
        type_pts = 5
        type_detail = 'Bug fix'
    elif 'epic' in priority_lower:
        type_pts = 3
        type_detail = 'Epic'
    else:
        type_detail = 'Standard'
    breakdown['type'] = {'points': type_pts, 'max': 5, 'detail': type_detail}

    total = min(100, base + ageing_pts + eta_pts + type_pts)
    return {'score': round(total, 1), 'breakdown': breakdown}


# ===== TestRail & Redmine cached data =====
_TESTRAIL_FILE = os.path.join(os.path.dirname(__file__), 'data', 'testrail_cache.json')
_REDMINE_FILE = os.path.join(os.path.dirname(__file__), 'data', 'redmine_cache.json')
_EXTERNAL_CACHE_TTL = 600  # 10 min for TestRail/Redmine


def _load_file_cache(filepath):
    try:
        with open(filepath, 'r') as f:
            return _json.load(f)
    except (FileNotFoundError, _json.JSONDecodeError):
        return None


def _save_file_cache(filepath, data):
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, 'w') as f:
        _json.dump(data, f)


# Load from disk on startup so data survives restarts
_testrail_disk = _load_file_cache(_TESTRAIL_FILE)
_redmine_disk = _load_file_cache(_REDMINE_FILE)
_testrail_cache = {'data': _testrail_disk, 'timestamp': time.time() if _testrail_disk else 0}
_redmine_cache = {'data': _redmine_disk, 'timestamp': time.time() if _redmine_disk else 0}


def _fetch_testrail_plans() -> Dict[int, Dict]:
    """Fetch all TestRail plans for project 18, return {ticket_id: {cases, passed, failed, untested, plan_id}}."""
    now = time.time()
    if _testrail_cache['data'] is not None and (now - _testrail_cache['timestamp']) < _EXTERNAL_CACHE_TTL:
        return _testrail_cache['data']

    try:
        import requests, base64, re
        testrail_url = os.environ.get('TESTRAIL_URL', 'https://bistrainer.testrail.io')
        email = os.environ.get('TESTRAIL_EMAIL', '')
        key = os.environ.get('TESTRAIL_API_KEY', '')
        if not email or not key:
            return _testrail_cache.get('data') or {}

        api_base = f'{testrail_url}/index.php?/api/v2'
        cred = base64.b64encode(f'{email}:{key}'.encode()).decode()
        headers = {'Authorization': f'Basic {cred}', 'Content-Type': 'application/json'}
        project_id = int(os.environ.get('TESTRAIL_AUTOMATION_PROJECT_ID', '18'))

        # Fetch all plans
        all_plans = []
        offset = 0
        while True:
            resp = requests.get(f'{api_base}/get_plans/{project_id}', headers=headers, params={'limit': 250, 'offset': offset}, timeout=30)
            if resp.status_code != 200:
                break
            data = resp.json()
            plans = data.get('plans', data) if isinstance(data, dict) else data
            if not plans:
                break
            all_plans.extend(plans)
            offset += len(plans)
            if len(plans) < 250:
                break

        # Map ticket_id -> plan summary (from list view - has counts).
        # Plan names come in two forms: "20468 ..." and "#20270 — Title" — handle both.
        result = {}
        for p in all_plans:
            name = str(p.get('name', '')).strip().lstrip('#').strip()
            match = re.match(r'^(\d+)', name)
            if match:
                tid = int(match.group(1))
                if tid > 100:
                    result[tid] = {
                        'plan_id': p['id'],
                        'cases': (p.get('passed_count', 0) or 0) + (p.get('failed_count', 0) or 0) + (p.get('untested_count', 0) or 0) + (p.get('blocked_count', 0) or 0) + (p.get('retest_count', 0) or 0),
                        'passed': p.get('passed_count', 0) or 0,
                        'failed': p.get('failed_count', 0) or 0,
                        'untested': p.get('untested_count', 0) or 0,
                        'blocked': p.get('blocked_count', 0) or 0,
                        'retest': p.get('retest_count', 0) or 0,
                    }

        _testrail_cache['data'] = result
        _testrail_cache['timestamp'] = now
        _save_file_cache(_TESTRAIL_FILE, result)
        logger.info(f'TestRail: fetched {len(result)} plan mappings')
        return result
    except Exception as e:
        logger.error(f'TestRail fetch error: {e}')
        return _testrail_cache.get('data') or {}


_TESTRAIL_MODULE_FILE = os.path.join(os.path.dirname(__file__), 'data', 'testrail_module_cache.json')
_testrail_module_cache = {'data': None, 'timestamp': 0}


def _fetch_testrail_module_stats() -> Dict[str, Dict]:
    """Fetch test case counts per PM module from TestRail Web suite (137).
    Returns {module_name: {total_cases, automated, executions}}.
    Uses section-to-module mapping from ownership config.
    """
    now = time.time()
    if _testrail_module_cache['data'] is not None and (now - _testrail_module_cache['timestamp']) < _EXTERNAL_CACHE_TTL:
        return _testrail_module_cache['data']

    # Try disk cache
    if _testrail_module_cache['data'] is None:
        disk = _load_file_cache(_TESTRAIL_MODULE_FILE)
        if disk:
            _testrail_module_cache['data'] = disk
            _testrail_module_cache['timestamp'] = now
            return disk

    try:
        import requests, base64, re
        testrail_url = os.environ.get('TESTRAIL_URL', 'https://bistrainer.testrail.io')
        email = os.environ.get('TESTRAIL_EMAIL', '')
        api_key = os.environ.get('TESTRAIL_API_KEY', '')
        if not email or not api_key:
            return _testrail_module_cache.get('data') or {}

        api_base = f'{testrail_url}/index.php?/api/v2'
        cred = base64.b64encode(f'{email}:{api_key}'.encode()).decode()
        headers = {'Authorization': f'Basic {cred}', 'Content-Type': 'application/json'}
        suite_id = 137  # Web suite

        ownership = load_module_ownership()
        mapping = ownership.get('testrail_mapping', {})

        # 1. Fetch all sections (paginated)
        all_sections = []
        offset = 0
        while True:
            resp = requests.get(f'{api_base}/get_sections/18&suite_id={suite_id}', headers=headers, params={'limit': 250, 'offset': offset}, timeout=30)
            if resp.status_code != 200:
                break
            data = resp.json()
            batch = data.get('sections', [])
            if not batch:
                break
            all_sections.extend(batch)
            offset += len(batch)
            if not data.get('_links', {}).get('next'):
                break
            time.sleep(0.3)

        # Build section ancestry map
        sec_map = {s['id']: s for s in all_sections}
        top_sections = {s['id']: s['name'] for s in all_sections if s.get('depth', 0) == 0}

        def get_ancestry(sec_id):
            """Get list of all ancestor section names including self."""
            names = []
            visited = set()
            while sec_id and sec_id not in visited:
                visited.add(sec_id)
                s = sec_map.get(sec_id)
                if s:
                    names.append(s['name'].lower())
                    sec_id = s.get('parent_id')
                else:
                    break
            return names

        def section_to_module(sec_id):
            """Map a section to a PM module using ancestry + keyword matching."""
            ancestry = get_ancestry(sec_id)
            # Check each module's mapping
            for mod, cfg in mapping.items():
                # Direct section ID match (or any ancestor)
                mapped_ids = set(cfg.get('section_ids', []))
                check_id = sec_id
                visited = set()
                while check_id and check_id not in visited:
                    visited.add(check_id)
                    if check_id in mapped_ids:
                        return mod
                    p = sec_map.get(check_id)
                    check_id = p.get('parent_id') if p else None
                # Keyword match in section name or ancestors
                keywords = cfg.get('keywords', [])
                for kw in keywords:
                    kw_lower = kw.lower()
                    for name in ancestry:
                        if kw_lower in name:
                            return mod
            return None

        # 2. Fetch all cases (paginated)
        module_stats = {}
        for mod in mapping:
            module_stats[mod] = {'total_cases': 0, 'automated': 0, 'not_automated': 0}

        offset = 0
        while True:
            resp = requests.get(f'{api_base}/get_cases/18&suite_id={suite_id}', headers=headers, params={'limit': 250, 'offset': offset}, timeout=30)
            if resp.status_code != 200:
                break
            data = resp.json()
            cases = data.get('cases', [])
            if not cases:
                break
            for c in cases:
                mod = section_to_module(c.get('section_id'))
                if mod and mod in module_stats:
                    module_stats[mod]['total_cases'] += 1
                    if c.get('custom_case_automated') == 3:
                        module_stats[mod]['automated'] += 1
                    else:
                        module_stats[mod]['not_automated'] += 1
            offset += len(cases)
            if not data.get('_links', {}).get('next'):
                break
            time.sleep(0.3)

        # 3. Execution counts from existing plan cache
        plan_data = _testrail_cache.get('data') or {}
        pm_tickets = _ticket_cache.get('data') or []
        # Build ticket -> module map from PM data
        ticket_module = {}
        for t in pm_tickets:
            if t.get('module') in mapping:
                ticket_module[t['ticket_id']] = t['module']
            ticket_module[str(t['ticket_id'])] = t.get('module')

        for tid_str, plan_info in plan_data.items():
            tid = int(tid_str) if tid_str.isdigit() else 0
            mod = ticket_module.get(tid) or ticket_module.get(tid_str)
            if mod and mod in module_stats:
                executions = (plan_info.get('passed', 0) or 0) + (plan_info.get('failed', 0) or 0) + (plan_info.get('retest', 0) or 0)
                module_stats[mod]['executions'] = module_stats[mod].get('executions', 0) + executions

        # Ensure executions key exists
        for mod in module_stats:
            module_stats[mod].setdefault('executions', 0)

        _testrail_module_cache['data'] = module_stats
        _testrail_module_cache['timestamp'] = now
        _save_file_cache(_TESTRAIL_MODULE_FILE, module_stats)
        logger.info(f'TestRail module stats: {sum(s["total_cases"] for s in module_stats.values())} cases across {len(module_stats)} modules')
        return module_stats
    except Exception as e:
        logger.error(f'TestRail module stats error: {e}')
        return _testrail_module_cache.get('data') or {}


def _fetch_redmine_bugs_for_tickets(ticket_ids: List[int]) -> Dict[int, Dict]:
    """Fetch Redmine bugs for specific ticket IDs using custom field filter (cf_14=ticket_id).
    Fast: one API call per ticket instead of paginating all bugs.
    """
    now = time.time()
    if _redmine_cache['data'] is not None and (now - _redmine_cache['timestamp']) < _EXTERNAL_CACHE_TTL:
        return _redmine_cache['data']

    try:
        import requests
        redmine_url = os.environ.get('REDMINE_URL', 'https://redmine.bissafety.app')
        api_key = os.environ.get('REDMINE_API_KEY', '')
        if not api_key:
            return _redmine_cache.get('data') or {}

        headers = {'X-Redmine-API-Key': api_key}
        # cf_14 = "Ticket ID" custom field in Redmine
        CLOSED_STATUSES = {'Closed', 'Rejected', 'Resolved', 'Duplicate'}

        result: Dict[int, Dict] = {}

        # Batch: Redmine supports pipe-separated values for custom field filter
        # Fetch in chunks of 10 ticket IDs at a time
        chunk_size = 10
        for i in range(0, len(ticket_ids), chunk_size):
            chunk = ticket_ids[i:i + chunk_size]
            # Use pipe-separated ticket IDs in cf_14 filter
            filter_val = '|'.join(str(tid) for tid in chunk)
            try:
                resp = requests.get(
                    f'{redmine_url}/issues.json', headers=headers,
                    params={'status_id': '*', 'limit': 100, f'cf_14': filter_val},
                    timeout=15
                )
                if resp.status_code != 200:
                    continue
                data = resp.json()
                for iss in data.get('issues', []):
                    # Find ticket ID from custom fields
                    tid = None
                    for cf in iss.get('custom_fields', []):
                        if cf.get('id') == 14 or cf.get('name') == 'Ticket ID':
                            val = str(cf.get('value', '')).strip()
                            if val.isdigit():
                                tid = int(val)
                                break
                    if not tid:
                        continue
                    if tid not in result:
                        result[tid] = {'total': 0, 'open': 0, 'closed': 0, 'released_to_qa': 0}
                    result[tid]['total'] += 1
                    status_name = iss.get('status', {}).get('name', '')
                    if status_name in CLOSED_STATUSES:
                        result[tid]['closed'] += 1
                    elif status_name == 'Released to QA':
                        result[tid]['released_to_qa'] += 1
                        result[tid]['open'] += 1  # Still open
                    else:
                        result[tid]['open'] += 1
            except Exception:
                continue

        # Merge with existing cache (keep old ticket mappings, update new ones)
        existing = _redmine_cache.get('data') or {}
        existing.update(result)
        _redmine_cache['data'] = existing
        _redmine_cache['timestamp'] = now
        _save_file_cache(_REDMINE_FILE, existing)
        logger.info(f'Redmine: fetched bugs for {len(result)} of {len(ticket_ids)} tickets (total cached: {len(existing)})')
        return result
    except Exception as e:
        logger.error(f'Redmine fetch error: {e}')
        return _redmine_cache.get('data') or {}


import threading
_external_fetch_lock = threading.Lock()
_external_fetch_running = False


_pending_redmine_ticket_ids = []


def _start_external_fetch_if_needed(ticket_ids: Optional[List[int]] = None):
    """Start background thread to fetch TestRail + Redmine if cache is stale."""
    global _external_fetch_running, _pending_redmine_ticket_ids
    now = time.time()
    testrail_stale = _testrail_cache['data'] is None or (now - _testrail_cache['timestamp']) >= _EXTERNAL_CACHE_TTL
    redmine_stale = _redmine_cache['data'] is None or (now - _redmine_cache['timestamp']) >= _EXTERNAL_CACHE_TTL

    if ticket_ids:
        _pending_redmine_ticket_ids = ticket_ids

    if not (testrail_stale or redmine_stale):
        return
    if _external_fetch_running:
        return

    tids = list(_pending_redmine_ticket_ids)

    def _bg_fetch():
        global _external_fetch_running
        _external_fetch_running = True
        try:
            if testrail_stale:
                _fetch_testrail_plans()
                _fetch_testrail_module_stats()
            if redmine_stale and tids:
                _fetch_redmine_bugs_for_tickets(tids)
        finally:
            _external_fetch_running = False

    threading.Thread(target=_bg_fetch, daemon=True).start()


def _init_pm_cache():
    """Load PM ticket cache from disk on first call. Excludes Initiative type."""
    if _ticket_cache['data'] is None:
        disk = _load_file_cache(_PM_DISK_CACHE)
        if disk:
            _ticket_cache['data'] = [t for t in disk if t.get('ticket_type') != 'Initiative']
            _ticket_cache['timestamp'] = time.time()


def fetch_live_tickets(force_refresh: bool = False) -> Tuple[bool, List[Dict], str]:
    """Fetch and normalize all tickets from PM API. Cached for 5 min. Falls back to disk cache."""
    _init_pm_cache()
    now = time.time()
    if not force_refresh and _ticket_cache['data'] is not None and (now - _ticket_cache['timestamp']) < _CACHE_TTL:
        return True, _ticket_cache['data'], 'From cache'

    client = _get_pm_client()
    success, raw_tickets, msg = client.fetch_tickets()
    if not success or not raw_tickets:
        # Return stale cache if available
        if _ticket_cache['data'] is not None:
            return True, _ticket_cache['data'], 'From stale cache (API failed)'
        return False, [], msg
    # Exclude Initiative type tickets from all counts
    EXCLUDED_TYPES = {'Initiative'}
    normalized = [_normalize_ticket(t) for t in raw_tickets if t.get('Type', '') not in EXCLUDED_TYPES]
    _ticket_cache['data'] = normalized
    _ticket_cache['timestamp'] = now
    # Save to disk so data survives restarts and API outages
    try:
        _save_file_cache(_PM_DISK_CACHE, normalized)
    except Exception:
        pass
    return True, normalized, msg


def get_live_qc_queue(today: Optional[date] = None) -> Dict:
    return _cached_response('qc_queue', lambda: _compute_qc_queue(today))

def _get_movement_24h(all_tickets: list, today: date) -> Dict:
    """Count tickets that entered each pipeline stage in the last 24 hours.
    Uses ageing tracker for QA statuses, and updates it for ALL statuses going forward."""
    tracker = _load_ageing_tracker()
    yesterday = (today - timedelta(days=1)).isoformat()
    today_str = today.isoformat()

    stage_map = {
        'In Progress': 'dev', 'Hold/Pending': 'dev',
        'Start Code Review': 'cr', 'Code Review Failed': 'cr', 'Express Lane Review': 'cr',
        'Code Review Passed': 'crp',
        'QC Testing': 'qa', 'QC Testing Hold': 'qa',
        'QC Testing in Progress': 'testing',
        'BIS Testing': 'bis', 'Approved for Live': 'live', 'Moved to Live': 'live',
        'QC Review Fail': 'fail',
    }

    movement = {'dev': 0, 'cr': 0, 'crp': 0, 'qa': 0, 'testing': 0, 'bis': 0, 'live': 0, 'fail': 0}
    updated = False

    for t in all_tickets:
        tid = str(t['ticket_id'])
        status = t['status']
        stage = stage_map.get(status)
        if not stage:
            continue

        entry = tracker.get(tid)
        if entry is None:
            # First time seeing this ticket — record it
            tracker[tid] = {'status': status, 'first_seen': today_str}
            movement[stage] += 1  # New today
            updated = True
        elif entry.get('status') != status:
            # Status changed — update tracker and count as movement
            tracker[tid] = {'status': status, 'first_seen': today_str}
            movement[stage] += 1
            updated = True
        else:
            # Same status — check if entered within 24h
            first_seen = entry.get('first_seen', '')
            if first_seen and first_seen >= yesterday:
                movement[stage] += 1

    if updated:
        _save_ageing_tracker(tracker)

    return movement


def _compute_qc_queue(today: Optional[date] = None) -> Dict:
    """Live QC queue with scoring, breakdowns, and counts."""
    today = today or date.today()
    success, all_tickets, msg = fetch_live_tickets()
    if not success:
        return {'error': msg, 'queue': [], 'total': 0, 'status_cards': {}}

    qc_tickets = [t for t in all_tickets if t['status'] in QC_STATUSES]
    qc_failed = [t for t in all_tickets if t['status'] in QC_FAIL_STATUSES]
    bis_tickets = [t for t in all_tickets if t['status'] == BIS_STATUS]
    approved_tickets = [t for t in all_tickets if t['status'] == APPROVED_STATUS]

    # Collect all relevant ticket IDs for Redmine lookup
    all_relevant_ids = [t['ticket_id'] for t in qc_tickets + qc_failed + bis_tickets + approved_tickets]

    # Fetch TestRail and Redmine data (from cache — background thread refreshes)
    _start_external_fetch_if_needed(ticket_ids=all_relevant_ids)
    testrail_data = _testrail_cache.get('data') or {}
    redmine_data = _redmine_cache.get('data') or {}
    testrail_url = os.environ.get('TESTRAIL_URL', 'https://bistrainer.testrail.io')

    def _enrich_external(t):
        """Add TestRail test case counts and Redmine bug counts to a ticket."""
        tid = t['ticket_id']
        # JSON keys may be strings after disk cache load
        tr = testrail_data.get(tid) or testrail_data.get(str(tid))
        if tr:
            t['test_cases'] = tr['cases']
            t['test_plan_cases'] = tr['cases']
            t['has_test_plan'] = True
            t['test_passed'] = tr['passed']
            t['test_failed'] = tr['failed']
            t['test_untested'] = tr['untested']
            t['testrail_plan_url'] = f'{testrail_url}/index.php?/plans/view/{tr["plan_id"]}'
        else:
            t['test_cases'] = 0
            t['test_plan_cases'] = 0
            t['has_test_plan'] = False
            t['test_passed'] = 0
            t['test_failed'] = 0
            t['test_untested'] = 0
            t['testrail_plan_url'] = None

        bugs = redmine_data.get(tid) or redmine_data.get(str(tid))
        if bugs:
            t['bugs_total'] = bugs['total']
            t['bugs_open'] = bugs['open']
            t['bugs_closed'] = bugs['closed']
            t['bugs_released_to_qa'] = bugs.get('released_to_qa', 0)
        else:
            t['bugs_total'] = 0
            t['bugs_open'] = 0
            t['bugs_closed'] = 0
            t['bugs_released_to_qa'] = 0

    # Load ageing tracker (file-based, no DB)
    tracker = _load_ageing_tracker()

    # Track QC cycles (retesting detection)
    cycle_tracker = _update_cycle_tracker(all_tickets, today)

    # Score and enrich — ageing tracked from first seen in status
    for t in qc_tickets:
        ageing = _get_ageing_tracked(t['ticket_id'], t['status'], today, tracker)
        t['days_in_qc'] = ageing['days_in_status']
        t['days_on_hold'] = ageing['days_in_status'] if t['status'] == 'QC Testing Hold' else 0
        t['moved_to_qc_on'] = ageing['first_seen']

        scoring = _calculate_score(t, today)
        t['priority_score'] = scoring['score']
        t['score_breakdown'] = scoring['breakdown']

        _enrich_external(t)

        # Cycle tracking
        ct = cycle_tracker.get(str(t['ticket_id']), {})
        t['retest_cycle_count'] = ct.get('cycle_count', 0)
        t['is_retesting'] = ct.get('is_retesting', False)

        # Activity type with hold duration and retesting info
        if t['status'] == 'QC Testing Hold':
            t['activity_type'] = 'on_hold'
            t['activity_label'] = f'On hold ({t["days_on_hold"]}d)' if t['days_on_hold'] > 0 else 'On hold'
        elif t['is_retesting']:
            t['activity_type'] = 'retesting'
            cycle = t['retest_cycle_count']
            if t['status'] == 'QC Testing in Progress':
                t['activity_label'] = f'Retesting - cycle {cycle}' if cycle else 'Retesting'
            else:
                t['activity_label'] = f'Pending retest - cycle {cycle}' if cycle else 'Pending retest'
        elif t['status'] == 'QC Testing in Progress':
            t['activity_type'] = 'in_progress'
            t['activity_label'] = 'In progress'
        elif t['qc_tester']:
            t['activity_type'] = 'to_be_started'
            t['activity_label'] = 'Assigned, not started'
        else:
            t['activity_type'] = 'unassigned'
            t['activity_label'] = 'Unassigned'
        t['open_bugs_count'] = 0
        t['qa_lead'] = ''

    # Sort by score descending
    qc_tickets.sort(key=lambda t: (-t['priority_score'], t['ticket_id']))

    # Score QC failed too
    for t in qc_failed:
        scoring = _calculate_score(t, today)
        t['priority_score'] = scoring['score']
        t['score_breakdown'] = scoring['breakdown']
        ct = cycle_tracker.get(str(t['ticket_id']), {})
        t['days_in_qc'] = 0
        t['activity_type'] = 'qc_failed'
        t['activity_label'] = f'QC Review Fail (cycle {ct.get("cycle_count", 0) + 1})'
        t['open_bugs_count'] = 0
        t['retest_cycle_count'] = ct.get('cycle_count', 0)
        t['is_retesting'] = False
        t['qa_lead'] = ''

    status_cards = {
        'QC Testing': sum(1 for t in qc_tickets if t['status'] == 'QC Testing'),
        'QC Testing in Progress': sum(1 for t in qc_tickets if t['status'] == 'QC Testing in Progress'),
        'QC Testing Hold': sum(1 for t in qc_tickets if t['status'] == 'QC Testing Hold'),
    }

    # Enrich BIS and Approved tickets — ageing tracked from first seen
    for t in bis_tickets + approved_tickets:
        ageing = _get_ageing_tracked(t['ticket_id'], t['status'], today, tracker)
        t['days_in_qc'] = ageing['days_in_status']
        t['days_on_hold'] = 0
        t['moved_to_qc_on'] = ageing['first_seen']

        scoring = _calculate_score(t, today)
        t['priority_score'] = scoring['score']
        t['score_breakdown'] = scoring['breakdown']

        if t['status'] == BIS_STATUS:
            t['activity_type'] = 'bis_testing'
            t['activity_label'] = f'In BIS ({t["days_in_qc"]}d)' if t['days_in_qc'] > 0 else 'In BIS Testing'
        else:
            t['activity_type'] = 'approved_for_live'
            t['activity_label'] = f'Approved for Live ({t["days_in_qc"]}d)' if t['days_in_qc'] > 0 else 'Approved for Live — verify in prod'
        _enrich_external(t)
        ct = cycle_tracker.get(str(t['ticket_id']), {})
        t['retest_cycle_count'] = ct.get('cycle_count', 0)
        t['is_retesting'] = False
        t['qa_lead'] = ''

    # Also enrich QC failed
    for t in qc_failed:
        _enrich_external(t)

    # Save ageing tracker
    _save_ageing_tracker(tracker)

    # No QA estimate: QC tickets where OtherEstimatedHours is 0 or missing
    no_qa_estimate = [t for t in qc_tickets if not t.get('qa_estimate_hours')]

    # 30-day summary: tickets that entered/exited QA in last 30 days
    d30 = today - timedelta(days=30)
    d60 = today - timedelta(days=60)

    def _in_range(ticket, field, start, end):
        d = _parse_date(ticket.get(field))
        return d and start <= d <= end

    # Tickets with QC tester (went through QA)
    qa_tickets = [t for t in all_tickets if t.get('qc_tester')]

    # Current month (30d)
    entered_qa_30d = [t for t in qa_tickets if t['status'] in QC_STATUSES and _in_range(t, 'created_on', d30, today)]
    handed_to_bis_30d = [t for t in qa_tickets if t['status'] in (BIS_STATUS, APPROVED_STATUS) + tuple(CLOSED_STATUSES) and _in_range(t, 'created_on', d30, today)]
    closed_30d = [t for t in qa_tickets if t['status'] in CLOSED_STATUSES and _in_range(t, 'closed_on', d30, today)]
    # All recently closed by QA (regardless of created date)
    all_closed_by_qa_30d = [t for t in qa_tickets if _in_range(t, 'closed_on', d30, today)]

    # Previous month (30-60d)
    closed_prev = [t for t in qa_tickets if _in_range(t, 'closed_on', d60, d30)]

    monthly_summary = {
        'period': f'{d30.strftime("%b %d")} - {today.strftime("%b %d, %Y")}',
        'entered_qa': len(entered_qa_30d),
        'handed_to_bis': len(handed_to_bis_30d),
        'closed_by_qa': len(all_closed_by_qa_30d),
        'currently_in_qc': len(qc_tickets),
        'on_hold': status_cards['QC Testing Hold'],
        'qc_failed': len(qc_failed),
        'no_qa_estimate': len(no_qa_estimate),
        'in_bis': len(bis_tickets),
        'approved': len(approved_tickets),
        'previous_month': {
            'period': f'{d60.strftime("%b %d")} - {d30.strftime("%b %d")}',
            'closed_by_qa': len(closed_prev),
        },
        # Waiting = QC Testing with no tester
        'unassigned_count': sum(1 for t in qc_tickets if t['status'] == 'QC Testing' and not t.get('qc_tester')),
        'assigned_waiting_count': sum(1 for t in qc_tickets if t['status'] == 'QC Testing' and t.get('qc_tester')),
        'in_progress_count': status_cards['QC Testing in Progress'],
        'hold_count': status_cards['QC Testing Hold'],
        'retesting_count': sum(1 for t in qc_tickets if t.get('is_retesting')),
    }

    # Module workload breakdown for graph tab
    all_qa_pipeline = qc_tickets + qc_failed + bis_tickets + approved_tickets
    module_workload: Dict[str, Dict] = {}
    for t in all_qa_pipeline:
        mod = t.get('module') or 'Unassigned'
        if mod not in module_workload:
            module_workload[mod] = {'module': mod, 'qc_testing': 0, 'in_progress': 0, 'hold': 0, 'qc_failed': 0, 'bis': 0, 'approved': 0, 'unassigned': 0, 'total': 0}
        module_workload[mod]['total'] += 1
        if t['status'] == 'QC Testing' and not t.get('qc_tester'):
            module_workload[mod]['unassigned'] += 1
        s = t['status']
        if s == 'QC Testing':
            module_workload[mod]['qc_testing'] += 1
        elif s == 'QC Testing in Progress':
            module_workload[mod]['in_progress'] += 1
        elif s == 'QC Testing Hold':
            module_workload[mod]['hold'] += 1
        elif s == 'QC Review Fail':
            module_workload[mod]['qc_failed'] += 1
        elif s == BIS_STATUS:
            module_workload[mod]['bis'] += 1
        elif s == APPROVED_STATUS:
            module_workload[mod]['approved'] += 1
    module_workload_list = sorted(module_workload.values(), key=lambda m: -m['total'])

    # Dev pipeline module breakdown — tickets coming to QA
    DEV_PIPELINE_STATUSES = {'Ready For Development', 'In Progress', 'Hold/Pending',
        'Start Code Review', 'Code Review Failed', 'Code Review Passed',
        'Express Lane Review'}
    DEV_NEAR_QC_SET = {'Code Review Passed'}
    DEV_CODE_REVIEW_SET = {'Start Code Review', 'Code Review Failed', 'Express Lane Review'}
    DEV_ACTIVE_SET = {'In Progress', 'Hold/Pending'}
    dev_pipeline_tickets = [t for t in all_tickets if t['status'] in DEV_PIPELINE_STATUSES]
    module_pipeline: Dict[str, Dict] = {}
    for t in dev_pipeline_tickets:
        mod = t.get('module') or 'Unassigned'
        if mod not in module_pipeline:
            module_pipeline[mod] = {'module': mod, 'first_time': 0, 'refix': 0, 'cr_passed': 0,
                'code_review': 0, 'in_progress': 0, 'total': 0, 'tickets': []}
        module_pipeline[mod]['total'] += 1
        is_refix = bool(t.get('qc_tester'))
        s = t['status']
        if is_refix:
            module_pipeline[mod]['refix'] += 1
        else:
            module_pipeline[mod]['first_time'] += 1
        if s in DEV_NEAR_QC_SET:
            module_pipeline[mod]['cr_passed'] += 1
        elif s in DEV_CODE_REVIEW_SET:
            module_pipeline[mod]['code_review'] += 1
        elif s in DEV_ACTIVE_SET:
            module_pipeline[mod]['in_progress'] += 1
        module_pipeline[mod]['tickets'].append({
            'ticket_id': t['ticket_id'], 'title': t['title'], 'status': t['status'],
            'priority': t['priority'], 'module': mod, 'platform': t.get('platform', ''),
            'developers_str': t.get('developers_str', ''), 'qc_tester': t.get('qc_tester', ''),
            'is_refix': is_refix, 'eta': t.get('eta'),
            'dev_estimate_hours': t.get('dev_estimate_hours', 0), 'actual_dev_hours': t.get('actual_dev_hours', 0),
        })
    module_pipeline_list = sorted(module_pipeline.values(), key=lambda m: -m['total'])

    return {
        'queue': qc_tickets,
        'dev_tested': [],
        'total': len(qc_tickets),
        'dev_tested_count': 0,
        'status_cards': status_cards,
        'qc_failed': {'tickets': qc_failed, 'total': len(qc_failed)},
        'bis_testing': {'tickets': bis_tickets, 'total': len(bis_tickets)},
        'approved_for_live': {'tickets': approved_tickets, 'total': len(approved_tickets)},
        'no_qa_estimate': {'tickets': no_qa_estimate, 'total': len(no_qa_estimate)},
        'monthly_summary': monthly_summary,
        'module_workload': module_workload_list,
        'module_pipeline': module_pipeline_list,
        'dev_pipeline_summary': {
            'in_progress': sum(1 for t in all_tickets if t['status'] in ('In Progress', 'Hold/Pending')),
            'code_review': sum(1 for t in all_tickets if t['status'] in ('Start Code Review', 'Code Review Failed', 'Express Lane Review')),
            'cr_passed': sum(1 for t in all_tickets if t['status'] == 'Code Review Passed'),
            'detail': {
                'In Progress': sum(1 for t in all_tickets if t['status'] == 'In Progress'),
                'Hold/Pending': sum(1 for t in all_tickets if t['status'] == 'Hold/Pending'),
                'Start Code Review': sum(1 for t in all_tickets if t['status'] == 'Start Code Review'),
                'Code Review Failed': sum(1 for t in all_tickets if t['status'] == 'Code Review Failed'),
                'Express Lane Review': sum(1 for t in all_tickets if t['status'] == 'Express Lane Review'),
                'Code Review Passed': sum(1 for t in all_tickets if t['status'] == 'Code Review Passed'),
            },
        },
        'movement_24h': _get_movement_24h(all_tickets, today),
    }


def get_live_team_board(today: Optional[date] = None) -> Dict:
    return _cached_response('team_board', lambda: _compute_team_board(today))

def _compute_team_board(today: Optional[date] = None) -> Dict:
    """Live team board - who is working on what."""
    today = today or date.today()
    success, all_tickets, msg = fetch_live_tickets()
    if not success:
        return {'error': msg, 'members': [], 'summary': {}}

    # Include QC statuses + Approved for Live (QA needs to verify in prod)
    qa_active_statuses = QC_STATUSES + [APPROVED_STATUS]
    qc_tickets = [t for t in all_tickets if t['status'] in qa_active_statuses]

    # Build tester -> tickets mapping
    tester_map: Dict[str, List[Dict]] = {}
    for t in qc_tickets:
        tester = t.get('qc_tester') or ''
        if tester:
            for name in (n.strip() for n in tester.split(',') if n.strip()):
                key = name.lower()
                if key not in tester_map:
                    tester_map[key] = {'name': name, 'tickets': []}
                tester_map[key]['tickets'].append(t)

    # Get active team members from ownership config
    ownership = load_module_ownership()
    active_team = set(ownership.get('team_members', []))

    # Get all unique QC testers from active QC tickets + active team list
    all_testers = set()
    for t in qc_tickets:
        tester = (t.get('qc_tester') or '').strip()
        if tester:
            for name in (n.strip() for n in tester.split(',') if n.strip()):
                all_testers.add(name)
    # Add active team members even if they have no tickets (shows as idle)
    all_testers |= active_team
    # Remove anyone not in the active team (resigned members)
    if active_team:
        all_testers = all_testers & active_team

    members = []
    busy_count = 0
    idle_count = 0

    for name in sorted(all_testers):
        key = name.lower()
        assigned = tester_map.get(key, {}).get('tickets', [])

        if not assigned:
            activity = 'idle'
            idle_count += 1
        else:
            statuses = [t['status'] for t in assigned]
            if all(s == 'QC Testing Hold' for s in statuses):
                activity = 'on_hold'
            elif 'QC Testing in Progress' in statuses:
                activity = 'active'
                busy_count += 1
            elif APPROVED_STATUS in statuses:
                activity = 'active'
                busy_count += 1
            else:
                activity = 'assigned'
                busy_count += 1

        primary = None
        if assigned:
            scored = sorted(assigned, key=lambda t: -(
                _calculate_score(t, today)['score']
            ))
            pt = scored[0]
            primary = {
                'ticket_id': pt['ticket_id'],
                'title': pt['title'],
                'status': pt['status'],
                'priority': pt['priority'],
                'days_in_qc': pt.get('days_in_qc', 0),
                'eta': pt.get('eta'),
                'module': pt.get('module', ''),
            }

        members.append({
            'employee_id': name.replace(' ', '_'),
            'name': name,
            'designation': '',
            'platform': assigned[0]['platform'] if assigned else 'Web',
            'activity': activity,
            'ticket_count': len(assigned),
            'primary_ticket': primary,
            'all_tickets': [{
                'ticket_id': t['ticket_id'], 'title': t['title'], 'status': t['status'],
                'priority': t['priority'], 'days_in_qc': t.get('days_in_qc', 0),
                'eta': t.get('eta'), 'module': t.get('module', ''),
            } for t in assigned],
            'total_qa_estimate_hours': sum(t.get('qa_estimate_hours', 0) for t in assigned),
            'total_qa_actual_hours': sum(t.get('qa_actual_hours', 0) for t in assigned),
        })

    activity_order = {'active': 0, 'assigned': 1, 'on_hold': 2, 'idle': 3}
    members.sort(key=lambda m: (activity_order.get(m['activity'], 9), m['name']))

    return {
        'members': members,
        'summary': {
            'total_members': len(members),
            'busy': busy_count,
            'idle': idle_count,
            'on_hold': sum(1 for m in members if m['activity'] == 'on_hold'),
            'total_qc_tickets': len(qc_tickets),
            'avg_ageing': 0,
        },
        'status_cards': {
            'QC Testing': sum(1 for t in qc_tickets if t['status'] == 'QC Testing'),
            'QC Testing in Progress': sum(1 for t in qc_tickets if t['status'] == 'QC Testing in Progress'),
            'QC Testing Hold': sum(1 for t in qc_tickets if t['status'] == 'QC Testing Hold'),
        },
    }


def get_live_activity_summary(period: str = 'past_5_days', start_override: Optional[date] = None, end_override: Optional[date] = None) -> Dict:
    """
    Live QA activity summary - shows what each tester is currently assigned to.
    Since we don't have status change history from live API, this shows
    current state: who has what tickets, in what status, priorities.
    """
    today = date.today()
    success, all_tickets, msg = fetch_live_tickets()
    if not success:
        return {'error': msg, 'members': [], 'team_stats': {}, 'period': period, 'start_date': '', 'end_date': ''}

    cycle_tracker = _load_cycle_tracker()

    # All QC + QC Failed + BIS tickets (active work)
    active_statuses = QC_STATUSES + QC_FAIL_STATUSES + [BIS_STATUS, APPROVED_STATUS]
    active_tickets = [t for t in all_tickets if t['status'] in active_statuses]

    # Recently closed tickets (closed_on within period)
    if start_override and end_override:
        start_date, end_date = start_override, end_override
    elif period == 'current_month':
        start_date = date(today.year, today.month, 1)
        end_date = today
    else:  # past_5_days
        start_date = today - timedelta(days=7)  # 7 calendar days to cover 5 working days
        end_date = today

    recently_closed = []
    for t in all_tickets:
        closed = _parse_date(t.get('closed_on'))
        if closed and start_date <= closed <= end_date and t.get('qc_tester'):
            recently_closed.append(t)

    # Combine: active + recently closed
    relevant_tickets = active_tickets + recently_closed
    # De-duplicate by ticket_id
    seen = set()
    unique_tickets = []
    for t in relevant_tickets:
        if t['ticket_id'] not in seen:
            seen.add(t['ticket_id'])
            unique_tickets.append(t)

    # Group by tester
    tester_tickets: Dict[str, List[Dict]] = {}
    for t in unique_tickets:
        tester = t.get('qc_tester') or ''
        if not tester:
            continue
        for name in (n.strip() for n in tester.split(',') if n.strip()):
            key = name.lower()
            if key not in tester_tickets:
                tester_tickets[key] = {'name': name, 'tickets': []}
            tester_tickets[key]['tickets'].append(t)

    # Build member stories
    # Fetch TestRail and Redmine data for enrichment
    all_relevant_ids = [t['ticket_id'] for t in unique_tickets]
    _start_external_fetch_if_needed(ticket_ids=all_relevant_ids)
    testrail_data = _testrail_cache.get('data') or {}
    redmine_data = _redmine_cache.get('data') or {}
    testrail_url = os.environ.get('TESTRAIL_URL', 'https://bistrainer.testrail.io')

    member_stories = []
    total_tested = 0
    total_passed = 0
    total_failed = 0

    for key in sorted(tester_tickets.keys()):
        info = tester_tickets[key]
        name = info['name']
        tickets = info['tickets']
        total_tested += len(tickets)

        stats = {
            'total': len(tickets), 'qc_testing': 0, 'in_progress': 0, 'on_hold': 0,
            'qc_failed': 0, 'bis_testing': 0, 'approved': 0, 'closed': 0,
        }
        ticket_items = []

        for t in tickets:
            status = t['status']
            if status == 'QC Testing':
                stats['qc_testing'] += 1
            elif status == 'QC Testing in Progress':
                stats['in_progress'] += 1
            elif status == 'QC Testing Hold':
                stats['on_hold'] += 1
            elif status in QC_FAIL_STATUSES:
                stats['qc_failed'] += 1
                total_failed += 1
            elif status == BIS_STATUS:
                stats['bis_testing'] += 1
                total_passed += 1
            elif status == APPROVED_STATUS:
                stats['approved'] += 1  # Active QA work - verify in prod
            elif status in CLOSED_STATUSES:
                stats['closed'] += 1
                total_passed += 1

            # TestRail data
            tid = t['ticket_id']
            tr = testrail_data.get(tid) or testrail_data.get(str(tid))
            bugs = redmine_data.get(tid) or redmine_data.get(str(tid))

            ticket_items.append({
                'ticket_id': tid,
                'title': t['title'],
                'priority': t['priority'],
                'priority_order': t.get('priority_order', 99),
                'module': t.get('module'),
                'current_status': status,
                'qa_estimate_hours': t.get('qa_estimate_hours'),
                'qa_actual_hours': t.get('qa_actual_hours'),
                'dev_estimate_hours': t.get('dev_estimate_hours'),
                'actual_dev_hours': t.get('actual_dev_hours'),
                'backend_developer': t.get('backend_developer', ''),
                'frontend_developer': t.get('frontend_developer', ''),
                'developers_str': t.get('developers_str', ''),
                'platform': t.get('platform', 'Web'),
                'ticket_type': t.get('ticket_type', ''),
                'eta': t.get('eta'),
                'created_on': t.get('created_on'),
                'closed_on': t.get('closed_on'),
                'test_cases': tr['cases'] if tr else 0,
                'test_passed': tr['passed'] if tr else 0,
                'test_failed': tr['failed'] if tr else 0,
                'test_untested': tr['untested'] if tr else 0,
                'testrail_plan_url': f'{testrail_url}/index.php?/plans/view/{tr["plan_id"]}' if tr else None,
                'bugs_total': bugs['total'] if bugs else 0,
                'bugs_open': bugs['open'] if bugs else 0,
                'bugs_closed': bugs['closed'] if bugs else 0,
                'bugs_released_to_qa': bugs.get('released_to_qa', 0) if bugs else 0,
                'is_refix': (t.get('qa_actual_hours') or 0) > 0 or cycle_tracker.get(str(tid), {}).get('cycle_count', 0) > 0,
            })

        ticket_items.sort(key=lambda t: (PRIORITY_ORDER.get(t['priority'], 99), t['ticket_id']))

        # Build descriptive summary
        summary_lines = []
        active_work = [t for t in ticket_items if t['current_status'] == 'QC Testing in Progress']
        waiting = [t for t in ticket_items if t['current_status'] == 'QC Testing']
        on_hold = [t for t in ticket_items if t['current_status'] == 'QC Testing Hold']
        in_bis = [t for t in ticket_items if t['current_status'] == BIS_STATUS]

        if active_work:
            for t in active_work:
                summary_lines.append(f'Currently testing #{t["ticket_id"]} - {t["title"][:60]} ({t["priority"]})')
        if waiting:
            summary_lines.append(f'{len(waiting)} ticket(s) assigned, waiting to start')
        if on_hold:
            for t in on_hold:
                summary_lines.append(f'#{t["ticket_id"]} on hold - {t["title"][:50]}')
        if in_bis:
            summary_lines.append(f'{len(in_bis)} ticket(s) in BIS Testing')

        # Estimate occupied until date from ETA of active tickets
        occupied_until = None
        for t in active_work + waiting:
            if t.get('eta'):
                eta_d = _parse_date(t['eta'])
                if eta_d and (occupied_until is None or eta_d > occupied_until):
                    occupied_until = eta_d
        # Also estimate from hours: remaining = estimate - actual
        total_remaining_hours = 0
        for t in active_work + waiting:
            est = t.get('qa_estimate_hours') or 0
            act = t.get('qa_actual_hours') or 0
            total_remaining_hours += max(0, est - act)
        if total_remaining_hours > 0:
            remaining_days = max(1, int(total_remaining_hours / 8))
            est_finish = today + timedelta(days=remaining_days)
            summary_lines.append(f'~{total_remaining_hours:.0f}h remaining work (~{remaining_days} working days, est. finish {est_finish.strftime("%b %d")})')
        if occupied_until:
            summary_lines.append(f'Latest ETA: {occupied_until.strftime("%b %d, %Y")}')
        if not summary_lines:
            summary_lines.append('No active QC work')

        member_stories.append({
            'employee_id': name.replace(' ', '_'),
            'name': name,
            'designation': '',
            'platform': tickets[0].get('platform', 'Web') if tickets else 'Web',
            'ticket_count': len(tickets),
            'tickets': ticket_items,
            'stats': stats,
            'summary_lines': summary_lines,
        })

    member_stories.sort(key=lambda m: (-m['ticket_count'], m['name']))
    active_members = sum(1 for m in member_stories if m['ticket_count'] > 0)

    return {
        'period': period,
        'start_date': start_date.isoformat(),
        'end_date': end_date.isoformat(),
        'team_stats': {
            'total_tickets_touched': total_tested,
            'total_passed': total_passed,
            'total_failed': total_failed,
            'active_members': active_members,
            'total_members': len(member_stories),
        },
        'members': member_stories,
    }


def get_live_bis_tracking(today: Optional[date] = None) -> Dict:
    """Live BIS to Closed tracking."""
    today = today or date.today()
    success, all_tickets, msg = fetch_live_tickets()
    if not success:
        return {'error': msg, 'summary': {}, 'closed_tickets': [], 'pending_tickets': []}

    bis_tickets = [t for t in all_tickets if t['status'] == BIS_STATUS]
    approved_tickets = [t for t in all_tickets if t['status'] == APPROVED_STATUS]

    # Use ageing tracker for accurate "days since moved to status"
    tracker = _load_ageing_tracker()

    pending = []
    for t in bis_tickets + approved_tickets:
        ageing = _get_ageing_tracked(t['ticket_id'], t['status'], today, tracker)
        pending.append({
            'ticket_id': t['ticket_id'],
            'title': t['title'],
            'priority': t['priority'],
            'qc_tester': t.get('qc_tester') or '',
            'entered_bis_on': ageing['first_seen'],
            'current_status': t['status'],
            'days_since_bis': ageing['days_in_status'],
            'status_legs': [],
        })

    _save_ageing_tracker(tracker)
    pending.sort(key=lambda t: -t['days_since_bis'])

    still_bis = [p for p in pending if p['current_status'] == BIS_STATUS]
    still_approved = [p for p in pending if p['current_status'] == APPROVED_STATUS]

    return {
        'summary': {
            'total_closed': 0,
            'avg_days_bis_to_closed': 0,
            'still_in_bis': len(still_bis),
            'still_approved': len(still_approved),
            'total_pending': len(pending),
        },
        'closed_tickets': [],
        'pending_tickets': pending,
    }


# ===== MODULE OWNERSHIP & RESOURCE PLANNING =====

_OWNERSHIP_FILE = os.path.join(os.path.dirname(__file__), 'data', 'module_ownership.json')


def load_module_ownership() -> Dict:
    try:
        with open(_OWNERSHIP_FILE, 'r') as f:
            return _json.load(f)
    except (FileNotFoundError, _json.JSONDecodeError):
        return {'modules': {}, 'team_members': [], 'last_updated': None}


def save_module_ownership(data: Dict) -> bool:
    data['last_updated'] = datetime.now().isoformat()
    os.makedirs(os.path.dirname(_OWNERSHIP_FILE), exist_ok=True)
    with open(_OWNERSHIP_FILE, 'w') as f:
        _json.dump(data, f, indent=2)
    return True


def auto_detect_modules_and_members() -> Dict:
    """Detect team members from live PM data. Modules are fixed (15 main modules only)."""
    success, tickets, _ = fetch_live_tickets()
    if not success:
        return {'error': 'Cannot fetch tickets'}

    testers = set()
    for t in tickets:
        tester = (t.get('qc_tester') or '').strip()
        if tester:
            for name in (n.strip() for n in tester.split(',') if n.strip()):
                testers.add(name)

    data = load_module_ownership()
    data['team_members'] = sorted(set(data.get('team_members', [])) | testers)
    save_module_ownership(data)
    return {'modules_count': len(data.get('modules', {})), 'team_members_count': len(data['team_members'])}


def get_live_resource_occupancy(today: Optional[date] = None) -> Dict:
    return _cached_response('resource_occupancy', lambda: _compute_resource_occupancy(today))

def _compute_resource_occupancy(today: Optional[date] = None) -> Dict:
    """Per-member resource occupancy: tickets, hours, finish date, status. Separates Web and Mobile."""
    today = today or date.today()
    success, all_tickets, _ = fetch_live_tickets()
    if not success:
        return {'error': 'Cannot fetch tickets', 'members': [], 'summary': {}}

    ownership = load_module_ownership()
    mobile_team = set(ownership.get('mobile_team', []))
    qa_active_statuses = QC_STATUSES + [APPROVED_STATUS]
    active_tickets = [t for t in all_tickets if t['status'] in qa_active_statuses]

    # Build tester -> tickets
    tester_map: Dict[str, List[Dict]] = {}
    for t in active_tickets:
        tester = (t.get('qc_tester') or '').strip()
        if not tester:
            continue
        for name in (n.strip() for n in tester.split(',') if n.strip()):
            tester_map.setdefault(name, []).append(t)

    # Build reverse ownership lookup: person -> {primary_modules, support_modules}
    person_roles: Dict[str, Dict] = {}
    for mod, cfg in ownership.get('modules', {}).items():
        for name in cfg.get('primary_owners', []):
            person_roles.setdefault(name, {'primary': [], 'support': []})['primary'].append(mod)
        for name in cfg.get('support_owners', []):
            person_roles.setdefault(name, {'primary': [], 'support': []})['support'].append(mod)

    # Module -> unassigned QC ticket count (for primary queue empty check)
    module_qc_count: Dict[str, int] = {}
    for t in all_tickets:
        if t['status'] in QC_STATUSES:
            mod = t.get('module', 'Unassigned')
            module_qc_count[mod] = module_qc_count.get(mod, 0) + 1

    # Only show current team members from config — not resigned/historical testers
    current_team = set(ownership.get('team_members', []))
    automation_team = set(ownership.get('automation_team', []))
    all_names = sorted(current_team)
    members = []
    busy_count = 0
    partial_count = 0
    available_count = 0

    for name in all_names:
        tickets_list = tester_map.get(name, [])
        in_progress = [t for t in tickets_list if t['status'] == 'QC Testing in Progress']
        assigned = [t for t in tickets_list if t['status'] == 'QC Testing' and t.get('qc_tester')]
        on_hold = [t for t in tickets_list if t['status'] == 'QC Testing Hold']
        approved = [t for t in tickets_list if t['status'] == APPROVED_STATUS]

        total = len(tickets_list)
        remaining_hours = sum(max(0, (t.get('qa_estimate_hours') or 0) - (t.get('qa_actual_hours') or 0)) for t in tickets_list)
        remaining_days = max(0, int(remaining_hours / 8)) if remaining_hours > 0 else 0
        est_finish = (today + timedelta(days=remaining_days)).isoformat() if remaining_days > 0 else None

        if len(in_progress) > 0:
            status = 'busy'
            busy_count += 1
        elif total > 0:
            status = 'partially_available'
            partial_count += 1
        else:
            status = 'available'
            available_count += 1

        roles = person_roles.get(name, {'primary': [], 'support': []})
        primary_queue_empty = all(module_qc_count.get(m, 0) == 0 for m in roles['primary']) if roles['primary'] else True
        current_modules = list(set(t.get('module', '') for t in tickets_list if t.get('module')))

        members.append({
            'name': name,
            'status': status,
            'in_progress': len(in_progress),
            'assigned': len(assigned),
            'on_hold': len(on_hold),
            'approved_for_live': len(approved),
            'total_tickets': total,
            'remaining_hours': round(remaining_hours, 1),
            'estimated_finish_date': est_finish,
            'current_modules': current_modules,
            'primary_modules': roles['primary'],
            'support_modules': roles['support'],
            'primary_queue_empty': primary_queue_empty,
            'is_mobile': name in mobile_team,
            'is_automation': name in automation_team,
            'team': 'Automation' if name in automation_team else ('Mobile' if name in mobile_team else 'Web'),
            'tickets': [{
                'ticket_id': t['ticket_id'], 'title': t['title'], 'status': t['status'],
                'priority': t['priority'], 'module': t.get('module', ''),
                'qa_estimate_hours': t.get('qa_estimate_hours', 0),
                'qa_actual_hours': t.get('qa_actual_hours', 0),
                'eta': t.get('eta'),
            } for t in tickets_list],
        })

    members.sort(key=lambda m: ({'busy': 0, 'partially_available': 1, 'available': 2}.get(m['status'], 3), m['name']))

    return {
        'members': members,
        'summary': {
            'total': len(members), 'busy': busy_count,
            'partially_available': partial_count, 'available': available_count,
            'web_count': sum(1 for m in members if m['team'] == 'Web'),
            'mobile_count': sum(1 for m in members if m['team'] == 'Mobile'),
            'automation_count': sum(1 for m in members if m['team'] == 'Automation'),
        },
        'mobile_team': list(mobile_team),
    }


def get_live_assignment_suggestions(today: Optional[date] = None) -> Dict:
    """For each unassigned QC ticket, suggest top 3 candidates with scores."""
    today = today or date.today()
    success, all_tickets, _ = fetch_live_tickets()
    if not success:
        return {'error': 'Cannot fetch tickets', 'suggestions': [], 'unassigned_count': 0}

    ownership = load_module_ownership()
    unassigned = [t for t in all_tickets if t['status'] == 'QC Testing' and not t.get('qc_tester')]

    # Build occupancy data
    occupancy = get_live_resource_occupancy(today)
    member_map = {m['name']: m for m in occupancy.get('members', [])}

    # Build historical expertise: {name: {module: count}}
    expertise: Dict[str, Dict[str, int]] = {}
    for t in all_tickets:
        tester = (t.get('qc_tester') or '').strip()
        if not tester:
            continue
        mod = t.get('module', 'Unassigned')
        for name in (n.strip() for n in tester.split(',') if n.strip()):
            expertise.setdefault(name, {})
            expertise[name][mod] = expertise[name].get(mod, 0) + 1

    # Module -> QC ticket count for primary queue check
    module_qc_count: Dict[str, int] = {}
    for t in all_tickets:
        if t['status'] in QC_STATUSES:
            mod = t.get('module', 'Unassigned')
            module_qc_count[mod] = module_qc_count.get(mod, 0) + 1

    all_candidates = ownership.get('team_members', [])
    if not all_candidates:
        all_candidates = list(member_map.keys())

    suggestions = []
    for ticket in sorted(unassigned, key=lambda t: -PRIORITY_SCORES.get(t.get('priority', ''), 10)):
        mod = ticket.get('module', 'Unassigned')
        est_hours = ticket.get('qa_estimate_hours', 0) or 8
        mod_config = ownership.get('modules', {}).get(mod, {})
        primary_owners = set(mod_config.get('primary_owners', []))
        support_owners = set(mod_config.get('support_owners', []))

        scored = []
        for name in all_candidates:
            m = member_map.get(name, {})
            score = 0
            reasons = []

            # Primary owner: 40 pts
            if name in primary_owners:
                score += 40
                reasons.append('Primary owner')
                role = 'primary'
            # Support owner: 25 pts if primary queue empty
            elif name in support_owners:
                p_mods = [mod2 for mod2, cfg in ownership.get('modules', {}).items() if name in cfg.get('primary_owners', [])]
                p_empty = all(module_qc_count.get(pm, 0) == 0 for pm in p_mods) if p_mods else True
                if p_empty:
                    score += 25
                    reasons.append('Support (primary queue empty)')
                    role = 'support'
                else:
                    reasons.append('Support (primary queue busy)')
                    role = 'support_busy'
            else:
                role = 'available'

            # Workload: 20 pts (less = better)
            active = m.get('total_tickets', 0)
            workload_pts = round(20 * max(0, 1 - min(active / 5, 1)), 1)
            score += workload_pts
            if workload_pts >= 15:
                reasons.append('Low workload')

            # Hours capacity: 10 pts
            remaining = m.get('remaining_hours', 0)
            if remaining < 8:
                score += 10
                reasons.append('Has capacity')
            elif remaining < 24:
                score += 5

            # Historical expertise: 5 pts
            exp = expertise.get(name, {}).get(mod, 0)
            if exp > 0:
                score += 5
                reasons.append(f'Tested {exp} tickets in this module')

            scored.append({
                'name': name,
                'score': round(score, 1),
                'reasons': reasons,
                'role': role,
                'active_tickets': active,
                'remaining_hours': m.get('remaining_hours', 0),
                'status': m.get('status', 'unknown'),
            })

        scored.sort(key=lambda s: -s['score'])
        top3 = scored[:3]

        suggestions.append({
            'ticket_id': ticket['ticket_id'],
            'title': ticket['title'],
            'module': mod,
            'priority': ticket['priority'],
            'qa_estimate_hours': ticket.get('qa_estimate_hours', 0),
            'top_suggestions': top3,
        })

    return {
        'suggestions': suggestions,
        'unassigned_count': len(unassigned),
    }


def get_live_team_queue(today: Optional[date] = None) -> Dict:
    """Per-person view: current work + next suggested tickets from their modules."""
    return _cached_response('team_queue', lambda: _compute_team_queue(today))


def _compute_team_queue(today: Optional[date] = None) -> Dict:
    today = today or date.today()
    success, all_tickets, _ = fetch_live_tickets()
    if not success:
        return {'members': [], 'unassigned_count': 0}

    ownership = load_module_ownership()
    team_members = ownership.get('team_members', [])
    mobile_team = set(ownership.get('mobile_team', []))
    automation_team = set(ownership.get('automation_team', []))

    # QA active tickets by tester
    qa_active = [t for t in all_tickets if t['status'] in QC_STATUSES + [APPROVED_STATUS]]
    tester_tickets: Dict[str, List[Dict]] = {}
    for t in qa_active:
        for name in (n.strip() for n in (t.get('qc_tester') or '').split(',') if n.strip()):
            tester_tickets.setdefault(name, []).append(t)

    # Unassigned QC tickets (potential queue)
    unassigned = [t for t in all_tickets if t['status'] == 'QC Testing' and not t.get('qc_tester')]

    # Track which tickets have been through QC before (refix detection via cycle tracker)
    cycle_tracker = _load_cycle_tracker()

    # Module -> primary/support owners
    modules_config = ownership.get('modules', {})
    person_roles = {}
    for mod, cfg in modules_config.items():
        for name in cfg.get('primary_owners', []):
            person_roles.setdefault(name, {'primary': [], 'support': []})
            person_roles[name]['primary'].append(mod)
        for name in cfg.get('support_owners', []):
            person_roles.setdefault(name, {'primary': [], 'support': []})
            person_roles[name]['support'].append(mod)

    # Module QC count for primary queue check
    module_qc_count: Dict[str, int] = {}
    for t in all_tickets:
        if t['status'] in QC_STATUSES:
            mod = t.get('module', 'Unassigned')
            module_qc_count[mod] = module_qc_count.get(mod, 0) + 1

    # Historical expertise
    expertise: Dict[str, Dict[str, int]] = {}
    for t in all_tickets:
        tester = (t.get('qc_tester') or '').strip()
        if not tester:
            continue
        mod = t.get('module', 'Unassigned')
        for name in (n.strip() for n in tester.split(',') if n.strip()):
            expertise.setdefault(name, {})
            expertise[name][mod] = expertise[name].get(mod, 0) + 1

    members = []
    for name in team_members:
        roles = person_roles.get(name, {'primary': [], 'support': []})
        tickets = tester_tickets.get(name, [])
        in_progress = [t for t in tickets if t['status'] == 'QC Testing in Progress']
        assigned = [t for t in tickets if t['status'] == 'QC Testing']
        on_hold = [t for t in tickets if t['status'] == 'QC Testing Hold']
        approved = [t for t in tickets if t['status'] == APPROVED_STATUS]
        total = len(tickets)
        remaining_hours = round(sum(max(0, (t.get('qa_estimate_hours') or 0) - (t.get('qa_actual_hours') or 0)) for t in tickets), 1)

        if len(in_progress) > 0:
            status = 'busy'
        elif total > 0:
            status = 'partially_available'
        else:
            status = 'available'

        primary_queue_empty = all(module_qc_count.get(m, 0) == 0 for m in roles['primary']) if roles['primary'] else True

        # Score unassigned tickets for this person — find their best next tickets
        next_tickets = []
        for ticket in sorted(unassigned, key=lambda t: -PRIORITY_SCORES.get(t.get('priority', ''), 10)):
            mod = ticket.get('module', 'Unassigned')
            mod_config = modules_config.get(mod, {})
            score = 0
            reasons = []

            if name in mod_config.get('primary_owners', []):
                score += 40
                reasons.append('Primary owner')
            elif name in mod_config.get('support_owners', []):
                if primary_queue_empty:
                    score += 25
                    reasons.append('Support (queue clear)')
                else:
                    score += 10
                    reasons.append('Support')
            else:
                continue  # Skip tickets not in their modules

            # Workload bonus
            workload_pts = round(20 * max(0, 1 - min(total / 5, 1)), 1)
            score += workload_pts

            # Capacity bonus
            if remaining_hours < 8:
                score += 10
            elif remaining_hours < 24:
                score += 5

            # Expertise bonus
            exp = expertise.get(name, {}).get(mod, 0)
            if exp > 0:
                score += 5
                reasons.append(f'{exp} prior tests')

            is_refix = cycle_tracker.get(str(ticket['ticket_id']), {}).get('cycle_count', 0) > 0 \
                or (ticket.get('qa_actual_hours') or 0) > 0
            next_tickets.append({
                'ticket_id': ticket['ticket_id'], 'title': ticket['title'],
                'module': mod, 'priority': ticket['priority'], 'status': ticket['status'],
                'qa_estimate_hours': ticket.get('qa_estimate_hours', 0),
                'score': round(score, 1), 'reasons': reasons,
                'is_refix': is_refix,
            })

        next_tickets.sort(key=lambda t: -t['score'])

        members.append({
            'name': name,
            'status': status,
            'team': 'Automation' if name in automation_team else ('Mobile' if name in mobile_team else 'Web'),
            'primary_modules': roles['primary'],
            'support_modules': roles['support'],
            'in_progress': len(in_progress),
            'assigned': len(assigned),
            'on_hold': len(on_hold),
            'approved_for_live': len(approved),
            'total_tickets': total,
            'remaining_hours': remaining_hours,
            'primary_queue_empty': primary_queue_empty,
            'current_tickets': [{
                'ticket_id': t['ticket_id'], 'title': t['title'], 'status': t['status'],
                'priority': t['priority'], 'module': t.get('module', ''),
                'qa_estimate_hours': t.get('qa_estimate_hours', 0),
                'qa_actual_hours': t.get('qa_actual_hours', 0),
                'is_refix': cycle_tracker.get(str(t['ticket_id']), {}).get('cycle_count', 0) > 0
                    or (t.get('qa_actual_hours') or 0) > 0,  # Has prior QA hours = tested before
            } for t in tickets],
            'next_suggested': next_tickets[:3],
        })

    # Sort: busy first, then partial, then available; within same status by name
    members.sort(key=lambda m: ({'busy': 0, 'partially_available': 1, 'available': 2}.get(m['status'], 3), m['name']))

    # Unassigned count per module
    unassigned_by_module = {}
    for t in unassigned:
        mod = t.get('module') or 'Unassigned'
        unassigned_by_module[mod] = unassigned_by_module.get(mod, 0) + 1

    return {
        'members': members,
        'unassigned_count': len(unassigned),
        'unassigned_by_module': [{'module': m, 'count': c} for m, c in sorted(unassigned_by_module.items(), key=lambda x: -x[1])],
    }


def get_live_automation_utilization() -> Dict:
    """Automation utilization: plans data + module stats from TestRail."""
    return _cached_response('auto_utilization', _compute_automation_utilization)


def _compute_automation_utilization() -> Dict:
    import re, base64, requests as _req
    testrail_url = os.environ.get('TESTRAIL_URL', 'https://bistrainer.testrail.io')
    email = os.environ.get('TESTRAIL_EMAIL', '')
    key = os.environ.get('TESTRAIL_API_KEY', '')
    if not email or not key:
        return {'error': 'TestRail not configured'}

    api_base = f'{testrail_url}/index.php?/api/v2'
    cred = base64.b64encode(f'{email}:{key}'.encode()).decode()
    headers = {'Authorization': f'Basic {cred}', 'Content-Type': 'application/json'}
    project_id = int(os.environ.get('TESTRAIL_AUTOMATION_PROJECT_ID', '18'))

    # Fetch all plans
    all_plans = []
    offset = 0
    while True:
        try:
            resp = _req.get(f'{api_base}/get_plans/{project_id}', headers=headers, params={'limit': 250, 'offset': offset}, timeout=30)
            if resp.status_code != 200:
                break
            data = resp.json()
            batch = data.get('plans', [])
            if not batch:
                break
            all_plans.extend(batch)
            offset += len(batch)
            if len(batch) < 250:
                break
        except Exception:
            break

    # Load PM tickets for QA hours
    pm_tickets = {}
    disk = _load_file_cache(_PM_DISK_CACHE)
    if disk:
        for t in disk:
            pm_tickets[t['ticket_id']] = t

    # Module stats from cache
    tr_module_stats = _testrail_module_cache.get('data') or _load_file_cache(_TESTRAIL_MODULE_FILE) or {}
    total_automated = sum(m.get('automated', 0) for m in tr_module_stats.values())
    total_cases = sum(m.get('total_cases', 0) for m in tr_module_stats.values())

    # Process plans
    from collections import defaultdict
    monthly = defaultdict(lambda: {'plans': 0, 'passed': 0, 'failed': 0, 'blocked': 0, 'retest': 0, 'untested': 0, 'total': 0, 'qa_hours_saved': 0})
    plan_list = []
    total_qa_hours_saved = 0

    for p in sorted(all_plans, key=lambda x: -(x.get('created_on') or 0)):
        name = str(p.get('name', '')).strip()
        match = re.match(r'^(\d+)', name)
        ticket_id = int(match.group(1)) if match and int(match.group(1)) > 100 else None

        passed = p.get('passed_count', 0) or 0
        failed = p.get('failed_count', 0) or 0
        blocked = p.get('blocked_count', 0) or 0
        retest = p.get('retest_count', 0) or 0
        untested = p.get('untested_count', 0) or 0
        total = passed + failed + blocked + retest + untested

        qa_hrs = 0
        module = ''
        if ticket_id and ticket_id in pm_tickets:
            pm = pm_tickets[ticket_id]
            qa_hrs = pm.get('qa_estimate_hours', 0) or 0
            module = pm.get('module', '')
        total_qa_hours_saved += qa_hrs

        created = ''
        month_key = ''
        if p.get('created_on'):
            from datetime import datetime as dt
            created = dt.fromtimestamp(p['created_on']).strftime('%Y-%m-%d')
            month_key = dt.fromtimestamp(p['created_on']).strftime('%Y-%m')

        # Split auto vs manual based on module's automation ratio
        mod_stats = tr_module_stats.get(module, {})
        mod_total = mod_stats.get('total_cases', 0)
        mod_auto = mod_stats.get('automated', 0)
        auto_ratio = mod_auto / mod_total if mod_total > 0 else 0
        auto_exec = round(total * auto_ratio)
        manual_exec = total - auto_exec

        plan_list.append({
            'plan_id': p['id'], 'name': name, 'ticket_id': ticket_id, 'module': module,
            'created_on': created, 'total': total, 'passed': passed, 'failed': failed,
            'blocked': blocked, 'retest': retest, 'untested': untested,
            'auto_exec': auto_exec, 'manual_exec': manual_exec,
            'pass_rate': round(passed / total * 100, 1) if total else 0,
            'qa_hours_saved': round(qa_hrs, 1),
        })

        if month_key:
            monthly[month_key]['plans'] += 1
            monthly[month_key]['passed'] += passed
            monthly[month_key]['failed'] += failed
            monthly[month_key]['blocked'] += blocked
            monthly[month_key]['retest'] += retest
            monthly[month_key]['untested'] += untested
            monthly[month_key]['total'] += total
            monthly[month_key]['qa_hours_saved'] += qa_hrs

    total_executed = sum(p.get('passed_count', 0) or 0 for p in all_plans) + sum(p.get('failed_count', 0) or 0 for p in all_plans)
    total_passed = sum(p.get('passed_count', 0) or 0 for p in all_plans)
    total_failed = sum(p.get('failed_count', 0) or 0 for p in all_plans)

    # Module-wise re-execution stats (the value add of automation)
    module_runs = defaultdict(lambda: {'plans': 0, 'total_executions': 0, 'auto_executions': 0, 'manual_executions': 0, 'passed': 0, 'failed': 0, 'tickets': set()})
    for p in plan_list:
        mod = p.get('module') or 'Unassigned'
        if mod and mod != 'Unassigned':
            module_runs[mod]['plans'] += 1
            module_runs[mod]['total_executions'] += p['total']
            module_runs[mod]['auto_executions'] += p.get('auto_exec', 0)
            module_runs[mod]['manual_executions'] += p.get('manual_exec', 0)
            module_runs[mod]['passed'] += p['passed']
            module_runs[mod]['failed'] += p['failed']
            if p.get('ticket_id'):
                module_runs[mod]['tickets'].add(p['ticket_id'])

    # Merge with TestRail module stats (automation case counts)
    module_list = []
    all_module_names = set(tr_module_stats.keys()) | set(module_runs.keys())
    for mod_name in sorted(all_module_names):
        ms = tr_module_stats.get(mod_name, {})
        mr = module_runs.get(mod_name, {})
        automated = ms.get('automated', 0)
        total_execs = mr.get('total_executions', 0)
        # Re-execution ratio: how many times each automated case was run on average
        reuse_ratio = round(total_execs / automated, 1) if automated > 0 else 0
        module_list.append({
            'module': mod_name,
            'total_cases': ms.get('total_cases', 0),
            'automated': automated,
            'automation_pct': round(automated / ms.get('total_cases', 1) * 100) if ms.get('total_cases') else 0,
            'plans_count': mr.get('plans', 0),
            'total_executions': total_execs,
            'auto_executions': mr.get('auto_executions', 0),
            'manual_executions': mr.get('manual_executions', 0),
            'passed': mr.get('passed', 0),
            'failed': mr.get('failed', 0),
            'tickets_covered': len(mr.get('tickets', set())),
            'reuse_ratio': reuse_ratio,
        })
    module_list.sort(key=lambda m: -m['total_executions'])

    monthly_list = [{'month': k, **v} for k, v in sorted(monthly.items())]

    # Weekly + monthly breakdown by module (for execution history tab)
    from datetime import datetime as _dt
    weekly_by_module = defaultdict(lambda: defaultdict(lambda: {'total': 0, 'auto': 0, 'manual': 0, 'plans': 0}))
    for p in plan_list:
        mod = p.get('module') or 'Unassigned'
        if mod == 'Unassigned':
            continue
        if p.get('created_on'):
            d = _dt.strptime(p['created_on'], '%Y-%m-%d')
            wk = (d - timedelta(days=d.weekday())).strftime('%Y-%m-%d')
            weekly_by_module[wk][mod]['total'] += p['total']
            weekly_by_module[wk][mod]['auto'] += p.get('auto_exec', 0)
            weekly_by_module[wk][mod]['manual'] += p.get('manual_exec', 0)
            weekly_by_module[wk][mod]['plans'] += 1

    all_mods = sorted(set(m for wk in weekly_by_module.values() for m in wk.keys()))
    weekly_history = []
    for wk in sorted(weekly_by_module.keys()):
        row = {'week': wk,
               'total': sum(d['total'] for d in weekly_by_module[wk].values()),
               'auto_total': sum(d['auto'] for d in weekly_by_module[wk].values()),
               'manual_total': sum(d['manual'] for d in weekly_by_module[wk].values()),
               'modules': {m: {'total': weekly_by_module[wk].get(m, {}).get('total', 0),
                               'auto': weekly_by_module[wk].get(m, {}).get('auto', 0),
                               'manual': weekly_by_module[wk].get(m, {}).get('manual', 0)} for m in all_mods}}
        weekly_history.append(row)
    execution_modules = all_mods

    # Daily breakdown by module with auto/manual split (for calendar view)
    daily_by_module = defaultdict(lambda: defaultdict(lambda: {'total': 0, 'auto': 0, 'manual': 0, 'plans': 0}))
    for p in plan_list:
        mod = p.get('module') or 'Unassigned'
        if mod == 'Unassigned' or not p.get('created_on'):
            continue
        day_key = p['created_on']
        daily_by_module[day_key][mod]['total'] += p['total']
        daily_by_module[day_key][mod]['auto'] += p.get('auto_exec', 0)
        daily_by_module[day_key][mod]['manual'] += p.get('manual_exec', 0)
        daily_by_module[day_key][mod]['plans'] += 1
    daily_history = []
    for dk in sorted(daily_by_module.keys()):
        mods = {}
        for m, d in daily_by_module[dk].items():
            mods[m] = {'total': d['total'], 'auto': d['auto'], 'manual': d['manual']}
        daily_history.append({
            'date': dk,
            'total': sum(d['total'] for d in daily_by_module[dk].values()),
            'auto_total': sum(d['auto'] for d in daily_by_module[dk].values()),
            'manual_total': sum(d['manual'] for d in daily_by_module[dk].values()),
            'modules': mods,
        })

    # Cumulative module utilization (running total per module, week by week)
    cumulative_by_module = {}
    for mod in execution_modules:
        running = 0
        weeks_data = []
        for wk_row in weekly_history:
            mod_data = wk_row['modules'].get(mod, {})
            val = mod_data.get('total', 0) if isinstance(mod_data, dict) else mod_data
            running += val
            weeks_data.append({'week': wk_row['week'], 'this_week': val, 'cumulative': running})
        cumulative_by_module[mod] = weeks_data

    # Total re-executions across all modules
    total_all_executions = sum(m['total_executions'] for m in module_list)
    total_auto_executions = sum(m.get('auto_executions', 0) for m in module_list)
    total_manual_executions = sum(m.get('manual_executions', 0) for m in module_list)

    return {
        'summary': {
            'total_plans': len(all_plans),
            'total_test_executions': total_all_executions,
            'total_auto_executions': total_auto_executions,
            'total_manual_executions': total_manual_executions,
            'total_passed': total_passed,
            'total_failed': total_failed,
            'pass_rate': round(total_passed / (total_executed) * 100, 1) if total_executed else 0,
            'total_automated_cases': total_automated,
            'total_test_cases': total_cases,
            'automation_coverage': round(total_automated / total_cases * 100, 1) if total_cases else 0,
            'qa_hours_saved': round(total_qa_hours_saved, 1),
            'avg_reuse_ratio': round(total_auto_executions / total_automated, 1) if total_automated else 0,
        },
        'plans': plan_list[:50],
        'monthly_trend': monthly_list,
        'module_coverage': module_list,
        'weekly_history': weekly_history,
        'monthly_history': [],  # Removed in favor of weekly with auto/manual split
        'daily_history': daily_history,
        'execution_modules': execution_modules,
        'cumulative_by_module': cumulative_by_module,
    }


def get_live_module_ownership_matrix(today: Optional[date] = None) -> Dict:
    return _cached_response('module_matrix', lambda: _compute_module_matrix(today))

def _compute_module_matrix(today: Optional[date] = None) -> Dict:
    """Merge ownership config with live ticket counts."""
    today = today or date.today()
    success, all_tickets, _ = fetch_live_tickets()
    ownership = load_module_ownership()

    # Dev workflow statuses (pipeline coming to QA)
    # In Progress -> Hold/Pending -> Start Code Review -> Code Review Failed -> Code Review Passed -> QC Testing
    DEV_NEAR_QC = {'Code Review Passed'}  # Expected soon in QC Testing
    DEV_CODE_REVIEW = {'Start Code Review', 'Code Review Failed'}  # In code review
    DEV_IN_PROGRESS = {'In Progress', 'Hold/Pending'}  # Dev working on it
    DEV_EARLY = {'Planning', 'Ready For Development', 'NEW', 'DRAFT', 'Ready for Design',
                 'Technical Review', 'Design Review', 'Design In Progress'}

    # Count tickets per module by status
    module_counts: Dict[str, Dict[str, int]] = {}
    for t in all_tickets:
        mod = t.get('module', 'Unassigned')
        if mod in ('Unassigned', 'Not Applicable'):
            continue
        if mod not in module_counts:
            module_counts[mod] = {
                'total': 0, 'qc_testing': 0, 'in_progress': 0, 'hold': 0,
                'bis': 0, 'approved': 0, 'closed': 0, 'qc_failed': 0,
                'dev_near_qc': 0, 'dev_code_review': 0, 'dev_in_progress': 0,
                'dev_refix': 0, 'dev_early': 0, 'dev_total': 0,
            }
        module_counts[mod]['total'] += 1
        s = t['status']
        if s == 'QC Testing': module_counts[mod]['qc_testing'] += 1
        elif s == 'QC Testing in Progress': module_counts[mod]['in_progress'] += 1
        elif s == 'QC Testing Hold': module_counts[mod]['hold'] += 1
        elif s == BIS_STATUS: module_counts[mod]['bis'] += 1
        elif s == APPROVED_STATUS: module_counts[mod]['approved'] += 1
        elif s in CLOSED_STATUSES: module_counts[mod]['closed'] += 1
        elif s == 'QC Review Fail': module_counts[mod]['qc_failed'] += 1
        elif s in DEV_NEAR_QC or s in DEV_CODE_REVIEW or s in DEV_IN_PROGRESS or s in DEV_EARLY:
            # Detect refix: ticket has QC tester assigned = QA tested it and it failed back to dev
            is_refix = bool(t.get('qc_tester'))
            if is_refix:
                module_counts[mod]['dev_refix'] += 1
            else:
                if s in DEV_NEAR_QC:
                    module_counts[mod]['dev_near_qc'] += 1
                elif s in DEV_CODE_REVIEW:
                    module_counts[mod]['dev_code_review'] += 1
                elif s in DEV_IN_PROGRESS:
                    module_counts[mod]['dev_in_progress'] += 1
                else:
                    module_counts[mod]['dev_early'] += 1
            module_counts[mod]['dev_total'] += 1

    # Historical expertise per module
    module_experts: Dict[str, List] = {}
    from collections import Counter
    for mod in module_counts:
        expert_count = Counter()
        for t in all_tickets:
            if t.get('module') == mod and t.get('qc_tester'):
                for n in (x.strip() for x in t['qc_tester'].split(',') if x.strip()):
                    expert_count[n] += 1
        module_experts[mod] = [{'name': n, 'count': c} for n, c in expert_count.most_common(5)]

    # Only show main modules from ownership config (not subsets)
    main_modules = list(ownership.get('modules', {}).keys())
    all_modules = main_modules if main_modules else sorted(module_counts.keys())
    matrix = []
    for mod in all_modules:
        cfg = ownership.get('modules', {}).get(mod, {})
        counts = module_counts.get(mod, {})
        qc_active = counts.get('qc_testing', 0) + counts.get('in_progress', 0) + counts.get('hold', 0)
        matrix.append({
            'module': mod,
            'total_tickets': counts.get('total', 0),
            'qc_active': qc_active,
            'in_progress': counts.get('in_progress', 0),
            'bis': counts.get('bis', 0),
            'approved': counts.get('approved', 0),
            'qc_failed': counts.get('qc_failed', 0),
            # Dev pipeline (expected incoming work for QA)
            'dev_total': counts.get('dev_total', 0),
            'dev_near_qc': counts.get('dev_near_qc', 0),  # Code Review Passed - expected soon
            'dev_code_review': counts.get('dev_code_review', 0),  # Start Code Review / Code Review Failed
            'dev_in_progress': counts.get('dev_in_progress', 0),  # First-time In Progress
            'dev_refix': counts.get('dev_refix', 0),  # In Progress after QC Review Fail (refix)
            'dev_early': counts.get('dev_early', 0),  # Planning / NEW / Tech Review etc.
            'primary_owners': cfg.get('primary_owners', []),
            'support_owners': cfg.get('support_owners', []),
            'has_owner': bool(cfg.get('primary_owners')),
            'top_experts': module_experts.get(mod, []),
        })

    # Add TestRail test case stats
    # Refresh TestRail module stats if stale
    _start_external_fetch_if_needed()
    tr_module_stats = _testrail_module_cache.get('data') or _load_file_cache(_TESTRAIL_MODULE_FILE) or {}
    for m in matrix:
        tr = tr_module_stats.get(m['module'], {})
        m['test_cases'] = tr.get('total_cases', 0)
        m['test_automated'] = tr.get('automated', 0)
        m['test_executions'] = tr.get('executions', 0)

    matrix.sort(key=lambda m: (-m['qc_active'], -m['total_tickets']))

    return {
        'matrix': matrix,
        'team_members': ownership.get('team_members', []),
        'total_modules': len(matrix),
        'owned_modules': sum(1 for m in matrix if m['has_owner']),
        'unowned_modules': sum(1 for m in matrix if not m['has_owner']),
    }


# ===== DEV TEAM DASHBOARD =====

# Confirmed dev and QA statuses — ONLY these are relevant
DEV_RELEVANT_STATUSES = {
    'Ready For Development', 'In Progress', 'Hold/Pending',
    'Start Code Review', 'Code Review Failed', 'Code Review Passed',
    'Express Lane Review',
}
QA_RELEVANT_STATUSES = {
    'QC Testing', 'QC Testing in Progress', 'QC Testing Hold',
    'QC Review Fail', 'BIS Testing', 'Tested - Awaiting Fixes',
    'Approved for Live', 'Moved to Live',
}
ALL_RELEVANT_STATUSES = DEV_RELEVANT_STATUSES | QA_RELEVANT_STATUSES

# Keep old DEV_ALL_STATUSES for backward compat
DEV_ALL_STATUSES = DEV_RELEVANT_STATUSES


def _get_stage(status: str) -> str:
    for stage, statuses in DEV_STAGES.items():
        if status in statuses:
            return stage
    return 'other'


def get_live_build_quality() -> Dict:
    """Analyze dev build quality — fail rates, refix patterns, developer/module breakdown."""
    return _cached_response('build_quality', _compute_build_quality)


def _compute_build_quality() -> Dict:
    success, all_tickets, _ = fetch_live_tickets()
    if not success:
        return {'error': 'Cannot fetch'}

    redmine_data = _redmine_cache.get('data') or {}
    cycle_tracker = _load_cycle_tracker()

    # All tickets that went through QA (have qc_tester)
    qa_tested = [t for t in all_tickets if t.get('qc_tester')]
    qc_failed = [t for t in all_tickets if t['status'] == 'QC Review Fail']

    # Refix tickets: in dev statuses with qc_tester (failed back from QA)
    DEV_STATUSES = {'Ready For Development', 'In Progress', 'Hold/Pending',
        'Start Code Review', 'Code Review Failed', 'Code Review Passed',
        'Express Lane Review'}
    refix_in_dev = [t for t in all_tickets if t['status'] in DEV_STATUSES and t.get('qc_tester')]

    # Tickets that passed QA (BIS, Approved, Closed)
    PASSED_STATUSES = {'BIS Testing', 'Approved for Live', 'Moved to Live', 'Closed'}
    qa_passed = [t for t in qa_tested if t['status'] in PASSED_STATUSES]

    # All tickets that ever failed (have cycle_count > 0 or currently in QC Review Fail or refix)
    ever_failed_ids = set()
    for tid_str, ct in cycle_tracker.items():
        if ct.get('cycle_count', 0) > 0:
            ever_failed_ids.add(int(tid_str) if tid_str.isdigit() else 0)
    for t in qc_failed + refix_in_dev:
        ever_failed_ids.add(t['ticket_id'])

    total_qa_tested = len(set(t['ticket_id'] for t in qa_tested))
    total_failed = len(ever_failed_ids)
    fail_rate = round(total_failed / total_qa_tested * 100, 1) if total_qa_tested else 0

    # Analyze failed tickets for quality indicators
    from collections import defaultdict

    # QA hours on failed tickets — low hours = obvious bug = bad build
    failed_ticket_details = []
    for t in qc_failed + refix_in_dev:
        qa_hrs = t.get('qa_actual_hours') or 0
        bugs = redmine_data.get(t['ticket_id']) or redmine_data.get(str(t['ticket_id']))
        bug_count = bugs.get('total', 0) if bugs else 0
        ct = cycle_tracker.get(str(t['ticket_id']), {})
        # Quality verdict
        if qa_hrs < 1 and bug_count > 0:
            verdict = 'Critical — Failed with minimal QA effort (obvious bugs)'
        elif qa_hrs < 2:
            verdict = 'Poor — Basic scenario failure'
        elif bug_count >= 3:
            verdict = 'Poor — Multiple bugs found'
        else:
            verdict = 'Moderate — Found during thorough testing'

        failed_ticket_details.append({
            'ticket_id': t['ticket_id'], 'title': t['title'],
            'module': t.get('module', ''), 'priority': t['priority'],
            'developers_str': t.get('developers_str', ''),
            'qc_tester': t.get('qc_tester', ''),
            'qa_hours_before_fail': round(qa_hrs, 1),
            'bugs_found': bug_count,
            'cycle_count': ct.get('cycle_count', 0),
            'verdict': verdict,
            'status': t['status'],
        })

    # Quality scores
    obvious_failures = len([f for f in failed_ticket_details if 'Critical' in f['verdict'] or 'Basic' in f['verdict']])
    thorough_failures = len([f for f in failed_ticket_details if 'Moderate' in f['verdict']])

    # Developer analysis — enhanced with quality metrics
    dev_stats = defaultdict(lambda: {'total': 0, 'failed': 0, 'refix': 0, 'bugs': 0,
        'dev_hours': 0, 'overrun': 0, 'obvious_fails': 0, 'modules': set()})
    for t in qa_tested:
        devs = t.get('developers_str', '') or ''
        is_failed = t['ticket_id'] in ever_failed_ids
        bugs = redmine_data.get(t['ticket_id']) or redmine_data.get(str(t['ticket_id']))
        bug_count = bugs.get('total', 0) if bugs else 0
        mod = t.get('module', '')
        dev_est = t.get('dev_estimate_hours') or 0
        dev_act = t.get('actual_dev_hours') or 0
        qa_hrs = t.get('qa_actual_hours') or 0

        for dev_name in (d.strip() for d in devs.split(',') if d.strip() and d.strip() != 'Not Assigned'):
            dev_stats[dev_name]['total'] += 1
            dev_stats[dev_name]['bugs'] += bug_count
            dev_stats[dev_name]['dev_hours'] += dev_act
            if dev_est > 0 and dev_act > dev_est:
                dev_stats[dev_name]['overrun'] += 1
            if mod: dev_stats[dev_name]['modules'].add(mod)
            if is_failed:
                dev_stats[dev_name]['failed'] += 1
                if qa_hrs < 2 and bug_count > 0:
                    dev_stats[dev_name]['obvious_fails'] += 1
            if t['status'] in DEV_STATUSES and t.get('qc_tester'):
                dev_stats[dev_name]['refix'] += 1

    dev_list = []
    for name, stats in sorted(dev_stats.items(), key=lambda x: -x[1]['failed']):
        if stats['total'] < 1:
            continue
        bug_density = round(stats['bugs'] / stats['total'], 1) if stats['total'] else 0
        quality_score = max(0, round(100 - stats.get('fail_rate', 0) * 2 - bug_density * 5 - stats['obvious_fails'] * 10))
        fail_rate = round(stats['failed'] / stats['total'] * 100, 1) if stats['total'] else 0
        quality_score = max(0, round(100 - fail_rate * 2 - bug_density * 5 - stats['obvious_fails'] * 10))
        dev_list.append({
            'developer': name,
            'tickets_tested': stats['total'],
            'failed': stats['failed'],
            'refix_in_dev': stats['refix'],
            'fail_rate': fail_rate,
            'bugs_reported': stats['bugs'],
            'bug_density': bug_density,
            'obvious_fails': stats['obvious_fails'],
            'overrun_count': stats['overrun'],
            'quality_score': min(100, quality_score),
            'modules': sorted(stats['modules']),
        })

    # Module analysis
    mod_stats = defaultdict(lambda: {'total': 0, 'failed': 0, 'refix': 0, 'bugs': 0, 'developers': set()})
    for t in qa_tested:
        mod = t.get('module') or 'Unassigned'
        is_failed = t['ticket_id'] in ever_failed_ids
        bugs = redmine_data.get(t['ticket_id']) or redmine_data.get(str(t['ticket_id']))
        bug_count = bugs.get('total', 0) if bugs else 0
        devs = t.get('developers_str', '') or ''

        mod_stats[mod]['total'] += 1
        mod_stats[mod]['bugs'] += bug_count
        if is_failed:
            mod_stats[mod]['failed'] += 1
        if t['status'] in DEV_STATUSES and t.get('qc_tester'):
            mod_stats[mod]['refix'] += 1
        for d in (x.strip() for x in devs.split(',') if x.strip() and x.strip() != 'Not Assigned'):
            mod_stats[mod]['developers'].add(d)

    mod_list = []
    for mod, stats in sorted(mod_stats.items(), key=lambda x: -x[1]['failed']):
        if stats['total'] < 1:
            continue
        mod_list.append({
            'module': mod,
            'tickets_tested': stats['total'],
            'failed': stats['failed'],
            'refix_in_dev': stats['refix'],
            'fail_rate': round(stats['failed'] / stats['total'] * 100, 1) if stats['total'] else 0,
            'bugs_reported': stats['bugs'],
            'developers': sorted(stats['developers']),
        })

    # Add bug density + obvious fails to modules
    for m in mod_list:
        m['bug_density'] = round(m['bugs_reported'] / m['tickets_tested'], 1) if m['tickets_tested'] else 0

    # Current QC Fail details
    fail_details = []
    for t in qc_failed:
        bugs = redmine_data.get(t['ticket_id']) or redmine_data.get(str(t['ticket_id']))
        ct = cycle_tracker.get(str(t['ticket_id']), {})
        fail_details.append({
            'ticket_id': t['ticket_id'], 'title': t['title'], 'priority': t['priority'],
            'module': t.get('module', ''), 'developers_str': t.get('developers_str', ''),
            'qc_tester': t.get('qc_tester', ''), 'cycle_count': ct.get('cycle_count', 0),
            'bugs_total': bugs.get('total', 0) if bugs else 0,
            'bugs_open': bugs.get('open', 0) if bugs else 0,
        })

    return {
        'summary': {
            'total_qa_tested': total_qa_tested,
            'total_failed': total_failed,
            'fail_rate': fail_rate,
            'currently_in_qc_fail': len(qc_failed),
            'refix_in_dev': len(refix_in_dev),
            'total_qa_passed': len(qa_passed),
            'pass_rate': round(len(qa_passed) / total_qa_tested * 100, 1) if total_qa_tested else 0,
            'obvious_failures': obvious_failures,
            'thorough_failures': thorough_failures,
            'build_quality_score': max(0, round(100 - (obvious_failures / max(total_failed, 1)) * 100)),
        },
        'developers': dev_list[:30],
        'modules': mod_list,
        'current_failures': fail_details,
        'failed_ticket_analysis': sorted(failed_ticket_details, key=lambda x: x.get('qa_hours_before_fail', 99)),
    }


def get_live_dev_dashboard(today: Optional[date] = None) -> Dict:
    return _cached_response('dev_dashboard', lambda: _compute_dev_dashboard(today))

def _compute_dev_dashboard(today: Optional[date] = None) -> Dict:
    """Dev team insights with QA/failed tracking, bug counts, overrun detection."""
    today = today or date.today()
    success, all_tickets, _ = fetch_live_tickets()
    if not success:
        return {'error': 'Cannot fetch', 'summary': {}, 'developers': [], 'tickets': [], 'modules': []}

    # Load external data — include ALL relevant ticket IDs for Redmine fetch
    all_relevant_pre = [t for t in all_tickets if t['status'] in ALL_RELEVANT_STATUSES]
    all_relevant_ids = [t['ticket_id'] for t in all_relevant_pre]
    _start_external_fetch_if_needed(ticket_ids=all_relevant_ids)
    testrail_data = _testrail_cache.get('data') or {}
    redmine_data = _redmine_cache.get('data') or {}
    cycle_tracker = _update_cycle_tracker(all_tickets, today)
    ageing_tracker = _load_ageing_tracker()

    # ONLY relevant statuses — no Planning, Technical Review, NEW, DRAFT, etc.
    all_relevant = [t for t in all_tickets if t['status'] in ALL_RELEVANT_STATUSES]
    dev_tickets = [t for t in all_relevant if t['status'] in DEV_RELEVANT_STATUSES]
    qa_tickets = [t for t in all_relevant if t['status'] in QA_RELEVANT_STATUSES]

    # Enrich each ticket
    for t in all_relevant:
        tid = t['ticket_id']
        t['stage'] = t['status']  # Use actual PM status as stage label
        t['stage_label'] = t['status']
        # Refix: has QC tester AND is in a dev status (not QA status)
        t['is_refix'] = bool(t.get('qc_tester')) and t['status'] in DEV_RELEVANT_STATUSES

        # Category: dev or qa
        if t['status'] in DEV_RELEVANT_STATUSES:
            t['category'] = 'dev'
        else:
            t['category'] = 'qa'

        # Overrun: actual > estimate
        dev_est = t.get('dev_estimate_hours') or 0
        dev_act = t.get('actual_dev_hours') or 0
        qa_est = t.get('qa_estimate_hours') or 0
        qa_act = t.get('qa_actual_hours') or 0
        t['dev_overrun'] = round(dev_act - dev_est, 1) if dev_est > 0 and dev_act > dev_est else 0
        t['qa_overrun'] = round(qa_act - qa_est, 1) if qa_est > 0 and qa_act > qa_est else 0
        t['is_dev_overrun'] = dev_est > 0 and dev_act > dev_est
        t['is_qa_overrun'] = qa_est > 0 and qa_act > qa_est

        # Ageing (for QA/failed/BIS tickets)
        age_entry = ageing_tracker.get(str(tid), {})
        if age_entry.get('status') == t['status']:
            first_seen = _parse_date(age_entry.get('first_seen'))
            t['ageing_days'] = max(0, (today - first_seen).days) if first_seen else 0
        else:
            t['ageing_days'] = 0

        # Cycle count
        ct = cycle_tracker.get(str(tid), {})
        t['cycle_count'] = ct.get('cycle_count', 0)

        # Bug data (for QA/failed tickets)
        bugs = redmine_data.get(tid) or redmine_data.get(str(tid))
        if bugs:
            t['bugs_total'] = bugs.get('total', 0)
            t['bugs_open'] = bugs.get('open', 0)
            t['bugs_closed'] = bugs.get('closed', 0)
            t['bugs_released_to_qa'] = bugs.get('released_to_qa', 0)
        else:
            t['bugs_total'] = 0; t['bugs_open'] = 0; t['bugs_closed'] = 0; t['bugs_released_to_qa'] = 0

        # TestRail
        tr = testrail_data.get(tid) or testrail_data.get(str(tid))
        t['test_cases'] = tr.get('cases', 0) if tr else 0
        t['test_passed'] = tr.get('passed', 0) if tr else 0
        t['test_failed'] = tr.get('failed', 0) if tr else 0

    # Summary
    # Per-status counts
    from collections import Counter as _Counter
    dev_status_counts = _Counter(t['status'] for t in dev_tickets if not t['is_refix'])
    refix_status_counts = _Counter(t['status'] for t in dev_tickets if t['is_refix'])
    qa_status_counts = _Counter(t['status'] for t in qa_tickets)
    refix_count = sum(1 for t in dev_tickets if t['is_refix'])
    dev_overrun_count = sum(1 for t in dev_tickets if t['is_dev_overrun'])

    # Developer-wise — use ALL relevant tickets, de-duplicate per developer
    dev_map = {}
    for t in all_relevant:
        # De-duplicate developers per ticket (backend_dev == frontend_dev)
        # Split comma-separated names (PM sometimes has "Name1, Name2" as one entry)
        seen_devs = set()
        raw_devs = []
        for d in t.get('developers', []):
            if not d: continue
            if ',' in d:
                raw_devs.extend(part.strip() for part in d.split(',') if part.strip())
            else:
                raw_devs.append(d)
        for d in raw_devs:
            if not d or d in seen_devs:
                continue
            seen_devs.add(d)
            if d not in dev_map:
                dev_map[d] = {'name': d, 'tickets': [], 'seen_tids': set(), 'modules': set(), 'stages': {},
                              'refix_count': 0, 'total_dev_est': 0, 'total_dev_actual': 0}
            # Skip if ticket already added for this developer
            if t['ticket_id'] in dev_map[d]['seen_tids']:
                continue
            dev_map[d]['seen_tids'].add(t['ticket_id'])
            dev_map[d]['tickets'].append({
                'ticket_id': t['ticket_id'], 'title': t['title'], 'status': t['status'],
                'stage': t['stage'], 'stage_label': t['stage_label'], 'priority': t['priority'],
                'module': t.get('module', ''), 'platform': t.get('platform', 'Web'),
                'qc_tester': t.get('qc_tester', ''), 'is_refix': t['is_refix'],
                'cycle_count': t.get('cycle_count', 0),
                'current_assignee': t.get('current_assignee', ''),
                'dev_estimate_hours': t.get('dev_estimate_hours', 0),
                'actual_dev_hours': t.get('actual_dev_hours', 0),
                'eta': t.get('eta'),
            })
            dev_map[d]['modules'].add(t.get('module', ''))
            dev_map[d]['stages'][t['status']] = dev_map[d]['stages'].get(t['status'], 0) + 1
            if t['is_refix']:
                dev_map[d]['refix_count'] += 1
            dev_map[d]['total_dev_est'] += t.get('dev_estimate_hours', 0) or 0
            dev_map[d]['total_dev_actual'] += t.get('actual_dev_hours', 0) or 0

    developers = []
    for d in sorted(dev_map.values(), key=lambda x: (-x['refix_count'], -len(x['tickets']))):
        st = d['stages']
        developers.append({
            'name': d['name'],
            'ticket_count': len(d['tickets']),
            'in_progress': st.get('In Progress', 0) + st.get('Hold/Pending', 0),
            'code_review': st.get('Start Code Review', 0) + st.get('Code Review Failed', 0),
            'ready_for_qc': st.get('Code Review Passed', 0),
            'ready_for_dev': st.get('Ready For Development', 0),
            'qc_testing': st.get('QC Testing', 0) + st.get('QC Testing in Progress', 0) + st.get('QC Testing Hold', 0),
            'qc_failed': st.get('QC Review Fail', 0) + st.get('Tested - Awaiting Fixes', 0),
            'bis': st.get('BIS Testing', 0),
            'approved': st.get('Approved for Live', 0),
            'moved_to_live': st.get('Moved to Live', 0),
            'refix_count': d['refix_count'],
            'modules': sorted(d['modules'] - {''}),
            'total_dev_est': round(d['total_dev_est'], 1),
            'total_dev_actual': round(d['total_dev_actual'], 1),
            'tickets': d['tickets'],
        })

    # Module-wise — use ALL relevant tickets (dev + qa)
    mod_map = {}
    for t in all_relevant:
        mod = t.get('module', 'Other')
        if mod not in mod_map:
            mod_map[mod] = {'module': mod, 'total': 0, 'statuses': {}, 'refix': 0, 'developers': set()}
        mod_map[mod]['total'] += 1
        s = t['status']
        mod_map[mod]['statuses'][s] = mod_map[mod]['statuses'].get(s, 0) + 1
        if t['is_refix']:
            mod_map[mod]['refix'] += 1
        for d in t.get('developers', []):
            if d:
                mod_map[mod]['developers'].add(d)

    modules = []
    for m in sorted(mod_map.values(), key=lambda x: -x['total']):
        st = m['statuses']
        modules.append({
            'module': m['module'],
            'total': m['total'],
            'in_progress': st.get('In Progress', 0) + st.get('Hold/Pending', 0),
            'code_review': st.get('Start Code Review', 0) + st.get('Code Review Failed', 0),
            'ready_for_qc': st.get('Code Review Passed', 0),
            'ready_for_dev': st.get('Ready For Development', 0),
            'qc_testing': st.get('QC Testing', 0) + st.get('QC Testing in Progress', 0) + st.get('QC Testing Hold', 0),
            'qc_failed': st.get('QC Review Fail', 0) + st.get('Tested - Awaiting Fixes', 0),
            'bis': st.get('BIS Testing', 0),
            'approved': st.get('Approved for Live', 0),
            'moved_to_live': st.get('Moved to Live', 0),
            'refix': m['refix'],
            'developers': sorted(m['developers']),
        })

    # All tickets (for ticket view tab) — includes dev + qa + failed + bis + approved
    def _ticket_item(t):
        return {
            'ticket_id': t['ticket_id'], 'title': t['title'], 'status': t['status'],
            'stage': t.get('stage', ''), 'stage_label': t.get('stage_label', t['status']),
            'category': t.get('category', ''), 'priority': t['priority'],
            'priority_order': t.get('priority_order', 99),
            'module': t.get('module', ''), 'platform': t.get('platform', 'Web'),
            'backend_developer': t.get('backend_developer', ''),
            'frontend_developer': t.get('frontend_developer', ''),
            'developers_str': t.get('developers_str', ''),
            'qc_tester': t.get('qc_tester', ''), 'is_refix': t.get('is_refix', False),
            'dev_estimate_hours': t.get('dev_estimate_hours', 0),
            'actual_dev_hours': t.get('actual_dev_hours', 0),
            'dev_overrun': t.get('dev_overrun', 0), 'is_dev_overrun': t.get('is_dev_overrun', False),
            'qa_estimate_hours': t.get('qa_estimate_hours', 0),
            'qa_actual_hours': t.get('qa_actual_hours', 0),
            'qa_overrun': t.get('qa_overrun', 0), 'is_qa_overrun': t.get('is_qa_overrun', False),
            'ageing_days': t.get('ageing_days', 0), 'cycle_count': t.get('cycle_count', 0),
            'bugs_total': t.get('bugs_total', 0), 'bugs_open': t.get('bugs_open', 0),
            'bugs_closed': t.get('bugs_closed', 0), 'bugs_released_to_qa': t.get('bugs_released_to_qa', 0),
            'test_cases': t.get('test_cases', 0), 'test_passed': t.get('test_passed', 0),
            'test_failed': t.get('test_failed', 0),
            'current_assignee': t.get('current_assignee', ''),
            'eta': t.get('eta'), 'created_on': t.get('created_on'),
        }

    ticket_list = [_ticket_item(t) for t in all_relevant]
    # Filter to only our dev team employees (exclude client names)
    try:
        from database import SessionLocal as _SL
        from models import Employee as _Emp
        _db = _SL()
        our_dev_names = set(e.name for e in _db.query(_Emp).filter(_Emp.is_active == True, _Emp.team == 'DEVELOPMENT').all())
        _db.close()
    except Exception:
        our_dev_names = set()

    all_devs_raw = sorted(set(d for t in all_relevant for d in t.get('developers', []) if d))
    if our_dev_names:
        import re as _re
        # Build lookup with exact names + known PM aliases
        our_lookup = set()
        for n in our_dev_names:
            normalized = _re.sub(r'\s+', ' ', n.lower().strip())
            our_lookup.add(normalized)
            parts = normalized.split()
            if len(parts) >= 2:
                our_lookup.add(f'{parts[0]} {parts[-1]}')
                # Handle "X Y Z" -> "X Yz" (PM concatenates initials)
                if len(parts) >= 3:
                    concat = ''.join(p[0] for p in parts[1:])
                    our_lookup.add(f'{parts[0]} {concat}')
                    our_lookup.add(f'{parts[0]} {"".join(parts[1:])}')

        # Explicit PM name aliases for known mismatches
        pm_aliases = {
            'abhijai kp': True, 'adarsh us': True, 'anoop ben': True,
            'binoy dominic': True, 'gosal ram': True, 'ranimol kr': True,
            'sabareesh rs': True, 'sam isaac': True, 'shyamsundar ps': True,
            'vishnu pramod': True, 'vishnu cs': True, 'midhun gopi': True,
        }
        our_lookup.update(pm_aliases.keys())

        def _is_our_dev(pm_name):
            for part in pm_name.split(','):
                clean = part.strip().split('(')[0].strip().lower()
                clean = _re.sub(r'\s+', ' ', clean).strip()
                if clean in our_lookup:
                    return True
                cparts = clean.split()
                if len(cparts) >= 2 and f'{cparts[0]} {cparts[-1]}' in our_lookup:
                    return True
                # First name only match for single-word PM names
                if len(cparts) >= 1 and any(clean.startswith(k.split()[0]) and len(clean) > 3 for k in our_lookup if ' ' in k):
                    # Verify second part overlaps
                    for k in our_lookup:
                        kp = k.split()
                        if len(kp) >= 2 and len(cparts) >= 2 and kp[0] == cparts[0] and cparts[1][:2] == kp[1][:2]:
                            return True
            return False
        all_devs = [d for d in all_devs_raw if _is_our_dev(d)]
        developers = [d for d in developers if _is_our_dev(d['name'])]
        # Add team members with 0 tickets (skip only if their PM name is already in the list)
        existing_pm_names = set()
        for d in developers:
            pm_clean = d['name'].split('(')[0].strip().lower()
            existing_pm_names.add(pm_clean)

        existing_first_names = set()
        for pm in existing_pm_names:
            parts = pm.split()
            if parts:
                existing_first_names.add(parts[0])
        for our_name in sorted(our_dev_names):
            our_parts = our_name.lower().strip().split()
            # Use first significant name part (skip single-letter prefixes like "B")
            our_first = our_parts[0] if len(our_parts[0]) > 1 else (our_parts[1] if len(our_parts) > 1 else our_parts[0])
            if our_first in existing_first_names:
                continue
            developers.append({
                'name': our_name, 'ticket_count': 0,
                'in_progress': 0, 'code_review': 0, 'ready_for_qc': 0, 'ready_for_dev': 0,
                'qc_testing': 0, 'qc_failed': 0, 'bis': 0, 'approved': 0, 'moved_to_live': 0,
                'refix_count': 0, 'modules': [], 'total_dev_est': 0, 'total_dev_actual': 0, 'tickets': [],
            })
    else:
        all_devs = all_devs_raw

    return {
        'summary': {
            'total_dev': len(dev_tickets),
            'total_qa': len(qa_tickets),
            'total_all': len(all_relevant),
            'total_developers': len(all_devs),
            'dev_status_counts': dict(dev_status_counts),
            'refix_status_counts': dict(refix_status_counts),
            'qa_status_counts': dict(qa_status_counts),
            'refix_count': refix_count,
            'dev_overrun_count': dev_overrun_count,
            'web_count': sum(1 for t in all_relevant if t.get('platform') == 'Web'),
            'mobile_count': sum(1 for t in all_relevant if t.get('platform') == 'Mobile'),
        },
        'developers': developers,
        'tickets': ticket_list,
        'modules': modules,
    }
