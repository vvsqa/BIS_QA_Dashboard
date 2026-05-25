"""Generate Automation Utilization PDF Report — module-wise re-execution value add."""
import os, sys, json, re, base64, time, logging
from datetime import date, timedelta, datetime
from collections import defaultdict

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))
except ImportError:
    pass

import requests
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import inch, cm
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Table, TableStyle, Paragraph,
                                 Spacer, PageBreak, Image)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

REPORTS_DIR = os.path.join(os.path.dirname(__file__), 'reports')
PM_CACHE = os.path.join(os.path.dirname(__file__), 'data', 'pm_tickets_cache.json')
MODULE_CACHE = os.path.join(os.path.dirname(__file__), 'data', 'testrail_module_cache.json')
TESTRAIL_URL = 'https://bistrainer.testrail.io'
TESTRAIL_EMAIL = os.environ.get('TESTRAIL_EMAIL', '')
TESTRAIL_API_KEY = os.environ.get('TESTRAIL_API_KEY', '')
PROJECT_ID = int(os.environ.get('TESTRAIL_AUTOMATION_PROJECT_ID', '18'))
API_BASE = f'{TESTRAIL_URL}/index.php?/api/v2'
CRED = base64.b64encode(f'{TESTRAIL_EMAIL}:{TESTRAIL_API_KEY}'.encode()).decode()
HEADERS = {'Authorization': f'Basic {CRED}', 'Content-Type': 'application/json'}

# Colors
DARK = HexColor('#1a1a2e')
TEAL = HexColor('#14b8a6')
GREEN = HexColor('#22c55e')
RED = HexColor('#ef4444')
AMBER = HexColor('#f59e0b')
BLUE = HexColor('#3b82f6')
LIGHT_BG = HexColor('#f8fafc')
BORDER = HexColor('#e2e8f0')

# Parse args
start_date = end_date = None
for arg in sys.argv[1:]:
    if arg.startswith('--start='): start_date = date.fromisoformat(arg.split('=', 1)[1])
    elif arg.startswith('--end='): end_date = date.fromisoformat(arg.split('=', 1)[1])

today = date.today()
if not start_date or not end_date:
    end_date = today
    start_date = today - timedelta(days=7)

prev_start = start_date - timedelta(days=(end_date - start_date).days)
prev_end = start_date


def tr_get(endpoint, params=None):
    try:
        resp = requests.get(f'{API_BASE}{endpoint}', headers=HEADERS, params=params or {}, timeout=30)
        return resp.json() if resp.status_code == 200 else None
    except Exception:
        return None


def fetch_all(endpoint, key, params=None):
    items, offset = [], 0
    while True:
        data = tr_get(endpoint, {**(params or {}), 'limit': 250, 'offset': offset})
        if not data: break
        batch = data.get(key, []) if isinstance(data, dict) else data
        if not batch: break
        items.extend(batch)
        offset += len(batch)
        if len(batch) < 250: break
        time.sleep(0.3)
    return items


# ===== FETCH DATA =====
logger.info(f'Generating PDF report: {start_date} to {end_date}')

all_plans = fetch_all(f'/get_plans/{PROJECT_ID}', 'plans')
logger.info(f'Fetched {len(all_plans)} plans')

# Load PM data for module mapping + QA hours
pm_tickets = {}
if os.path.exists(PM_CACHE):
    with open(PM_CACHE) as f:
        for t in json.load(f): pm_tickets[t['ticket_id']] = t

# Load module stats
module_stats = {}
if os.path.exists(MODULE_CACHE):
    with open(MODULE_CACHE) as f: module_stats = json.load(f)

start_ts = int(datetime.combine(start_date, datetime.min.time()).timestamp())
end_ts = int(datetime.combine(end_date, datetime.max.time()).timestamp())
prev_start_ts = int(datetime.combine(prev_start, datetime.min.time()).timestamp())
prev_end_ts = int(datetime.combine(prev_end, datetime.max.time()).timestamp())

# Process plans
period_plans = [p for p in all_plans if p.get('created_on') and start_ts <= p['created_on'] <= end_ts]
prev_plans = [p for p in all_plans if p.get('created_on') and prev_start_ts <= p['created_on'] <= prev_end_ts]


def plan_module(p):
    name = str(p.get('name', '')).strip()
    match = re.match(r'^(\d+)', name)
    tid = int(match.group(1)) if match and int(match.group(1)) > 100 else None
    pm = pm_tickets.get(tid, {}) if tid else {}
    return pm.get('module', 'Unassigned'), tid, pm.get('qa_estimate_hours', 0) or 0


def compute_module_data(plans):
    mod_data = defaultdict(lambda: {'plans': 0, 'executions': 0, 'auto_exec': 0, 'manual_exec': 0, 'passed': 0, 'failed': 0, 'qa_hours': 0})
    for p in plans:
        mod, tid, qa_hrs = plan_module(p)
        passed = p.get('passed_count', 0) or 0
        failed = p.get('failed_count', 0) or 0
        total = passed + failed + (p.get('untested_count', 0) or 0) + (p.get('blocked_count', 0) or 0) + (p.get('retest_count', 0) or 0)
        # Auto/manual split based on module automation ratio
        ms = module_stats.get(mod, {})
        mod_total_cases = ms.get('total_cases', 0)
        mod_auto_cases = ms.get('automated', 0)
        auto_ratio = mod_auto_cases / mod_total_cases if mod_total_cases > 0 else 0
        auto_exec = round(total * auto_ratio)
        manual_exec = total - auto_exec
        mod_data[mod]['plans'] += 1
        mod_data[mod]['executions'] += total
        mod_data[mod]['auto_exec'] += auto_exec
        mod_data[mod]['manual_exec'] += manual_exec
        mod_data[mod]['passed'] += passed
        mod_data[mod]['failed'] += failed
        mod_data[mod]['qa_hours'] += qa_hrs
    return dict(mod_data)


current_mod = compute_module_data(period_plans)
prev_mod = compute_module_data(prev_plans)
all_mod = compute_module_data(all_plans)

# Totals
total_automated = sum(m.get('automated', 0) for m in module_stats.values())
total_cases = sum(m.get('total_cases', 0) for m in module_stats.values())
cur_executions = sum(d['executions'] for d in current_mod.values())
prev_executions = sum(d['executions'] for d in prev_mod.values())
all_executions = sum(d['executions'] for d in all_mod.values())
cur_auto = sum(d.get('auto_exec', 0) for d in current_mod.values())
cur_manual = sum(d.get('manual_exec', 0) for d in current_mod.values())
all_auto = sum(d.get('auto_exec', 0) for d in all_mod.values())
all_manual = sum(d.get('manual_exec', 0) for d in all_mod.values())
cur_hours_saved = sum(d['qa_hours'] for d in current_mod.values())

# ===== BUILD PDF =====
os.makedirs(REPORTS_DIR, exist_ok=True)
pdf_path = os.path.join(REPORTS_DIR, f'Automation_Utilization_Report_{end_date.strftime("%Y%m%d")}.pdf')

doc = SimpleDocTemplate(pdf_path, pagesize=landscape(A4), topMargin=1*cm, bottomMargin=1*cm,
                        leftMargin=1.5*cm, rightMargin=1.5*cm)

styles = getSampleStyleSheet()
title_style = ParagraphStyle('Title', parent=styles['Title'], fontSize=18, textColor=DARK, spaceAfter=4)
subtitle_style = ParagraphStyle('Sub', parent=styles['Normal'], fontSize=10, textColor=HexColor('#64748b'), spaceAfter=12)
heading_style = ParagraphStyle('H2', parent=styles['Heading2'], fontSize=13, textColor=DARK, spaceBefore=16, spaceAfter=8)
normal_style = ParagraphStyle('N', parent=styles['Normal'], fontSize=9, textColor=HexColor('#334155'))
small_style = ParagraphStyle('S', parent=styles['Normal'], fontSize=8, textColor=HexColor('#64748b'))

elements = []

# ===== PAGE 1: EXECUTIVE SUMMARY =====
elements.append(Paragraph('BIS Training Solutions', small_style))
elements.append(Paragraph('Automation Utilization Report', title_style))
elements.append(Paragraph(f'{start_date.strftime("%B %d")} — {end_date.strftime("%B %d, %Y")}', subtitle_style))

# Summary cards as table
summary_data = [
    ['Automated\nCases', 'Test Plans', 'Auto\nExecutions', 'Manual\nExecutions', 'Total\nExecutions', 'This Period\n(Auto+Manual)', 'QA Hours\nSaved'],
    [str(total_automated), str(len(all_plans)), str(all_auto), str(all_manual), str(all_executions), f'{cur_auto}+{cur_manual}={cur_executions}', f'{cur_hours_saved:.0f}h'],
]
t = Table(summary_data, colWidths=[3.5*cm]*7)
t.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), DARK), ('TEXTCOLOR', (0, 0), (-1, 0), white),
    ('FONTSIZE', (0, 0), (-1, 0), 8), ('FONTSIZE', (0, 1), (-1, 1), 14),
    ('FONTNAME', (0, 1), (-1, 1), 'Helvetica-Bold'),
    ('ALIGN', (0, 0), (-1, -1), 'CENTER'), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('GRID', (0, 0), (-1, -1), 0.5, BORDER), ('ROWHEIGHTS', (0, 0), (-1, 0), 1*cm), ('ROWHEIGHTS', (0, 1), (-1, 1), 1.2*cm),
    ('TEXTCOLOR', (3, 1), (3, 1), TEAL), ('TEXTCOLOR', (5, 1), (5, 1), GREEN),
]))
elements.append(t)
elements.append(Spacer(1, 12))

# Progress comparison
if prev_executions > 0:
    change = cur_executions - prev_executions
    pct = round(change / prev_executions * 100, 1)
    color = GREEN if change >= 0 else RED
    elements.append(Paragraph(f'<font color="{color.hexval()}">{("+" if change >= 0 else "")}{change} executions vs previous period ({("+" if pct >= 0 else "")}{pct}%)</font>', normal_style))
elements.append(Spacer(1, 8))

# Value add statement
elements.append(Paragraph(f'<b>Value Add:</b> {all_executions} automated test executions across {len(all_plans)} test plans have replaced an equivalent of <b>{cur_hours_saved:.0f} QA hours</b> of manual testing effort this period.', normal_style))

# ===== MODULE-WISE RE-EXECUTION TABLE =====
elements.append(Paragraph('Module-wise Automation Re-execution (Value Add)', heading_style))

mod_header = ['Module', 'Automated\nCases', 'Test Plans', 'Auto\nExec', 'Manual\nExec', 'Total\nExec', 'Reuse\nRatio', 'This Period', 'Change', 'QA Hours\nSaved']
mod_rows = [mod_header]

all_modules = set(list(module_stats.keys()) + list(all_mod.keys()))
for mod_name in sorted(all_modules):
    ms = module_stats.get(mod_name, {})
    am = all_mod.get(mod_name, {})
    cm_data = current_mod.get(mod_name, {})
    pm_data = prev_mod.get(mod_name, {})
    automated = ms.get('automated', 0)
    total_ex = am.get('executions', 0)
    reuse = round(total_ex / automated, 1) if automated > 0 else 0
    cur_ex = cm_data.get('executions', 0)
    prev_ex = pm_data.get('executions', 0)
    change = cur_ex - prev_ex
    qa_hrs = cm_data.get('qa_hours', 0)
    if automated > 0 or total_ex > 0:
        auto_ex = am.get('auto_exec', 0)
        manual_ex = am.get('manual_exec', 0)
        mod_rows.append([
            mod_name, str(automated), str(am.get('plans', 0)),
            str(auto_ex), str(manual_ex), str(total_ex),
            f'{reuse}x', str(cur_ex),
            f'+{change}' if change > 0 else str(change),
            f'{qa_hrs:.0f}h' if qa_hrs > 0 else '-',
        ])

# Totals row
mod_rows.append([
    'TOTAL', str(total_automated), str(len(all_plans)),
    str(all_auto), str(all_manual), str(all_executions),
    f'{round(all_auto/total_automated,1) if total_automated else 0}x',
    str(cur_executions),
    f'+{cur_executions-prev_executions}' if cur_executions >= prev_executions else str(cur_executions-prev_executions),
    f'{cur_hours_saved:.0f}h',
])

col_widths = [3.5*cm, 1.8*cm, 1.5*cm, 1.5*cm, 1.5*cm, 1.5*cm, 1.5*cm, 2*cm, 1.8*cm, 2*cm]
t2 = Table(mod_rows, colWidths=col_widths, repeatRows=1)
t2_style = [
    ('BACKGROUND', (0, 0), (-1, 0), DARK), ('TEXTCOLOR', (0, 0), (-1, 0), white),
    ('FONTSIZE', (0, 0), (-1, 0), 8), ('FONTSIZE', (0, 1), (-1, -1), 8),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('ALIGN', (1, 0), (-1, -1), 'CENTER'), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
    # Total row
    ('BACKGROUND', (0, -1), (-1, -1), HexColor('#e2e8f0')),
    ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
]
# Alternating row colors
for i in range(1, len(mod_rows) - 1):
    if i % 2 == 0:
        t2_style.append(('BACKGROUND', (0, i), (-1, i), LIGHT_BG))
# Color the change column
for i in range(1, len(mod_rows)):
    val = mod_rows[i][8]
    if val.startswith('+') and val != '+0':
        t2_style.append(('TEXTCOLOR', (8, i), (8, i), GREEN))
    elif val.startswith('-'):
        t2_style.append(('TEXTCOLOR', (8, i), (8, i), RED))

t2.setStyle(TableStyle(t2_style))
elements.append(t2)

# ===== PAGE 2: RECENT PLANS =====
elements.append(PageBreak())
elements.append(Paragraph('Recent Test Plans (This Period)', heading_style))

if period_plans:
    plan_header = ['Plan Name', 'Ticket', 'Module', 'Date', 'Total', 'Passed', 'Failed']
    plan_rows = [plan_header]
    for p in sorted(period_plans, key=lambda x: -(x.get('created_on') or 0)):
        mod, tid, _ = plan_module(p)
        name = str(p.get('name', ''))[:30]
        created = datetime.fromtimestamp(p['created_on']).strftime('%Y-%m-%d') if p.get('created_on') else ''
        passed = p.get('passed_count', 0) or 0
        failed = p.get('failed_count', 0) or 0
        total = passed + failed + (p.get('untested_count', 0) or 0) + (p.get('blocked_count', 0) or 0) + (p.get('retest_count', 0) or 0)
        plan_rows.append([name, str(tid or '-'), mod or '-', created, str(total), str(passed), str(failed)])

    t3 = Table(plan_rows, colWidths=[5*cm, 2*cm, 4*cm, 2.5*cm, 2*cm, 2*cm, 2*cm], repeatRows=1)
    t3.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), DARK), ('TEXTCOLOR', (0, 0), (-1, 0), white),
        ('FONTSIZE', (0, 0), (-1, -1), 8), ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('ALIGN', (3, 0), (-1, -1), 'CENTER'), ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
    ]))
    elements.append(t3)
else:
    elements.append(Paragraph('No test plans created in this period.', normal_style))

# ===== PAGE 3: WEEKLY EXECUTION HISTORY BY MODULE =====
elements.append(PageBreak())
elements.append(Paragraph('Weekly Automated Execution History by Module', heading_style))

# Build weekly breakdown
weekly_by_mod = defaultdict(lambda: defaultdict(int))
all_weeks = set()
for p in all_plans:
    mod, tid, _ = plan_module(p)
    if mod == 'Unassigned' or not p.get('created_on'):
        continue
    d = datetime.fromtimestamp(p['created_on'])
    wk = (d - timedelta(days=d.weekday())).strftime('%Y-%m-%d')
    total = sum(p.get(k, 0) or 0 for k in ['passed_count', 'failed_count', 'untested_count', 'blocked_count', 'retest_count'])
    weekly_by_mod[wk][mod] += total
    all_weeks.add(wk)

active_mods = sorted(set(m for wk in weekly_by_mod.values() for m in wk.keys()))
sorted_weeks = sorted(all_weeks)[-12:]  # Last 12 weeks

if active_mods and sorted_weeks:
    wk_header = ['Week'] + [m[:12] for m in active_mods] + ['Total']
    wk_rows = [wk_header]
    for wk in sorted_weeks:
        row = [wk]
        for m in active_mods:
            row.append(str(weekly_by_mod[wk].get(m, 0) or '-'))
        row.append(str(sum(weekly_by_mod[wk].values())))
        wk_rows.append(row)
    # Totals
    tot_row = ['TOTAL']
    for m in active_mods:
        tot_row.append(str(sum(weekly_by_mod[wk].get(m, 0) for wk in sorted_weeks)))
    tot_row.append(str(sum(sum(weekly_by_mod[wk].values()) for wk in sorted_weeks)))
    wk_rows.append(tot_row)

    n_cols = len(wk_header)
    col_w = min(2*cm, (25*cm) / n_cols)
    wk_widths = [2.5*cm] + [col_w] * (n_cols - 2) + [2*cm]

    t4 = Table(wk_rows, colWidths=wk_widths, repeatRows=1)
    t4_style = [
        ('BACKGROUND', (0, 0), (-1, 0), DARK), ('TEXTCOLOR', (0, 0), (-1, 0), white),
        ('FONTSIZE', (0, 0), (-1, -1), 7), ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'), ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('BACKGROUND', (0, -1), (-1, -1), HexColor('#e2e8f0')),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
    ]
    for i in range(1, len(wk_rows) - 1):
        if i % 2 == 0:
            t4_style.append(('BACKGROUND', (0, i), (-1, i), LIGHT_BG))
    t4.setStyle(TableStyle(t4_style))
    elements.append(t4)
else:
    elements.append(Paragraph('No weekly execution data available.', normal_style))

# Footer
elements.append(Spacer(1, 20))
elements.append(Paragraph(f'Generated: {datetime.now().strftime("%d %b %Y %H:%M")}  |  Data from TestRail Project {PROJECT_ID}  |  {len(all_plans)} total plans', small_style))

doc.build(elements)
logger.info(f'PDF saved: {pdf_path}')
print(f'Report: {pdf_path}')
