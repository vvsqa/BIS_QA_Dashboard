"""
Developer performance PDF report generator.

Builds a detailed per-employee report for Development team members using:
- Employee master data
- PM ticket tracking data
- Redmine bug data linked by ticket_id
"""

import os
import re
from datetime import datetime, timedelta
from typing import Dict, List, Tuple

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from sqlalchemy import or_

from models import Bug, Employee, TicketTracking


REPORTS_FOLDER = os.path.join(os.path.dirname(__file__), "reports")


def _to_string(value) -> str:
    return str(value or "").strip()


def _normalize_name(name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9 ]+", " ", _to_string(name))
    return re.sub(r"\s+", " ", cleaned).strip().lower()


def _split_people(raw_value: str) -> List[str]:
    raw = _to_string(raw_value)
    if not raw:
        return []
    parts = re.split(r"[,/|;&\n]+", raw)
    names = []
    for part in parts:
        candidate = part.strip()
        if candidate:
            names.append(candidate)
    return names


def _format_hours(value) -> str:
    if value is None:
        return "-"
    try:
        return f"{float(value):.1f}"
    except Exception:
        return "-"


def _format_dt(value) -> str:
    if not value:
        return "-"
    if hasattr(value, "strftime"):
        return value.strftime("%d-%b-%Y")
    return _to_string(value)


def _safe_num(value) -> float:
    try:
        return float(value or 0)
    except Exception:
        return 0.0


def _assignment_roles_for_employee(ticket: TicketTracking, employee_name: str) -> List[str]:
    roles: List[str] = []
    target = _normalize_name(employee_name)
    role_map = [
        ("Backend", ticket.backend_developer),
        ("Frontend", ticket.frontend_developer),
        ("Assigned", ticket.developer_assigned),
        ("Current Assignee", ticket.current_assignee),
    ]
    for role, raw_value in role_map:
        names = _split_people(raw_value)
        if any(_normalize_name(n) == target for n in names):
            roles.append(role)
    return roles


def _get_other_devs(ticket: TicketTracking, employee_name: str) -> List[str]:
    """Get other developers (excluding QA and the current employee)."""
    target_norm = _normalize_name(employee_name)
    people = []
    for raw in [
        ticket.backend_developer,
        ticket.frontend_developer,
        ticket.developer_assigned,
        ticket.current_assignee,
    ]:
        people.extend(_split_people(raw))
    seen = set()
    out = []
    for person in people:
        key = _normalize_name(person)
        if key and key not in seen and key != target_norm:
            seen.add(key)
            out.append(person.strip())
    return out


def _get_qa_testers(ticket: TicketTracking) -> List[str]:
    """Get QA testers from the ticket."""
    return _split_people(ticket.qc_tester)


def get_developer_tickets(db, employee_name: str, past_one_year_only: bool = False) -> List[Dict]:
    """
    Query tickets where employee appears in assignment fields.
    Returns normalized rows for reporting.
    """
    if not _to_string(employee_name):
        return []

    name = employee_name.strip()
    like_term = f"%{name}%"

    query = db.query(TicketTracking).filter(
        or_(
            TicketTracking.backend_developer.ilike(like_term),
            TicketTracking.frontend_developer.ilike(like_term),
            TicketTracking.developer_assigned.ilike(like_term),
            TicketTracking.current_assignee.ilike(like_term),
        )
    )

    if past_one_year_only:
        one_year_ago = datetime.utcnow() - timedelta(days=365)
        query = query.filter(TicketTracking.updated_on >= one_year_ago)

    candidates = query.order_by(
        TicketTracking.updated_on.desc().nullslast(),
        TicketTracking.ticket_id.desc()
    ).all()

    target_norm = _normalize_name(name)
    rows: List[Dict] = []
    for ticket in candidates:
        roles = _assignment_roles_for_employee(ticket, name)
        if not roles:
            continue

        other_devs = _get_other_devs(ticket, name)
        qa_testers = _get_qa_testers(ticket)

        est = _safe_num(ticket.dev_estimate_hours)
        actual = _safe_num(ticket.actual_dev_hours)
        
        # Calculate variance
        is_estimated = est > 0
        variance = actual - est if is_estimated else None
        variance_status = "not_estimated"
        if is_estimated:
            if variance <= 0:
                variance_status = "within_time"
            else:
                variance_status = "exceeded"

        rows.append(
            {
                "ticket_id": ticket.ticket_id,
                "title": _to_string(ticket.title) or f"Ticket #{ticket.ticket_id}",
                "status": _to_string(ticket.status) or "Unknown",
                "roles": roles,
                "role_display": " / ".join(roles),
                "dev_estimate_hours": est,
                "actual_dev_hours": actual,
                "variance": variance,
                "variance_status": variance_status,
                "other_devs": other_devs,
                "other_devs_display": ", ".join(other_devs) if other_devs else "-",
                "qa_testers": qa_testers,
                "qa_testers_display": ", ".join(qa_testers) if qa_testers else "-",
                "updated_on": ticket.updated_on,
            }
        )

    return rows


def get_bugs_for_tickets(db, ticket_ids: List[int]) -> Dict[int, List[Bug]]:
    if not ticket_ids:
        return {}
    bug_rows = (
        db.query(Bug)
        .filter(Bug.ticket_id.in_(ticket_ids))
        .order_by(Bug.created_on.desc().nullslast())
        .all()
    )
    grouped: Dict[int, List[Bug]] = {}
    for bug in bug_rows:
        if bug.ticket_id is None:
            continue
        grouped.setdefault(bug.ticket_id, []).append(bug)
    return grouped


def calculate_experience(employee: Employee) -> Dict[str, float]:
    today = datetime.utcnow().date()
    previous = _safe_num(employee.previous_experience)
    tenure = 0.0
    if employee.date_of_joining:
        joined = employee.date_of_joining.date() if hasattr(employee.date_of_joining, "date") else employee.date_of_joining
        delta_days = max((today - joined).days, 0)
        tenure = round(delta_days / 365.25, 1)
    total = round(previous + tenure, 1)
    return {
        "previous_experience": round(previous, 1),
        "company_experience": tenure,
        "total_experience": total,
    }


def _build_summary(ticket_rows: List[Dict], bugs_by_ticket: Dict[int, List[Bug]]) -> Dict:
    backend_count = 0
    frontend_count = 0
    assigned_count = 0
    current_assignee_count = 0
    total_est = 0.0
    total_actual = 0.0
    status_counts: Dict[str, int] = {}
    severity_counts: Dict[str, int] = {}
    bug_status_counts: Dict[str, int] = {}
    total_bugs = 0

    # New metrics for time tracking
    within_time_count = 0
    exceeded_time_count = 0
    not_estimated_count = 0

    for row in ticket_rows:
        roles = set(row["roles"])
        if "Backend" in roles:
            backend_count += 1
        if "Frontend" in roles:
            frontend_count += 1
        if "Assigned" in roles:
            assigned_count += 1
        if "Current Assignee" in roles:
            current_assignee_count += 1

        total_est += _safe_num(row["dev_estimate_hours"])
        total_actual += _safe_num(row["actual_dev_hours"])
        status = row["status"] or "Unknown"
        status_counts[status] = status_counts.get(status, 0) + 1

        # Track variance status
        vs = row.get("variance_status", "not_estimated")
        if vs == "within_time":
            within_time_count += 1
        elif vs == "exceeded":
            exceeded_time_count += 1
        else:
            not_estimated_count += 1

        ticket_bugs = bugs_by_ticket.get(row["ticket_id"], [])
        total_bugs += len(ticket_bugs)
        for bug in ticket_bugs:
            sev = _to_string(bug.severity) or "Unknown"
            bs = _to_string(bug.status) or "Unknown"
            severity_counts[sev] = severity_counts.get(sev, 0) + 1
            bug_status_counts[bs] = bug_status_counts.get(bs, 0) + 1

    total_tickets = len(ticket_rows)
    avg_est = round(total_est / total_tickets, 1) if total_tickets else 0.0
    avg_actual = round(total_actual / total_tickets, 1) if total_tickets else 0.0

    return {
        "total_tickets": total_tickets,
        "backend_tickets": backend_count,
        "frontend_tickets": frontend_count,
        "assigned_tickets": assigned_count,
        "current_assignee_tickets": current_assignee_count,
        "total_bugs": total_bugs,
        "total_estimated_hours": round(total_est, 1),
        "total_actual_hours": round(total_actual, 1),
        "avg_estimated_hours": avg_est,
        "avg_actual_hours": avg_actual,
        "status_counts": status_counts,
        "severity_counts": severity_counts,
        "bug_status_counts": bug_status_counts,
        "within_time_count": within_time_count,
        "exceeded_time_count": exceeded_time_count,
        "not_estimated_count": not_estimated_count,
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
            textColor=colors.HexColor("#1f2937"),
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
            textColor=colors.HexColor("#2563eb"),
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
            name="CellTextGreen",
            parent=styles["Normal"],
            fontSize=7,
            leading=9,
            textColor=colors.HexColor("#15803d"),
        )
    )
    styles.add(
        ParagraphStyle(
            name="CellTextRed",
            parent=styles["Normal"],
            fontSize=7,
            leading=9,
            textColor=colors.HexColor("#dc2626"),
        )
    )
    styles.add(
        ParagraphStyle(
            name="CellTextOrange",
            parent=styles["Normal"],
            fontSize=7,
            leading=9,
            textColor=colors.HexColor("#ea580c"),
        )
    )
    return styles


def _add_profile_section(elements, styles, employee: Employee, exp: Dict[str, float]):
    elements.append(Paragraph("Employee Profile", styles["SectionTitle"]))
    profile_rows = [
        [
            Paragraph("<b>Employee ID</b>", styles["CellText"]),
            Paragraph(_to_string(employee.employee_id), styles["CellText"]),
            Paragraph("<b>Team</b>", styles["CellText"]),
            Paragraph(_to_string(employee.team) or "-", styles["CellText"]),
        ],
        [
            Paragraph("<b>Name</b>", styles["CellText"]),
            Paragraph(_to_string(employee.name), styles["CellText"]),
            Paragraph("<b>Platform</b>", styles["CellText"]),
            Paragraph(_to_string(employee.platform) or "-", styles["CellText"]),
        ],
        [
            Paragraph("<b>Email</b>", styles["CellText"]),
            Paragraph(_to_string(employee.email), styles["CellText"]),
            Paragraph("<b>Status</b>", styles["CellText"]),
            Paragraph(_to_string(employee.employment_status) or "-", styles["CellText"]),
        ],
        [
            Paragraph("<b>Role / Designation</b>", styles["CellText"]),
            Paragraph(_to_string(employee.designation) or _to_string(employee.role) or "-", styles["CellText"]),
            Paragraph("<b>Reporting To (Lead)</b>", styles["CellText"]),
            Paragraph(_to_string(employee.lead) or "-", styles["CellText"]),
        ],
        [
            Paragraph("<b>Manager</b>", styles["CellText"]),
            Paragraph(_to_string(employee.manager) or "-", styles["CellText"]),
            Paragraph("<b>Location / Mode</b>", styles["CellText"]),
            Paragraph(f"{_to_string(employee.location) or '-'} / {_to_string(employee.mode_of_work) or 'Onsite'}", styles["CellText"]),
        ],
        [
            Paragraph("<b>Previous Exp (Years)</b>", styles["CellText"]),
            Paragraph(f"{exp['previous_experience']:.1f}", styles["CellText"]),
            Paragraph("<b>Company Exp (Years)</b>", styles["CellText"]),
            Paragraph(f"{exp['company_experience']:.1f}", styles["CellText"]),
        ],
        [
            Paragraph("<b>Total Exp (Years)</b>", styles["CellText"]),
            Paragraph(f"{exp['total_experience']:.1f}", styles["CellText"]),
            Paragraph("<b>Date Of Joining</b>", styles["CellText"]),
            Paragraph(_format_dt(employee.date_of_joining), styles["CellText"]),
        ],
    ]
    profile_table = Table(profile_rows, colWidths=[1.6 * inch, 2.0 * inch, 1.6 * inch, 2.0 * inch])
    profile_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f3f4f6")),
                ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#f3f4f6")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#d1d5db")),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    elements.append(profile_table)
    elements.append(Spacer(1, 8))


def _add_summary_section(elements, styles, summary: Dict):
    elements.append(Paragraph("Summary (Past One Year)", styles["SectionTitle"]))
    
    # Key metrics cards at top
    key_metrics = [
        [
            Paragraph(f"<b>{summary['total_tickets']}</b>", styles["ReportTitle"]),
            Paragraph(f"<b>{summary['within_time_count']}</b>", styles["ReportTitle"]),
            Paragraph(f"<b>{summary['exceeded_time_count']}</b>", styles["ReportTitle"]),
            Paragraph(f"<b>{summary['not_estimated_count']}</b>", styles["ReportTitle"]),
        ],
        [
            Paragraph("Total Tickets", styles["Small"]),
            Paragraph("Within Estimate", styles["Small"]),
            Paragraph("Exceeded Estimate", styles["Small"]),
            Paragraph("Not Estimated", styles["Small"]),
        ],
    ]
    key_table = Table(key_metrics, colWidths=[1.8 * inch, 1.8 * inch, 1.8 * inch, 1.8 * inch])
    key_table.setStyle(
        TableStyle(
            [
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("BACKGROUND", (0, 0), (0, 1), colors.HexColor("#dbeafe")),
                ("BACKGROUND", (1, 0), (1, 1), colors.HexColor("#dcfce7")),
                ("BACKGROUND", (2, 0), (2, 1), colors.HexColor("#fee2e2")),
                ("BACKGROUND", (3, 0), (3, 1), colors.HexColor("#fef3c7")),
                ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#d1d5db")),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    elements.append(key_table)
    elements.append(Spacer(1, 6))

    # Detailed summary
    summary_rows = [
        [
            Paragraph("<b>Total Bugs On Tickets</b>", styles["CellText"]),
            Paragraph(str(summary["total_bugs"]), styles["CellText"]),
            Paragraph("<b>Backend Tickets</b>", styles["CellText"]),
            Paragraph(str(summary["backend_tickets"]), styles["CellText"]),
        ],
        [
            Paragraph("<b>Frontend Tickets</b>", styles["CellText"]),
            Paragraph(str(summary["frontend_tickets"]), styles["CellText"]),
            Paragraph("<b>Assigned Tickets</b>", styles["CellText"]),
            Paragraph(str(summary["assigned_tickets"]), styles["CellText"]),
        ],
        [
            Paragraph("<b>Total Dev Est. Hours</b>", styles["CellText"]),
            Paragraph(f"{summary['total_estimated_hours']:.1f}", styles["CellText"]),
            Paragraph("<b>Total Actual Dev Hours</b>", styles["CellText"]),
            Paragraph(f"{summary['total_actual_hours']:.1f}", styles["CellText"]),
        ],
        [
            Paragraph("<b>Avg Dev Est. Hours</b>", styles["CellText"]),
            Paragraph(f"{summary['avg_estimated_hours']:.1f}", styles["CellText"]),
            Paragraph("<b>Avg Actual Dev Hours</b>", styles["CellText"]),
            Paragraph(f"{summary['avg_actual_hours']:.1f}", styles["CellText"]),
        ],
    ]
    table = Table(summary_rows, colWidths=[1.8 * inch, 1.4 * inch, 1.8 * inch, 1.4 * inch])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f3f4f6")),
                ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#f3f4f6")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#bfdbfe")),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#bfdbfe")),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    elements.append(table)
    elements.append(Spacer(1, 6))

    status_text = " | ".join([f"{k}: {v}" for k, v in sorted(summary["status_counts"].items())]) or "No data"
    bug_severity_text = " | ".join([f"{k}: {v}" for k, v in sorted(summary["severity_counts"].items())]) or "No data"
    bug_status_text = " | ".join([f"{k}: {v}" for k, v in sorted(summary["bug_status_counts"].items())]) or "No data"
    elements.append(Paragraph(f"<b>Ticket Status:</b> {status_text}", styles["Small"]))
    elements.append(Paragraph(f"<b>Bug Severity:</b> {bug_severity_text}", styles["Small"]))
    elements.append(Paragraph(f"<b>Bug Status:</b> {bug_status_text}", styles["Small"]))
    elements.append(Spacer(1, 6))


def _add_tickets_table(elements, styles, ticket_rows: List[Dict], bugs_by_ticket: Dict[int, List[Bug]]):
    elements.append(Paragraph("Ticket Details (Past One Year)", styles["SectionTitle"]))
    if not ticket_rows:
        elements.append(Paragraph("No tickets found for this developer in the past year.", styles["Normal"]))
        return

    header = [
        Paragraph("<b>ID</b>", styles["CellText"]),
        Paragraph("<b>Title</b>", styles["CellText"]),
        Paragraph("<b>Role</b>", styles["CellText"]),
        Paragraph("<b>Est.</b>", styles["CellText"]),
        Paragraph("<b>Actual</b>", styles["CellText"]),
        Paragraph("<b>Diff</b>", styles["CellText"]),
        Paragraph("<b>Status</b>", styles["CellText"]),
        Paragraph("<b>Other Devs</b>", styles["CellText"]),
        Paragraph("<b>QA Tester</b>", styles["CellText"]),
        Paragraph("<b>Bugs</b>", styles["CellText"]),
    ]
    rows = [header]
    
    for row in ticket_rows:
        bug_count = len(bugs_by_ticket.get(row["ticket_id"], []))
        
        # Use Paragraph for text wrapping
        title_text = row["title"]
        if len(title_text) > 50:
            title_text = title_text[:47] + "..."
        
        other_devs_text = row["other_devs_display"]
        qa_text = row["qa_testers_display"]
        
        # Variance display with color coding
        est = row["dev_estimate_hours"]
        actual = row["actual_dev_hours"]
        variance = row["variance"]
        variance_status = row["variance_status"]
        
        est_display = _format_hours(est) if est > 0 else "-"
        actual_display = _format_hours(actual) if actual > 0 else "-"
        
        # Determine variance display and style
        if variance_status == "not_estimated":
            variance_display = Paragraph("<b>N/E</b>", styles["CellTextOrange"])
            est_cell = Paragraph(f"<b>{est_display}</b>", styles["CellTextOrange"])
        elif variance_status == "within_time":
            diff_val = f"{variance:+.1f}" if variance != 0 else "0.0"
            variance_display = Paragraph(diff_val, styles["CellTextGreen"])
            est_cell = Paragraph(est_display, styles["CellText"])
        else:  # exceeded
            diff_val = f"+{variance:.1f}"
            variance_display = Paragraph(f"<b>{diff_val}</b>", styles["CellTextRed"])
            est_cell = Paragraph(est_display, styles["CellText"])
        
        rows.append([
            Paragraph(str(row["ticket_id"] or "-"), styles["CellText"]),
            Paragraph(title_text, styles["CellText"]),
            Paragraph(row["role_display"], styles["CellText"]),
            est_cell,
            Paragraph(actual_display, styles["CellText"]),
            variance_display,
            Paragraph(row["status"], styles["CellText"]),
            Paragraph(other_devs_text, styles["CellText"]),
            Paragraph(qa_text, styles["CellText"]),
            Paragraph(str(bug_count), styles["CellText"]),
        ])

    # Adjusted column widths for landscape A4
    table = Table(
        rows,
        repeatRows=1,
        colWidths=[0.5 * inch, 2.0 * inch, 0.8 * inch, 0.5 * inch, 0.5 * inch, 0.5 * inch, 0.9 * inch, 1.5 * inch, 1.2 * inch, 0.4 * inch],
    )
    
    table_style = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1d4ed8")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
        ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#bfdbfe")),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#bfdbfe")),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ]
    
    table.setStyle(TableStyle(table_style))
    elements.append(table)
    elements.append(Spacer(1, 6))


def build_developer_report_data(db, employee_id: str) -> Dict:
    employee = (
        db.query(Employee)
        .filter(
            or_(
                Employee.employee_id == employee_id,
                Employee.id == int(employee_id) if str(employee_id).isdigit() else False,
            )
        )
        .first()
    )
    if not employee:
        raise ValueError("Employee not found")

    team_upper = _to_string(employee.team).upper()
    if "DEV" not in team_upper and team_upper != "DEVELOPMENT":
        raise ValueError("Report is available only for Development team employees")

    # Only fetch tickets from the past one year
    ticket_rows = get_developer_tickets(db, employee.name, past_one_year_only=True)
    ticket_ids = [row["ticket_id"] for row in ticket_rows if row.get("ticket_id") is not None]
    bugs_by_ticket = get_bugs_for_tickets(db, ticket_ids)
    summary = _build_summary(ticket_rows, bugs_by_ticket)
    experience = calculate_experience(employee)

    return {
        "employee": employee,
        "experience": experience,
        "tickets": ticket_rows,
        "bugs_by_ticket": bugs_by_ticket,
        "summary": summary,
        "generated_at": datetime.utcnow(),
    }


def generate_developer_report_pdf(db, employee_id: str, use_name_in_filename: bool = False) -> Tuple[str, str]:
    """
    Generate PDF and return (output_path, filename).
    If use_name_in_filename is True, uses employee name instead of ID for the filename.
    """
    data = build_developer_report_data(db, employee_id)
    employee = data["employee"]

    os.makedirs(REPORTS_FOLDER, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    
    if use_name_in_filename:
        # Sanitize name for filename (replace special chars with underscore)
        safe_name = re.sub(r"[^a-zA-Z0-9]+", "_", employee.name.strip())
        filename = f"{safe_name}.pdf"
    else:
        filename = f"Developer_Report_{employee.employee_id}_{timestamp}.pdf"
    
    output_path = os.path.join(REPORTS_FOLDER, filename)

    styles = _create_styles()
    
    # Use landscape A4 for wider table
    doc = SimpleDocTemplate(
        output_path,
        pagesize=landscape(A4),
        rightMargin=0.4 * inch,
        leftMargin=0.4 * inch,
        topMargin=0.4 * inch,
        bottomMargin=0.4 * inch,
        title=f"Developer Report - {employee.name}",
        author="QA Dashboard",
        subject="Developer performance report",
    )

    elements = []
    generated_at = data["generated_at"].strftime("%d-%b-%Y %H:%M UTC")
    elements.append(Paragraph("Developer Performance Report", styles["ReportTitle"]))
    elements.append(Paragraph(f"{employee.name} ({employee.employee_id})", styles["ReportSubtitle"]))
    elements.append(Paragraph(f"Latest data as of: {generated_at}", styles["ReportSubtitle"]))

    _add_profile_section(elements, styles, data["employee"], data["experience"])
    _add_summary_section(elements, styles, data["summary"])
    _add_tickets_table(elements, styles, data["tickets"], data["bugs_by_ticket"])

    doc.build(elements)
    return output_path, filename


def get_employees_reporting_to(db, lead_name: str) -> List[Employee]:
    """
    Get all development team employees reporting to a specific lead.
    """
    if not lead_name or not lead_name.strip():
        return []
    
    lead_normalized = lead_name.strip().lower()
    
    employees = (
        db.query(Employee)
        .filter(
            func.lower(Employee.lead).contains(lead_normalized),
            or_(
                func.upper(Employee.team).contains("DEV"),
                func.upper(Employee.team) == "DEVELOPMENT",
            ),
            Employee.is_active == True,
        )
        .order_by(Employee.name)
        .all()
    )
    return employees


def get_employee_by_name(db, name: str) -> Employee:
    """
    Find an employee by name (case-insensitive partial match).
    """
    if not name or not name.strip():
        return None
    
    name_normalized = name.strip().lower()
    
    employee = (
        db.query(Employee)
        .filter(func.lower(Employee.name).contains(name_normalized))
        .first()
    )
    return employee


def generate_bulk_reports_zip(db, employee_ids: List[str], zip_filename: str = None) -> Tuple[str, str]:
    """
    Generate PDF reports for multiple employees and package them in a ZIP file.
    Returns (zip_path, zip_filename).
    Each PDF inside the ZIP is named after the employee name.
    """
    import zipfile
    
    os.makedirs(REPORTS_FOLDER, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    
    if not zip_filename:
        zip_filename = f"Developer_Reports_{timestamp}.zip"
    
    zip_path = os.path.join(REPORTS_FOLDER, zip_filename)
    
    generated_files = []
    errors = []
    
    for emp_id in employee_ids:
        try:
            # Use employee name in filename for ZIP contents
            pdf_path, pdf_filename = generate_developer_report_pdf(db, emp_id, use_name_in_filename=True)
            generated_files.append((pdf_path, pdf_filename))
        except Exception as e:
            errors.append(f"{emp_id}: {str(e)}")
    
    if not generated_files:
        raise ValueError(f"No reports could be generated. Errors: {'; '.join(errors)}")
    
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for pdf_path, pdf_filename in generated_files:
            zipf.write(pdf_path, pdf_filename)
    
    # Clean up individual PDF files after zipping
    for pdf_path, _ in generated_files:
        try:
            os.remove(pdf_path)
        except Exception:
            pass
    
    return zip_path, zip_filename


def generate_team_reports_zip(db, lead_name: str) -> Tuple[str, str, List[str]]:
    """
    Generate PDF reports for all dev team members reporting to a specific lead.
    Returns (zip_path, zip_filename, list_of_employee_names).
    """
    employees = get_employees_reporting_to(db, lead_name)
    
    if not employees:
        raise ValueError(f"No development team employees found reporting to '{lead_name}'")
    
    employee_ids = [emp.employee_id for emp in employees]
    employee_names = [emp.name for emp in employees]
    
    lead_slug = re.sub(r"[^a-zA-Z0-9]+", "_", lead_name.strip())
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    zip_filename = f"Team_Reports_{lead_slug}_{timestamp}.zip"
    
    zip_path, _ = generate_bulk_reports_zip(db, employee_ids, zip_filename)
    
    return zip_path, zip_filename, employee_names


# Import func for SQL functions
from sqlalchemy import func
