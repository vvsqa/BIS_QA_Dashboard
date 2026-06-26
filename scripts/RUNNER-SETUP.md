# Test-Plan Runner — deploy on the generator machine (Option B: full auto)

The **runner** (`test_plan_runner.py`) runs on the machine where your `/create-test-plan`
Claude generator is set up. It polls the dashboard's queue and, for each ticket, runs the
generator headlessly (`claude -p "create test plan for <id>"`), uploads the Excel, and reports
status back. It also handles the review loop (apply reviewed Excel / sync Draft|Reviewed|Obsolete).

## What I need from the generator machine (confirm these once)
1. **Headless Claude works**:  `claude -p "say hi"`  → prints a reply and exits.
   (It's the same tool as your chat, just `-p`. Uses your logged-in `claude` auth — no separate
   key needed, though `ANTHROPIC_API_KEY` also works.)
2. **bis-automation repo path** — where `/create-test-plan` runs, e.g. `C:\Users\you\bis-automation`.
3. **Network to the dashboard** —  `curl http://10.1.0.20:8000/live/test-plan-queue?status=pending`
   returns JSON from that machine.
4. **Python 3.8+** —  `python --version`  (you already have 3.11 per the generator setup).

## Deploy (3 steps on the generator machine)
1. Copy `test_plan_runner.py` onto that machine (e.g. into the bis-automation folder).
2. Set environment + smoke-test:
   ```powershell
   $env:DASHBOARD_BASE   = "http://10.1.0.20:8000"
   $env:BIS_AUTOMATION_DIR = "C:\Users\you\bis-automation"
   # optional: $env:ANTHROPIC_API_KEY = "sk-ant-..."   (only if not using the logged-in CLI auth)

   python test_plan_runner.py --dry-run   # lists queued tickets, runs nothing
   python test_plan_runner.py --once      # processes ONE cycle for real (watch a ticket go Queued->Generating->done)
   ```
3. Schedule it (see register-runner-task.ps1) so it runs every few minutes unattended.

## Tunables (env vars)
- `CLAUDE_BIN` — path to the Claude CLI if `claude` isn't on PATH. On Windows it's usually the
  npm shim, e.g. `C:\Users\<you>\AppData\Roaming\npm\claude.cmd`. Set this if `claude -p` isn't found.
- `TPR_POLL_SECONDS` (loop interval, default 60) · `TPR_MAX_PER_CYCLE` (default 2) ·
  `TPR_TIMEOUT_SECONDS` (per ticket, default 1800) · `CLAUDE_EXTRA_ARGS`
  (default `--dangerously-skip-permissions` so the headless run never blocks on a prompt).

## Backfill already-created plans (one-time)
To make Excel downloadable for test plans you created earlier (before the runner), upload all the
existing Excels from `ticket-analysis/` once:
```powershell
python test_plan_runner.py --backfill-excel
```
After it runs, those tickets show **✓ {count} ⬇** and download like the new ones.

## Auto-retry
The dashboard scheduler auto-resets errored tickets back to `pending` (up to 3 attempts,
`TEST_PLAN_QUEUE_MAX_RETRY`) so transient failures get picked up again on the next runner cycle —
no manual reset needed.

## Safety
- The runner **skips any ticket that already has a TestRail plan** (no duplicates) — and your
  command's hard-rule amends rather than duplicating.
- Modes: `--dry-run` (no claude calls), `--once` (single cycle), default = loop.
