# QA Live Metrics Dashboard — Client Prototype

A single self-contained file: **`qa-live-metrics-dashboard.html`**.

This is the prototype to hand to the client for building the QA dashboard **inside their own PM
tool**. It does two jobs at once:

1. **Demonstrates the target UI** — three sections, ultra-polished, animated, with realistic sample
   data so it always demos perfectly.
2. **Documents the data-processing logic** — the *Data Processing Logic* appendix (section ④) gives
   the exact formula and field source for every tile and chart, so the client's developers can
   reproduce each metric natively.

## How to use

Just **open the file in any modern browser** (double-click it). No server, no build, no install.
It works offline — Chart.js loads from a CDN; if there's no internet the layout/logic still render,
only the charts need the CDN.

### The three sections (in order)

1. **Ticket Movement Speed** — avg QC cycle time (QC → BIS), avg first-time QC wait (QA-owned),
   retests (dev-concerned, tracked separately), and Moved-to-Live → Closed wait. Plus a 12-month
   trend and an automatic **spike analysis** that flags abnormal periods, attributes the cause
   (longer testing / more bugs / more retests), and lists the offending tickets.
2. **Team Members** — per-QA work profile: attended, handed-to-BIS, closed, test cases executed,
   bugs reported, retested — each split by ticket complexity (H/M/L) — plus a complexity-weighted
   **velocity** so fewer-but-harder tickets still read as high output.
3. **Automation Utilisation** — coverage %, utilisation %, time saved, categorised module-wise.
   This is the only section sourced from **TestRail**; everything else is PM-native.

### Controls

- **Period** — Past 7 days / Current month / Past month / Past quarter / 6 months / 1 year.
- **Sample / Live toggle** — *Sample* uses baked data. *Live* fetches the existing backend so you can
  prove the numbers are real.
- **Theme toggle** — dark / light.

## SAMPLE vs LIVE

Every sample object is shaped **identically** to the real backend payload, so flipping to LIVE needs
no change to any render function. The data comes from these existing endpoints:

| Section | Endpoint |
| --- | --- |
| Ticket movement | `GET /ticket-speed`, `GET /ticket-movement`, `GET /analytics/bis-to-closed` |
| Team members | `GET /employees/performance/leaderboard?team=qa` (+ per-tester cycle from `/ticket-speed`) |
| Automation | `GET /automation/overview` |

To use LIVE mode, set `API_BASE` (and `API_TOKEN` if required) near the top of the `<script>` block
in the HTML, then click **Live**. If a live fetch fails (CORS / token / backend down) it falls back
to sample automatically.

## Note for the client's engineering team

The appendix is your implementation spec. Almost every metric is computed from the PM tool's own
**status-change history** — rows of `(previous_status, new_status, changed_on, assignee)`. Only the
automation metrics and the per-member *test-cases-executed* count need data from **TestRail**.
