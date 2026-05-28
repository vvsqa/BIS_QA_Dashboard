#!/usr/bin/env python3
"""
Push the live "QC Pipeline By Module" view to the shared Google Sheet.

Two tabs are written (clean overwrites each run) with a dark theme that
mirrors the Dashboard tab:
  - QC_With_QA  : tickets currently with QA team (QA_TEAM_STATUSES)
  - QC_With_Dev : tickets currently with Dev team (DEV_TEAM_STATUSES, expected to come to QA)

Each tab has:
  * a title + metadata block,
  * a SUMMARY BY MODULE table (module x status counts) with a TOTAL row,
  * a TICKET DETAILS table (one row per ticket) with a basic filter applied.

Click-to-filter behaviour (clicking a count cell in the summary applies a
filter to the details table) is provided by the onSelectionChange handler in
backend/google_sheets_apps_script.js.

Status lists come from backend/main.py so the same configuration the rest of
the system uses is respected.

Run:
    python push_qc_pipeline_to_sheets.py
"""
from __future__ import annotations

import os
import sys
from collections import Counter, defaultdict
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import requests
from dotenv import load_dotenv

load_dotenv()

# Reuse the existing exporter helpers (auth, ensure-tab, clear, write)
from google_sheets_export import GoogleSheetsExporter, get_sheets_exporter  # noqa: E402

PM_API_URL = os.environ.get(
    "PM_API_URL",
    "https://www.bissafety.app/rest/v.01/pm/ticket-export",
)
PM_API_KEY = os.environ.get("PM_API_KEY", "")

# ---------- Config (mirrors backend/main.py) ----------
QA_TEAM_STATUSES_RAW = [
    "QC Testing",
    "QC Testing in Progress",
    "QC Testing Hold",
]
# NOTE: A few statuses from main.py's DEV_TEAM_STATUSES are intentionally
# omitted here because they don't represent "tickets coming up for QA":
#   - QC Review Fail / Tested - Awaiting Fixes : already tested, returned
#     to dev for fixes (rework, not net-new for QA)
#   - Re-opened                                : closed ticket reopened
#   - Approved for Live                        : goes straight to Live, not QA
DEV_TEAM_STATUSES_RAW = [
    "In Progress",
    "Technical Review",
    "Start Code Review",
    "Code Review Passed",
    "Code Review Failed",
    "Ready For Development",
    "Express Lane Review",
]
QA_SET = {s.upper() for s in QA_TEAM_STATUSES_RAW}
DEV_SET = {s.upper() for s in DEV_TEAM_STATUSES_RAW}

# Column order for the per-module breakdown
# (closest to QA on the left, earliest in the dev pipeline on the right)
DEV_STATUS_ORDER = [
    "Code Review Passed",
    "Start Code Review",
    "Code Review Failed",
    "Express Lane Review",
    "Technical Review",
    "In Progress",
    "Ready For Development",
]
QA_STATUS_ORDER = [
    "QC Testing",
    "QC Testing in Progress",
    "QC Testing Hold",
]

QA_TAB_NAME = "QC_With_QA"
QA_TAB_TITLE = "Tickets currently with QA  (QA_TEAM_STATUSES)"
DEV_TAB_NAME = "QC_With_Dev"
DEV_TAB_TITLE = "Tickets currently with Dev — expected to come to QA  (DEV_TEAM_STATUSES)"

# ---------- Theme (mirrors APP_CONFIG.COLORS in google_sheets_apps_script.js) ----------
COLORS = {
    "BG":     "#111827",
    "CARD":   "#1f2937",
    "BORDER": "#374151",
    "TEXT":   "#f9fafb",
    "MUTED":  "#9ca3af",
    "CYAN":   "#06b6d4",
    "GREEN":  "#22c55e",
    "ORANGE": "#f59e0b",
    "PINK":   "#ec4899",
    "BLUE":   "#3b82f6",
    "VIOLET": "#8b5cf6",
}


def _hex_rgb(hex_str: str) -> Dict[str, float]:
    """Convert "#rrggbb" to the {red,green,blue} 0..1 floats Sheets expects."""
    h = hex_str.lstrip("#")
    return {
        "red":   int(h[0:2], 16) / 255.0,
        "green": int(h[2:4], 16) / 255.0,
        "blue":  int(h[4:6], 16) / 255.0,
    }


# ---------- PM API ----------
def fetch_pm() -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    if not PM_API_KEY:
        raise RuntimeError("PM_API_KEY not set in environment / .env")
    r = requests.get(
        PM_API_URL,
        headers={"authID": PM_API_KEY, "Accept": "application/json"},
        timeout=60,
    )
    r.raise_for_status()
    payload = r.json()
    return payload.get("data", []), payload.get("metadata", {})


def norm_status(s: str) -> str:
    return (s or "").strip().upper()


def module_of(t: Dict[str, Any]) -> str:
    return (t.get("Subdepartment") or "(Unknown)").strip() or "(Unknown)"


def split_buckets(tickets: List[Dict[str, Any]]):
    in_qa, in_dev = [], []
    for t in tickets:
        st = norm_status(t.get("Status"))
        if not st:
            continue
        if st in QA_SET:
            in_qa.append(t)
        elif st in DEV_SET:
            in_dev.append(t)
    return in_qa, in_dev


# ---------- Layout builder ----------
DETAIL_HEADERS = [
    "Module",
    "Ticket #",
    "Status",
    "Priority",
    "Title",
    "Current Assignee",
    "QA / QC Tester",
    "Backend Developer",
    "Frontend Developer",
    "ETA",
    "Created On",
    "Dev Estimate (hrs)",
    "Actual Dev (hrs)",
    "QA Estimate (hrs)",
    "Actual QA (hrs)",
]


def build_layout(
    title: str,
    rows: List[Dict[str, Any]],
    status_order: List[str],
    generated_at: str,
    total_records: int,
) -> Dict[str, Any]:
    """Build the 2D values array AND record exact row/col positions of every block.

    Returned dict:
        {
            "values": List[List[Any]],
            "summary_col_count": int,         # cols used by summary table (1 + 1 + len(status_order))
            "details_col_count": int,         # cols used by details table
            "title_row": int,                 # 1-based
            "metadata_rows": (start, end),    # 1-based inclusive
            "summary_section_row": int,       # row of "SUMMARY BY MODULE"
            "summary_header_row": int,        # row of "Module | Total | <statuses>"
            "summary_data_rows": (start, end),# data rows (excludes TOTAL)
            "summary_total_row": int,
            "details_section_row": int,       # row of "TICKET DETAILS"
            "details_header_row": int,
            "details_data_rows": (start, end),# data rows (or (n,n-1) when empty)
            "frozen_rows": int,
        }
    """
    by_mod: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for t in rows:
        by_mod[module_of(t)].append(t)

    values: List[List[Any]] = []

    # ---- Title + metadata block (rows 1..6)
    values.append([title])                                                       # row 1
    values.append([f"PM API generated at: {generated_at}"])                      # row 2
    values.append([f"Total PM records scanned: {total_records}"])                # row 3
    values.append([f"Tickets in this bucket: {len(rows)}"])                      # row 4
    values.append([f"Pulled at (local): {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"])  # row 5
    values.append([])                                                            # row 6 blank

    title_row = 1
    metadata_rows = (2, 5)

    # ---- Summary section
    summary_section_row = len(values) + 1
    values.append(["SUMMARY BY MODULE"])                                         # row 7

    summary_header_row = len(values) + 1
    summary_header = ["Module", "Total"] + status_order
    values.append(summary_header)                                                # row 8
    summary_col_count = len(summary_header)

    sorted_mods = sorted(by_mod, key=lambda k: (-len(by_mod[k]), k.lower()))

    summary_data_start = len(values) + 1
    grand_total = 0
    grand_per_status: Counter = Counter()
    for mod in sorted_mods:
        items = by_mod[mod]
        sb = Counter(t.get("Status", "").strip() for t in items)
        sb_lower = {k.lower(): v for k, v in sb.items()}
        row = [mod, len(items)]
        for st in status_order:
            row.append(sb_lower.get(st.lower(), 0))
        values.append(row)
        grand_total += len(items)
        for k, v in sb.items():
            grand_per_status[k.lower()] += v
    summary_data_end = len(values)

    summary_total_row = len(values) + 1
    total_row = ["TOTAL", grand_total] + [
        grand_per_status.get(s.lower(), 0) for s in status_order
    ]
    values.append(total_row)

    values.append([])  # blank separator

    # ---- Details section
    details_section_row = len(values) + 1
    values.append(["TICKET DETAILS"])

    details_header_row = len(values) + 1
    values.append(DETAIL_HEADERS)

    details_data_start = len(values) + 1
    for mod in sorted_mods:
        for t in sorted(
            by_mod[mod],
            key=lambda x: (
                str(x.get("Status", "")).lower(),
                -(int(x.get("TicketNumber") or 0)),
            ),
        ):
            values.append(
                [
                    mod,
                    t.get("TicketNumber", ""),
                    t.get("Status", ""),
                    t.get("Priority", ""),
                    t.get("TicketTitle", ""),
                    t.get("CurrentAssignee", ""),
                    t.get("QCTester", ""),
                    t.get("BackendDeveloper", ""),
                    t.get("FrontendDeveloper", ""),
                    t.get("ETA", ""),
                    t.get("TicketCreatedDate", ""),
                    t.get("DevEstimatedHours", ""),
                    t.get("ActualDevHours", ""),
                    t.get("OtherEstimatedHours", ""),
                    t.get("ActualQAQCHours", ""),
                ]
            )
    details_data_end = len(values)

    return {
        "values": values,
        "summary_col_count": summary_col_count,
        "details_col_count": len(DETAIL_HEADERS),
        "title_row": title_row,
        "metadata_rows": metadata_rows,
        "summary_section_row": summary_section_row,
        "summary_header_row": summary_header_row,
        "summary_data_rows": (summary_data_start, summary_data_end),
        "summary_total_row": summary_total_row,
        "details_section_row": details_section_row,
        "details_header_row": details_header_row,
        "details_data_rows": (details_data_start, details_data_end),
        # Freeze the title + metadata block so the summary header is visible
        "frozen_rows": 6,
    }


# ---------- Sheets API helpers ----------
def _get_sheet_id(exporter: GoogleSheetsExporter, sheet_name: str) -> Optional[int]:
    spreadsheet = exporter.service.spreadsheets().get(
        spreadsheetId=exporter.spreadsheet_id
    ).execute()
    for s in spreadsheet.get("sheets", []):
        if s["properties"]["title"] == sheet_name:
            return s["properties"]["sheetId"]
    return None


def _format_requests(sheet_id: int, layout: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Build batchUpdate requests to apply the dark theme + filter."""
    summary_cols = layout["summary_col_count"]
    details_cols = layout["details_col_count"]
    summary_data_start, summary_data_end = layout["summary_data_rows"]
    details_data_start, details_data_end = layout["details_data_rows"]

    # The widest column extent we touch — ensures BG fills don't leak past it
    max_cols = max(summary_cols, details_cols)

    bg_full   = _hex_rgb(COLORS["BG"])
    bg_card   = _hex_rgb(COLORS["CARD"])
    border_c  = _hex_rgb(COLORS["BORDER"])
    text_c    = _hex_rgb(COLORS["TEXT"])
    muted_c   = _hex_rgb(COLORS["MUTED"])
    accent_c  = _hex_rgb(COLORS["CYAN"])
    accent2_c = _hex_rgb(COLORS["BLUE"])
    accent3_c = _hex_rgb(COLORS["VIOLET"])

    def rng(start_row, end_row_exclusive, start_col=0, end_col_exclusive=None) -> Dict[str, int]:
        return {
            "sheetId": sheet_id,
            "startRowIndex": start_row - 1,
            "endRowIndex": end_row_exclusive - 1 if end_row_exclusive >= start_row else start_row,
            "startColumnIndex": start_col,
            "endColumnIndex": end_col_exclusive if end_col_exclusive is not None else max_cols,
        }

    def repeat_cell(range_, fmt) -> Dict[str, Any]:
        return {
            "repeatCell": {
                "range": range_,
                "cell": {"userEnteredFormat": fmt},
                "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding,wrapStrategy)",
            }
        }

    def border(range_, color) -> Dict[str, Any]:
        side = {"style": "SOLID", "color": color}
        return {
            "updateBorders": {
                "range": range_,
                "top": side, "bottom": side, "left": side, "right": side,
                "innerHorizontal": side, "innerVertical": side,
            }
        }

    requests: List[Dict[str, Any]] = []

    # 0) Wipe existing basic filter (we re-create on details)
    requests.append({"clearBasicFilter": {"sheetId": sheet_id}})

    # 1) Background fill the entire used area (defensive, removes leftover styles)
    last_row = max(layout["summary_total_row"] + 1, details_data_end + 1)
    requests.append(repeat_cell(
        rng(1, last_row + 1, 0, max_cols),
        {
            "backgroundColor": bg_full,
            "textFormat": {"foregroundColor": text_c, "fontFamily": "Arial", "fontSize": 10},
            "verticalAlignment": "MIDDLE",
            "wrapStrategy": "CLIP",
        },
    ))

    # 2) Title row
    requests.append(repeat_cell(
        rng(layout["title_row"], layout["title_row"] + 1, 0, max_cols),
        {
            "backgroundColor": bg_full,
            "textFormat": {"foregroundColor": accent_c, "bold": True, "fontSize": 16},
            "horizontalAlignment": "LEFT",
            "verticalAlignment": "MIDDLE",
            "padding": {"left": 12, "right": 8, "top": 6, "bottom": 6},
        },
    ))
    # Merge title across the used columns for a cleaner banner
    requests.append({
        "mergeCells": {
            "range": rng(layout["title_row"], layout["title_row"] + 1, 0, max_cols),
            "mergeType": "MERGE_ALL",
        }
    })
    # Set title row taller
    requests.append({
        "updateDimensionProperties": {
            "range": {
                "sheetId": sheet_id,
                "dimension": "ROWS",
                "startIndex": layout["title_row"] - 1,
                "endIndex": layout["title_row"],
            },
            "properties": {"pixelSize": 38},
            "fields": "pixelSize",
        }
    })

    # 3) Metadata rows (muted)
    md_start, md_end = layout["metadata_rows"]
    requests.append(repeat_cell(
        rng(md_start, md_end + 1, 0, max_cols),
        {
            "backgroundColor": bg_full,
            "textFormat": {"foregroundColor": muted_c, "fontSize": 10},
            "horizontalAlignment": "LEFT",
            "verticalAlignment": "MIDDLE",
            "padding": {"left": 12},
        },
    ))

    # 4) Section banner: SUMMARY BY MODULE
    requests.append(repeat_cell(
        rng(layout["summary_section_row"], layout["summary_section_row"] + 1, 0, max_cols),
        {
            "backgroundColor": bg_full,
            "textFormat": {"foregroundColor": accent2_c, "bold": True, "fontSize": 12},
            "horizontalAlignment": "LEFT",
            "verticalAlignment": "MIDDLE",
            "padding": {"left": 12, "top": 4, "bottom": 4},
        },
    ))

    # 5) Summary header row
    requests.append(repeat_cell(
        rng(layout["summary_header_row"], layout["summary_header_row"] + 1, 0, summary_cols),
        {
            "backgroundColor": bg_full,
            "textFormat": {"foregroundColor": text_c, "bold": True, "fontSize": 11},
            "horizontalAlignment": "CENTER",
            "verticalAlignment": "MIDDLE",
            "padding": {"top": 6, "bottom": 6},
        },
    ))
    # Module col left-aligned in header
    requests.append(repeat_cell(
        rng(layout["summary_header_row"], layout["summary_header_row"] + 1, 0, 1),
        {
            "backgroundColor": bg_full,
            "textFormat": {"foregroundColor": text_c, "bold": True, "fontSize": 11},
            "horizontalAlignment": "LEFT",
            "verticalAlignment": "MIDDLE",
            "padding": {"left": 12},
        },
    ))

    # 6) Summary data rows
    if summary_data_end >= summary_data_start:
        # Whole summary block CARD bg, centered counts
        requests.append(repeat_cell(
            rng(summary_data_start, summary_data_end + 1, 0, summary_cols),
            {
                "backgroundColor": bg_card,
                "textFormat": {"foregroundColor": text_c, "fontSize": 10},
                "horizontalAlignment": "CENTER",
                "verticalAlignment": "MIDDLE",
            },
        ))
        # Module name column left-aligned
        requests.append(repeat_cell(
            rng(summary_data_start, summary_data_end + 1, 0, 1),
            {
                "backgroundColor": bg_card,
                "textFormat": {"foregroundColor": text_c, "fontSize": 10},
                "horizontalAlignment": "LEFT",
                "verticalAlignment": "MIDDLE",
                "padding": {"left": 12},
            },
        ))
        # Total column accent (cyan, bold)
        requests.append(repeat_cell(
            rng(summary_data_start, summary_data_end + 1, 1, 2),
            {
                "backgroundColor": bg_card,
                "textFormat": {"foregroundColor": accent_c, "bold": True, "fontSize": 11},
                "horizontalAlignment": "CENTER",
                "verticalAlignment": "MIDDLE",
            },
        ))
        # Borders around the summary block (header + data)
        requests.append(border(
            rng(layout["summary_header_row"], summary_data_end + 1, 0, summary_cols),
            border_c,
        ))

    # 7) TOTAL row (accent strip)
    requests.append(repeat_cell(
        rng(layout["summary_total_row"], layout["summary_total_row"] + 1, 0, summary_cols),
        {
            "backgroundColor": bg_full,
            "textFormat": {"foregroundColor": accent_c, "bold": True, "fontSize": 12},
            "horizontalAlignment": "CENTER",
            "verticalAlignment": "MIDDLE",
        },
    ))
    requests.append(repeat_cell(
        rng(layout["summary_total_row"], layout["summary_total_row"] + 1, 0, 1),
        {
            "backgroundColor": bg_full,
            "textFormat": {"foregroundColor": accent_c, "bold": True, "fontSize": 12},
            "horizontalAlignment": "LEFT",
            "padding": {"left": 12},
        },
    ))
    requests.append(border(
        rng(layout["summary_total_row"], layout["summary_total_row"] + 1, 0, summary_cols),
        border_c,
    ))

    # 8) Section banner: TICKET DETAILS
    requests.append(repeat_cell(
        rng(layout["details_section_row"], layout["details_section_row"] + 1, 0, max_cols),
        {
            "backgroundColor": bg_full,
            "textFormat": {"foregroundColor": accent3_c, "bold": True, "fontSize": 12},
            "horizontalAlignment": "LEFT",
            "verticalAlignment": "MIDDLE",
            "padding": {"left": 12, "top": 8, "bottom": 4},
        },
    ))

    # 9) Details header row
    requests.append(repeat_cell(
        rng(layout["details_header_row"], layout["details_header_row"] + 1, 0, details_cols),
        {
            "backgroundColor": bg_full,
            "textFormat": {"foregroundColor": text_c, "bold": True, "fontSize": 11},
            "horizontalAlignment": "CENTER",
            "verticalAlignment": "MIDDLE",
            "padding": {"top": 6, "bottom": 6},
        },
    ))

    # 10) Details data rows
    if details_data_end >= details_data_start:
        requests.append(repeat_cell(
            rng(details_data_start, details_data_end + 1, 0, details_cols),
            {
                "backgroundColor": bg_card,
                "textFormat": {"foregroundColor": text_c, "fontSize": 10},
                "horizontalAlignment": "LEFT",
                "verticalAlignment": "MIDDLE",
                "wrapStrategy": "CLIP",
                "padding": {"left": 6, "right": 6},
            },
        ))
        # Ticket # centered
        requests.append(repeat_cell(
            rng(details_data_start, details_data_end + 1, 1, 2),
            {
                "backgroundColor": bg_card,
                "textFormat": {"foregroundColor": accent_c, "bold": True, "fontSize": 10},
                "horizontalAlignment": "CENTER",
            },
        ))
        # Borders around details block (header + data)
        requests.append(border(
            rng(layout["details_header_row"], details_data_end + 1, 0, details_cols),
            border_c,
        ))
        # 11) Basic filter on details (header + data)
        requests.append({
            "setBasicFilter": {
                "filter": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": layout["details_header_row"] - 1,
                        "endRowIndex": details_data_end,
                        "startColumnIndex": 0,
                        "endColumnIndex": details_cols,
                    }
                }
            }
        })

    # 12) Column widths (Module wide, counts narrow, Title wide)
    # Summary side
    requests.append({
        "updateDimensionProperties": {
            "range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 0, "endIndex": 1},
            "properties": {"pixelSize": 230},
            "fields": "pixelSize",
        }
    })
    requests.append({
        "updateDimensionProperties": {
            "range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 1, "endIndex": 2},
            "properties": {"pixelSize": 90},
            "fields": "pixelSize",
        }
    })
    if summary_cols > 2:
        requests.append({
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id, "dimension": "COLUMNS",
                    "startIndex": 2, "endIndex": summary_cols,
                },
                "properties": {"pixelSize": 110},
                "fields": "pixelSize",
            }
        })
    # Details-only columns (those past the summary): Title, etc.
    # Specific widths for the detail columns we know about
    detail_widths = {
        # 0 Module 230 (already set above)
        1: 90,    # Ticket #
        2: 180,   # Status
        3: 130,   # Priority
        4: 480,   # Title
        5: 160,   # Current Assignee
        6: 160,   # QA / QC Tester
        7: 160,   # Backend Developer
        8: 160,   # Frontend Developer
        9: 110,   # ETA
        10: 110,  # Created On
        11: 130,  # Dev Estimate
        12: 130,  # Actual Dev
        13: 130,  # QA Estimate
        14: 130,  # Actual QA
    }
    for col_idx, width in detail_widths.items():
        if col_idx == 0:
            continue
        if col_idx < summary_cols:
            # Already styled by summary; skip to avoid shrinking status columns
            continue
        requests.append({
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id, "dimension": "COLUMNS",
                    "startIndex": col_idx, "endIndex": col_idx + 1,
                },
                "properties": {"pixelSize": width},
                "fields": "pixelSize",
            }
        })

    # 13) Freeze the title + metadata banner so the summary stays visible
    requests.append({
        "updateSheetProperties": {
            "properties": {
                "sheetId": sheet_id,
                "gridProperties": {"frozenRowCount": layout["frozen_rows"]},
            },
            "fields": "gridProperties.frozenRowCount",
        }
    })

    # 14) Hide gridlines for a cleaner card look
    requests.append({
        "updateSheetProperties": {
            "properties": {
                "sheetId": sheet_id,
                "gridProperties": {"hideGridlines": True},
            },
            "fields": "gridProperties.hideGridlines",
        }
    })

    return requests


def _write_themed_tab(
    exporter: GoogleSheetsExporter,
    tab_name: str,
    title: str,
    rows: List[Dict[str, Any]],
    status_order: List[str],
    generated_at: str,
    record_count: int,
) -> Dict[str, Any]:
    if not exporter.service:
        return {"success": False, "rows": 0, "error": "no service"}

    layout = build_layout(
        title=title,
        rows=rows,
        status_order=status_order,
        generated_at=generated_at,
        total_records=record_count,
    )

    svc = exporter.service.spreadsheets()

    # Make sure the tab exists, then look up its sheetId
    if not exporter._ensure_sheet_exists(tab_name):
        return {"success": False, "rows": 0, "error": "could not ensure tab"}
    sheet_id = _get_sheet_id(exporter, tab_name)
    if sheet_id is None:
        return {"success": False, "rows": 0, "error": "sheetId lookup failed"}

    # Wipe any existing filter BEFORE clearing values (otherwise filter ranges
    # can shrink and the basic-filter request below complains)
    try:
        svc.batchUpdate(
            spreadsheetId=exporter.spreadsheet_id,
            body={"requests": [{"clearBasicFilter": {"sheetId": sheet_id}}]},
        ).execute()
    except Exception:
        pass

    # Unmerge any cells we may have merged on a previous run before re-writing
    try:
        svc.batchUpdate(
            spreadsheetId=exporter.spreadsheet_id,
            body={
                "requests": [{
                    "unmergeCells": {
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": 0,
                            "endRowIndex": 200,
                            "startColumnIndex": 0,
                            "endColumnIndex": 30,
                        }
                    }
                }]
            },
        ).execute()
    except Exception:
        pass

    # Clear values
    svc.values().clear(
        spreadsheetId=exporter.spreadsheet_id,
        range=f"'{tab_name}'!A:ZZ",
    ).execute()

    # Write values
    svc.values().update(
        spreadsheetId=exporter.spreadsheet_id,
        range=f"'{tab_name}'!A1",
        valueInputOption="USER_ENTERED",
        body={"values": layout["values"]},
    ).execute()

    # Apply formatting
    requests = _format_requests(sheet_id, layout)
    if requests:
        svc.batchUpdate(
            spreadsheetId=exporter.spreadsheet_id,
            body={"requests": requests},
        ).execute()

    return {"success": True, "rows": len(rows)}


# ---------- Public API ----------
def export_qc_pipeline(exporter: GoogleSheetsExporter) -> Dict[str, Any]:
    """Build and write the QC pipeline tabs to the spreadsheet bound to ``exporter``.

    Returns a dict shaped like the other export_* functions in google_sheets_export.py
    so it can be folded into ``export_all`` results.
    """
    if exporter is None or not exporter.service:
        return {"success": False, "error": "Google Sheets exporter not initialised"}

    tickets, meta = fetch_pm()
    generated_at = meta.get("generatedAt") or "(unknown)"
    record_count = meta.get("recordCount") or len(tickets)

    in_qa, in_dev = split_buckets(tickets)

    qa_result = _write_themed_tab(
        exporter,
        QA_TAB_NAME,
        QA_TAB_TITLE,
        in_qa,
        QA_STATUS_ORDER,
        generated_at,
        record_count,
    )
    dev_result = _write_themed_tab(
        exporter,
        DEV_TAB_NAME,
        DEV_TAB_TITLE,
        in_dev,
        DEV_STATUS_ORDER,
        generated_at,
        record_count,
    )

    return {
        "success": bool(qa_result.get("success") and dev_result.get("success")),
        "tabs": {
            QA_TAB_NAME: qa_result,
            DEV_TAB_NAME: dev_result,
        },
        "with_qa_count": len(in_qa),
        "with_dev_count": len(in_dev),
        "generated_at": generated_at,
        "record_count": record_count,
    }


def main() -> int:
    exporter = get_sheets_exporter()
    if exporter is None:
        print(
            "ERROR: Google Sheets exporter not configured. "
            "Check SHEETS_EXPORT_CREDENTIALS_FILE and SHEETS_EXPORT_SPREADSHEET_ID in .env."
        )
        return 2
    if not exporter.service:
        print("ERROR: Google Sheets API service failed to initialise.")
        return 2

    print("Fetching latest PM data and pushing to Google Sheets...")
    try:
        result = export_qc_pipeline(exporter)
    except Exception as e:  # pragma: no cover
        print(f"ERROR: {type(e).__name__}: {e}")
        return 1

    print(
        f"  generated at: {result.get('generated_at')}, records: {result.get('record_count')}"
    )
    print(
        f"  with QA: {result.get('with_qa_count')}    "
        f"with Dev (upcoming): {result.get('with_dev_count')}"
    )
    for tab, info in (result.get("tabs") or {}).items():
        print(f"  {tab}: rows={info.get('rows')} success={info.get('success')}")

    if result.get("success"):
        print("\nDONE. Both tabs updated successfully.")
        print(
            f"Sheet: https://docs.google.com/spreadsheets/d/{exporter.spreadsheet_id}/edit"
        )
        return 0
    print("FAILED to write one or more tabs (see logs).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
