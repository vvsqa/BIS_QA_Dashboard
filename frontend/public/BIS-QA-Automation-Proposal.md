# BIS QA Automation — Technical & Functional Proposal
### AI-assisted bug reporting today, fully automated bug verification next

**Prepared for:** Client review & implementation approval
**Prepared by:** BIS Training Solutions · QA Tooling
**Scope:** The BIS Bug Reporter (live) + the proposed Phase‑2 Automated Bug Lifecycle & Retest

---

## 1. Executive summary

QA spends a large share of its day on two repetitive, low-creativity tasks: **writing up bugs** and **re-verifying fixes**. Both are mechanical, both are error-prone when rushed, and both scale linearly with team size.

The **BIS Bug Reporter** already removes most of the first cost: it turns a screen recording, a test case, or a rough note into a **complete, house‑style, correctly‑fielded bug in ~1.5–2 minutes** instead of **~8–11 minutes** by hand — filed under the tester's own identity, with proof attached, the right developer assigned, and the matching test case failed automatically.

**Phase 2** closes the loop: when a developer marks a bug *Released to QA*, the system **re-runs the bug's own reproduction automatically**, gives the reporter a ready verdict with evidence, and — on a one-click human confirmation — **closes or reopens** the bug and optionally **promotes the check to the next environment** (Staging → Pre → Live).

The design is deliberately **tool-agnostic**: it posts bugs to **Redmine today and is built to move to the PM tool** (logging bugs inside each PM ticket), and reads test-case data from **TestRail or any equivalent**, by swapping a thin adapter — no change to the AI or the user experience.

**Headline outcome:** for a 12‑person QA team, the combined Phase‑1 + Phase‑2 savings are estimated at **~1.0–1.2 full‑time‑equivalents of effort returned to real testing** (roughly **1,800–2,400 hours/year**), with a **~75–85% reduction** in the time spent on the bug-logging-and-verification lifecycle. Section 11 shows the model and the per-unit figures so the numbers can be calibrated to actual volume.

---

## 2. The problem we are solving

| Pain | Today (manual) | Cost |
|---|---|---|
| Writing a complete bug | Re-type steps, expected/actual, ~10 fields, find the developer, attach proof | ~8–11 min/bug, inconsistent quality |
| Failing the matching test case | Open the run, find the case, set Failed, write a note | ~1.5–2 min/bug, often skipped |
| Re-verifying a released fix | Re-create the exact repro, in the right env, with the right data | ~10–15 min/retest, easily deferred |
| Verifying across environments | Repeat the retest in Pre and Live | multiplies the retest cost |
| Evidence & traceability | Re-gather screenshots/logs; link bug ↔ test ↔ ticket by hand | continuous overhead |

These costs are **repetitive and rule-based** — the ideal target for assisted automation with a human only at the decision points.

---

## 3. Solution overview

Two layers, one continuous loop:

**Phase 1 — Assisted capture (live today):** a standalone desktop tool that converts inputs (Jam video, TestRail case, notes) into a finished bug, files it, assigns it, and fails the test case.

**Phase 2 — Automated verification (proposed):** every bug also captures a **machine-runnable retest recipe**; when the fix is released, the recipe auto-executes and the reporter confirms close/reopen and environment promotion.

> The tester's job shifts from *doing the mechanical work* to *making the judgement calls* — the machine prepares everything; the human decides.

---

## 4. Functional walkthrough (end to end)

1. **Capture.** The tester pastes a **Jam video link**, a **TestRail Case ID**, or types a **note** — or any combination.
2. **Auto-fill.** The tool reads the Jam recording (actual behaviour, steps, environment, browser/OS, ticket, test data) and the test case (canonical steps + expected), then an optional **AI polish** writes it in house style. Passwords spoken in the recording are masked.
3. **Review.** Every field is pre-filled and editable; required fields are flagged; the correct **developer is suggested** from the ticket.
4. **Create.** The bug is filed in the tracker under the tester's identity, with the Jam link as proof — clean, de-duplicated fields. An optional **parent task** can be set so the bug **nests under the right task** in the tracker.
5. **Close the loop (test case).** Optionally the matching test case is marked **Failed** in the run for that environment, with a short *Failed/Expected* note. **If no matching case exists**, the tool can **create one from the bug and add it to the plan** (all environment runs) — so test coverage grows from every gap a tester finds.
6. **Bulk.** One recording describing several issues is split into multiple editable bugs (with per-bug case ids), then created together.
7. **My Pending Retests.** Each tester sees their own released-back bugs, grouped by ticket, ready to retest.
8. **(Phase 2) Auto-retest.** When the fix is released, the recipe auto-runs and the reporter confirms close/reopen + environment promotion.

---

## 5. Technical architecture

### 5.1 Components

| Layer | Component | Technology | Responsibility |
|---|---|---|---|
| Client | Desktop tool | Python + FastAPI packaged as a single Windows .exe; served to a local browser | UI, per-user keys, talks to tracker + the AI service |
| Service | QA Dashboard backend | Python / FastAPI on a server | AI orchestration, TestRail/PM integration, analytics, metadata |
| Data | App database | PostgreSQL | Estimations, reviews, events, snapshots |
| Integrations | Tracker / test tool | REST APIs | Redmine today → PM (bugs), TestRail (cases & runs) |
| AI | Claude (Anthropic API) | Structured-output (JSON-schema) calls | Fill, polish, bulk-split, estimation, (Phase 2) recipe synthesis |
| Evidence | Jam | MCP API | Reproduction transcript, user events, environment metadata |

### 5.2 Two-layer design (why it is tool-agnostic)

```
        INPUTS                 CONTENT ENGINE                     CREATE ADAPTER             TARGET
  Jam video ─┐            ┌───────────────────────────┐      ┌──────────────────┐     ┌──────────────┐
  TestRail   ├──────────▶ │ extract → fill → AI polish │ ───▶ │ field map + API  │ ──▶ │ Redmine today│
  Notes ─────┘            │ → de-dup → assign dev      │      │ (swappable)      │     │   → PM next  │
                          └───────────────────────────┘      └──────────────────┘     └──────────────┘
                                  (reused as-is)               (small, swappable)
```

- **Content engine** — Jam→fields, test-case fill, AI polish, bulk split, test-data + password masking, developer suggestion. **Never changes per tool.**
- **Create adapter** — posts the finished bug to a specific tracker via a small **field map**. **One module per tracker.**

### 5.3 Data flow (single bug)

```
Tester ──▶ Desktop tool ──▶ (AI service: fill/polish) ──▶ Tester reviews
   │                                                          │
   └───────────────────────────────────────────────────────▶ Tracker API (create bug)
                                                              │
                                          TestRail API (mark case Failed) ◀── optional
                                                              │
                                              Dashboard analytics (event logged)
```

---

## 6. The AI model — how it works and what to wire in

### 6.1 How AI is used (reliably)

The app does **not** free-form chat. Every AI call is a **structured-output** request: the model is given the tester's raw material plus a **strict JSON schema** (subject, steps, expected, actual, severity, type, module, …) and must return data that matches it. The result is validated before use; on a mismatch the call is retried. This makes the AI **predictable and safe to automate** — it fills fields, it does not invent free text.

AI is used for: **bug fill/polish**, **bulk transcript → many bugs**, **QA estimation/review reasoning**, and (Phase 2) **reproduction-recipe synthesis**. Rule-based fallbacks run when AI is unavailable, so the tool never hard-depends on it.

### 6.2 Recommended Claude model

We recommend wiring the app to the **Anthropic Claude API** with a model tiered by task:

| Task | Recommended model | Why |
|---|---|---|
| Bug fill / polish, bulk split | **Claude Sonnet (claude-sonnet-4-6)** | Best cost/quality balance for structuring text at volume |
| Estimation reasoning, Phase‑2 recipe synthesis | **Claude Opus (claude-opus-4-8)** | Strongest reasoning for the hardest, lower-volume tasks |
| High-volume cheap classification (optional) | **Claude Haiku (claude-haiku-4-5)** | Fastest/cheapest for simple, frequent calls |

**Default: Sonnet 4.6 for everyday calls, Opus 4.8 for the heavy reasoning paths.** The model id is a single configuration value, so tiers can be tuned without code changes.

### 6.3 Key recommendation — a dedicated API key

Today the AI runs through a shared developer CLI subscription, which competes with interactive use and has no usage isolation. **We recommend provisioning a dedicated Anthropic API key for the application.** Benefits: predictable cost, usage metering per feature, rate-limit isolation, and no contention with developers' tools. Cost is modest because each call is small and schema-bounded; Section 11 includes an indicative budget.

### 6.4 Privacy

AI calls send only the bug's working text (narration, steps) to the Anthropic API; **credentials are masked before any AI call**. Per-user tracker/Jam/TestRail keys are stored **locally on each tester's machine** and are sent only to those services. No keys are sent to the AI provider.

---

## 7. Built to plug into your tracker — Redmine today, PM next

The tool is split into two layers, which is what makes the destination swappable:

| Layer | Role | Changes per tracker? |
|---|---|---|
| **Content engine** | Jam → fields, TestRail-case fill, AI polish, bulk split, test-data + password masking, developer suggestion | **No** — reused as-is |
| **"Create" adapter** | Posts the finished bug to the tracker's API via a small field map | **Yes** — one small, swappable module |

**Configured for Redmine today; the plan is to log bugs directly inside each PM ticket.** Because only the thin create-adapter changes, moving from Redmine to PM is a contained adapter + field-map change — the AI and the entire tester experience stay exactly the same. We already integrate with PM tickets (the test-plan links are posted into PM today), so the channel exists. A `both` mode can run Redmine + PM in parallel during the transition so nothing is lost.

**To confirm when PM logging is ready:** whether a bug becomes a sub-item/work entry under its PM ticket (preferred) or a structured comment; the PM field mapping (subject, steps, expected, actual, test data, severity, environment, proof link, assignee); and whether dashboard analytics read PM bugs or keep the Redmine sync during transition.

---

## 8. Server setup & how people access it

### 8.1 Topology

```
   Tester machines (Win)                Company network                 Cloud
  ┌────────────────────┐            ┌────────────────────┐         ┌──────────────┐
  │ BIS Bug Reporter   │  HTTP      │  QA Dashboard      │  HTTPS  │ Anthropic    │
  │ (.exe, 127.0.0.1)  │ ─────────▶ │  backend (server)  │ ──────▶ │ Claude API   │
  │  per-user keys      │            │  + PostgreSQL      │         └──────────────┘
  └────────────────────┘            │  REST to tracker   │  ──▶ Redmine today → PM · TestRail
                                     └────────────────────┘
```

### 8.2 Setup

- **Backend**: one server on the company network runs the dashboard/API service + PostgreSQL. It holds shared service credentials and the (recommended) Anthropic API key. Reachable on the LAN (e.g. `http://<server>:8000`).
- **Desktop tool**: a **single .exe** distributed to each tester — no install, no Python. It runs a tiny local web server and opens in the browser at `http://127.0.0.1:8765`.
- **Updates are zero-friction**: a new .exe **auto-replaces** the running one on the same URL (it asks the old copy to step aside) — no manual intervention.
- **Access**: testers on the company network reach the backend for AI/TestRail/analytics; basic bug creation works offline. Each tester enters their **own** tracker key once.

### 8.3 Security

Per-user keys are local; credentials are masked before AI; tracker/test writes are attributed to the actual person; the backend centralises shared secrets. Standard network controls (VPN/LAN-only backend, HTTPS to external APIs) apply.

---

## 9. Phase 2 — Automated Bug Lifecycle & Retest (detailed)

### 9.1 Concept

Each bug carries its own **retest recipe**; when the fix is released, the recipe runs automatically and the reporter confirms the outcome.

### 9.2 Stages & implementation logic

1. **Recipe capture (at bug creation).** Build a runnable reproduction from the **Jam user-events** (the actual clicks/inputs), the test-case steps, the test data, and the expected result. Persist it linked to the bug + test case. Tag a **confidence** level (high for clean UI flows, low for data-specific/intermittent bugs → flagged for manual retest).
2. **Status trigger.** A **Redmine/PM webhook** (preferred) — or a poller — fires when the bug enters **Released to QA**, carrying the **target environment**.
3. **Auto-execution.** A headless **runner (Playwright)** replays the recipe against that environment, capturing **pass/fail, screenshots/video, console & network logs**, and an **actual‑vs‑expected** comparison.
4. **Verdict to the reporter.** The bug's author is notified (in *My Pending Retests* / email / PM) with the result + evidence and a **recommendation** ("looks fixed" / "still failing").
5. **One-click confirm.** The human decides: **Close** (attach evidence, close) or **Reopen** (re-assign to the developer with the fresh failure). **Nothing closes without sign-off.**
6. **Environment promotion.** On a pass, the reporter chooses to verify the same fix in the **next environment** (Staging → Pre → Live); the recipe re-runs there and the confirm repeats.
7. **Sync.** Each execution updates the test-case result per environment and the dashboard's retest metrics (auto-pass rate, reopen rate, cycle time).

### 9.3 Phase-2 components

| Component | Role |
|---|---|
| Recipe builder | Jam events + steps + data → runnable Playwright recipe stored on the bug |
| Status watcher | Webhook/poller on *Released to QA* with environment |
| Execution runner | Headless replay per environment; evidence + verdict |
| Confirmation UI | Extends *My Pending Retests*: verdict + evidence + Close/Reopen + Promote |
| Promotion controller | Sequences Staging → Pre → Live with re-run + re-confirm |
| Integrations | Tracker (status/close/reopen + evidence), test tool (per-env result), dashboard (metrics) |

### 9.4 Guardrails

Auto-pass **never** auto-closes; reopen routes the fresh failure to the developer; inconclusive/flaky runs re-run and, if still unclear, fall back to manual retest. Environment promotion is always a conscious human choice.

### 9.5 Wiring into the existing Playwright automation repo

Phase 2 does **not** introduce a parallel automation stack — it **feeds the team's existing Playwright + TypeScript + Cucumber repo** (`bis-automation/e2e_tests`), reusing what is already there:

| Existing asset | How Phase 2 uses it |
|---|---|
| `tests/pages/*` (Page Objects) | Generated tests **call existing Page Objects** (e.g. `AdminPage`, Forms pages) instead of raw selectors → maintainable, on-convention. Missing POs are scaffolded and flagged for review. |
| `tests/features` + `tests/steps` (BDD) | A recipe can be emitted as a `.feature` + step definitions, matching the team's BDD style. |
| `helper/auth` | Generated test logs in as the **role from the bug's test data** using the existing auth helper. |
| `helper/env` (`.env.vvsstaging`, …) | The same spec runs against **Staging / Pre / Live** by switching the env helper — powering environment promotion. |
| `helper/testrail` | Auto-execution **posts pass/fail to TestRail through the repo's existing TestRail helper** — native, no new integration. |
| `hooks/pageFixture.ts`, `playwright.config.ts` | Generated specs are first-class: they use the standard fixtures/config and run via the existing npm scripts and CI. |
| `recordings/<module>/` | The source Jam reproduction is stored alongside, per module, for traceability. |

**Generation → review → merge flow:**

1. **Recipe builder** converts the Jam user-events + test-case steps into a Playwright spec that reuses Page Objects and helpers, named by ticket/bug (e.g. `20543-attendee-reuse.spec.ts`) under `tests/playwright-tests/` (or a `.feature` under the module folder).
2. The spec is delivered as a **pull request to the automation repo** — an **automation engineer reviews and merges** it (quality gate; nothing lands blindly).
3. Once merged, it is a **permanent regression test**, runnable locally, in CI, and by the Phase‑2 status-triggered runner — across all environments.
4. **Low-confidence recipes** (data-specific/intermittent) are flagged for manual authoring rather than auto-committed.

> Net effect: the tool **seeds ~70–80% of each test's boilerplate** in the team's own conventions; engineers spend their time on correctness and maintainability, not scaffolding — so the suite grows far faster than hand-writing every test.

### 9.6 Usability — who uses it and how

- **Manual testers (no code):** they file the bug exactly as today. The retest runs itself; they receive a verdict + evidence and click **Close** or **Reopen**. Zero automation skill required.
- **Automation engineers:** receive generated specs as PRs that already follow repo conventions (Page Objects, auth/env/testrail helpers) — they review, tidy, and merge, multiplying their output instead of writing each test from scratch.
- **The repo & team:** every reported bug contributes a maintainable, convention-aligned regression test, so coverage compounds and stays consistent.

### 9.7 Bonus: a regression suite that builds itself

Because every bug yields a runnable, Page-Object-based recipe **inside your existing repo**, the accumulated recipes become a **growing automated regression library** — re-runnable on each release at near-zero marginal cost. This compounds the savings over time and is the long-term strategic payoff.

---

## 10. Implementation roadmap

| Phase | Deliverable | Indicative effort |
|---|---|---|
| **1 (live)** | Assisted bug capture: Jam/TestRail/notes → fill → create → assign → fail case; bulk; retests | Delivered |
| **1.1** | Adoption + time-saved instrumentation; dedicated Anthropic API key | Small |
| **1.2** | PM "create" adapter + field map (log bugs inside PM tickets) | Small–Medium |
| **2A** | Capture & store the retest recipe at bug creation | Medium |
| **2B** | Status webhook + headless auto-execution on *Released to QA* | Medium–Large |
| **2C** | Confirmation UI (Close/Reopen with evidence) | Medium |
| **2D** | Multi-environment promotion + retest analytics | Medium |
| **2E** | Regression library from accumulated recipes | Incremental |

Each phase is independently shippable and delivers value on its own.

---

## 11. Time savings & ROI

### 11.1 Per-unit savings (measured/estimated)

| Activity | Manual | With the system | Saved |
|---|---|---|---|
| Log one bug | ~8–11 min | ~1.5–2 min | **~6.5 min** |
| Fail the test case + note | ~1.5–2 min | automatic | **~1.7 min** |
| Retest a released fix (Phase 2) | ~10–15 min | ~1–2 min (confirm) | **~10 min** |
| Verify in each extra environment | ~10 min | ~1 min | **~9 min** |

### 11.2 Team model (illustrative — adjust to real volume)

Assumptions (conservative; tune per actual data): **12 QA testers**, **~3.5 bugs/tester/day**, **~60% of bugs released back once** for retest, **~220 working days/year**, half of bugs linked to a test case.

| Stream | Daily volume | Saved/day | Annualized |
|---|---|---|---|
| Bug logging | ~42 bugs | ~42 × 6.5 min ≈ **4.5 h** | **~1,000 h** |
| Test-case failing | ~21 bugs | ~21 × 1.7 min ≈ **0.6 h** | **~130 h** |
| Phase‑2 retests | ~25 retests | ~25 × 10 min ≈ **4.2 h** | **~920 h** |
| Environment promotion | (subset) | conservative add | **~150 h** |
| **Total** | | **~9 h/day** | **~2,200 h/year** |

**~2,200 hours/year ≈ ~1.0–1.2 FTE of QA effort returned to real testing**, a **~75–85% reduction** in the bug-handling-and-verification lifecycle. The regression-library upside (§9.5) grows on top of this each release.

### 11.3 Indicative AI cost

Each AI call is small and schema-bounded. At the volumes above, the dedicated Anthropic API spend is a **small fraction** of the labour value returned (typically low tens of dollars per day at team scale on Sonnet, with Opus reserved for heavy tasks) — i.e. a **strongly positive ROI**. Exact cost is metered once the dedicated key is in place.

> All figures are estimates with stated assumptions. We recommend turning on the built-in **adoption + time-saved instrumentation** (Phase 1.1) so the savings are reported from **real usage**, not estimates.

### 11.4 What this means for the manual testing team — delivering on time

The two reclaimed streams (logging and retest) are exactly the work that **piles up near a release** and forces overtime or slipped dates. Returning ~9 hours/day team-wide changes the day-to-day for testers:

- **Hit release deadlines without overtime.** The end-of-cycle crunch of writing up a backlog of bugs and re-verifying a wave of fixes is the part that is now largely automated.
- **Clear the retest backlog.** Released fixes are verified as they arrive — automatically — instead of queuing for a tester to find time.
- **Spend the freed hours on higher-value testing.** Exploratory, edge-case, and risk-based testing — the work that actually finds the bugs machines miss, and that testers rarely have time for under deadline pressure.
- **Consistent quality under pressure.** Even when busy, every bug is complete and every fix is verified across environments — no shortcuts taken to save time.
- **Faster feature throughput.** A shorter bug → fix → verify → promote cycle means features clear QA sooner, so the whole release moves on time.

In short: the tool does not replace testers — it **removes the repetitive load that makes them miss deadlines**, and gives that time back to the testing only people can do.

---

## 12. Risks, prerequisites & mitigations

| Item | Mitigation |
|---|---|
| Not every bug is cleanly automatable (data-specific, intermittent) | Confidence tagging + manual-retest fallback; start with UI-reproducible functional bugs |
| Environment access & test data for the runner | Provision authenticated env access + seeded data per environment |
| Trigger mechanism | Confirm tracker webhook support (preferred) vs polling |
| Recipe drift as the product changes | Ownership + light maintenance; failures surface immediately on re-run |
| AI cost/availability | Dedicated API key + rule-based fallbacks; tiered models |
| Security | Local per-user keys, masked credentials, LAN-only backend |

---

## 13. Why this approach

- **Human-in-the-loop, not human-out:** the machine prepares; people decide. Quality and accountability are preserved.
- **Incremental & low-risk:** every phase ships value independently; Phase 1 is already live.
- **Tool-agnostic & future-proof:** runs on Redmine today and moves to the PM tool without reworking the engine.
- **Compounding returns:** bug recipes become a regression suite that pays back on every release.

## 14. Requested approval & next steps

1. Approve **Phase 1.1** — dedicated Anthropic API key + adoption/time-saved instrumentation (calibrate the ROI on real data).
2. Confirm the **PM logging target** (bug sub-item vs comment) and the PM field mapping for the create adapter (Phase 1.2).
3. Approve the **Phase 2** build sequence (2A → 2E).
4. Provide environment access + test data for the Phase‑2 runner.

---

*BIS Training Solutions · QA Tooling · This proposal is for client review; scope, sequencing and figures to be confirmed jointly. Estimates carry stated assumptions and can be calibrated with built-in instrumentation.*
