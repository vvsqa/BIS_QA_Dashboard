"""Per-employee QA performance appraisal PDF, built from the performance-matrix data + an AI narrative.

generate_appraisal_pdf(emp, period_label, rank, team_size, narrative) -> Path
  emp           : one entry from the leaderboard response (composite_score, sub_scores, raw_metrics,
                  summary_lines, manager_notes, name, role)
  period_label  : e.g. "2026-06-01 → 2026-06-17"
  narrative     : {"overall": str, "strengths": [str], "areas": [str], "source": "ai"|"rule"}
A clean light-theme document meant to be printed / shared in an appraisal discussion.
"""
import os
from datetime import datetime
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable)

TEAL = colors.HexColor("#0d9488")
INK = colors.HexColor("#0f172a")
MUTED = colors.HexColor("#64748b")
LINE = colors.HexColor("#e2e8f0")
BAND = colors.HexColor("#f1f5f9")
GREEN = colors.HexColor("#16a34a")
RED = colors.HexColor("#dc2626")
AMBER = colors.HexColor("#d97706")

_REPORT_DIR = os.path.join(os.path.dirname(__file__), "reports")


def _styles():
    ss = getSampleStyleSheet()
    return {
        "h1": ParagraphStyle("h1", parent=ss["Title"], fontSize=19, textColor=INK, spaceAfter=2, leading=22),
        "sub": ParagraphStyle("sub", parent=ss["Normal"], fontSize=10, textColor=MUTED, spaceAfter=10),
        "h2": ParagraphStyle("h2", parent=ss["Heading2"], fontSize=12.5, textColor=TEAL, spaceBefore=12, spaceAfter=5),
        "body": ParagraphStyle("body", parent=ss["Normal"], fontSize=9.5, textColor=INK, leading=14),
        "small": ParagraphStyle("small", parent=ss["Normal"], fontSize=8.5, textColor=MUTED, leading=12),
        "cell": ParagraphStyle("cell", parent=ss["Normal"], fontSize=9, textColor=INK, leading=12),
        "cellb": ParagraphStyle("cellb", parent=ss["Normal"], fontSize=9, textColor=INK, leading=12, fontName="Helvetica-Bold"),
    }


def _metric_grid(rm, S):
    def cell(label, value, sub=None):
        v = Paragraph(f'<font size=14><b>{value}</b></font>' + (f'<br/><font size=7 color="#64748b">{sub}</font>' if sub else ""), S["cell"])
        return [Paragraph(label, S["small"]), v]
    cc = rm.get("complexity_counts") or {}
    cards = [
        cell("Delivered to live", rm.get("delivered_to_live", 0), f"{cc.get('high',0)}H · {cc.get('medium',0)}M · {cc.get('low',0)}L"),
        cell("In progress (QC)", rm.get("in_progress", 0)),
        cell("Awaiting BIS / go-live", rm.get("awaiting_review", 0)),
        cell("Bugs found", rm.get("bugs", 0)),
        cell("Quality", f"{rm.get('quality_percent', 0)}%"),
        cell("Estimate accuracy", f"{rm.get('estimate_accuracy', 0)}%"),
        cell("On-time vs target", f"{rm.get('on_time_rate', 0)}%"),
        cell("Ticket focus", f"{rm.get('ticket_focus_percent', 0)}%"),
        cell("Present", f"{rm.get('present_days', 0)}/{rm.get('working_days', 0)}", f"avg {rm.get('avg_hours_per_day',0)}h/day"),
        cell("Utilization", f"{rm.get('utilization_percent', 0)}%", f"{rm.get('hours',0)}h logged"),
    ]
    # 2 columns of (label/value) pairs → 4-col table
    rows, i = [], 0
    while i < len(cards):
        left = cards[i]
        right = cards[i + 1] if i + 1 < len(cards) else [Paragraph("", S["small"]), Paragraph("", S["cell"])]
        rows.append([left[0], left[1], right[0], right[1]])
        i += 2
    t = Table(rows, colWidths=[40 * mm, 35 * mm, 40 * mm, 35 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -2), 0.5, LINE),
        ("LINEAFTER", (1, 0), (1, -1), 0.5, LINE),
    ]))
    return t


def _bullets(items, S, color=INK):
    out = []
    for it in (items or []):
        out.append(Paragraph(f'<font color="{color.hexval() if hasattr(color,"hexval") else "#0f172a"}">●</font>&nbsp;&nbsp;{it}', S["body"]))
    return out or [Paragraph("—", S["small"])]


def generate_appraisal_pdf(emp, period_label, rank=None, team_size=None, narrative=None, out_path=None):
    S = _styles()
    rm = emp.get("raw_metrics", {}) or {}
    ss = emp.get("sub_scores", {}) or {}
    narrative = narrative or {}
    name = emp.get("name", "Employee")
    os.makedirs(_REPORT_DIR, exist_ok=True)
    safe = "".join(c for c in name if c.isalnum() or c in " _-").strip().replace(" ", "_")
    out = Path(out_path) if out_path else Path(_REPORT_DIR) / f"Appraisal_{safe}_{period_label.split(' ')[0]}.pdf"

    doc = SimpleDocTemplate(str(out), pagesize=A4, topMargin=16 * mm, bottomMargin=14 * mm,
                            leftMargin=16 * mm, rightMargin=16 * mm, title=f"Appraisal — {name}")
    F = []
    F.append(Paragraph("QA Performance Appraisal", S["h1"]))
    rankstr = f" · Rank {rank} of {team_size}" if rank and team_size else ""
    F.append(Paragraph(f"<b>{name}</b> · {emp.get('role') or 'QA'} · Period: {period_label}{rankstr}", S["sub"]))

    # Headline: composite score
    comp = emp.get("composite_score", 0)
    head = Table([[Paragraph("Overall performance score", S["small"]),
                   Paragraph(f'<font size=26 color="#0d9488"><b>{comp}</b></font><font size=11 color="#64748b"> / 100</font>', S["cell"])]],
                 colWidths=[95 * mm, 55 * mm])
    head.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), BAND), ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                              ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 12),
                              ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10)]))
    F.append(head)

    # AI / rule narrative
    if narrative.get("overall"):
        F.append(Paragraph("Summary", S["h2"]))
        F.append(Paragraph(narrative["overall"], S["body"]))
    if narrative.get("strengths"):
        F.append(Paragraph("Strengths", S["h2"]))
        F.extend(_bullets(narrative["strengths"], S, GREEN))
    if narrative.get("areas"):
        F.append(Paragraph("Areas to improve", S["h2"]))
        F.extend(_bullets(narrative["areas"], S, AMBER))

    # Key metrics
    F.append(Paragraph("Key metrics", S["h2"]))
    F.append(_metric_grid(rm, S))

    # Score breakdown
    F.append(Paragraph("Score breakdown (0–100 × weight)", S["h2"]))
    weights = {"throughput": 31, "ticket_focus": 14, "quality": 20, "presence": 14, "efficiency": 13, "output": 8}
    labels = {"throughput": "Throughput (tickets × complexity)", "ticket_focus": "Ticket focus",
              "quality": "Quality", "presence": "Presence", "efficiency": "Efficiency", "output": "Output (bugs/tests)"}
    rows = [[Paragraph("Metric", S["cellb"]), Paragraph("Score", S["cellb"]), Paragraph("Weight", S["cellb"])]]
    for k in ["throughput", "ticket_focus", "quality", "presence", "efficiency", "output"]:
        rows.append([Paragraph(labels[k], S["cell"]), Paragraph(str(ss.get(k, "–")), S["cell"]), Paragraph(f"{weights[k]}", S["cell"])])
    if rm.get("manager_note_net"):
        rows.append([Paragraph("Diligence (manager comments, applied directly)", S["cell"]),
                     Paragraph(f"{'+' if rm['manager_note_net'] > 0 else ''}{rm['manager_note_net']}", S["cell"]), Paragraph("direct", S["cell"])])
    if rm.get("leave_days"):
        rows.append([Paragraph("Leave penalty", S["cell"]), Paragraph(f"−{emp.get('leave_penalty', 0)}", S["cell"]), Paragraph("direct", S["cell"])])
    bt = Table(rows, colWidths=[110 * mm, 30 * mm, 25 * mm])
    bt.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE), ("BACKGROUND", (0, 0), (-1, 0), BAND),
                            ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                            ("ALIGN", (1, 0), (-1, -1), "CENTER")]))
    F.append(bt)

    # Delivered by module
    mods = rm.get("module_breakdown") or []
    if mods:
        F.append(Paragraph("Delivered by module", S["h2"]))
        mrows = [[Paragraph("Module", S["cellb"]), Paragraph("Delivered", S["cellb"])]]
        for m in mods[:10]:
            mrows.append([Paragraph(m.get("module", "—"), S["cell"]), Paragraph(str(m.get("count", 0)), S["cell"])])
        mt = Table(mrows, colWidths=[130 * mm, 35 * mm])
        mt.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE), ("BACKGROUND", (0, 0), (-1, 0), BAND),
                                ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                                ("ALIGN", (1, 0), (-1, -1), "CENTER")]))
        F.append(mt)

    # Manager comments
    notes = rm.get("manager_notes") or []
    F.append(Paragraph("Manager comments / incidents", S["h2"]))
    if notes:
        nrows = [[Paragraph("Date", S["cellb"]), Paragraph("Impact", S["cellb"]), Paragraph("Type", S["cellb"]), Paragraph("Comment", S["cellb"])]]
        for n in notes:
            clr = "#16a34a" if n.get("points", 0) >= 0 else "#dc2626"
            nrows.append([Paragraph(n.get("date", "—"), S["cell"]),
                          Paragraph(f'<font color="{clr}"><b>{"+" if n.get("points",0)>=0 else ""}{n.get("points",0)}</b></font>', S["cell"]),
                          Paragraph(f'{n.get("severity","")} {n.get("sentiment","")}', S["small"]),
                          Paragraph(n.get("text", ""), S["cell"])])
        nt = Table(nrows, colWidths=[22 * mm, 16 * mm, 28 * mm, 99 * mm])
        nt.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE), ("BACKGROUND", (0, 0), (-1, 0), BAND),
                                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                                ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
        F.append(nt)
    else:
        F.append(Paragraph("No manager comments recorded for this period.", S["small"]))

    F.append(Spacer(1, 10))
    F.append(HRFlowable(width="100%", thickness=0.5, color=LINE))
    src = "AI-assisted narrative" if narrative.get("source") == "ai" else "rule-based narrative"
    F.append(Paragraph(f"Generated {datetime.now().strftime('%d %b %Y %H:%M')} · {src} · from the QA performance matrix. "
                       "Diligence reflects manager comments only; bug-leakage is informational, not auto-scored.", S["small"]))

    doc.build(F)
    return out
