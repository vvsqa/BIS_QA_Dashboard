"""
Open Bugs PDF Report Generator.

Generates a report of all currently open bugs with:
- Developer summary table (bug count, avg ageing)
- Bug ID, Subject
- Linked Ticket ID
- Developer(s) and QA Tester
- Bug Status
- Ageing (days since created)
- Current Ticket Status
"""

import os
import re
from datetime import datetime
from typing import Dict, List, Tuple

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from sqlalchemy import func, or_

from models import Bug, TicketTracking


REPORTS_FOLDER = os.path.join(os.path.dirname(__file__), "reports")

# Statuses considered as "open" (not closed/resolved)
OPEN_STATUSES = [
    'new', 'open', 'in progress', 'feedback', 'assigned', 
    'reopened', 're-opened', 'reopen', 'pending', 'review',
    'deferred', 'confirmed', 'acknowledged'
]

CLOSED_STATUSES = [
    'closed', 'resolved', 'rejected', 'fixed', 'verified', 
    'wont fix', "won't fix", 'duplicate', 'invalid', 'cannot reproduce',
    'released to qa', 'released to qc'
]


def _to_string(value) -> str:
    return str(value or "").strip()


def _split_people(raw_value: str) -> List[str]:
    raw = _to_string(raw_value)
    if not raw:
        return []
    parts = re.split(r"[,/|;&\n]+", raw)
    return [p.strip() for p in parts if p.strip()]


def _calculate_ageing(created_on) -> int:
    """Calculate days since bug was created."""
    if not created_on:
        return 0
    today = datetime.utcnow()
    if hasattr(created_on, 'replace'):
        created = created_on
    else:
        return 0
    delta = today - created
    return max(delta.days, 0)


def _format_date(dt) -> str:
    if not dt:
        return "-"
    if hasattr(dt, "strftime"):
        return dt.strftime("%d-%b-%Y")
    return str(dt)


def get_open_bugs_with_ticket_info(db, sort_by: str = "ageing", sort_order: str = "desc", developer_filter: str = None) -> List[Dict]:
    """
    Fetch all open bugs joined with ticket information.
    
    sort_by: 'ageing', 'bug_id', 'ticket_id', 'developer', 'severity'
    sort_order: 'asc' or 'desc'
    developer_filter: Optional developer name to filter bugs for
    """
    # Get all bugs that are not in closed statuses
    bugs = (
        db.query(Bug)
        .filter(
            ~func.lower(Bug.status).in_(CLOSED_STATUSES)
        )
        .order_by(Bug.created_on.desc().nullslast())
        .all()
    )
    
    # Get unique ticket IDs
    ticket_ids = list(set(b.ticket_id for b in bugs if b.ticket_id))
    
    # Fetch ticket details
    tickets_map = {}
    if ticket_ids:
        tickets = db.query(TicketTracking).filter(
            TicketTracking.ticket_id.in_(ticket_ids)
        ).all()
        tickets_map = {t.ticket_id: t for t in tickets}
    
    result = []
    dev_filter_lower = developer_filter.lower().strip() if developer_filter else None
    
    for bug in bugs:
        ticket = tickets_map.get(bug.ticket_id)
        
        # Get developers from ticket
        developers = []
        if ticket:
            if ticket.backend_developer:
                developers.extend(_split_people(ticket.backend_developer))
            if ticket.frontend_developer:
                developers.extend(_split_people(ticket.frontend_developer))
            if ticket.developer_assigned and not developers:
                developers.extend(_split_people(ticket.developer_assigned))
        
        # Deduplicate developers
        seen = set()
        unique_devs = []
        for d in developers:
            d_lower = d.lower()
            if d_lower not in seen:
                seen.add(d_lower)
                unique_devs.append(d)
        
        # Filter by developer if specified
        if dev_filter_lower:
            # Check if the developer filter matches any developer on this bug
            dev_match = any(dev_filter_lower in d.lower() for d in unique_devs)
            # Also check for unassigned filter
            if dev_filter_lower == "(unassigned)" and not unique_devs:
                dev_match = True
            if not dev_match:
                continue
        
        # Get QA tester from ticket
        qa_tester = "-"
        if ticket and ticket.qc_tester:
            qa_tester = ticket.qc_tester.strip()
        
        # Get current ticket status
        ticket_status = "-"
        if ticket and ticket.status:
            ticket_status = ticket.status.strip()
        
        # Calculate ageing
        ageing = _calculate_ageing(bug.created_on)
        
        result.append({
            "bug_id": bug.bug_id,
            "subject": _to_string(bug.subject) or f"Bug #{bug.bug_id}",
            "ticket_id": bug.ticket_id,
            "developers": unique_devs,
            "developers_display": ", ".join(unique_devs) if unique_devs else "-",
            "qa_tester": qa_tester,
            "bug_status": _to_string(bug.status) or "Unknown",
            "severity": _to_string(bug.severity) or "-",
            "environment": _to_string(bug.environment) or "-",
            "ageing_days": ageing,
            "ticket_status": ticket_status,
            "created_on": bug.created_on,
            "module": _to_string(bug.module) or "-",
        })
    
    # Sort the results
    reverse = sort_order.lower() == "desc"
    if sort_by == "ageing":
        result.sort(key=lambda x: x["ageing_days"], reverse=reverse)
    elif sort_by == "bug_id":
        result.sort(key=lambda x: x["bug_id"] or 0, reverse=reverse)
    elif sort_by == "ticket_id":
        result.sort(key=lambda x: x["ticket_id"] or 0, reverse=reverse)
    elif sort_by == "developer":
        result.sort(key=lambda x: x["developers_display"].lower(), reverse=reverse)
    elif sort_by == "severity":
        severity_order = {"Critical": 1, "High": 2, "Major": 3, "Medium": 4, "Normal": 5, "Minor": 6, "Low": 7, "-": 99}
        result.sort(key=lambda x: severity_order.get(x["severity"], 50), reverse=reverse)
    
    return result


def _build_developer_summary(bugs: List[Dict]) -> List[Dict]:
    """
    Build developer-wise bug summary with count and average ageing.
    """
    dev_stats = {}
    
    for bug in bugs:
        developers = bug["developers"]
        ageing = bug["ageing_days"]
        
        if not developers:
            # Track bugs without developer
            dev_name = "(Unassigned)"
            if dev_name not in dev_stats:
                dev_stats[dev_name] = {"count": 0, "total_ageing": 0, "bugs": []}
            dev_stats[dev_name]["count"] += 1
            dev_stats[dev_name]["total_ageing"] += ageing
            dev_stats[dev_name]["bugs"].append(bug["bug_id"])
        else:
            for dev in developers:
                if dev not in dev_stats:
                    dev_stats[dev] = {"count": 0, "total_ageing": 0, "bugs": []}
                dev_stats[dev]["count"] += 1
                dev_stats[dev]["total_ageing"] += ageing
                dev_stats[dev]["bugs"].append(bug["bug_id"])
    
    # Calculate averages and create result list
    result = []
    for dev_name, stats in dev_stats.items():
        avg_ageing = round(stats["total_ageing"] / stats["count"], 1) if stats["count"] > 0 else 0
        result.append({
            "developer": dev_name,
            "bug_count": stats["count"],
            "avg_ageing_days": avg_ageing,
            "total_ageing_days": stats["total_ageing"],
        })
    
    # Sort by bug count descending (most bugs first)
    result.sort(key=lambda x: (-x["bug_count"], -x["avg_ageing_days"]))
    
    return result


def _build_summary(bugs: List[Dict]) -> Dict:
    """Build summary statistics for the report."""
    total = len(bugs)
    
    # By status
    status_counts = {}
    for bug in bugs:
        status = bug["bug_status"]
        status_counts[status] = status_counts.get(status, 0) + 1
    
    # By severity
    severity_counts = {}
    for bug in bugs:
        sev = bug["severity"]
        severity_counts[sev] = severity_counts.get(sev, 0) + 1
    
    # By environment
    env_counts = {}
    for bug in bugs:
        env = bug["environment"]
        env_counts[env] = env_counts.get(env, 0) + 1
    
    # Ageing categories
    ageing_0_7 = sum(1 for b in bugs if b["ageing_days"] <= 7)
    ageing_8_30 = sum(1 for b in bugs if 8 <= b["ageing_days"] <= 30)
    ageing_31_90 = sum(1 for b in bugs if 31 <= b["ageing_days"] <= 90)
    ageing_90_plus = sum(1 for b in bugs if b["ageing_days"] > 90)
    
    # Tickets affected
    unique_tickets = len(set(b["ticket_id"] for b in bugs if b["ticket_id"]))
    
    # Overall average ageing
    total_ageing = sum(b["ageing_days"] for b in bugs)
    avg_ageing = round(total_ageing / total, 1) if total > 0 else 0
    
    return {
        "total_bugs": total,
        "unique_tickets": unique_tickets,
        "status_counts": status_counts,
        "severity_counts": severity_counts,
        "env_counts": env_counts,
        "ageing_0_7": ageing_0_7,
        "ageing_8_30": ageing_8_30,
        "ageing_31_90": ageing_31_90,
        "ageing_90_plus": ageing_90_plus,
        "avg_ageing": avg_ageing,
    }


def _create_styles():
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="ReportTitle",
            parent=styles["Heading1"],
            fontSize=18,
            spaceAfter=6,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#dc2626"),
        )
    )
    styles.add(
        ParagraphStyle(
            name="ReportSubtitle",
            parent=styles["Normal"],
            fontSize=10,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#6b7280"),
            spaceAfter=10,
        )
    )
    styles.add(
        ParagraphStyle(
            name="SectionTitle",
            parent=styles["Heading2"],
            fontSize=11,
            textColor=colors.HexColor("#dc2626"),
            spaceBefore=8,
            spaceAfter=4,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Small",
            parent=styles["Normal"],
            fontSize=7,
            textColor=colors.HexColor("#6b7280"),
        )
    )
    styles.add(
        ParagraphStyle(
            name="CellText",
            parent=styles["Normal"],
            fontSize=7,
            leading=9,
            textColor=colors.HexColor("#1f2937"),
        )
    )
    styles.add(
        ParagraphStyle(
            name="CellTextBold",
            parent=styles["Normal"],
            fontSize=7,
            leading=9,
            textColor=colors.HexColor("#1f2937"),
            fontName="Helvetica-Bold",
        )
    )
    styles.add(
        ParagraphStyle(
            name="MetricValue",
            parent=styles["Normal"],
            fontSize=20,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#1f2937"),
            fontName="Helvetica-Bold",
        )
    )
    styles.add(
        ParagraphStyle(
            name="MetricLabel",
            parent=styles["Normal"],
            fontSize=8,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#6b7280"),
        )
    )
    return styles


def _add_summary_section(elements, styles, summary: Dict):
    elements.append(Paragraph("Summary", styles["SectionTitle"]))
    
    # Key metrics cards - simplified to show only avg ageing
    key_metrics = [
        [
            Paragraph(f"<b>{summary['total_bugs']}</b>", styles["MetricValue"]),
            Paragraph(f"<b>{summary['unique_tickets']}</b>", styles["MetricValue"]),
            Paragraph(f"<b>{summary['avg_ageing']}</b>", styles["MetricValue"]),
        ],
        [
            Paragraph("Total Open Bugs", styles["MetricLabel"]),
            Paragraph("Tickets Affected", styles["MetricLabel"]),
            Paragraph("Avg Ageing (Days)", styles["MetricLabel"]),
        ],
    ]
    key_table = Table(key_metrics, colWidths=[2.0 * inch, 2.0 * inch, 2.0 * inch])
    key_table.setStyle(
        TableStyle(
            [
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("BACKGROUND", (0, 0), (0, 1), colors.HexColor("#fee2e2")),
                ("BACKGROUND", (1, 0), (1, 1), colors.HexColor("#fef3c7")),
                ("BACKGROUND", (2, 0), (2, 1), colors.HexColor("#e0e7ff")),
                ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#d1d5db")),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    elements.append(key_table)
    elements.append(Spacer(1, 6))
    
    # Status and severity breakdown
    status_text = " | ".join([f"{k}: {v}" for k, v in sorted(summary["status_counts"].items())]) or "No data"
    severity_text = " | ".join([f"{k}: {v}" for k, v in sorted(summary["severity_counts"].items())]) or "No data"
    env_text = " | ".join([f"{k}: {v}" for k, v in sorted(summary["env_counts"].items())]) or "No data"
    
    elements.append(Paragraph(f"<b>By Status:</b> {status_text}", styles["Small"]))
    elements.append(Paragraph(f"<b>By Severity:</b> {severity_text}", styles["Small"]))
    elements.append(Paragraph(f"<b>By Environment:</b> {env_text}", styles["Small"]))
    elements.append(Spacer(1, 8))


def _add_developer_summary_table(elements, styles, dev_summary: List[Dict]):
    """Add developer-wise bug summary table."""
    elements.append(Paragraph("Developer-wise Bug Summary (Sorted by Bug Count)", styles["SectionTitle"]))
    
    if not dev_summary:
        elements.append(Paragraph("No developer data available.", styles["Normal"]))
        return
    
    header = [
        Paragraph("<b>#</b>", styles["CellTextBold"]),
        Paragraph("<b>Developer Name</b>", styles["CellTextBold"]),
        Paragraph("<b>Open Bug Count</b>", styles["CellTextBold"]),
        Paragraph("<b>Avg Ageing (Days)</b>", styles["CellTextBold"]),
        Paragraph("<b>Total Ageing (Days)</b>", styles["CellTextBold"]),
    ]
    rows = [header]
    
    for idx, dev in enumerate(dev_summary, 1):
        # Color code based on bug count
        bug_count = dev["bug_count"]
        if bug_count >= 20:
            count_style = ParagraphStyle("CountRed", parent=styles["CellText"], textColor=colors.HexColor("#dc2626"), fontName="Helvetica-Bold")
        elif bug_count >= 10:
            count_style = ParagraphStyle("CountOrange", parent=styles["CellText"], textColor=colors.HexColor("#ea580c"), fontName="Helvetica-Bold")
        elif bug_count >= 5:
            count_style = ParagraphStyle("CountYellow", parent=styles["CellText"], textColor=colors.HexColor("#ca8a04"))
        else:
            count_style = styles["CellText"]
        
        # Color code avg ageing
        avg_ageing = dev["avg_ageing_days"]
        if avg_ageing > 90:
            age_style = ParagraphStyle("AgeRed", parent=styles["CellText"], textColor=colors.HexColor("#dc2626"), fontName="Helvetica-Bold")
        elif avg_ageing > 30:
            age_style = ParagraphStyle("AgeOrange", parent=styles["CellText"], textColor=colors.HexColor("#ea580c"))
        else:
            age_style = styles["CellText"]
        
        rows.append([
            Paragraph(str(idx), styles["CellText"]),
            Paragraph(dev["developer"], styles["CellText"]),
            Paragraph(str(bug_count), count_style),
            Paragraph(str(avg_ageing), age_style),
            Paragraph(str(dev["total_ageing_days"]), styles["CellText"]),
        ])
    
    table = Table(
        rows,
        repeatRows=1,
        colWidths=[0.4 * inch, 2.5 * inch, 1.2 * inch, 1.3 * inch, 1.3 * inch],
    )
    
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#7c3aed")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (0, -1), "CENTER"),
                ("ALIGN", (2, 0), (-1, -1), "CENTER"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f3ff")]),
                ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#c4b5fd")),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#c4b5fd")),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    elements.append(table)
    elements.append(Spacer(1, 10))


def _add_bugs_table(elements, styles, bugs: List[Dict], sort_by: str = "ageing"):
    """Add detailed bugs table with sort indicator."""
    sort_labels = {
        "ageing": "Ageing (Highest First)",
        "bug_id": "Bug ID",
        "ticket_id": "Ticket ID",
        "developer": "Developer",
        "severity": "Severity",
    }
    sort_label = sort_labels.get(sort_by, "Ageing")
    elements.append(Paragraph(f"Open Bugs Details (Sorted by {sort_label})", styles["SectionTitle"]))
    
    if not bugs:
        elements.append(Paragraph("No open bugs found.", styles["Normal"]))
        return
    
    header = [
        Paragraph("<b>Bug ID</b>", styles["CellTextBold"]),
        Paragraph("<b>Subject</b>", styles["CellTextBold"]),
        Paragraph("<b>Ticket</b>", styles["CellTextBold"]),
        Paragraph("<b>Developer(s)</b>", styles["CellTextBold"]),
        Paragraph("<b>QA Tester</b>", styles["CellTextBold"]),
        Paragraph("<b>Bug Status</b>", styles["CellTextBold"]),
        Paragraph("<b>Severity</b>", styles["CellTextBold"]),
        Paragraph("<b>Ageing</b>", styles["CellTextBold"]),
        Paragraph("<b>Ticket Status</b>", styles["CellTextBold"]),
    ]
    rows = [header]
    
    for bug in bugs:
        subject = bug["subject"]
        if len(subject) > 45:
            subject = subject[:42] + "..."
        
        devs = bug["developers_display"]
        if len(devs) > 25:
            devs = devs[:22] + "..."
        
        qa = bug["qa_tester"]
        if len(qa) > 18:
            qa = qa[:15] + "..."
        
        # Color code ageing
        ageing = bug["ageing_days"]
        if ageing > 90:
            ageing_style = ParagraphStyle("AgeRed", parent=styles["CellText"], textColor=colors.HexColor("#dc2626"), fontName="Helvetica-Bold")
        elif ageing > 30:
            ageing_style = ParagraphStyle("AgeOrange", parent=styles["CellText"], textColor=colors.HexColor("#ea580c"))
        elif ageing > 7:
            ageing_style = ParagraphStyle("AgeYellow", parent=styles["CellText"], textColor=colors.HexColor("#ca8a04"))
        else:
            ageing_style = styles["CellText"]
        
        rows.append([
            Paragraph(str(bug["bug_id"]), styles["CellText"]),
            Paragraph(subject, styles["CellText"]),
            Paragraph(str(bug["ticket_id"] or "-"), styles["CellText"]),
            Paragraph(devs, styles["CellText"]),
            Paragraph(qa, styles["CellText"]),
            Paragraph(bug["bug_status"], styles["CellText"]),
            Paragraph(bug["severity"], styles["CellText"]),
            Paragraph(f"{ageing} days", ageing_style),
            Paragraph(bug["ticket_status"], styles["CellText"]),
        ])
    
    table = Table(
        rows,
        repeatRows=1,
        colWidths=[0.5 * inch, 2.0 * inch, 0.5 * inch, 1.3 * inch, 1.0 * inch, 0.8 * inch, 0.7 * inch, 0.6 * inch, 1.0 * inch],
    )
    
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dc2626")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fef2f2")]),
                ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#fecaca")),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#fecaca")),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    elements.append(table)
    elements.append(Spacer(1, 6))


def generate_open_bugs_report_pdf(db, sort_by: str = "ageing", sort_order: str = "desc", developer_filter: str = None) -> Tuple[str, str]:
    """
    Generate Open Bugs PDF report and return (output_path, filename).
    
    sort_by: 'ageing', 'bug_id', 'ticket_id', 'developer', 'severity'
    sort_order: 'asc' or 'desc'
    developer_filter: Optional developer name to filter bugs for
    """
    os.makedirs(REPORTS_FOLDER, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    
    # Include developer name in filename if filtered
    if developer_filter:
        safe_dev_name = "".join(c if c.isalnum() or c in " _-" else "_" for c in developer_filter).strip().replace(" ", "_")
        filename = f"Open_Bugs_{safe_dev_name}_{timestamp}.pdf"
    else:
        filename = f"Open_Bugs_Report_{timestamp}.pdf"
    output_path = os.path.join(REPORTS_FOLDER, filename)
    
    # Fetch data with sorting and optional developer filter
    bugs = get_open_bugs_with_ticket_info(db, sort_by=sort_by, sort_order=sort_order, developer_filter=developer_filter)
    summary = _build_summary(bugs)
    dev_summary = _build_developer_summary(bugs)
    
    styles = _create_styles()
    
    doc = SimpleDocTemplate(
        output_path,
        pagesize=landscape(A4),
        rightMargin=0.4 * inch,
        leftMargin=0.4 * inch,
        topMargin=0.4 * inch,
        bottomMargin=0.4 * inch,
        title="Open Bugs Report",
        author="QA Dashboard",
        subject="Current open bugs from Redmine with ticket details",
    )
    
    elements = []
    generated_at = datetime.utcnow().strftime("%d-%b-%Y %H:%M UTC")
    
    # Title based on filter
    if developer_filter:
        elements.append(Paragraph(f"Open Bugs Report: {developer_filter}", styles["ReportTitle"]))
    else:
        elements.append(Paragraph("Open Bugs Report", styles["ReportTitle"]))
    elements.append(Paragraph(f"Latest data as of: {generated_at}", styles["ReportSubtitle"]))
    elements.append(Paragraph("Bugs from Redmine linked with PM Tracker tickets", styles["ReportSubtitle"]))
    
    _add_summary_section(elements, styles, summary)
    
    # Only show developer summary table if not filtered to a specific developer
    if not developer_filter:
        _add_developer_summary_table(elements, styles, dev_summary)
    
    _add_bugs_table(elements, styles, bugs, sort_by=sort_by)
    
    doc.build(elements)
    return output_path, filename


def get_open_bugs_preview(db) -> Dict:
    """
    Get preview data for open bugs (for API/UI preview).
    """
    bugs = get_open_bugs_with_ticket_info(db, sort_by="ageing", sort_order="desc")
    summary = _build_summary(bugs)
    dev_summary = _build_developer_summary(bugs)
    
    # Extract unique developer names for the filter dropdown
    all_developers = set()
    for dev_info in dev_summary:
        all_developers.add(dev_info["developer"])
    
    return {
        "summary": summary,
        "developer_summary": dev_summary,
        "developers_list": sorted(all_developers),
        "bugs": bugs[:50],  # Limit for preview
        "total_count": len(bugs),
        "generated_at": datetime.utcnow().isoformat(),
    }
