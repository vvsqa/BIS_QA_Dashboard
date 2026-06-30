"""QA Weekly Report — dark-themed PDF for the client (WEB MANUAL TESTING team).

One Friday-ready page covering the week (Mon–Fri): LOAD (how much QA handled), MOVEMENT (how
tickets flowed through the QA pipeline) and AVERAGE QA CYCLE TIME. Mobile-QA and Automation are
excluded upstream. Rendered with Pillow on a dark canvas and saved as PDF. The caller (main.py)
computes the data dict and passes it in (avoids circular imports).
"""
import os
from datetime import date
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BG = "#0e1626"; CARD = "#1b2536"; CARD2 = "#141d2e"; BORDER = "#2c3a52"
TEXT = "#f1f5f9"; MUTED = "#9fb0c7"; FAINT = "#64748b"
TEAL = "#14b8a6"; AMBER = "#f59e0b"; PURPLE = "#a78bfa"; BLUE = "#3b82f6"
GREEN = "#22c55e"; RED = "#ef4444"; CYAN = "#22d3ee"
W = 1040
M = 32
GAP = 16


def _font(size, weight="r"):
    size = int(round(size))
    opts = {"r": ["segoeui.ttf", "arial.ttf"],
            "sb": ["seguisb.ttf", "segoeui.ttf", "arial.ttf"],
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


def _hex(c):
    if isinstance(c, (tuple, list)):  # already an RGB triple
        return tuple(c)
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def _mix(c, bg, a):
    cr, bgc = _hex(c), _hex(bg)
    return tuple(int(bgc[i] + (cr[i] - bgc[i]) * a) for i in range(3))


def _vgrad(img, box, ctop, cbot, radius=0):
    """Paint a vertical gradient (ctop→cbot) into box, optionally rounded — gives bars depth."""
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    w, h = x1 - x0, y1 - y0
    if w <= 0 or h <= 0:
        return
    ct, cb = _hex(ctop), _hex(cbot)
    col = Image.new("RGB", (1, h))
    px = col.load()
    for i in range(h):
        t = i / max(1, h - 1)
        px[0, i] = tuple(int(ct[j] + (cb[j] - ct[j]) * t) for j in range(3))
    col = col.resize((w, h))
    if radius > 0:
        mask = Image.new("L", (w, h), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)
        img.paste(col, (x0, y0), mask)
    else:
        img.paste(col, (x0, y0))


def render_card(data):
    """Render the dark weekly QA card and return the PIL Image (reused by the combined report)."""
    k = data.get("kpis", {})
    flow = data.get("flow", {})
    cycle = data.get("cycle", {})
    days = data.get("daily", [])
    testers = data.get("testers", [])
    modules = data.get("modules", [])
    per_member = data.get("per_member", [])     # richer per-tester profile (replaces the tester bars)
    slow = data.get("slow_tickets", [])         # slowest tickets in QC this period
    mtests = data.get("manual_tests")  # None until weekly capture is built
    mtd = data.get("mtd")  # month-to-date cumulative (weekly report only); None otherwise
    title = data.get("title", "QA Weekly Report")
    range_caption = data.get("range_caption", "Mon–Fri")
    load_title = data.get("load_title", "Daily QC load")
    period_word = data.get("period_word", "week")
    period_kind = data.get("period_kind", "week")

    # ---- vertical layout plan ----
    head_h = 98
    kpi_y = head_h + 14
    kpi_h = 96
    kpi_list_n = 9
    kpi_per_row = 5
    kpi_rows = (kpi_list_n + kpi_per_row - 1) // kpi_per_row
    kpi_total = kpi_rows * kpi_h + (kpi_rows - 1) * 12
    mtd_y = kpi_y + kpi_total + 12
    mtd_h = 48 if mtd else 0
    secA_y = mtd_y + mtd_h + (12 if mtd else 6)
    secA_h = 206
    secB_y = secA_y + secA_h + 18
    secB_h = 210
    pm_y = secB_y + secB_h + 18                     # Per-Member Profile table (was tester bars)
    pm_h = 54 + 26 + max(len(per_member), 1) * 30 + 14
    mt_y = pm_y + pm_h + 18
    mt_h = 54 + 28 + max(len(modules), 1) * 29 + 14
    st_h = (54 + 26 + len(slow) * 29 + 14) if slow else 0   # Slowest-in-QC table (optional)
    st_y = mt_y + mt_h + (18 if slow else 0)
    foot_h = 30
    H = (st_y + st_h if slow else mt_y + mt_h) + foot_h

    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    def txt(x, y, s, f, color=TEXT, anchor="la"):
        d.text((x, y), str(s), font=f, fill=color, anchor=anchor)

    def card(x, y, w, h, accent=None, fill=CARD):
        d.rounded_rectangle([x, y, x + w, y + h], radius=14, fill=fill, outline=BORDER, width=1)
        if accent:
            d.rounded_rectangle([x, y, x + w, y + 4], radius=2, fill=accent)

    def chip(cx, cy, w, h, color):
        d.rounded_rectangle([cx, cy, cx + w, cy + h], radius=4, fill=color)

    ws = date.fromisoformat(data["week_start"])
    we = date.fromisoformat(data["week_end"])

    # ============ HEADER ============
    d.rounded_rectangle([M, 26, M + 6, 70], radius=3, fill=TEAL)
    txt(M + 18, 22, title, _font(31, "b"))
    txt(M + 18, 63, "Web Manual Testing · Load, Movement & Cycle Time", _font(13.5), MUTED)
    txt(W - M, 26, f"{ws.strftime('%d %b')} – {we.strftime('%d %b %Y')}", _font(16, "sb"), TEAL, anchor="ra")
    txt(W - M, 52, f"{range_caption} · generated {date.today().strftime('%d %b %Y')}", _font(11.5), MUTED, anchor="ra")
    d.line([M, head_h, W - M, head_h], fill=BORDER, width=1)

    # ============ KPI STRIP ============
    kpis = [
        ("Received into QC", f"{k.get('received', 0):,}", TEAL,
         f"{flow.get('first_time', 0)} new · {flow.get('retest', 0)} retest"),
        ("Delivered to BIS", f"{k.get('delivered', 0):,}", PURPLE, "moved out for review"),
        ("Closed", f"{k.get('closed', 0):,}", GREEN, "completed this week"),
        ("Avg QC cycle", f"{k.get('qa_cycle', 0):g}", AMBER, "days QC→BIS"),
        ("Avg QC (first pass)", f"{k.get('qc_first_pass', 0):g}", CYAN, "0-cycle tickets"),
        ("Retests", f"{k.get('retests', 0):,}", RED, "came back for re-test"),
        ("Avg closure", f"{k.get('closure', 0):g}", BLUE, "days Live → closed"),
        ("Bugs raised", f"{k.get('bugs', 0):,}", RED, "logged this week"),
        ("QA testers", f"{k.get('testers', 0):,}", GREEN, "web manual team"),
    ]
    kw = (W - 2 * M - GAP * (kpi_per_row - 1)) / kpi_per_row
    for i, (lbl, val, ac, sub) in enumerate(kpis):
        col, row = i % kpi_per_row, i // kpi_per_row
        x = M + col * (kw + GAP)
        y = kpi_y + row * (kpi_h + 12)
        card(x, y, kw, kpi_h, ac)
        chip(x + 15, y + 16, 22, 5, ac)
        txt(x + 15, y + 26, val, _font(30, "b"))
        txt(x + 15, y + 63, lbl, _font(11.5, "sb"), MUTED)
        txt(x + 15, y + 79, sub, _font(9.5), FAINT)

    # ============ MONTH-TO-DATE STRIP (cumulative, alongside the weekly KPIs) ============
    if mtd:
        card(M, mtd_y, W - 2 * M, mtd_h, TEAL, fill=CARD2)
        txt(M + 18, mtd_y + 15, f"Month to date · {mtd.get('label', '')}", _font(13, "b"), TEAL)
        txt(M + 18, mtd_y + 33, "cumulative this month", _font(9.5), FAINT)
        mt_items = [("Received", mtd.get("received", 0), TEAL), ("Delivered", mtd.get("delivered", 0), PURPLE),
                    ("Closed", mtd.get("closed", 0), GREEN), ("Bugs raised", mtd.get("bugs", 0), RED)]
        area_l = M + 250
        step = (W - M - 16 - area_l) / len(mt_items)
        for i, (lbl, val, clr) in enumerate(mt_items):
            x = area_l + i * step
            chip(x, mtd_y + 11, 10, 10, clr)
            txt(x + 16, mtd_y + 6, f"{val:,}", _font(19, "b"), TEXT)
            txt(x + 16, mtd_y + 31, lbl, _font(10.5), MUTED, anchor="lm")

    # ============ SECTION A : MOVEMENT (left) + QA CYCLE (right) ============
    aw_l = (W - 2 * M - GAP) * 0.58
    aw_r = (W - 2 * M - GAP) - aw_l
    ax_r = M + aw_l + GAP

    # ---- A-left : Ticket movement (flow) ----
    card(M, secA_y, aw_l, secA_h)
    txt(M + 18, secA_y + 14, "Ticket movement", _font(15, "sb"))
    txt(M + 18, secA_y + 36, "How work flowed through the QA pipeline this week", _font(10.5), FAINT)
    stages = [
        ("Received", flow.get("received", 0), TEAL),
        ("To BIS", flow.get("delivered", 0), PURPLE),
        ("Approved", flow.get("approved", 0), BLUE),
        ("Closed", flow.get("closed", 0), GREEN),
    ]
    pad = 20
    inner = aw_l - 2 * pad
    arrow_w = 24
    n = len(stages)
    node_w = (inner - arrow_w * (n - 1)) / n
    node_h = 84
    ny = secA_y + 66
    nx = M + pad
    fmax = max([1] + [s[1] for s in stages])
    for i, (lbl, val, clr) in enumerate(stages):
        x0 = nx + i * (node_w + arrow_w)
        _vgrad(img, [x0, ny, x0 + node_w, ny + node_h], _mix(clr, CARD, 0.30), _mix(clr, CARD, 0.10), radius=12)
        d.rounded_rectangle([x0, ny, x0 + node_w, ny + node_h], radius=12, outline=clr, width=1)
        bar_w = (node_w - 24) * (val / fmax)
        d.rounded_rectangle([x0 + 12, ny + 13, x0 + 12 + max(4, bar_w), ny + 18], radius=2, fill=clr)
        txt(x0 + node_w / 2, ny + 42, f"{val:,}", _font(29, "b"), TEXT, anchor="mm")
        txt(x0 + node_w / 2, ny + 68, lbl, _font(11.5, "sb"), MUTED, anchor="mm")
        if i < n - 1:
            ax = x0 + node_w + arrow_w / 2
            ayc = ny + node_h / 2
            d.line([ax - 8, ayc, ax + 3, ayc], fill=FAINT, width=2)
            d.polygon([(ax + 2, ayc - 5), (ax + 9, ayc), (ax + 2, ayc + 5)], fill=FAINT)
    cap_y = ny + node_h + 20
    txt(M + pad, cap_y, "Received:", _font(11, "sb"), MUTED)
    chip(M + pad + 78, cap_y + 2, 11, 11, TEAL)
    txt(M + pad + 95, cap_y, f"First-time {flow.get('first_time', 0)}", _font(11), TEXT)
    chip(M + pad + 230, cap_y + 2, 11, 11, _mix(TEAL, CARD, 0.5))
    txt(M + pad + 247, cap_y, f"Retest {flow.get('retest', 0)}", _font(11), TEXT)

    # ---- A-right : QA cycle ring ----
    card(ax_r, secA_y, aw_r, secA_h, AMBER)
    txt(ax_r + 18, secA_y + 14, "Avg QC waiting time (QC → BIS)", _font(15, "sb"))
    txt(ax_r + 18, secA_y + 36, f"over {cycle.get('closed_tickets', 0)} tickets closed this {period_word}", _font(10.5), FAINT)
    qa_days = cycle.get("qa_days", 0) or 0
    total_days = cycle.get("total_days", 0) or 0
    cx, ccy, r, ri = ax_r + 78, secA_y + 122, 52, 36
    frac = max(0.0, min(1.0, (qa_days / total_days) if total_days else (1.0 if qa_days else 0.0)))
    d.ellipse([cx - r, ccy - r, cx + r, ccy + r], fill=_mix(AMBER, CARD, 0.12))
    d.pieslice([cx - r, ccy - r, cx + r, ccy + r], -90, -90 + 360 * frac, fill=AMBER)
    d.ellipse([cx - ri, ccy - ri, cx + ri, ccy + ri], fill=CARD)
    txt(cx, ccy - 9, f"{qa_days:g}", _font(27, "b"), AMBER, anchor="mm")
    txt(cx, ccy + 15, "days", _font(11), MUTED, anchor="mm")
    lx = cx + r + 26
    txt(lx, ccy - 30, "QC → BIS waiting", _font(11), MUTED)
    txt(lx, ccy - 12, f"{qa_days:g} days", _font(16, "b"), AMBER)
    txt(lx, ccy + 16, "Total lead time", _font(11), MUTED)
    txt(lx, ccy + 34, f"{total_days:g} days", _font(15, "sb"), TEXT)
    txt(ax_r + 18, secA_y + secA_h - 26, "QC waiting = entering QC Testing → handed to BIS Testing.",
        _font(9.5), FAINT)

    # ============ SECTION B : DAILY LOAD (+ MANUAL TEST EXECUTION when data exists) ============
    # The manual-test card is only drawn once there's data; until then Daily load spans full width.
    has_mtests = mtests is not None
    if has_mtests:
        bw_l = (W - 2 * M - GAP) * 0.54
        bw_r = (W - 2 * M - GAP) - bw_l
        bx_r = M + bw_l + GAP
    else:
        bw_l = W - 2 * M

    # ---- B-left : QC load (daily for week, per-week for month) ----
    card(M, secB_y, bw_l, secB_h)
    txt(M + 18, secB_y + 14, load_title, _font(15, "sb"))
    sset = [("received", TEAL), ("delivered", PURPLE), ("closed", GREEN)]
    for j, (key, clr) in enumerate(sset):
        lxx = M + 150 + j * 108
        chip(lxx, secB_y + 18, 11, 11, clr)
        txt(lxx + 16, secB_y + 16, key.capitalize(), _font(10.5), MUTED)
    gax, gay = M + 30, secB_y + 60
    gaw, gah = bw_l - 56, secB_h - 100
    maxv = max([1] + [max(dd.get("received", 0), dd.get("delivered", 0), dd.get("closed", 0)) for dd in days])
    for gl in range(3):
        yy = gay + gah * gl / 2
        d.line([gax, yy, gax + gaw, yy], fill=_mix(BORDER, CARD, 0.55), width=1)
    slot = gaw / max(1, len(days))
    bw = min(20, slot / 4.6)
    for di, dd in enumerate(days):
        x0 = gax + di * slot + (slot - bw * 3 - 6) / 2
        for si, (key, clr) in enumerate(sset):
            v = dd.get(key, 0)
            bh = gah * v / maxv
            bxp = x0 + si * (bw + 3)
            if bh > 0:
                _vgrad(img, [bxp, gay + gah - bh, bxp + bw, gay + gah], _mix(clr, CARD, 0.9), clr, radius=3)
                if v:
                    txt(bxp + bw / 2, gay + gah - bh - 11, f"{v}", _font(10, "b"), TEXT, anchor="mm")
        txt(gax + di * slot + slot / 2, gay + gah + 8, dd.get("day", ""), _font(11, "sb"), MUTED, anchor="ma")

    # ---- B-right : Manual test execution (only once weekly capture has data) ----
    if has_mtests:
        card(bx_r, secB_y, bw_r, secB_h)
        txt(bx_r + 18, secB_y + 14, "Manual test execution", _font(15, "sb"))
        tiles = [("Cases prepared", "prepared", CYAN), ("Executed", "executed", BLUE),
                 ("Passed", "passed", GREEN), ("Failed", "failed", RED)]
        tgap = 12
        tcw = (bw_r - 36 - tgap) / 2
        tch = 56
        for i, (lbl, key, clr) in enumerate(tiles):
            row, col = divmod(i, 2)
            tx = bx_r + 18 + col * (tcw + tgap)
            ty = secB_y + 48 + row * (tch + tgap)
            d.rounded_rectangle([tx, ty, tx + tcw, ty + tch], radius=10, fill=CARD2, outline=BORDER, width=1)
            chip(tx + 12, ty + 14, 8, 8, clr)
            txt(tx + tcw - 14, ty + 12, f"{mtests.get(key, 0):,}", _font(22, "b"), TEXT, anchor="ra")
            txt(tx + 12, ty + 32, lbl, _font(10.5), MUTED)

    # ============ QA TEAM PERFORMANCE — PER-MEMBER PROFILE (replaces the tester bars) ============
    card(M, pm_y, W - 2 * M, pm_h)
    txt(M + 18, pm_y + 14, "QA team performance", _font(15, "sb"))
    txt(M + 245, pm_y + 17, f"per-member · this {period_word} · A·B·C = Attended · to BIS · Closed",
        _font(10.5), FAINT)
    p_l, p_r = M + 22, W - M - 26
    p_name_w = (p_r - p_l) * 0.22
    p_col0 = p_l + p_name_w
    p_area = p_r - p_col0
    p_headers = ["A·B·C", "Cases", "Bugs", "Retest", "Cx H/M/L", "Avg cyc", "Velocity"]
    p_centers = [p_col0 + p_area * (j + 0.5) / len(p_headers) for j in range(len(p_headers))]
    phy = pm_y + 50
    txt(p_l, phy, "Member", _font(12, "sb"), MUTED, anchor="la")
    for h, cxx in zip(p_headers, p_centers):
        txt(cxx, phy, h, _font(11.5, "sb"), MUTED, anchor="ma")
    d.line([M + 16, phy + 26, W - M - 16, phy + 26], fill=BORDER, width=1)
    if per_member:
        for i, mrow in enumerate(per_member):
            ry = phy + 40 + i * 30
            disp = f"{mrow.get('medal', '')} {mrow.get('name', '')}".strip()
            if len(disp) > 24:
                disp = disp[:23] + "…"
            txt(p_l, ry, disp, _font(12.5, "sb"), anchor="la")
            avgc = mrow.get("avg_qc_days")
            cyc_clr = FAINT if avgc is None else (GREEN if avgc <= 4 else AMBER if avgc <= 7 else RED)
            cmix = mrow.get("complexity") or {}
            cases = mrow.get("cases")
            vals = [
                (f"{mrow.get('attended', 0)}·{mrow.get('handed_to_bis', 0)}·{mrow.get('closed', 0)}", TEXT),
                (f"{cases:,}" if cases is not None else "—", TEXT if cases else FAINT),
                (f"{mrow.get('bugs', 0)}", RED if mrow.get('bugs') else FAINT),
                (f"{mrow.get('retests', 0)}", AMBER if mrow.get('retests') else FAINT),
                (f"{cmix.get('high', 0)}/{cmix.get('medium', 0)}/{cmix.get('low', 0)}", TEXT),
                (f"{avgc:g}d" if avgc is not None else "—", cyc_clr),
                (f"{mrow.get('velocity', 0):g}", TEAL),
            ]
            for (val, clr), cxx in zip(vals, p_centers):
                txt(cxx, ry, val, _font(13), clr, anchor="ma")
    else:
        txt(W / 2, phy + 50, f"No QA activity this {period_word}", _font(12), FAINT, anchor="mm")

    # ============ MODULE TABLE ============
    # Count columns evenly spaced; header + value share the SAME centre x so digits sit directly
    # under their column heading. Larger fonts for readability.
    card(M, mt_y, W - 2 * M, mt_h)
    txt(M + 18, mt_y + 14, f"By module — this {period_word}", _font(15, "sb"))
    tbl_l = M + 22
    tbl_r = W - M - 26
    name_w = (tbl_r - tbl_l) * 0.42
    col0 = tbl_l + name_w
    col_area = tbl_r - col0
    headers = ["Received", "Delivered", "Closed", "Bugs"]
    centers = [col0 + col_area * (j + 0.5) / len(headers) for j in range(len(headers))]
    hy = mt_y + 50
    txt(tbl_l, hy, "Module", _font(12.5, "sb"), MUTED, anchor="la")
    for h, cxx in zip(headers, centers):
        txt(cxx, hy, h, _font(12.5, "sb"), MUTED, anchor="ma")
    d.line([M + 16, hy + 26, W - M - 16, hy + 26], fill=BORDER, width=1)
    if modules:
        for i, row in enumerate(modules):
            ry = hy + 40 + i * 29
            mod = row.get("module", "")
            if len(mod) > 38:
                mod = mod[:37] + "…"
            txt(tbl_l, ry, mod, _font(13.5, "sb"), anchor="la")
            for h, cxx in zip(headers, centers):
                key = h.lower()
                val = row.get(key, 0)
                clr = RED if key == "bugs" and val else (TEXT if val else FAINT)
                txt(cxx, ry, f"{val:,}", _font(13.5), clr, anchor="ma")
    else:
        txt(W / 2, hy + 50, f"No module activity this {period_word}", _font(12), FAINT, anchor="mm")

    # ============ SLOWEST TICKETS IN QC (top by QC → BIS) ============
    if slow:
        card(M, st_y, W - 2 * M, st_h)
        txt(M + 18, st_y + 14, "Slowest tickets in QC", _font(15, "sb"))
        txt(M + 230, st_y + 17, f"top {len(slow)} by QC Testing → BIS Testing time", _font(10.5), FAINT)
        s_l, s_r = M + 22, W - M - 26
        s_name_w = (s_r - s_l) * 0.46
        s_col0 = s_l + s_name_w
        s_area = s_r - s_col0
        s_headers = ["Module", "QA", "Cx", "QC→BIS", "Cycles", "Bugs"]
        s_centers = [s_col0 + s_area * (j + 0.5) / len(s_headers) for j in range(len(s_headers))]
        shy = st_y + 50
        txt(s_l, shy, "Ticket", _font(12, "sb"), MUTED, anchor="la")
        for h, cxx in zip(s_headers, s_centers):
            txt(cxx, shy, h, _font(11.5, "sb"), MUTED, anchor="ma")
        d.line([M + 16, shy + 26, W - M - 16, shy + 26], fill=BORDER, width=1)
        CXCLR = {"high": RED, "medium": AMBER, "low": GREEN}
        for i, srow in enumerate(slow):
            ry = shy + 38 + i * 29
            ttl = f"#{srow.get('ticket_id')}  {srow.get('title', '')}"
            if len(ttl) > 56:
                ttl = ttl[:55] + "…"
            txt(s_l, ry, ttl, _font(12.5), TEXT, anchor="la")
            cxlvl = (srow.get("complexity") or "").lower()
            qcb = srow.get("qc_to_bis_days", 0)
            qcb_clr = GREEN if qcb <= 4 else AMBER if qcb <= 7 else RED
            mod = srow.get("module", "—") or "—"
            qa = srow.get("qc_tester", "—") or "—"
            vals = [
                (mod[:14] + ("…" if len(mod) > 14 else ""), MUTED),
                (qa[:14] + ("…" if len(qa) > 14 else ""), MUTED),
                ((cxlvl[:1].upper() or "—"), CXCLR.get(cxlvl, FAINT)),
                (f"{qcb:g}d", qcb_clr),
                (f"{srow.get('cycles', 0)}", RED if srow.get('cycles', 0) > 1 else FAINT),
                (f"{srow.get('bugs', 0)}", RED if srow.get('bugs') else FAINT),
            ]
            for (val, clr), cxx in zip(vals, s_centers):
                txt(cxx, ry, val, _font(12.5), clr, anchor="ma")

    # ============ FOOTER ============
    txt(M, H - 22, "BIS Training Solutions · QA Team · Web Manual Testing", _font(10.5), FAINT)
    txt(W - M, H - 22, "Mobile & Automation excluded · QC waiting = QC Testing → BIS Testing",
        _font(10), FAINT, anchor="ra")
    return img


def generate_pdf(data, output_path=None) -> Path:
    """Render the QA weekly card and save it as a single-page PDF (unchanged public API)."""
    img = render_card(data)
    period_kind = data.get("period_kind", "week")
    ws = date.fromisoformat(data["week_start"])
    fname = (f"QA_Monthly_Report_{ws.strftime('%Y_%m')}.pdf" if period_kind == "month"
             else f"QA_Weekly_Report_{ws.isoformat()}.pdf")
    out = output_path or (_desktop() / fname)
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "PDF", resolution=110)
    return out
