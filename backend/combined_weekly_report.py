"""Combined QA weekly report: manual card (page 1) + automation card (page 2) + a case-list tables
page (Planned next week + Backlog, grouped by module with counts). One multi-page PDF.

Reuses the existing card renderers (qa_weekly_report.render_card / automation_weekly_card.render_card)
and the weekly automation buckets (automation_sync.compute_weekly_automation)."""
from datetime import date, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from database import SessionLocal
import qa_weekly_report as MAN
import automation_weekly_card as AUTO
import automation_sync as A

# dark palette (matches the cards)
BG = "#0f172a"; CARD = "#1e293b"; BORDER = "#334155"; TEXT = "#f1f5f9"; MUTED = "#94a3b8"
TEAL = "#14b8a6"; AMBER = "#f59e0b"; FAINT = "#64748b"
W = 1020
M = 30
BACKLOG_ROW_BUDGET = 60  # cap case rows shown for the (potentially huge) backlog


def _font(size, weight="r"):
    opts = {"r": ["segoeui.ttf", "arial.ttf"], "sb": ["seguisb.ttf", "segoeui.ttf", "arial.ttf"],
            "b": ["segoeuib.ttf", "arialbd.ttf", "arial.ttf"]}
    for name in opts.get(weight, opts["r"]):
        try:
            return ImageFont.truetype("C:/Windows/Fonts/" + name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _section_rows(sec, row_budget=None):
    """(unused — kept for back-compat)"""
    return []


TEAM = ["Vishnu VS", "Varsha Dcruz P", "Vivek V Nair"]


def _build_summary(db, ws):
    """Per-person counts for the report: scripted this week, cumulative, backlog, and next-week planned.
    Vivek/Varsha come from the manual override; Vishnu stays on live synced data. Counts only — no case lists."""
    import automation_override as OV
    ov = OV.load_override()
    en = ov.get("enabled")
    team_ov = (ov.get("team") or {}) if en else {}
    planned_ov = (ov.get("planned") or {}) if en else {}
    live = A.compute_team(db, ws)
    live_by = {m["name"]: m for m in live.get("members", [])}
    wk = A.compute_weekly_automation(db, ws)
    live_scripted = {r["person"]: r["scripted"] for r in wk["this_week"]["by_person"]}

    rows = []
    for p in TEAM:
        t = team_ov.get(p, {})
        # Field-level: use the override value where set, otherwise fall back to LIVE (lets Vishnu have
        # an overridden all-time cumulative while his this-week scripted stays live).
        scripted = t.get("this_week") if t.get("this_week") is not None else live_scripted.get(p)
        cumulative = t.get("total_scripted") if t.get("total_scripted") is not None else (live_by.get(p) or {}).get("total_scripted")
        backlog = t.get("backlog")
        pcount = (planned_ov.get(p) or {}).get("count", 0)
        # planned count may be a label (e.g. "API automation") with no number — keep it as text then
        planned_next = (pcount + (backlog or 0)) if isinstance(pcount, (int, float)) else pcount
        rows.append({"person": p, "scripted": scripted, "cumulative": cumulative,
                     "backlog": backlog, "next_week": planned_next})
    next_total = sum(r["next_week"] for r in rows if isinstance(r["next_week"], (int, float)))
    nws = ws + timedelta(days=7)
    return rows, next_total, nws.isoformat(), (nws + timedelta(days=4)).isoformat()


def _render_summary(rows, next_total, nws, nwe):
    line_h = 34
    # room below the table for the two-line "Planned for next week" block + the footer (the +70 used to
    # land the footer exactly on the planned line — overlap).
    H = 96 + 44 + len(rows) * line_h + 120
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    def txt(x, y, s, f, color=TEXT, anchor="la"):
        d.text((x, y), str(s), font=f, fill=color, anchor=anchor)

    d.rounded_rectangle([M, 26, M + 6, 70], radius=3, fill=TEAL)
    txt(M + 18, 28, "Automation — Weekly Counts", _font(28, "b"))
    txt(M + 18, 66, "Scripted · cumulative · backlog per person (counts)", _font(13), MUTED)
    d.line([M, 96, W - M, 96], fill=BORDER, width=1)

    # column header
    cols = [("Member", M + 6, "la"), ("Scripted this week", 560, "ma"), ("Cumulative", 730, "ma"), ("Backlog", 880, "ma")]
    hy = 116
    for label, x, a in cols:
        txt(x, hy, label, _font(12.5, "sb"), MUTED, anchor=a)
    y = hy + 30
    fmt = lambda v: "—" if v is None else f"{v}"
    for r in rows:
        d.rounded_rectangle([M, y, W - M, y + line_h - 6], radius=6, fill="#1a2436")
        txt(M + 14, y + 5, r["person"], _font(14, "sb"), TEXT)
        txt(560, y + 5, fmt(r["scripted"]), _font(14, "b"), TEAL, anchor="ma")
        txt(730, y + 5, fmt(r["cumulative"]), _font(14, "b"), TEXT, anchor="ma")
        txt(880, y + 5, fmt(r["backlog"]), _font(14), AMBER, anchor="ma")
        y += line_h
    y += 14
    txt(M, y, f"Planned for next week ({nws} – {nwe}):", _font(15, "b"), TEAL)
    parts = "   ".join(f"{r['person'].split()[0]} {r['next_week']}" for r in rows)
    txt(M, y + 26, f"{parts}      Total {next_total}   (each person's plan + rolled-over backlog)",
        _font(13), MUTED)
    txt(M, H - 24, "BIS Training Solutions · QA Automation Team · counts only", _font(10.5), FAINT)
    return img


def generate_combined_pdf(manual_data, week_start: date = None, output_path: Path = None) -> Path:
    """One PDF: manual card + automation card + a counts-only automation summary (per-person scripted /
    cumulative / backlog + next-week planned total). No case lists. `manual_data` from _build_qa_weekly_data."""
    ws = week_start or (date.today() - timedelta(days=date.today().weekday()))
    # The combined report omits the "Slowest tickets in QC" table (kept only on the standalone manual
    # report). render_card gates that section on slow_tickets, so empty it for the combined render.
    manual_data = {**manual_data, "slow_tickets": []}
    manual_img = MAN.render_card(manual_data).convert("RGB")
    auto_img = AUTO.render_card(ws).convert("RGB")
    db = SessionLocal()
    try:
        rows, next_total, nws, nwe = _build_summary(db, ws)
    finally:
        db.close()
    summary_img = _render_summary(rows, next_total, nws, nwe).convert("RGB")

    out = Path(output_path or (Path(__file__).parent / "reports" / f"QA_Automation_Combined_{ws.isoformat()}.pdf"))
    out.parent.mkdir(parents=True, exist_ok=True)
    manual_img.save(out, "PDF", resolution=110, save_all=True, append_images=[auto_img, summary_img])
    return out
