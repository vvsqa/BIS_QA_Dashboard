"""Weekly automation report CARD — a dark-themed PNG you can snip and paste into the mail body.

Uses the corrected (Excel-override) data. Sections: KPI cards, utilisation ring + daily growth,
per-member this-week (scripted / executed / passed) + next-week planned, and planned-by-module.
Rendered with Pillow (matplotlib not installed).
"""
import os
from datetime import date, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from database import SessionLocal
import automation_sync as A
import automation_override as OV

# ---- dark palette ----
BG = "#0f172a"; CARD = "#1e293b"; BORDER = "#334155"; TEXT = "#f1f5f9"; MUTED = "#94a3b8"
TEAL = "#14b8a6"; AMBER = "#f59e0b"; PURPLE = "#a78bfa"; BLUE = "#3b82f6"; GREEN = "#22c55e"
MEMBER_COLOR = {"Vishnu VS": TEAL, "Varsha Dcruz P": AMBER, "Vivek V Nair": PURPLE}
W = 1020


def _font(size, weight="r"):
    opts = {"r": ["segoeui.ttf", "arial.ttf"], "sb": ["seguisb.ttf", "segoeui.ttf", "arial.ttf"],
            "b": ["segoeuib.ttf", "arialbd.ttf", "arial.ttf"]}
    for name in opts.get(weight, opts["r"]):
        try:
            return ImageFont.truetype("C:/Windows/Fonts/" + name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _desktop():
    d = Path(os.path.expanduser("~")) / "Desktop"
    return d if d.exists() else Path(os.path.expanduser("~"))


def _card_data(db):
    m = A.compute_metrics(db)
    store = OV.load_override()
    if store.get("enabled"):
        OV.apply_to_team(m["team"])
        OV.apply_to_modules(m["modules"], m["overview"])
        planned_ids = [cid for p in (store.get("planned") or {}).values() for cid in p.get("case_ids", [])]
        mod_lookup = {}
        if planned_ids:
            from models import AutomationCase
            mod_lookup = {cid: mod for cid, mod in db.query(AutomationCase.case_id, AutomationCase.module)
                          .filter(AutomationCase.case_id.in_(planned_ids)).all()}
        OV.apply_to_planning(m["planning"], module_lookup=mod_lookup)
    # Read the MERGED team payload (override applied above where present, live values otherwise) so
    # members left on live data — e.g. Vishnu, who is popped from the override — still show counts
    # instead of blanks.
    team_by_name = {x.get("name"): x for x in (m["team"].get("members") or [])}
    members = []
    for name in OV.TEAM_ORDER:
        t = team_by_name.get(name, {})
        sc = t.get("this_week")
        # Scripted cases this week were executed and passed → executed = passed = scripted.
        members.append({
            "name": name, "color": MEMBER_COLOR.get(name, BLUE),
            "scripted": sc,
            "executed": sc,
            "passed": sc,
            "planned": (store.get("planned", {}).get(name, {}) or {}).get("count"),
        })
    return m["overview"], A.growth_series(db), members, m["planning"].get("by_module", []), m["modules"]


def render_card(week_start: date = None):
    """Render the dark automation weekly card and return the PIL Image (reused by the combined report)."""
    db = SessionLocal()
    try:
        ws = week_start or (date.today() - timedelta(days=date.today().weekday()))
        we = ws + timedelta(days=6)
        ov, growth, members, by_module, modules = _card_data(db)
        by_module = [b for b in by_module if b.get("module")][:6]
        mods = sorted([mm for mm in modules if mm.get("module") and mm.get("module") != "Unmapped"
                       and mm.get("total_cases", 0) > 0], key=lambda x: -x.get("automated_cases", 0))[:12]

        modtbl_h = 54 + 26 + len(mods) * 30 + 14
        pb_h = 56 + max(len(by_module), 1) * 30 + 14
        mt_y = 460 + 188 + 18          # below the member table
        pb_y = mt_y + modtbl_h + 18
        H = pb_y + pb_h + 28
        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        M = 30

        def txt(x, y, s, f, color=TEXT, anchor="la"):
            d.text((x, y), str(s), font=f, fill=color, anchor=anchor)

        def card(x, y, w, h, accent=None):
            d.rounded_rectangle([x, y, x + w, y + h], radius=14, fill=CARD, outline=BORDER, width=1)
            if accent:
                d.rounded_rectangle([x, y, x + w, y + 4], radius=2, fill=accent)

        # ---- header ----
        txt(M, 26, "Automation — Weekly Report", _font(30, "b"))
        txt(M, 64, "BIS Training Solutions · QA Automation Team", _font(13), MUTED)
        txt(W - M, 30, f"{ws.strftime('%d %b')} – {we.strftime('%d %b %Y')}", _font(15, "sb"), TEAL, anchor="ra")
        txt(W - M, 56, f"Generated {date.today().strftime('%d %b %Y')}", _font(12), MUTED, anchor="ra")
        d.line([M, 92, W - M, 92], fill=BORDER, width=1)

        # ---- KPI cards ----
        kpis = [
            ("Total cases", f"{ov['total_cases']:,}", BLUE),
            ("Automated cases", f"{ov['automated_cases']:,}", TEAL),
            ("Coverage", f"{ov['coverage_pct']:.0f}%", TEAL),
            ("Automated exec", f"{ov['automated_executions']:,}", PURPLE),
            ("Utilisation", f"{ov['utilization_pct']:.0f}%", PURPLE),
            ("Time saved", f"{ov['time_saved_hours']:,.0f} h", AMBER),
        ]
        ky, kh = 108, 86
        gap = 14
        kw = (W - 2 * M - gap * (len(kpis) - 1)) / len(kpis)
        for i, (lbl, val, ac) in enumerate(kpis):
            x = M + i * (kw + gap)
            card(x, ky, kw, kh, ac)
            txt(x + 16, ky + 22, val, _font(28, "b"))
            txt(x + 16, ky + 60, lbl, _font(12), MUTED)

        # ---- charts row ----
        cy, ch = ky + kh + 16, 232
        cw = (W - 2 * M - gap) / 2
        # Utilisation ring (left)
        card(M, cy, cw, ch)
        txt(M + 18, cy + 14, "Automation supporting manual testing", _font(15, "sb"))
        cx, ccy, r, ri = M + 120, cy + 135, 66, 44
        auto = ov.get("automated_executions", 0) or 0
        manual = ov.get("manual_executions", 0) or 0
        tot = auto + manual
        box = [cx - r, ccy - r, cx + r, ccy + r]
        if tot > 0:
            sweep = 360 * auto / tot
            d.pieslice(box, -90, -90 + sweep, fill=TEAL)
            d.pieslice(box, -90 + sweep, 270, fill=AMBER)
        else:
            d.ellipse(box, fill=BORDER)
        d.ellipse([cx - ri, ccy - ri, cx + ri, ccy + ri], fill=CARD)
        txt(cx, ccy - 8, f"{ov['utilization_pct']:.0f}%", _font(26, "b"), anchor="mm")
        txt(cx, ccy + 16, "utilisation", _font(11), MUTED, anchor="mm")
        lx = cx + r + 36
        for j, (clr, lab, v) in enumerate([(TEAL, "Automated executions", auto), (AMBER, "Manual executions", manual)]):
            yy = cy + 110 + j * 38
            d.rounded_rectangle([lx, yy, lx + 12, yy + 12], radius=3, fill=clr)
            txt(lx + 22, yy - 3, lab, _font(13), MUTED)
            txt(lx + 22, yy + 14, f"{v:,}", _font(16, "b"))

        # Daily growth (right)
        gx0 = M + cw + gap
        card(gx0, cy, cw, ch)
        txt(gx0 + 18, cy + 14, "Daily growth", _font(15, "sb"))
        gax, gay, gaw, gah = gx0 + 24, cy + 56, cw - 48, ch - 96
        series = [("Automated cases", "automated_cases", TEAL), ("Automated exec", "automated_executions", PURPLE)]
        vals_all = [g.get(k, 0) for g in growth for _, k, _ in series]
        ymax = max(vals_all) * 1.15 if vals_all else 1
        ymax = max(ymax, 1)
        for gl in range(3):
            yy = gay + gah * gl / 2
            d.line([gax, yy, gax + gaw, yy], fill=BORDER, width=1)
        n = max(1, len(growth) - 1)
        for lab, key, clr in series:
            pts = []
            for idx, g in enumerate(growth):
                px = gax + (gaw * idx / n if n else gaw / 2)
                py = gay + gah - gah * (g.get(key, 0) / ymax)
                pts.append((px, py))
            if len(pts) >= 2:
                d.line(pts, fill=clr, width=3, joint="curve")
            for p in pts:
                d.ellipse([p[0] - 3, p[1] - 3, p[0] + 3, p[1] + 3], fill=clr)
        if growth:
            txt(gax, cy + ch - 26, growth[0]["date"][5:], _font(11), MUTED)
            txt(gax + gaw, cy + ch - 26, growth[-1]["date"][5:], _font(11), MUTED, anchor="ra")
        for j, (lab, key, clr) in enumerate(series):
            lxx = gx0 + 150 + j * 170
            d.rounded_rectangle([lxx, cy + 18, lxx + 12, cy + 30], radius=3, fill=clr)
            txt(lxx + 18, cy + 16, lab, _font(11), MUTED)

        # ---- per-member table ----
        ty = cy + ch + 18
        card(M, ty, W - 2 * M, 188)
        txt(M + 18, ty + 14, "This week — by member", _font(15, "sb"))
        cols = [("MEMBER", M + 18, "la"), ("SCRIPTED", M + 470, "ra"), ("EXECUTED", M + 600, "ra"),
                ("PASSED", M + 720, "ra"), ("PLANNED (NEXT WK)", W - M - 22, "ra")]
        hy = ty + 50
        for c, cx2, an in cols:
            txt(cx2, hy, c, _font(11, "sb"), MUTED, anchor=an)
        d.line([M + 16, hy + 22, W - M - 16, hy + 22], fill=BORDER, width=1)
        for i, mem in enumerate(members):
            ry = hy + 36 + i * 34
            d.ellipse([M + 18, ry + 3, M + 30, ry + 15], fill=mem["color"])
            txt(M + 40, ry, mem["name"], _font(14, "sb"))
            def cell(v, x, an="ra"):
                disp = "—" if v is None else (f"{v:,}" if isinstance(v, (int, float)) else str(v))
                txt(x, ry, disp, _font(14), TEXT if v is not None else MUTED, anchor=an)
            cell(mem["scripted"], M + 470)
            cell(mem["executed"], M + 600)
            cell(mem["passed"], M + 720)
            cell(mem["planned"], W - M - 22)

        # ---- module breakdown table ----
        card(M, mt_y, W - 2 * M, modtbl_h)
        txt(M + 18, mt_y + 14, "Module breakdown", _font(15, "sb"))
        mcols = [("MODULE", M + 18, "la"), ("TOTAL", M + 480, "ra"), ("AUTOMATED", M + 600, "ra"),
                 ("COVERAGE", M + 710, "ra"), ("EXECUTIONS", M + 840, "ra"), ("TIME SAVED", W - M - 22, "ra")]
        mhy = mt_y + 48
        for c, cx2, an in mcols:
            txt(cx2, mhy, c, _font(11, "sb"), MUTED, anchor=an)
        d.line([M + 16, mhy + 22, W - M - 16, mhy + 22], fill=BORDER, width=1)
        for i, mm in enumerate(mods):
            ry = mhy + 34 + i * 30
            txt(M + 18, ry, mm["module"], _font(13, "sb"))
            txt(M + 480, ry, f"{mm.get('total_cases', 0):,}", _font(13), TEXT, anchor="ra")
            txt(M + 600, ry, f"{mm.get('automated_cases', 0):,}", _font(13), TEXT, anchor="ra")
            txt(M + 710, ry, f"{mm.get('coverage_pct', 0):.0f}%", _font(13, "sb"), TEAL, anchor="ra")
            txt(M + 840, ry, f"{mm.get('total_executions', 0):,}", _font(13), MUTED, anchor="ra")
            tsv = mm.get('time_saved_hours', 0) or 0
            txt(W - M - 22, ry, f"{tsv:,.0f} h", _font(13, "sb"), AMBER if tsv else MUTED, anchor="ra")

        # ---- planned by module ----
        my, mh = pb_y, pb_h
        card(M, my, W - 2 * M, mh)
        txt(M + 18, my + 14, "Planned next week — by module", _font(15, "sb"))
        maxp = max([b["planned"] for b in by_module], default=1) or 1
        bx, bw = M + 230, W - 2 * M - 230 - 60
        for i, b in enumerate(by_module):
            yy = my + 52 + i * 30
            txt(M + 18, yy, b["module"], _font(13), MUTED)
            fillw = max(4, bw * b["planned"] / maxp)
            d.rounded_rectangle([bx, yy + 2, bx + bw, yy + 14], radius=6, fill="#243047")
            d.rounded_rectangle([bx, yy + 2, bx + fillw, yy + 14], radius=6, fill=TEAL)
            txt(W - M - 22, yy, f"{b['planned']}", _font(13, "b"), anchor="ra")

        return img
    finally:
        db.close()


def generate_weekly_card(week_start: date = None, output_path: Path = None, fmt: str = "png") -> Path:
    """Render the automation weekly card and save it (png default, or pdf). Unchanged public API."""
    ws = week_start or (date.today() - timedelta(days=date.today().weekday()))
    img = render_card(week_start)
    is_pdf = (fmt or "png").lower() == "pdf" or (output_path and str(output_path).lower().endswith(".pdf"))
    ext = "pdf" if is_pdf else "png"
    out = output_path or (_desktop() / f"Automation_Weekly_Card_{ws.isoformat()}.{ext}")
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if is_pdf:
        img.save(out, "PDF", resolution=110)
    else:
        img.save(out)
    return out


if __name__ == "__main__":
    print(generate_weekly_card())
