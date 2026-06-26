"""Dev Weekly/Monthly Report — dark-themed PDF for the client (DEVELOPMENT team).

Mirrors the QA report's look. Covers the period (Mon–Fri or a month): how much the dev team
HANDED TO QC, DELIVERED TO LIVE and FIXED (bugs), plus average lead time and dev effort, a
load chart, per-developer workload and a module breakdown. Pillow → single-page PDF. The caller
(main.py) computes the data dict.
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
    if isinstance(c, (tuple, list)):
        return tuple(c)
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def _mix(c, bg, a):
    cr, bgc = _hex(c), _hex(bg)
    return tuple(int(bgc[i] + (cr[i] - bgc[i]) * a) for i in range(3))


def _vgrad(img, box, ctop, cbot, radius=0):
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    w, h = x1 - x0, y1 - y0
    if w <= 0 or h <= 0:
        return
    ct, cb = _hex(ctop), _hex(cbot)
    col = Image.new("RGB", (1, h)); px = col.load()
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


def generate_pdf(data, output_path=None) -> Path:
    k = data.get("kpis", {})
    flow = data.get("flow", {})
    cycle = data.get("cycle", {})
    days = data.get("daily", [])
    devs = data.get("developers", [])
    modules = data.get("modules", [])
    title = data.get("title", "Dev Weekly Report")
    range_caption = data.get("range_caption", "Mon–Fri")
    load_title = data.get("load_title", "Daily dev load")
    period_word = data.get("period_word", "week")
    period_kind = data.get("period_kind", "week")

    head_h = 98
    kpi_y = head_h + 14
    kpi_h = 96
    secA_y = kpi_y + kpi_h + 18
    secA_h = 206
    secB_y = secA_y + secA_h + 18
    secB_h = 200
    wl_y = secB_y + secB_h + 18
    wl_rows = max(len(devs), 1)
    wl_h = 60 + wl_rows * 30 + 14
    mt_y = wl_y + wl_h + 18
    mt_h = 54 + 28 + max(len(modules), 1) * 29 + 14
    foot_h = 30
    H = mt_y + mt_h + foot_h

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
    d.rounded_rectangle([M, 26, M + 6, 70], radius=3, fill=BLUE)
    txt(M + 18, 22, title, _font(31, "b"))
    txt(M + 18, 63, "Development Team · Throughput, Delivery & Lead Time", _font(13.5), MUTED)
    txt(W - M, 26, f"{ws.strftime('%d %b')} – {we.strftime('%d %b %Y')}", _font(16, "sb"), BLUE, anchor="ra")
    txt(W - M, 52, f"{range_caption} · generated {date.today().strftime('%d %b %Y')}", _font(11.5), MUTED, anchor="ra")
    d.line([M, head_h, W - M, head_h], fill=BORDER, width=1)

    # ============ KPI STRIP ============
    kpis = [
        ("Handed to QC", f"{k.get('to_qc', 0):,}", TEAL, "builds delivered to QC"),
        ("Delivered to live", f"{k.get('closed', 0):,}", GREEN, "closed this " + period_word),
        ("Bugs fixed", f"{k.get('bugs_fixed', 0):,}", AMBER, "bugs closed this " + period_word),
        ("Avg lead time", f"{k.get('lead_time', 0):g}", BLUE, "created → closed (days)"),
        ("Avg dev effort", f"{k.get('dev_hours', 0):g}", PURPLE, "dev hours / ticket"),
        ("Developers", f"{k.get('devs', 0):,}", CYAN, "contributing this " + period_word),
    ]
    kw = (W - 2 * M - GAP * (len(kpis) - 1)) / len(kpis)
    for i, (lbl, val, ac, sub) in enumerate(kpis):
        x = M + i * (kw + GAP)
        card(x, kpi_y, kw, kpi_h, ac)
        chip(x + 15, kpi_y + 16, 22, 5, ac)
        txt(x + 15, kpi_y + 26, val, _font(30, "b"))
        txt(x + 15, kpi_y + 63, lbl, _font(11.5, "sb"), MUTED)
        txt(x + 15, kpi_y + 79, sub, _font(9.5), FAINT)

    # ============ SECTION A : DELIVERY FLOW (left) + LEAD TIME / EFFORT (right) ============
    aw_l = (W - 2 * M - GAP) * 0.58
    aw_r = (W - 2 * M - GAP) - aw_l
    ax_r = M + aw_l + GAP

    card(M, secA_y, aw_l, secA_h)
    txt(M + 18, secA_y + 14, "Delivery flow", _font(15, "sb"))
    txt(M + 18, secA_y + 36, "How dev work progressed through the pipeline this " + period_word, _font(10.5), FAINT)
    stages = [
        ("Handed to QC", flow.get("to_qc", 0), TEAL),
        ("To BIS", flow.get("to_bis", 0), PURPLE),
        ("Approved", flow.get("approved", 0), BLUE),
        ("Delivered", flow.get("closed", 0), GREEN),
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
        txt(x0 + node_w / 2, ny + 68, lbl, _font(11, "sb"), MUTED, anchor="mm")
        if i < n - 1:
            ax = x0 + node_w + arrow_w / 2
            ayc = ny + node_h / 2
            d.line([ax - 8, ayc, ax + 3, ayc], fill=FAINT, width=2)
            d.polygon([(ax + 2, ayc - 5), (ax + 9, ayc), (ax + 2, ayc + 5)], fill=FAINT)
    cap_y = ny + node_h + 20
    txt(M + pad, cap_y, "Handed to QC:", _font(11, "sb"), MUTED)
    chip(M + pad + 110, cap_y + 2, 11, 11, TEAL)
    txt(M + pad + 127, cap_y, f"Fresh {flow.get('first_time', 0)}", _font(11), TEXT)
    chip(M + pad + 240, cap_y + 2, 11, 11, _mix(TEAL, CARD, 0.5))
    txt(M + pad + 257, cap_y, f"Re-delivered {flow.get('retest', 0)}", _font(11), TEXT)

    # ---- A-right : Lead time + dev effort ----
    card(ax_r, secA_y, aw_r, secA_h, BLUE)
    txt(ax_r + 18, secA_y + 14, "Average lead time", _font(15, "sb"))
    txt(ax_r + 18, secA_y + 36, f"over {cycle.get('closed_tickets', 0)} tickets closed this {period_word}", _font(10.5), FAINT)
    lead = cycle.get("lead_days", 0) or 0
    txt(ax_r + 18, secA_y + 64, f"{lead:g}", _font(50, "b"), BLUE)
    lf = _font(50, "b")
    lw = d.textlength(f"{lead:g}", font=lf)
    txt(ax_r + 26 + lw, secA_y + 98, "days", _font(15, "sb"), MUTED)
    txt(ax_r + 26 + lw, secA_y + 78, "created → closed", _font(10.5), FAINT)
    # dev effort stat
    eff_y = secA_y + 140
    d.line([ax_r + 18, eff_y, ax_r + aw_r - 18, eff_y], fill=_mix(BORDER, CARD, 0.6), width=1)
    txt(ax_r + 18, eff_y + 12, "Avg dev effort", _font(11.5), MUTED)
    txt(ax_r + aw_r - 18, eff_y + 8, f"{cycle.get('dev_hours', 0):g} h/ticket", _font(15, "b"), PURPLE, anchor="ra")
    txt(ax_r + 18, secA_y + secA_h - 22, "Lead time = full calendar span from ticket creation to close.",
        _font(9.5), FAINT)

    # ============ SECTION B : DEV LOAD (full width) ============
    sset = [("to_qc", TEAL, "Handed to QC"), ("closed", GREEN, "Delivered")]
    card(M, secB_y, W - 2 * M, secB_h)
    txt(M + 18, secB_y + 14, load_title, _font(15, "sb"))
    for j, (key, clr, lab) in enumerate(sset):
        lxx = M + 170 + j * 140
        chip(lxx, secB_y + 18, 11, 11, clr)
        txt(lxx + 16, secB_y + 16, lab, _font(10.5), MUTED)
    gax, gay = M + 32, secB_y + 60
    gaw, gah = W - 2 * M - 64, secB_h - 100
    maxv = max([1] + [max(dd.get("to_qc", 0), dd.get("closed", 0)) for dd in days])
    for gl in range(3):
        yy = gay + gah * gl / 2
        d.line([gax, yy, gax + gaw, yy], fill=_mix(BORDER, CARD, 0.55), width=1)
    slot = gaw / max(1, len(days))
    bw = min(26, slot / 3.4)
    for di, dd in enumerate(days):
        x0 = gax + di * slot + (slot - bw * 2 - 6) / 2
        for si, (key, clr, lab) in enumerate(sset):
            v = dd.get(key, 0)
            bh = gah * v / maxv
            bxp = x0 + si * (bw + 6)
            if bh > 0:
                _vgrad(img, [bxp, gay + gah - bh, bxp + bw, gay + gah], _mix(clr, CARD, 0.9), clr, radius=3)
                if v:
                    txt(bxp + bw / 2, gay + gah - bh - 12, f"{v}", _font(9.5, "sb"), MUTED, anchor="mm")
        txt(gax + di * slot + slot / 2, gay + gah + 8, dd.get("day", ""), _font(11, "sb"), MUTED, anchor="ma")

    # ============ WORKLOAD BY DEVELOPER (all) ============
    card(M, wl_y, W - 2 * M, wl_h)
    txt(M + 18, wl_y + 14, "Workload by developer", _font(15, "sb"))
    txt(M + 240, wl_y + 17, "(all contributing developers)", _font(10.5), FAINT)
    wlss = [("to_qc", TEAL, "Handed to QC"), ("closed", GREEN, "Delivered"), ("bugs", AMBER, "Bugs fixed")]
    for j, (key, clr, lab) in enumerate(wlss):
        lxx = W - M - 380 + j * 126
        chip(lxx, wl_y + 18, 11, 11, clr)
        txt(lxx + 16, wl_y + 16, lab, _font(10.5), MUTED)
    lx = M + 20
    name_w = 160
    track_x = lx + name_w
    track_w = (W - 2 * M) - name_w - 40 - 56
    tmax = max([1] + [t.get("to_qc", 0) + t.get("closed", 0) + t.get("bugs", 0) for t in devs])
    ry0 = wl_y + 50
    for idx, t in enumerate(devs):
        cy = ry0 + idx * 30 + 13
        nm = t.get("name", "")
        if len(nm) > 24:
            nm = nm[:23] + "…"
        txt(lx, cy, nm, _font(11.5, "sb"), TEXT, anchor="lm")
        total = t.get("to_qc", 0) + t.get("closed", 0) + t.get("bugs", 0)
        d.rounded_rectangle([track_x, cy - 9, track_x + track_w, cy + 9], radius=5, fill=CARD2)
        seg_x = track_x
        bar_total_w = track_w * (total / tmax)
        for key, clr, lab in wlss:
            v = t.get(key, 0)
            if total <= 0:
                continue
            segw = bar_total_w * (v / total)
            if segw > 0:
                d.rectangle([seg_x, cy - 9, seg_x + segw, cy + 9], fill=clr)
                seg_x += segw
        if bar_total_w > 0:
            d.rounded_rectangle([track_x, cy - 9, track_x + max(6, bar_total_w), cy + 9],
                                radius=5, outline=_mix(BORDER, CARD, 0.4), width=1)
        txt(W - M - 18, cy, f"{total}", _font(12.5, "b"), TEXT, anchor="rm")
    if not devs:
        txt(W / 2, wl_y + wl_h / 2, "No developer activity this " + period_word, _font(12), FAINT, anchor="mm")

    # ============ MODULE TABLE ============
    card(M, mt_y, W - 2 * M, mt_h)
    txt(M + 18, mt_y + 14, f"By module — this {period_word}", _font(15, "sb"))
    tbl_l = M + 22
    tbl_r = W - M - 26
    name_col_w = (tbl_r - tbl_l) * 0.46
    col0 = tbl_l + name_col_w
    col_area = tbl_r - col0
    headers = [("Handed to QC", "to_qc"), ("Delivered", "closed"), ("Bugs fixed", "bugs")]
    centers = [col0 + col_area * (j + 0.5) / len(headers) for j in range(len(headers))]
    hy = mt_y + 50
    txt(tbl_l, hy, "Module", _font(12.5, "sb"), MUTED, anchor="la")
    for (h, _key), cxx in zip(headers, centers):
        txt(cxx, hy, h, _font(12.5, "sb"), MUTED, anchor="ma")
    d.line([M + 16, hy + 26, W - M - 16, hy + 26], fill=BORDER, width=1)
    if modules:
        for i, row in enumerate(modules):
            ry = hy + 40 + i * 29
            mod = row.get("module", "")
            if len(mod) > 40:
                mod = mod[:39] + "…"
            txt(tbl_l, ry, mod, _font(13.5, "sb"), anchor="la")
            for (h, key), cxx in zip(headers, centers):
                val = row.get(key, 0)
                clr = AMBER if key == "bugs" and val else (TEXT if val else FAINT)
                txt(cxx, ry, f"{val:,}", _font(13.5), clr, anchor="ma")
    else:
        txt(W / 2, hy + 50, f"No module activity this {period_word}", _font(12), FAINT, anchor="mm")

    # ============ FOOTER ============
    txt(M, H - 22, "BIS Training Solutions · Development Team", _font(10.5), FAINT)
    txt(W - M, H - 22, "Handed to QC = builds delivered for testing · Delivered = closed to live",
        _font(10), FAINT, anchor="ra")

    fname = (f"Dev_Monthly_Report_{ws.strftime('%Y_%m')}.pdf" if period_kind == "month"
             else f"Dev_Weekly_Report_{ws.isoformat()}.pdf")
    out = output_path or (_desktop() / fname)
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "PDF", resolution=110)
    return out
