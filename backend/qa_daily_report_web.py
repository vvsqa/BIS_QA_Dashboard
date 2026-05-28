"""
QA Daily Status Report - HTML Generator

Fetches live data from PM Tracker API and generates a polished HTML dashboard
that opens in the default browser. Mirrors the 5-sheet Excel report:
  Tab 1: Executive Summary  - KPI cards, charts (pie + bar)
  Tab 2: Team Workload      - Tickets grouped by QC tester
  Tab 3: QC Status Dashboard - Tickets by QC status, Web / Mobile split
  Tab 4: Unassigned Tickets  - QC Testing tickets with blank QC Tester
  Tab 5: QC Review Fail      - Tickets back with Dev after QA rejection

Usage:
    python qa_daily_report_web.py              # generate & open today's report
    python qa_daily_report_web.py --out DIR    # custom output directory
"""

import sys, os, json, argparse, webbrowser
from datetime import datetime
from pathlib import Path
from collections import defaultdict, Counter
from html import escape

import requests
from dotenv import load_dotenv

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

load_dotenv()

PM_API_URL = os.getenv(
    "PM_API_URL", "https://www.bissafety.app/rest/v.01/pm/ticket-export"
)
PM_API_KEY = os.getenv("PM_API_KEY", "")
REPORTS_DIR = Path(__file__).resolve().parent / "reports"
CLOSED_STATUSES = {"Closed", "Moved to Live"}
QC_ACTIVE_STATUSES = {
    "QC Testing", "QC Testing in Progress", "QC Testing Hold", "QC Review Fail",
}
MOBILE_KEYWORDS = {"Mobile", "SafeTapp"}

# ---------------------------------------------------------------------------
# Dark Theme Palette
# ---------------------------------------------------------------------------
BG_BASE      = "#0B1120"
BG_PANEL     = "#111B2E"
BG_ELEVATED  = "#162036"
BG_HEADER    = "#0D1526"
BG_ROW_A     = "#0F1729"
BG_ROW_B     = "#131D30"
BG_TABLE_HDR = "#1A2744"

ACC_CYAN     = "#00D2FF"
ACC_TEAL     = "#00C9A7"
ACC_BLUE     = "#3B82F6"
ACC_GREEN    = "#22C55E"
ACC_YELLOW   = "#FACC15"
ACC_ORANGE   = "#F97316"
ACC_RED      = "#EF4444"
ACC_PURPLE   = "#A855F7"
ACC_PINK     = "#EC4899"

TXT_WHITE    = "#F1F5F9"
TXT_LIGHT    = "#94A3B8"
TXT_DIM      = "#64748B"

STATUS_COLORS = {
    "QC Testing":              ACC_CYAN,
    "QC Testing in Progress":  ACC_GREEN,
    "QC Testing Hold":         ACC_YELLOW,
    "QC Review Fail":          ACC_RED,
    "Tested - Awaiting Fixes": ACC_PURPLE,
    "BIS Testing":             ACC_TEAL,
    "In Progress":             ACC_ORANGE,
    "Approved for Live":       ACC_GREEN,
    "Testing In Progress":     ACC_GREEN,
    "Start Code Review":       ACC_BLUE,
    "Code Review Failed":      ACC_RED,
    "Code Review Passed":      ACC_GREEN,
    "Technical Review":        ACC_PURPLE,
    "Planning":                ACC_BLUE,
    "Backlog":                 TXT_DIM,
    "NEW":                     ACC_CYAN,
}

STATUS_BG = {
    "QC Testing":              "#1E3A5F",
    "QC Testing in Progress":  "#14532D",
    "QC Testing Hold":         "#422006",
    "QC Review Fail":          "#450A0A",
    "Tested - Awaiting Fixes": "#3B0764",
    "BIS Testing":             "#134E4A",
    "In Progress":             "#431407",
    "Approved for Live":       "#14532D",
    "Testing In Progress":     "#14532D",
}


# ---------------------------------------------------------------------------
# Data fetching
# ---------------------------------------------------------------------------
def fetch_pm_tickets():
    headers = {"authID": PM_API_KEY, "Content-Type": "application/json"}
    print("  Fetching tickets from PM Tracker API...")
    resp = requests.get(PM_API_URL, headers=headers, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    tickets = data.get("data", data) if isinstance(data, dict) else data
    if isinstance(tickets, list):
        tickets = [t for t in tickets if isinstance(t, dict)]
    print(f"  Received {len(tickets)} tickets")
    return tickets


def classify_platform(subdept):
    if not subdept:
        return "Web"
    return "Mobile" if subdept.strip() in MOBILE_KEYWORDS else "Web"


# ---------------------------------------------------------------------------
# HTML helpers
# ---------------------------------------------------------------------------
def e(text):
    """Escape HTML."""
    return escape(str(text)) if text else ""


PRIORITY_COLORS = {
    "Urgent": ACC_RED, "High": ACC_ORANGE, "Medium": ACC_YELLOW,
    "Low": ACC_TEAL, "Normal": ACC_BLUE,
}


def status_badge(status):
    color = STATUS_COLORS.get(status, TXT_LIGHT)
    bg = STATUS_BG.get(status, BG_ROW_A)
    return f'<span class="badge" style="background:{bg};color:{color}">{e(status)}</span>'


def priority_badge(priority):
    p = (priority or "").strip()
    color = PRIORITY_COLORS.get(p, TXT_LIGHT)
    return f'<span class="priority-dot" style="color:{color}" title="{e(p)}">&#9679;</span> {e(p)}'


# ---------------------------------------------------------------------------
# Tab builders - each returns an HTML string
# ---------------------------------------------------------------------------
def build_summary_tab(ongoing, unassigned, all_tickets):
    # Count totals and per-platform
    web_counts = Counter()
    mob_counts = Counter()
    for t in ongoing:
        plat = classify_platform(t.get("Subdepartment"))
        if plat == "Web":
            web_counts[t.get("Status", "")] += 1
        else:
            mob_counts[t.get("Status", "")] += 1

    def _wm(status_keys):
        """Return (total, web, mobile) for one or more status keys."""
        w = sum(web_counts.get(s, 0) for s in status_keys)
        m = sum(mob_counts.get(s, 0) for s in status_keys)
        return w + m, w, m

    all_statuses = list(set(list(web_counts.keys()) + list(mob_counts.keys())))
    t_total, t_web, t_mob = _wm(all_statuses)
    n_testing, tw, tm   = _wm(["QC Testing"])
    n_inprog, iw, im    = _wm(["QC Testing in Progress"])
    n_hold, hw, hm      = _wm(["QC Testing Hold", "QC Testing On-hold"])
    n_fail, fw, fm      = _wm(["QC Review Fail"])
    n_bis, bw, bm       = _wm(["BIS Testing"])
    n_team = len({(t.get("QCTester") or "").strip() for t in ongoing if (t.get("QCTester") or "").strip()})

    # Web/Mobile split for unassigned
    ua_web = sum(1 for t in unassigned if classify_platform(t.get("Subdepartment")) == "Web")
    ua_mob = len(unassigned) - ua_web

    # (label, total, web, mobile, color)
    kpis = [
        ("TOTAL QA ONGOING", len(ongoing), t_web, t_mob, ACC_CYAN),
        ("QC TESTING",       n_testing,    tw,    tm,    ACC_BLUE),
        ("QC IN PROGRESS",   n_inprog,     iw,    im,   ACC_GREEN),
        ("QC ON HOLD",       n_hold,       hw,    hm,   ACC_ORANGE),
        ("QC REVIEW FAIL",   n_fail,       fw,    fm,   ACC_RED),
        ("BIS TESTING",      n_bis,        bw,    bm,   ACC_TEAL),
        ("UNASSIGNED",       len(unassigned), ua_web, ua_mob, ACC_PURPLE),
        ("TEAM MEMBERS",     n_team,       None,  None, ACC_CYAN),
    ]

    kpi_html = ""
    for label, value, web, mob, color in kpis:
        split = ""
        if web is not None:
            split = f'<div class="kpi-split"><span class="kpi-web">W {web}</span><span class="kpi-mob">M {mob}</span></div>'
        kpi_html += f'''
        <div class="kpi-card" style="--accent:{color}">
            <div class="kpi-accent"></div>
            <div class="kpi-value" style="color:{color}">{value}</div>
            <div class="kpi-label">{label}</div>
            {split}
        </div>'''

    # Web vs Mobile breakdown
    qc_ordered = ["QC Testing", "QC Testing in Progress", "QC Testing Hold", "QC Review Fail"]
    web_tot = mob_tot = 0
    table_rows = ""
    for status in qc_ordered:
        matched = [t for t in all_tickets if t.get("Status") == status]
        wc = sum(1 for t in matched if classify_platform(t.get("Subdepartment")) == "Web")
        mc = sum(1 for t in matched if classify_platform(t.get("Subdepartment")) == "Mobile")
        web_tot += wc
        mob_tot += mc
        s_color = STATUS_COLORS.get(status, TXT_LIGHT)
        table_rows += f'''
            <tr>
                <td style="color:{s_color};font-weight:600">{e(status)}</td>
                <td class="center">{wc}</td>
                <td class="center">{mc}</td>
                <td class="center" style="font-weight:700">{wc+mc}</td>
            </tr>'''
    table_rows += f'''
        <tr class="total-row">
            <td>TOTAL</td><td class="center">{web_tot}</td>
            <td class="center">{mob_tot}</td><td class="center">{web_tot+mob_tot}</td>
        </tr>'''

    # Chart data
    pie_labels = json.dumps(["Web", "Mobile"])
    pie_data = json.dumps([web_tot, mob_tot])
    pie_colors = json.dumps([ACC_BLUE, ACC_TEAL])

    bar_labels = json.dumps(["QC Testing", "In Progress", "On Hold", "Review Fail"])
    bar_web = json.dumps([
        sum(1 for t in all_tickets if t.get("Status") == s and classify_platform(t.get("Subdepartment")) == "Web")
        for s in qc_ordered
    ])
    bar_mobile = json.dumps([
        sum(1 for t in all_tickets if t.get("Status") == s and classify_platform(t.get("Subdepartment")) == "Mobile")
        for s in qc_ordered
    ])

    # Ticket load per QA member
    by_tester = defaultdict(int)
    for t in ongoing:
        qc = (t.get("QCTester") or "").strip()
        if qc:
            by_tester[qc] += 1
    sorted_t = sorted(by_tester.items(), key=lambda x: -x[1])
    tester_labels = json.dumps([n.split()[0] + (" " + n.split()[-1][0] + "." if len(n.split()) > 1 else "") for n, _ in sorted_t])
    tester_data = json.dumps([c for _, c in sorted_t])

    return f'''
    <div class="section-title"><span class="accent-bar" style="background:{ACC_CYAN}"></span>KEY METRICS</div>
    <div class="kpi-grid">{kpi_html}</div>

    <div class="section-title"><span class="accent-bar" style="background:{ACC_CYAN}"></span>QC STATUS | WEB vs MOBILE</div>
    <div class="two-col">
        <div class="card">
            <table class="data-table">
                <thead><tr><th>STATUS</th><th>WEB</th><th>MOBILE</th><th>TOTAL</th></tr></thead>
                <tbody>{table_rows}</tbody>
            </table>
        </div>
        <div class="card chart-card">
            <canvas id="pieChart"></canvas>
        </div>
    </div>

    <div class="section-title"><span class="accent-bar" style="background:{ACC_CYAN}"></span>CHARTS</div>
    <div class="charts-row">
        <div class="card chart-card" style="height:320px">
            <h3 class="chart-title">QC Status Distribution - Web vs Mobile</h3>
            <canvas id="statusBarChart"></canvas>
        </div>
        <div class="card chart-card" style="height:{max(220, len(sorted_t) * 36 + 60)}px">
            <h3 class="chart-title">Ticket Load per QA Member</h3>
            <canvas id="testerBarChart"></canvas>
        </div>
    </div>

    <script>
    window._chartData = {{
        pie: {{ labels: {pie_labels}, data: {pie_data}, colors: {pie_colors} }},
        bar: {{ labels: {bar_labels}, web: {bar_web}, mobile: {bar_mobile} }},
        tester: {{ labels: {tester_labels}, data: {tester_data} }}
    }};
    </script>'''


def build_team_tab(ongoing):
    by_tester = defaultdict(list)
    for t in ongoing:
        qc = (t.get("QCTester") or "").strip()
        if qc:
            by_tester[qc].append(t)

    status_order = {
        "QC Testing in Progress": 0, "Testing In Progress": 1,
        "QC Testing": 2, "QC Review Fail": 3, "Tested - Awaiting Fixes": 4,
        "QC Testing Hold": 5, "BIS Testing": 6, "In Progress": 7, "Approved for Live": 8,
    }

    html = ""
    for tester in sorted(by_tester.keys()):
        tasks = sorted(by_tester[tester], key=lambda x: status_order.get(x.get("Status", ""), 99))
        html += f'''
        <div class="tester-block">
            <div class="tester-header">
                <span class="tester-name">{e(tester)}</span>
                <span class="tester-count">{len(tasks)} tickets</span>
            </div>
            <table class="data-table">
                <thead><tr>
                    <th>#</th><th>Ticket</th><th>Title</th><th>Status</th>
                    <th>Priority</th><th>Module</th><th>ETA</th><th>Assignee</th>
                </tr></thead><tbody>'''
        for idx, t in enumerate(tasks, 1):
            status = t.get("Status", "")
            html += f'''
                <tr>
                    <td class="center">{idx}</td>
                    <td class="mono">{e(t.get("TicketNumber", ""))}</td>
                    <td class="title-col">{e((t.get("TicketTitle") or "")[:80])}</td>
                    <td>{status_badge(status)}</td>
                    <td class="center">{priority_badge(t.get("Priority", ""))}</td>
                    <td>{e(t.get("Subdepartment", ""))}</td>
                    <td class="center">{e(t.get("ETA") or "-")}</td>
                    <td>{e(t.get("CurrentAssignee", ""))}</td>
                </tr>'''
        html += '</tbody></table></div>'

    return f'''
    <div class="page-subtitle">{datetime.now().strftime("%A, %B %d, %Y | %I:%M %p")} &nbsp;|&nbsp; {len(by_tester)} members &nbsp;|&nbsp; {len(ongoing)} tickets</div>
    {html}'''


def build_status_tab(all_tickets):
    statuses = ["QC Testing", "QC Testing in Progress", "QC Testing Hold", "QC Review Fail"]
    platforms = [("Web", ACC_BLUE), ("Mobile", ACC_TEAL)]

    html = f'<div class="page-subtitle">{datetime.now().strftime("%B %d, %Y")} &nbsp;|&nbsp; Breakdown by QC Status &nbsp;|&nbsp; Web &amp; Mobile</div>'

    for platform, p_color in platforms:
        html += f'''
        <div class="platform-block">
            <div class="platform-header" style="border-left:4px solid {p_color};border-bottom:2px solid {p_color}">
                {platform.upper()} PLATFORM
            </div>'''

        for status in statuses:
            matched = [
                t for t in all_tickets
                if t.get("Status") == status
                and classify_platform(t.get("Subdepartment")) == platform
            ]
            if not matched:
                continue

            s_color = STATUS_COLORS.get(status, TXT_LIGHT)
            s_bg = STATUS_BG.get(status, BG_ROW_A)
            matched.sort(key=lambda x: (x.get("Priority", ""), x.get("TicketNumber", 0)))

            html += f'''
            <div class="status-sub-header" style="background:{s_bg};color:{s_color}">
                {e(status)} &nbsp;&nbsp;({len(matched)})
            </div>
            <table class="data-table">
                <thead><tr>
                    <th>#</th><th>Ticket</th><th>Title</th><th>Status</th>
                    <th>Priority</th><th>Module</th><th>QC Tester</th><th>ETA</th><th>Assignee</th>
                </tr></thead><tbody>'''

            for idx, t in enumerate(matched, 1):
                html += f'''
                <tr>
                    <td class="center">{idx}</td>
                    <td class="mono">{e(t.get("TicketNumber", ""))}</td>
                    <td class="title-col">{e((t.get("TicketTitle") or "")[:80])}</td>
                    <td>{status_badge(status)}</td>
                    <td class="center">{priority_badge(t.get("Priority", ""))}</td>
                    <td>{e(t.get("Subdepartment", ""))}</td>
                    <td>{e((t.get("QCTester") or "").strip() or "UNASSIGNED")}</td>
                    <td class="center">{e(t.get("ETA") or "-")}</td>
                    <td>{e(t.get("CurrentAssignee", ""))}</td>
                </tr>'''
            html += '</tbody></table>'

        html += '</div>'

    return html


def build_unassigned_tab(unassigned):
    unassigned_sorted = sorted(unassigned, key=lambda x: (x.get("Priority", ""), x.get("TicketNumber", 0)))

    rows = ""
    for idx, t in enumerate(unassigned_sorted, 1):
        status = t.get("Status", "")
        rows += f'''
            <tr>
                <td class="center">{idx}</td>
                <td class="mono">{e(t.get("TicketNumber", ""))}</td>
                <td class="title-col">{e((t.get("TicketTitle") or "")[:80])}</td>
                <td>{status_badge(status)}</td>
                <td class="center">{priority_badge(t.get("Priority", ""))}</td>
                <td>{e(t.get("Subdepartment", ""))}</td>
                <td>{e(t.get("Type", ""))}</td>
                <td>{e(t.get("ReportedBy", ""))}</td>
                <td class="center">{e(t.get("ETA") or "-")}</td>
                <td>{e(t.get("CurrentAssignee", ""))}</td>
            </tr>'''

    return f'''
    <div class="page-subtitle">Tickets in QC Testing status with no QC Tester assigned</div>
    <div class="alert-banner" style="background:{ACC_YELLOW};color:{BG_BASE}">
        {len(unassigned)} TICKETS NEED IMMEDIATE ASSIGNMENT
    </div>
    <table class="data-table">
        <thead><tr>
            <th>#</th><th>Ticket</th><th>Title</th><th>Status</th><th>Priority</th>
            <th>Module</th><th>Type</th><th>Reported By</th><th>ETA</th><th>Assignee</th>
        </tr></thead>
        <tbody>{rows}</tbody>
    </table>
    <div class="summary-footer" style="color:{ACC_PURPLE}">Total unassigned: {len(unassigned)}</div>'''


def build_review_fail_tab(all_tickets):
    qc_fail = [t for t in all_tickets if t.get("Status") == "QC Review Fail"]
    web_fail = [t for t in qc_fail if classify_platform(t.get("Subdepartment")) == "Web"]
    mob_fail = [t for t in qc_fail if classify_platform(t.get("Subdepartment")) == "Mobile"]

    html = f'''
    <div class="page-subtitle">Tickets that failed QA and need developer fixes</div>
    <div class="alert-banner" style="background:{ACC_RED};color:{TXT_WHITE}">
        {len(qc_fail)} TICKETS NEED DEVELOPER ATTENTION
    </div>'''

    for label, tlist, p_color in [("WEB", web_fail, ACC_BLUE), ("MOBILE", mob_fail, ACC_TEAL)]:
        if not tlist:
            continue
        html += f'''
        <div class="section-title"><span class="accent-bar" style="background:{p_color}"></span>{label} &nbsp;({len(tlist)} tickets)</div>
        <table class="data-table">
            <thead><tr>
                <th>#</th><th>Ticket</th><th>Title</th><th>Priority</th>
                <th>Module</th><th>QC Tester</th><th>Backend Dev</th><th>Frontend Dev</th><th>ETA</th>
            </tr></thead><tbody>'''
        for idx, t in enumerate(tlist, 1):
            html += f'''
            <tr>
                <td class="center">{idx}</td>
                <td class="mono">{e(t.get("TicketNumber", ""))}</td>
                <td class="title-col">{e((t.get("TicketTitle") or "")[:80])}</td>
                <td class="center">{priority_badge(t.get("Priority", ""))}</td>
                <td>{e(t.get("Subdepartment", ""))}</td>
                <td>{e((t.get("QCTester") or "").strip())}</td>
                <td>{e(t.get("BackendDeveloper", ""))}</td>
                <td>{e(t.get("FrontendDeveloper", ""))}</td>
                <td class="center">{e(t.get("ETA") or "-")}</td>
            </tr>'''
        html += '</tbody></table>'

    html += f'<div class="summary-footer" style="color:{ACC_RED}">Total: {len(qc_fail)} &nbsp;|&nbsp; Web: {len(web_fail)} &nbsp;|&nbsp; Mobile: {len(mob_fail)}</div>'
    return html


# ---------------------------------------------------------------------------
# Main HTML assembler
# ---------------------------------------------------------------------------
CSS = f"""
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

* {{ margin:0; padding:0; box-sizing:border-box; }}
html {{ scroll-behavior: smooth; }}
body {{
    font-family: 'Inter', 'Segoe UI', -apple-system, sans-serif;
    background: {BG_BASE};
    color: {TXT_WHITE};
    line-height: 1.6;
    min-height: 100vh;
}}

/* --- Scrollbar --- */
::-webkit-scrollbar {{ width: 8px; height: 8px; }}
::-webkit-scrollbar-track {{ background: {BG_BASE}; }}
::-webkit-scrollbar-thumb {{ background: #1E293B; border-radius: 4px; }}
::-webkit-scrollbar-thumb:hover {{ background: #334155; }}

/* --- Header --- */
.report-header {{
    text-align: center;
    padding: 40px 20px 20px;
    background: linear-gradient(180deg, #0E1A30 0%, {BG_BASE} 100%);
    position: relative;
    overflow: hidden;
}}
.report-header::before {{
    content: '';
    position: absolute;
    top: -60%;
    left: 50%;
    transform: translateX(-50%);
    width: 600px;
    height: 300px;
    background: radial-gradient(ellipse, rgba(0,210,255,0.08) 0%, transparent 70%);
    pointer-events: none;
}}
.report-header h1 {{
    font-size: 30px;
    font-weight: 800;
    background: linear-gradient(135deg, {ACC_CYAN}, #60a5fa);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    letter-spacing: 2px;
    margin-bottom: 8px;
    position: relative;
}}
.report-header .date {{
    color: {TXT_DIM};
    font-size: 13px;
    font-weight: 500;
    position: relative;
}}

/* --- Tab navigation --- */
.tab-bar {{
    display: flex;
    gap: 4px;
    background: {BG_HEADER};
    padding: 10px 20px 0;
    position: sticky;
    top: 0;
    z-index: 100;
    border-bottom: 1px solid #1E293B;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    flex-wrap: wrap;
}}
.tab-btn {{
    padding: 11px 22px;
    background: transparent;
    color: {TXT_DIM};
    border: none;
    border-radius: 10px 10px 0 0;
    cursor: pointer;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    transition: all 0.25s ease;
    position: relative;
    border-top: 3px solid transparent;
}}
.tab-btn:hover {{
    background: rgba(255,255,255,0.03);
    color: {TXT_LIGHT};
    transform: translateY(-1px);
}}
.tab-btn.active {{
    background: {BG_BASE};
    color: {ACC_CYAN};
    border-top: 3px solid var(--tab-color, {ACC_CYAN});
    box-shadow: 0 -2px 12px rgba(0,210,255,0.08);
}}
.tab-panel {{
    display: none;
    padding: 28px 36px 48px;
    animation: fadeIn 0.3s ease;
}}
.tab-panel.active {{ display: block; }}
@keyframes fadeIn {{
    from {{ opacity: 0; transform: translateY(8px); }}
    to {{ opacity: 1; transform: translateY(0); }}
}}

/* --- KPI cards --- */
.kpi-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 14px;
    margin: 18px 0 32px;
}}
.kpi-card {{
    background: {BG_PANEL};
    border-radius: 12px;
    padding: 0 18px 18px;
    text-align: center;
    border: 1px solid #1E293B;
    transition: transform 0.2s, box-shadow 0.2s;
    position: relative;
    overflow: hidden;
}}
.kpi-card:hover {{
    transform: translateY(-3px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.3), 0 0 0 1px rgba(0,210,255,0.1);
}}
.kpi-accent {{
    height: 4px;
    background: var(--accent);
    margin: 0 -18px 16px;
    border-radius: 0;
}}
.kpi-value {{
    font-size: 36px;
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: -0.5px;
}}
.kpi-label {{
    font-size: 10px;
    font-weight: 700;
    color: {TXT_DIM};
    margin-top: 6px;
    letter-spacing: 0.8px;
    text-transform: uppercase;
}}
.kpi-split {{
    display: flex;
    justify-content: center;
    gap: 10px;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #1E293B;
    font-size: 11px;
    font-weight: 600;
}}
.kpi-web {{ color: {ACC_BLUE}; }}
.kpi-mob {{ color: {ACC_TEAL}; }}

/* --- Section titles --- */
.section-title {{
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 15px;
    font-weight: 700;
    color: {TXT_WHITE};
    margin: 32px 0 14px;
    padding: 12px 0;
    border-bottom: 1px solid #1E293B;
    letter-spacing: 0.3px;
}}
.accent-bar {{
    width: 4px;
    height: 22px;
    border-radius: 2px;
    flex-shrink: 0;
}}
.page-subtitle {{
    color: {TXT_DIM};
    font-size: 13px;
    margin-bottom: 20px;
    font-weight: 500;
}}

/* --- Layout --- */
.two-col {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin-bottom: 24px;
}}
@media (max-width: 960px) {{ .two-col {{ grid-template-columns: 1fr; }} }}
.card {{
    background: {BG_PANEL};
    border-radius: 12px;
    padding: 20px;
    border: 1px solid #1E293B;
    transition: box-shadow 0.2s;
}}
.card:hover {{ box-shadow: 0 4px 20px rgba(0,0,0,0.2); }}
.charts-row {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin-bottom: 24px;
    align-items: start;
}}
@media (max-width: 960px) {{ .charts-row {{ grid-template-columns: 1fr; }} }}
.chart-card {{
    position: relative;
    display: flex;
    flex-direction: column;
}}
.chart-card canvas {{ flex: 1; min-height: 0; }}
.chart-title {{
    color: {ACC_CYAN};
    font-size: 14px;
    margin-bottom: 12px;
    font-weight: 700;
    letter-spacing: 0.3px;
}}

/* --- Tables --- */
.data-table {{
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 13px;
    margin-bottom: 8px;
}}
.data-table thead th {{
    background: {BG_TABLE_HDR};
    color: {ACC_CYAN};
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 12px 14px;
    text-align: left;
    border-bottom: 2px solid rgba(0,210,255,0.15);
    position: sticky;
    top: 56px;
    z-index: 10;
}}
.data-table thead th:first-child {{ border-radius: 8px 0 0 0; }}
.data-table thead th:last-child {{ border-radius: 0 8px 0 0; }}
.data-table tbody tr {{
    transition: all 0.15s ease;
}}
.data-table tbody tr:nth-child(odd) {{ background: {BG_ROW_A}; }}
.data-table tbody tr:nth-child(even) {{ background: {BG_ROW_B}; }}
.data-table tbody tr:hover {{
    background: {BG_ELEVATED};
    box-shadow: inset 3px 0 0 {ACC_CYAN};
}}
.data-table td {{
    padding: 10px 14px;
    border-bottom: 1px solid rgba(30,41,59,0.6);
    color: {TXT_LIGHT};
    vertical-align: middle;
}}
.data-table .center {{ text-align: center; }}
.data-table .mono {{
    font-family: 'JetBrains Mono', 'Consolas', monospace;
    font-size: 12px;
    color: {ACC_CYAN};
    font-weight: 600;
}}
.data-table .title-col {{ max-width: 420px; }}
.total-row td {{
    background: linear-gradient(135deg, {ACC_CYAN}, #0ea5e9) !important;
    color: {BG_BASE} !important;
    font-weight: 700;
}}

/* --- Badges --- */
.badge {{
    display: inline-block;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    letter-spacing: 0.2px;
    border: 1px solid rgba(255,255,255,0.06);
}}
.priority-dot {{
    font-size: 10px;
    vertical-align: middle;
}}

/* --- Tester blocks --- */
.tester-block {{
    margin-bottom: 20px;
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid #1E293B;
    transition: box-shadow 0.2s;
}}
.tester-block:hover {{ box-shadow: 0 4px 16px rgba(0,0,0,0.25); }}
.tester-header {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: linear-gradient(135deg, {BG_HEADER}, {BG_PANEL});
    padding: 14px 20px;
    border-left: 4px solid {ACC_CYAN};
}}
.tester-name {{
    font-weight: 700;
    font-size: 15px;
    color: {TXT_WHITE};
}}
.tester-count {{
    font-size: 12px;
    font-weight: 700;
    color: {ACC_CYAN};
    background: rgba(0,210,255,0.1);
    padding: 4px 12px;
    border-radius: 20px;
}}
.tester-block .data-table thead th {{ top: 0; }}

/* --- Platform blocks --- */
.platform-block {{ margin-bottom: 32px; }}
.platform-header {{
    font-size: 18px;
    font-weight: 800;
    padding: 14px 24px;
    background: linear-gradient(135deg, {BG_HEADER}, {BG_PANEL});
    margin-bottom: 12px;
    border-radius: 10px;
    letter-spacing: 1px;
}}
.status-sub-header {{
    padding: 10px 24px;
    font-weight: 700;
    font-size: 13px;
    border-left: 4px solid currentColor;
    margin: 12px 0 6px;
    border-radius: 6px;
    letter-spacing: 0.3px;
}}

/* --- Alerts & footers --- */
.alert-banner {{
    padding: 16px 24px;
    font-size: 16px;
    font-weight: 700;
    border-radius: 10px;
    margin-bottom: 20px;
    text-align: center;
    letter-spacing: 0.5px;
    animation: pulseGlow 2s ease-in-out infinite alternate;
}}
@keyframes pulseGlow {{
    from {{ box-shadow: 0 0 8px rgba(0,0,0,0.2); }}
    to {{ box-shadow: 0 0 20px rgba(0,0,0,0.4); }}
}}
.summary-footer {{
    padding: 16px 24px;
    font-size: 14px;
    font-weight: 700;
    background: {BG_HEADER};
    border-radius: 10px;
    margin-top: 16px;
    border: 1px solid #1E293B;
}}

/* --- Scroll to top --- */
.scroll-top {{
    position: fixed;
    bottom: 28px;
    right: 28px;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: {ACC_CYAN};
    color: {BG_BASE};
    border: none;
    cursor: pointer;
    font-size: 20px;
    font-weight: 700;
    box-shadow: 0 4px 16px rgba(0,210,255,0.3);
    opacity: 0;
    transform: translateY(12px);
    transition: all 0.3s;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
}}
.scroll-top.visible {{ opacity: 1; transform: translateY(0); }}
.scroll-top:hover {{ transform: translateY(-2px); box-shadow: 0 6px 24px rgba(0,210,255,0.5); }}

/* --- Tab panel h2 --- */
.tab-panel > h2 {{
    font-size: 24px;
    font-weight: 800;
    margin-bottom: 20px;
    letter-spacing: 0.5px;
}}

/* --- Live status bar --- */
.live-bar {{
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 20px;
    background: {BG_HEADER};
    border-bottom: 1px solid #1E293B;
    font-size: 11px;
    color: {TXT_DIM};
    font-weight: 500;
    transition: background 0.4s;
}}
.live-bar.refreshed {{ background: rgba(34,197,94,0.12); }}
.live-bar-left {{
    display: flex;
    align-items: center;
    gap: 8px;
}}
.live-dot {{
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: {ACC_GREEN};
    animation: livePulse 2s ease-in-out infinite;
}}
@keyframes livePulse {{
    0%, 100% {{ opacity: 1; box-shadow: 0 0 0 0 rgba(34,197,94,0.4); }}
    50% {{ opacity: 0.6; box-shadow: 0 0 0 4px rgba(34,197,94,0); }}
}}
.live-bar-right {{
    display: flex;
    align-items: center;
    gap: 12px;
}}
.refresh-btn {{
    background: none;
    border: 1px solid #334155;
    color: {TXT_LIGHT};
    padding: 3px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    font-size: 11px;
    transition: all 0.2s;
}}
.refresh-btn:hover {{ border-color: {ACC_CYAN}; color: {ACC_CYAN}; }}
.refresh-icon {{
    display: inline-block;
    transition: transform 0.3s;
}}
.refresh-icon.spinning {{ animation: spin 0.8s linear infinite; }}
@keyframes spin {{ to {{ transform: rotate(360deg); }} }}

/* --- Print --- */
@media print {{
    .tab-bar, .scroll-top, .live-bar {{ display: none; }}
    .tab-panel {{ display: block !important; page-break-before: always; padding: 20px; }}
    body {{ background: #fff; color: #222; }}
    .report-header {{ background: none; }}
    .report-header h1 {{ -webkit-text-fill-color: #0f172a; background: none; }}
    .data-table thead th {{ background: #e2e8f0; color: #1a202c; position: static; }}
    .data-table tbody tr {{ background: #fff !important; }}
    .data-table tbody tr:hover {{ box-shadow: none; }}
    .data-table td {{ color: #334155; border-color: #cbd5e1; }}
    .kpi-card {{ border: 1px solid #cbd5e1; }}
    .kpi-value {{ -webkit-text-fill-color: currentColor; }}
    .card {{ border-color: #cbd5e1; }}
    .alert-banner {{ animation: none; }}
}}
"""

TAB_JS = """
function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(tabId).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Scroll-to-top button
window.addEventListener('scroll', function() {
    var btn = document.getElementById('scrollTop');
    if (btn) btn.classList.toggle('visible', window.scrollY > 300);
});
function scrollToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }

// Keyboard navigation
document.addEventListener('keydown', function(ev) {
    if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') return;
    var tabs = Array.from(document.querySelectorAll('.tab-btn'));
    var idx = tabs.findIndex(b => b.classList.contains('active'));
    if (ev.key === 'ArrowRight' && idx < tabs.length - 1) { tabs[idx+1].click(); ev.preventDefault(); }
    if (ev.key === 'ArrowLeft' && idx > 0) { tabs[idx-1].click(); ev.preventDefault(); }
});

// --- Chart initialization ---
var _charts = {};
function initCharts() {
    var d = window._chartData;
    if (!d) return;
    // Destroy old chart instances
    Object.values(_charts).forEach(function(c) { if (c) c.destroy(); });
    _charts = {};

    var pieEl = document.getElementById('pieChart');
    var barEl = document.getElementById('statusBarChart');
    var testerEl = document.getElementById('testerBarChart');

    if (pieEl) {
        _charts.pie = new Chart(pieEl, {
            type: 'doughnut',
            data: {
                labels: d.pie.labels,
                datasets: [{ data: d.pie.data, backgroundColor: d.pie.colors, borderWidth: 0 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#F1F5F9', font: { size: 13 } } },
                    title: { display: true, text: 'Web vs Mobile', color: '#00D2FF', font: { size: 16, weight: 'bold' } }
                }
            }
        });
    }
    if (barEl) {
        _charts.bar = new Chart(barEl, {
            type: 'bar',
            data: {
                labels: d.bar.labels,
                datasets: [
                    { label: 'Web', data: d.bar.web, backgroundColor: '#3B82F6', borderRadius: 4 },
                    { label: 'Mobile', data: d.bar.mobile, backgroundColor: '#00C9A7', borderRadius: 4 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#F1F5F9', font: { size: 12 } }, position: 'top' }
                },
                scales: {
                    x: { ticks: { color: '#F1F5F9' }, grid: { color: '#1E293B' }, stacked: false },
                    y: { ticks: { color: '#F1F5F9' }, grid: { color: '#1E293B' }, beginAtZero: true, stacked: false }
                }
            }
        });
    }
    if (testerEl) {
        _charts.tester = new Chart(testerEl, {
            type: 'bar',
            data: {
                labels: d.tester.labels,
                datasets: [{ data: d.tester.data, backgroundColor: '#00D2FF', borderRadius: 4 }]
            },
            options: {
                indexAxis: 'y',
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                datasets: { bar: { barPercentage: 0.6, categoryPercentage: 0.7 } },
                scales: {
                    x: { ticks: { color: '#F1F5F9' }, grid: { color: '#1E293B' }, beginAtZero: true },
                    y: { ticks: { color: '#F1F5F9', font: { size: 12 } }, grid: { display: false } }
                }
            }
        });
    }
}
document.addEventListener('DOMContentLoaded', initCharts);

// --- Live auto-refresh ---
var REFRESH_INTERVAL = 5 * 60; // seconds
var _lastRefresh = Date.now();
var _refreshTimer = null;
var _isRefreshing = false;

function updateCountdown() {
    var el = document.getElementById('refreshCountdown');
    var indicator = document.getElementById('refreshIndicator');
    if (!el) return;
    var elapsed = Math.floor((Date.now() - _lastRefresh) / 1000);
    var remaining = Math.max(0, REFRESH_INTERVAL - elapsed);
    var min = Math.floor(remaining / 60);
    var sec = remaining % 60;
    if (_isRefreshing) {
        el.textContent = 'Refreshing...';
        if (indicator) indicator.classList.add('spinning');
    } else {
        el.textContent = 'Next refresh: ' + min + ':' + (sec < 10 ? '0' : '') + sec;
        if (indicator) indicator.classList.remove('spinning');
    }
}

function doRefresh() {
    if (_isRefreshing) return;
    _isRefreshing = true;
    updateCountdown();
    // Remember active tab and scroll
    var activeTab = document.querySelector('.tab-btn.active');
    var activeId = activeTab ? activeTab.getAttribute('data-tab') : null;
    var scrollY = window.scrollY;

    fetch(window.location.href + (window.location.href.includes('?') ? '&' : '?') + '_t=' + Date.now())
        .then(function(r) { return r.text(); })
        .then(function(html) {
            var parser = new DOMParser();
            var doc = parser.parseFromString(html, 'text/html');
            // Replace tab panels
            var newPanels = doc.querySelectorAll('.tab-panel');
            var oldPanels = document.querySelectorAll('.tab-panel');
            newPanels.forEach(function(np, i) {
                if (oldPanels[i]) {
                    oldPanels[i].innerHTML = np.innerHTML;
                }
            });
            // Update header date
            var newDate = doc.querySelector('.report-header .date');
            var oldDate = document.querySelector('.report-header .date');
            if (newDate && oldDate) oldDate.textContent = newDate.textContent;
            // Restore active tab
            if (activeId) {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                var btn = document.querySelector('[data-tab="' + activeId + '"]');
                var panel = document.getElementById(activeId);
                if (btn) btn.classList.add('active');
                if (panel) panel.classList.add('active');
            }
            // Extract new chart data and re-init charts
            var newScript = doc.querySelector('#summary script');
            if (newScript) {
                try { (new Function(newScript.textContent))(); } catch(e) {}
                initCharts();
            }
            // Restore scroll
            window.scrollTo(0, scrollY);
            _lastRefresh = Date.now();
            _isRefreshing = false;
            updateCountdown();
            // Flash the status bar green briefly
            var bar = document.getElementById('liveBar');
            if (bar) { bar.classList.add('refreshed'); setTimeout(function() { bar.classList.remove('refreshed'); }, 1500); }
        })
        .catch(function(err) {
            console.error('Refresh failed:', err);
            _isRefreshing = false;
            updateCountdown();
        });
}

document.addEventListener('DOMContentLoaded', function() {
    _refreshTimer = setInterval(function() {
        var elapsed = (Date.now() - _lastRefresh) / 1000;
        if (elapsed >= REFRESH_INTERVAL) doRefresh();
        updateCountdown();
    }, 1000);
    updateCountdown();
});
"""


def generate_report(output_dir=None):
    """Generate a static HTML file (for --static mode)."""
    print("\n" + "=" * 60)
    print("  QA DAILY STATUS REPORT GENERATOR (HTML)")
    print("=" * 60)
    print("  Building HTML report...")

    html = build_full_html()

    out_dir = Path(output_dir) if output_dir else REPORTS_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    filepath = out_dir / "QA_Daily_Status_Report.html"

    filepath.write_text(html, encoding="utf-8")

    print(f"\n  Report saved: {filepath}")
    print(f"  File size: {filepath.stat().st_size / 1024:.1f} KB")
    print("=" * 60 + "\n")
    return filepath


# ---------------------------------------------------------------------------
# Local live server
# ---------------------------------------------------------------------------
def run_server(port=5050):
    """Run a lightweight local HTTP server that serves a live dashboard."""
    from http.server import HTTPServer, BaseHTTPRequestHandler
    import threading

    class DashboardHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/" or self.path.startswith("/?"):
                try:
                    html = build_full_html()
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                    self.end_headers()
                    self.wfile.write(html.encode("utf-8"))
                except Exception as exc:
                    self.send_response(500)
                    self.send_header("Content-Type", "text/plain")
                    self.end_headers()
                    self.wfile.write(f"Error generating report: {exc}".encode())
            else:
                self.send_response(404)
                self.end_headers()

        def log_message(self, fmt, *args):
            # Quieter logging - only show refresh events
            if "GET / " in (fmt % args):
                ts = datetime.now().strftime("%I:%M:%S %p")
                print(f"  [{ts}] Dashboard refreshed")

    print("\n" + "=" * 60)
    print("  QA DAILY STATUS REPORT - LIVE DASHBOARD")
    print("=" * 60)
    print(f"\n  Starting live server on http://localhost:{port}")
    print(f"  Auto-refresh: every 5 minutes")
    print(f"  Press Ctrl+C to stop\n")

    server = HTTPServer(("127.0.0.1", port), DashboardHandler)

    # Open browser after a short delay
    def open_browser():
        import time; time.sleep(1)
        webbrowser.open(f"http://localhost:{port}")
    threading.Thread(target=open_browser, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server stopped.")
        server.server_close()


def build_full_html():
    """Fetch live data and return the complete HTML page."""
    all_tickets = fetch_pm_tickets()

    ongoing = [
        t for t in all_tickets
        if (t.get("QCTester") or "").strip()
        and (t.get("Status") or "").strip() not in CLOSED_STATUSES
    ]
    unassigned = [
        t for t in all_tickets
        if not (t.get("QCTester") or "").strip()
        and (t.get("Status") or "").strip() in QC_ACTIVE_STATUSES
    ]

    tabs = [
        ("summary",     "Executive Summary",     ACC_CYAN,   build_summary_tab(ongoing, unassigned, all_tickets)),
        ("team",        "Team Workload",          ACC_BLUE,   build_team_tab(ongoing)),
        ("status",      "QC Status Dashboard",    ACC_GREEN,  build_status_tab(all_tickets)),
        ("unassigned",  "Unassigned Tickets",     ACC_PURPLE, build_unassigned_tab(unassigned)),
        ("reviewfail",  "QC Review Fail",         ACC_RED,    build_review_fail_tab(all_tickets)),
    ]

    tab_buttons = ""
    tab_panels = ""
    for i, (tid, title, color, content) in enumerate(tabs):
        active = " active" if i == 0 else ""
        tab_buttons += f'<button class="tab-btn{active}" data-tab="{tid}" onclick="switchTab(\'{tid}\')" style="--tab-color:{color}">{title}</button>\n'
        tab_panels += f'''
        <div id="{tid}" class="tab-panel{active}">
            <h2 style="color:{color};margin-bottom:16px;font-size:22px">{title}</h2>
            {content}
        </div>'''

    now = datetime.now()
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QA Daily Status Report - {now.strftime("%B %d, %Y")}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
    <style>{CSS}</style>
</head>
<body>
    <div class="report-header">
        <h1>QA DAILY STATUS REPORT</h1>
        <div class="date">{now.strftime("Generated: %A, %B %d, %Y | %I:%M %p")}</div>
    </div>

    <div id="liveBar" class="live-bar">
        <div class="live-bar-left">
            <span class="live-dot"></span>
            <span>LIVE DASHBOARD</span>
        </div>
        <div class="live-bar-right">
            <span id="refreshCountdown">Next refresh: 5:00</span>
            <button class="refresh-btn" onclick="doRefresh()">
                <span id="refreshIndicator" class="refresh-icon">&#8635;</span> Refresh now
            </button>
        </div>
    </div>

    <div class="tab-bar">{tab_buttons}</div>
    {tab_panels}

    <button id="scrollTop" class="scroll-top" onclick="scrollToTop()" title="Back to top">&#8593;</button>
    <script>{TAB_JS}</script>
</body>
</html>"""


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="QA Daily Status Report - Live Dashboard")
    parser.add_argument("--port", type=int, default=5050, help="Server port (default: 5050)")
    parser.add_argument("--static", action="store_true", help="Generate static HTML file instead of running server")
    parser.add_argument("--out", type=str, default=None, help="Output directory (for --static mode)")
    args = parser.parse_args()

    if args.static:
        try:
            path = generate_report(output_dir=args.out)
            webbrowser.open(path.as_uri())
        except Exception as exc:
            print(f"\n  ERROR: {exc}", file=sys.stderr)
            import traceback; traceback.print_exc()
            sys.exit(1)
    else:
        run_server(port=args.port)
