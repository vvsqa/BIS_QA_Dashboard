"""
Monthly Team Report Generator.

Generates a PDF for a given month (defaults to the current month) with
per-team blocks (QA and Development) showing:
    - Active head-count split by Billed / Un-billed
    - Working days in the month
    - Total billable hours (capacity = working_days * 8 * billable_employees)
    - Total billable hours actually logged by billed employees
    - Billable utilization %
    - Total actual hours logged across all team members
    - Total leaves taken (days and hours)
    - Top employees by leave days

Usage:
    cd backend
    python monthly_team_report.py                    # current month
    python monthly_team_report.py --month 2026-04    # specific month
    python monthly_team_report.py --out custom_dir   # custom output dir
"""

import argparse
import calendar
import os
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.flowables import HRFlowable
from sqlalchemy import or_

from database import SessionLocal
from models import (
    Employee,
    EmployeeNameMapping,
    EnhancedTimesheet,
    Holiday,
    LeaveEntry,
)

REPORTS_FOLDER = os.path.join(os.path.dirname(__file__), "reports")
LOGO_PATH = os.path.join(
    os.path.dirname(__file__), "..", "frontend", "public", "techversant-logo.png"
)
HOURS_PER_DAY = 8.0
TOP_N_LEAVES = 5

# Timesheet-correction thresholds (mirrors report_qa_low_hours_april.py).
STRICT_DAY_THRESHOLD = 6.5    # any working day with work hours <= this and no leave is flagged
MONTHLY_AVG_THRESHOLD = 8.0   # monthly avg >= this means person is overall fine
# Working day where this fraction of the team logged 0h with no leave
# is treated as a "suspected company-off day" (e.g. holiday missing
# from the holidays table) and excluded from per-person flagging.
COMPANY_OFF_THRESHOLD_FRACTION = 0.5

TEAM_BLOCKS = [
    {"label": "QA Team", "employee_team": "QA", "timesheet_team": "QA"},
    {
        "label": "Development Team",
        "employee_team": "DEVELOPMENT",
        "timesheet_team": "DEV",
    },
]


def _compact(name):
    return re.sub(r"[^a-z0-9]+", "", str(name or "").lower())


def get_month_range(month_str=None):
    if month_str:
        year, mon = map(int, month_str.split("-"))
    else:
        today = date.today()
        year, mon = today.year, today.month
    last_day = calendar.monthrange(year, mon)[1]
    return year, mon, date(year, mon, 1), date(year, mon, last_day)


def get_working_days(month_start, month_end, holiday_dates):
    days = []
    d = month_start
    while d <= month_end:
        if d.weekday() < 5 and d not in holiday_dates:
            days.append(d)
        d += timedelta(days=1)
    return days


def collect_team_metrics(
    db, employee_team, timesheet_team, month_start, month_end, working_days
):
    employees = (
        db.query(Employee)
        .filter(Employee.is_active == True, Employee.team == employee_team)
        .order_by(Employee.name)
        .all()
    )
    emp_ids = [e.employee_id for e in employees]
    emp_names = [e.name for e in employees if e.name]
    canonical_by_id = {e.employee_id: e.name for e in employees if e.name}
    canonical_by_compact = {_compact(n): n for n in emp_names if n}
    canonical_set = set(canonical_by_id.values())
    for m in (
        db.query(EmployeeNameMapping).filter(EmployeeNameMapping.is_active == True).all()
    ):
        if not m.alternate_name:
            continue
        canonical = m.canonical_name or canonical_by_id.get(m.employee_id)
        if not canonical or canonical not in canonical_set:
            continue
        canonical_by_compact[_compact(m.alternate_name)] = canonical

    def resolve(emp_id, emp_name):
        if emp_id and emp_id in canonical_by_id:
            return canonical_by_id[emp_id]
        return canonical_by_compact.get(_compact(emp_name))

    billed_employees = [
        e for e in employees if e.category and e.category.upper() == "BILLED"
    ]
    billed_names = {e.name for e in billed_employees}

    ts_entries = (
        db.query(EnhancedTimesheet)
        .filter(
            EnhancedTimesheet.team == timesheet_team,
            EnhancedTimesheet.date >= month_start,
            EnhancedTimesheet.date <= month_end,
            or_(
                EnhancedTimesheet.employee_id.in_(emp_ids),
                EnhancedTimesheet.employee_name.in_(emp_names),
            ),
        )
        .all()
    )

    work_hours_by_emp = defaultdict(float)
    work_hours_by_emp_day = defaultdict(lambda: defaultdict(float))
    leave_hours_by_emp_from_ts = defaultdict(float)
    leave_days_from_ts = defaultdict(set)
    for ent in ts_entries:
        canonical = resolve(ent.employee_id, ent.employee_name)
        if not canonical:
            continue
        display_h = (
            ent.productive_hours
            if ent.productive_hours and ent.productive_hours > 0
            else (ent.hours_logged or 0)
        )
        display_h = float(display_h or 0)
        if ent.leave_type:
            leave_hours_by_emp_from_ts[canonical] += display_h
            leave_days_from_ts[canonical].add(ent.date)
        else:
            work_hours_by_emp[canonical] += display_h
            work_hours_by_emp_day[canonical][ent.date] += display_h

    leave_entries = (
        db.query(LeaveEntry)
        .filter(
            LeaveEntry.team == timesheet_team,
            LeaveEntry.date >= month_start,
            LeaveEntry.date <= month_end,
            or_(
                LeaveEntry.employee_id.in_(emp_ids),
                LeaveEntry.employee_name.in_(emp_names),
            ),
        )
        .all()
    )
    leave_days_by_emp = defaultdict(set)
    leave_hours_by_emp = defaultdict(float)
    leave_type_breakdown = defaultdict(lambda: {"days": 0, "hours": 0.0})
    leave_types_by_emp = defaultdict(lambda: defaultdict(int))  # emp -> type -> days
    for lv in leave_entries:
        canonical = resolve(lv.employee_id, lv.employee_name)
        if not canonical:
            continue
        leave_days_by_emp[canonical].add(lv.date)
        leave_hours_by_emp[canonical] += float(lv.hours or 0)
        leave_type_breakdown[lv.leave_type or "Leave"]["days"] += 1
        leave_type_breakdown[lv.leave_type or "Leave"]["hours"] += float(lv.hours or 0)
        leave_types_by_emp[canonical][lv.leave_type or "Leave"] += 1
    # Fallback: if LeaveEntry was empty for an employee but EnhancedTimesheet
    # has leave rows, accept those as the source of truth.
    for name, h in leave_hours_by_emp_from_ts.items():
        if leave_hours_by_emp.get(name, 0) <= 0:
            leave_hours_by_emp[name] = h
    for name, days in leave_days_from_ts.items():
        leave_days_by_emp[name].update(days)

    billable_employees_count = len(billed_employees)
    billable_hours_target = (
        len(working_days) * HOURS_PER_DAY * billable_employees_count
    )
    total_actual_hours = sum(work_hours_by_emp.values())
    billable_actual_hours = sum(
        h for n, h in work_hours_by_emp.items() if n in billed_names
    )
    total_leave_hours = sum(leave_hours_by_emp.values())
    total_leave_days = sum(len(d) for d in leave_days_by_emp.values())

    top_leaves = sorted(
        (
            (name, len(days), leave_hours_by_emp.get(name, 0))
            for name, days in leave_days_by_emp.items()
        ),
        key=lambda x: (-x[1], -x[2], x[0]),
    )[:TOP_N_LEAVES]

    # Full per-employee leave list - includes EVERY active team member,
    # even those who took zero leave, sorted by leave days descending.
    leaves_by_employee = []
    for emp in employees:
        name = emp.name
        if not name:
            continue
        days_taken = len(leave_days_by_emp.get(name, set()))
        hours_taken = leave_hours_by_emp.get(name, 0) or 0.0
        types_str = (
            ", ".join(
                f"{lt} ({c})"
                for lt, c in sorted(leave_types_by_emp.get(name, {}).items())
            )
            or "-"
        )
        leaves_by_employee.append((name, days_taken, hours_taken, types_str))
    leaves_by_employee.sort(key=lambda x: (-x[1], -x[2], x[0]))

    # ---- Timesheet correction logic (mirrors report_qa_low_hours_april) ----
    today = date.today()
    past_working_days = [d for d in working_days if d <= today]

    active_count = sum(1 for e in employees if e.name)
    suspected_off_days = []
    for wd in past_working_days:
        zero_count = 0
        for emp in employees:
            name = emp.name
            if not name:
                continue
            if wd in leave_days_by_emp.get(name, set()):
                continue
            if work_hours_by_emp_day.get(name, {}).get(wd, 0.0) <= 0:
                zero_count += 1
        if zero_count >= max(2, active_count * COMPANY_OFF_THRESHOLD_FRACTION):
            suspected_off_days.append((wd, zero_count))
    suspected_off_set = {d for d, _ in suspected_off_days}
    effective_working_days = [d for d in past_working_days if d not in suspected_off_set]

    underperformers = []
    avg_ok_with_bad_days = []
    for emp in employees:
        name = emp.name
        if not name:
            continue
        emp_work = work_hours_by_emp_day.get(name, {})
        emp_leave_days = leave_days_by_emp.get(name, set())
        emp_leave_hours_map = {d: 0.0 for d in emp_leave_days}
        # Approximate per-day leave hours: use total / day_count when not stored daily
        if emp_leave_days:
            avg_per_day = (leave_hours_by_emp.get(name, 0) or 0) / len(emp_leave_days)
            for d in emp_leave_days:
                emp_leave_hours_map[d] = avg_per_day

        total_worked = sum(emp_work.get(wd, 0.0) for wd in effective_working_days)
        total_leave = sum(
            emp_leave_hours_map.get(wd, 0.0)
            for wd in effective_working_days
            if wd in emp_leave_days
        )
        total_effective = total_worked + total_leave
        denom = len(effective_working_days) or 1
        monthly_avg = total_effective / denom
        month_ok = monthly_avg + 1e-6 >= MONTHLY_AVG_THRESHOLD

        bad_days = []
        for wd in effective_working_days:
            if wd in emp_leave_days:
                continue
            worked = emp_work.get(wd, 0.0)
            if worked <= STRICT_DAY_THRESHOLD:
                bad_days.append((wd, round(worked, 2)))

        row = {
            "name": name,
            "monthly_avg": round(monthly_avg, 2),
            "effective": round(total_effective, 2),
            "expected": round(denom * HOURS_PER_DAY, 1),
            "bad_days": bad_days,
        }
        if not month_ok:
            underperformers.append(row)
        elif bad_days:
            avg_ok_with_bad_days.append(row)
    underperformers.sort(key=lambda r: (r["monthly_avg"], r["name"]))
    avg_ok_with_bad_days.sort(key=lambda r: r["name"])

    return {
        "employees_total": len(employees),
        "billed_employees": billable_employees_count,
        "non_billed_employees": len(employees) - billable_employees_count,
        "working_days": len(working_days),
        "effective_working_days": len(effective_working_days),
        "billable_hours_target": billable_hours_target,
        "billable_actual_hours": billable_actual_hours,
        "actual_hours": total_actual_hours,
        "leave_hours": total_leave_hours,
        "leave_days": total_leave_days,
        "top_leaves": top_leaves,
        "leaves_by_employee": leaves_by_employee,
        "leave_type_breakdown": dict(leave_type_breakdown),
        "suspected_off_days": suspected_off_days,
        "underperformers": underperformers,
        "avg_ok_with_bad_days": avg_ok_with_bad_days,
    }


def _summary_table(metrics):
    utilization = (
        metrics["billable_actual_hours"] / metrics["billable_hours_target"] * 100
        if metrics["billable_hours_target"] > 0
        else 0
    )
    rows = [
        [
            "Active employees (Billed / Un-billed)",
            f"{metrics['employees_total']}  ({metrics['billed_employees']} / {metrics['non_billed_employees']})",
        ],
        ["Working days in month", str(metrics["working_days"])],
        [
            "Total billable hours (capacity)",
            f"{metrics['billable_hours_target']:.1f} h",
        ],
        [
            "Total billable hours (actual logged)",
            f"{metrics['billable_actual_hours']:.1f} h",
        ],
        ["Billable utilization", f"{utilization:.1f} %"],
        ["Total actual hours (all employees)", f"{metrics['actual_hours']:.1f} h"],
        [
            "Total leaves",
            f"{metrics['leave_days']} day(s)  /  {metrics['leave_hours']:.1f} h",
        ],
    ]
    t = Table(rows, colWidths=[95 * mm, 80 * mm])
    t.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#cccccc")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f0f4f8")),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return t


def _styled_table(data, col_widths, header_align_centered_from_col=2):
    style = [
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#cccccc")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0b2a4a")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f7f9fc")]),
    ]
    if header_align_centered_from_col is not None:
        style.append(
            (
                "ALIGN",
                (header_align_centered_from_col, 0),
                (-1, -1),
                "CENTER",
            )
        )
    t = Table(data, colWidths=col_widths)
    t.setStyle(TableStyle(style))
    return t


def _top_leaves_table(top_leaves):
    if not top_leaves:
        return None
    data = [["#", "Employee", "Leave days", "Leave hours"]]
    for i, (name, days, hours) in enumerate(top_leaves, 1):
        data.append([str(i), name, str(days), f"{hours:.1f} h"])
    return _styled_table(data, [12 * mm, 95 * mm, 30 * mm, 38 * mm])


def _leave_type_table(breakdown):
    if not breakdown:
        return None
    data = [["Leave type", "Days", "Hours"]]
    for lt, info in sorted(breakdown.items(), key=lambda x: (-x[1]["days"], x[0])):
        data.append([lt or "Leave", str(info["days"]), f"{info['hours']:.1f} h"])
    return _styled_table(data, [110 * mm, 30 * mm, 35 * mm])


def _leaves_by_employee_table(rows):
    if not rows:
        return None
    data = [["Employee", "Days", "Hours", "Leave types"]]
    for name, days, hours, types in rows:
        data.append([name, str(days), f"{hours:.1f} h", types])
    return _styled_table(data, [55 * mm, 18 * mm, 22 * mm, 80 * mm])


def _format_dates(dates):
    return ", ".join(d.strftime("%a %d %b") for d in dates)


def _underperformer_table(rows, body_style):
    if not rows:
        return None
    data = [["Employee", "Avg", "Effective / Expected", "Days to fix (<= 6.5h, no leave)"]]
    for r in rows:
        bad_days_text = (
            "\n".join(f"{d.strftime('%a %d %b')} ({h}h)" for d, h in r["bad_days"])
            or "spread across days"
        )
        data.append(
            [
                r["name"],
                f"{r['monthly_avg']:.2f}h",
                f"{r['effective']:.1f} / {r['expected']:.0f}h",
                Paragraph(bad_days_text.replace("\n", "<br/>"), body_style),
            ]
        )
    return _styled_table(
        data, [55 * mm, 18 * mm, 38 * mm, 64 * mm], header_align_centered_from_col=1
    )


def _avg_ok_table(rows, body_style):
    if not rows:
        return None
    data = [["Employee", "Avg", "Day(s) to fix"]]
    for r in rows:
        bad_days_text = "\n".join(
            f"{d.strftime('%a %d %b')} ({h}h)" for d, h in r["bad_days"]
        )
        data.append(
            [
                r["name"],
                f"{r['monthly_avg']:.2f}h (OK)",
                Paragraph(bad_days_text.replace("\n", "<br/>"), body_style),
            ]
        )
    return _styled_table(
        data, [55 * mm, 35 * mm, 85 * mm], header_align_centered_from_col=1
    )


def _suspected_off_table(rows, total_emp):
    if not rows:
        return None
    data = [["Date", "People at 0h with no leave"]]
    for d, zc in rows:
        data.append([d.strftime("%a %d %b %Y"), f"{zc} of {total_emp}"])
    return _styled_table(data, [60 * mm, 115 * mm], header_align_centered_from_col=1)


def build_team_pdf(team_label, month_start, month_end, metrics, output_path):
    """Build a PDF for ONE team only."""
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        rightMargin=15 * mm,
        leftMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "title",
        parent=styles["Title"],
        fontSize=22,
        textColor=colors.HexColor("#0b2a4a"),
    )
    subtitle_style = ParagraphStyle(
        "sub",
        parent=styles["Normal"],
        fontSize=11,
        textColor=colors.HexColor("#444444"),
    )
    h2_style = ParagraphStyle(
        "h2",
        parent=styles["Heading2"],
        fontSize=15,
        textColor=colors.HexColor("#0b2a4a"),
        spaceAfter=8,
    )
    h3_style = ParagraphStyle(
        "h3",
        parent=styles["Heading3"],
        fontSize=12,
        textColor=colors.HexColor("#0b2a4a"),
        spaceAfter=6,
    )
    body = styles["BodyText"]
    body_cell_style = ParagraphStyle("cell", parent=body, fontSize=9, leading=11)

    elements = []
    if os.path.exists(LOGO_PATH):
        try:
            elements.append(Image(LOGO_PATH, width=45 * mm, height=12 * mm))
            elements.append(Spacer(1, 6))
        except Exception:
            pass

    elements.append(Paragraph(f"Monthly {team_label} Report", title_style))
    elements.append(
        Paragraph(
            f"Period: {month_start.strftime('%d %b %Y')} - {month_end.strftime('%d %b %Y')}"
            f"  |  Generated: {datetime.now().strftime('%d %b %Y %H:%M')}",
            subtitle_style,
        )
    )
    elements.append(
        HRFlowable(
            width="100%",
            thickness=1,
            color=colors.HexColor("#0b2a4a"),
            spaceBefore=8,
            spaceAfter=12,
        )
    )

    elements.append(Paragraph(team_label, h2_style))
    elements.append(_summary_table(metrics))
    elements.append(Spacer(1, 12))

    # ------- Leave breakdown -------
    elements.append(Paragraph("Leaves by type", h3_style))
    type_table = _leave_type_table(metrics["leave_type_breakdown"])
    if type_table is not None:
        elements.append(type_table)
    else:
        elements.append(Paragraph("No leaves recorded for this month.", body))
    elements.append(Spacer(1, 12))

    elements.append(
        Paragraph(
            "All employees and leaves taken (sorted: most leaves first)",
            h3_style,
        )
    )
    emp_table = _leaves_by_employee_table(metrics["leaves_by_employee"])
    if emp_table is not None:
        elements.append(emp_table)
    else:
        elements.append(Paragraph("No employees in this team.", body))
    elements.append(Spacer(1, 14))

    # ------- Timesheet corrections -------
    elements.append(Paragraph("Timesheet corrections needed", h3_style))
    elements.append(
        Paragraph(
            f"Per-day rule: working day with work &le; {STRICT_DAY_THRESHOLD:g}h and no leave applied. "
            f"Monthly rule: avg &lt; {MONTHLY_AVG_THRESHOLD:g}h means underperforming. "
            f"Effective working days for this report: <b>{metrics['effective_working_days']}</b> "
            f"(of {metrics['working_days']} after weekends, holidays, suspected off-days).",
            body_cell_style,
        )
    )
    elements.append(Spacer(1, 6))

    if metrics["suspected_off_days"]:
        elements.append(
            Paragraph(
                "<b>Suspected company-off days</b> (excluded from per-person flagging):",
                body_cell_style,
            )
        )
        off_table = _suspected_off_table(
            metrics["suspected_off_days"], metrics["employees_total"]
        )
        if off_table is not None:
            elements.append(off_table)
        elements.append(Spacer(1, 8))

    elements.append(
        Paragraph(
            "<b>Underperforming overall (avg &lt; 8.0h)</b>",
            body_cell_style,
        )
    )
    u_table = _underperformer_table(metrics["underperformers"], body_cell_style)
    if u_table is not None:
        elements.append(u_table)
    else:
        elements.append(Paragraph("None.", body))
    elements.append(Spacer(1, 8))

    elements.append(
        Paragraph(
            "<b>Average OK but specific day(s) need correction</b>",
            body_cell_style,
        )
    )
    a_table = _avg_ok_table(metrics["avg_ok_with_bad_days"], body_cell_style)
    if a_table is not None:
        elements.append(a_table)
    else:
        elements.append(Paragraph("None.", body))

    doc.build(elements)
    return output_path


def generate_report(month_str=None, output_dir=None, teams=None):
    """Generate one PDF per team. Returns a list of {team, label, path} dicts.

    Args:
        month_str:  "YYYY-MM" or None for current month
        output_dir: folder to drop the PDFs in (default: backend/reports)
        teams:      optional list of team keys to limit to ("QA", "DEV").
                    None = both teams.
    """
    year, mon, month_start, month_end = get_month_range(month_str)
    db = SessionLocal()
    try:
        holiday_dates = {
            h.holiday_date
            for h in db.query(Holiday)
            .filter(
                Holiday.holiday_date >= month_start,
                Holiday.holiday_date <= month_end,
                Holiday.is_active == True,
            )
            .all()
        }
        working_days = get_working_days(month_start, month_end, holiday_dates)

        wanted = {t.upper() for t in teams} if teams else None
        team_specs = [
            ("QA", "QA Team", "QA", "QA"),
            ("DEV", "Development Team", "DEVELOPMENT", "DEV"),
        ]

        out_dir = output_dir or REPORTS_FOLDER
        os.makedirs(out_dir, exist_ok=True)
        outputs = []
        for team_key, team_label, employee_team, timesheet_team in team_specs:
            if wanted and team_key not in wanted:
                continue
            metrics = collect_team_metrics(
                db, employee_team, timesheet_team, month_start, month_end, working_days
            )
            output_path = os.path.join(
                out_dir,
                f"Monthly_Team_Report_{team_key}_{year:04d}-{mon:02d}.pdf",
            )
            build_team_pdf(team_label, month_start, month_end, metrics, output_path)
            outputs.append({"team": team_key, "label": team_label, "path": output_path})
    finally:
        db.close()
    return outputs


def main():
    parser = argparse.ArgumentParser(
        description="Generate monthly team PDF reports (one PDF per team: QA and Development)."
    )
    parser.add_argument(
        "--month",
        type=str,
        help="Month in YYYY-MM (default: current month)",
    )
    parser.add_argument(
        "--out",
        type=str,
        help="Output directory (default: backend/reports)",
    )
    parser.add_argument(
        "--teams",
        type=str,
        default=None,
        help="Comma-separated team keys to generate (QA,DEV). Default: both.",
    )
    args = parser.parse_args()
    teams = [t.strip() for t in args.teams.split(",")] if args.teams else None
    outputs = generate_report(args.month, args.out, teams=teams)
    for item in outputs:
        print(f"Report generated [{item['team']}]: {item['path']}")


if __name__ == "__main__":
    main()
