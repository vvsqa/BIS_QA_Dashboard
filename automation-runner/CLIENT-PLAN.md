# BIS Automation Runner — Client Plan

*A unified, local-first automation workbench for the whole QA team — discover, run, author, and govern Playwright (UI), API, and data‑generation automation against TestRail, with Claude doing the heavy lifting.*

---

## 1. Executive summary
Today automation is siloed: only a few engineers can author or run Playwright tests, manual testers can't see or reuse what's automated, the runner is a developer tool, and there's no single place that shows coverage, utilisation, maintenance health, or contribution. The **BIS Automation Runner** turns automation into a **team capability**: a lightweight app every QA member installs (same proven pattern as the BIS Bug Reporter) that shows — module by module — what is automated, lets anyone **run** existing cases against the always‑current `pre_main` branch, and lets engineers **author** new automation by describing a case, recording it, or pasting codegen, with Claude generating and verifying the Playwright spec. Each user works on their **own branch** and opens a **PR to `pre_main`**; merges stay controlled. The result: less manual regression time, visible and reusable automation, and a clear contribution and ROI picture for leadership.

## 2. The problem & the opportunity
| Problem today | What the Runner changes |
|---|---|
| Only 2–3 engineers can run/author automation | Every tester runs existing cases; engineers author with AI assistance |
| No visibility into what's automated | Module‑by‑module coverage, %automated, smoke/regression, by‑who |
| Manual regression repeated each cycle | Reusable automated cases run on demand → time saved |
| Authoring is slow and expert‑only | Describe / record / paste‑codegen → Claude writes & verifies the spec |
| Runner is a dev CLI; no governance | Local app, own‑branch + PR to `pre_main`, single source of truth |
| No ROI / contribution picture | Coverage, utilisation, time‑saved, bugs‑caught, contributor analytics |

## 3. Who uses it (personas)
1. **Automation Engineer** — authors, runs, heals and maintains scripts; commits to own branch; opens PRs.
2. **Manual / QA Tester** — discovers what's automated; runs existing automated cases to save manual effort; raises a bug on failure; requests cases to be automated.
3. **QA Lead / Manager** — reviews coverage and the automation backlog; reviews/approves PRs to `pre_main`; tracks team contribution and ROI.
4. **Leadership / Client (viewer)** — reads the analytics: coverage, utilisation, time saved, bugs caught, trends.

## 4. Complete use‑case catalogue (mapped to the app)
| # | Use case | Persona | Where in the app |
|---|---|---|---|
| 1 | See coverage & all metrics, module by module | All | **Discovery** dashboard |
| 2 | Filter/sort by module, category, engineer, reuse, criticality | All | Discovery filters |
| 3 | Run an existing automated case in a chosen env/role/data | Tester, Engineer | **UI Automation → Run** |
| 4 | Run several cases / a smoke or regression pack for a module | Tester, Engineer | UI Automation (multi‑select / pack run) |
| 5 | On failure, raise a bug (pre‑filled) | Tester | Run panel → "on fail → create bug" (reuses Bug Reporter) |
| 6 | Author a new case: **describe / record / paste codegen** → spec | Engineer | **UI Automation → Automate** |
| 7 | Author **one or many** cases at once (single/multi‑select) | Engineer | Automate workspace (case chips) |
| 8 | Verify locally, then commit to own branch + PR to `pre_main` | Engineer | Automate → Run → Commit → PR |
| 9 | **Heal** a failing/flaky test with Claude | Engineer | UI Automation → Heal |
| 10 | See & work the **automation backlog** (what to automate next) | Engineer, Lead | **Backlog / Candidates** |
| 11 | See & work the **maintenance queue** (needs‑work / deprecated) | Engineer | Discovery maintenance + Backlog (Maintenance mode) |
| 12 | **API automation**: pick API, configure, run, verify response | Engineer | **API Automation** |
| 13 | **Generate test data** (single / bulk) via app APIs | All | **Data Generation** |
| 14 | Per‑user home: my cases, my PRs, my runs, my data‑readiness | All | **My Work** |
| 15 | Review & approve PRs to `pre_main`; merge | Lead | My Work (manager) / Reviews |
| 16 | Configure private data & role accounts per environment | All | **Settings / Data & Roles** |
| 17 | First‑run bootstrap (git, Node, Playwright, Claude CLI, clone) | All | **Setup** panel |
| 18 | Always run against the latest `pre_main` | All | Auto `git fetch + reset` before every run |
| 19 | Track contribution & ROI (time saved, bugs caught) | Lead, Client | Discovery + My Work analytics |
| 20 | Run history & artifacts (trace/video/screenshot/error‑context) | Engineer | Run results |

## 5. The product — surface by surface
- **Discovery** — the landing analytics: 12 KPIs (total cases, automated, coverage %, manual, total/automated/manual executions, **utilisation %**, time saved, **maintenance required**, **bugs via automation**, contributors); coverage / utilisation / maintenance donuts; contributors; **daily scripting** (per engineer) and **bugs‑via‑automation**; and a **module‑breakdown table with every metric**. Filterable; rows deep‑link into the cases.
- **My Work** — each user's personalised home: profile + branch, my KPIs (cases automated, this week, bugs caught, open PRs, data‑readiness %), my daily scripting, my open PRs to `pre_main`, my cases, my recent runs.
- **UI Automation** — left: module → case tree with status badges and **single/multi‑select** checkboxes; right: **Run** (env · role · data · on‑fail→create‑bug · "Fetch pre_main & Run" → live log → pass/fail + artifacts) and **Automate** (case chips → input *describe/record/paste* → run config → Claude generates & verifies → commit to my branch → PR). **Heal** offered on failures.
- **API Automation** — catalog imported from **Postman/OpenAPI**; method + path, prerequisites, auth, editable body with `{{configurable}}` fields, run → response + verify + data‑created + error log.
- **Data Generation** — single / bulk via app APIs (never direct DB): template, env, count, role‑mix → progress → results → save to my data file.
- **Backlog / Candidates** *(new)* — the strategic worklist: not‑automated cases ranked by **reuse frequency + business criticality + execution volume** (highest ROI first), with select‑and‑automate; a **Maintenance** mode for needs‑work / deprecated scripts.
- **Setup** *(new)* — first‑run toolchain check & install (git, Node, Playwright, Claude CLI) and repo clone, with a live checklist.

## 6. How it works (architecture)
- **Shell** — a local **FastAPI + single‑page UI**, packaged as a one‑file `.exe` with an in‑app self‑updater, exactly like the BIS Bug Reporter; per‑user config in `%APPDATA%`. Calls the central QA dashboard for shared catalog/analytics and AI.
- **Bootstrap** — on first run the app installs **git, Node, Playwright, the Claude CLI** and **clones** the automation repo; before **every** run it does `git fetch + reset --hard origin/pre_main` so runs always use the latest stable code.
- **Authoring with Claude** — the app shells the **Claude CLI** in the repo (skills: *write‑playwright‑test, locate‑best‑element, record‑workflow, playwright‑test‑heal*) to turn a description / recording / codegen into a clean, convention‑following spec, then runs it once to verify.
- **Execution** — runs Playwright per‑case (sequential — the platform disallows concurrent logins), streams a live log, captures trace/video/screenshot/error‑context, and pushes results to **TestRail** (`@C####` → status); a passing new case is set **Automated** in TestRail.
- **Git governance** — the app commits **only to the user's branch** and opens a **PR to `pre_main`**; a lead merges. It refuses to push anything else.
- **Reuse** — the existing dashboard `/automation/*` analytics (`automation_sync.py`, `AutomationCase/Execution/Snapshot`), the bis‑automation Playwright config / TestRail client / record tooling, and the Bug‑Reporter `/create` flow for on‑fail bugs.

## 7. Environments, data & roles
- **Environments** — Staging / Pre / Live selectable for both running and authoring; base URLs configured internally per env.
- **Per‑user private data** — concrete values (and credentials) live only in the user's local `my-data.json`, never committed.
- **Shared data contract** — each case (or case‑set) declares a **data requirement** (what data shape + which user role) — shared and discoverable; the app overlays the user's private values at run time. Discovery shows a **"data ready / needs setup"** badge by checking the local file against the shared shape — nobody sees anyone else's values.
- **Roles** — logical roles (Client Admin, Learner, Security Admin…) map to concrete accounts per env in the user's config; execution uses only the accounts a user is entitled to.

## 8. Governance & control
- **One source of truth**: `pre_main`; everyone runs the latest; authors never edit `pre_main` directly.
- **Own‑branch + PR**: controlled contribution; leads merge.
- **Single‑user, sequential runs**: respects the platform's no‑concurrent‑login constraint.
- **Secrets local‑only**: TestRail/GitHub keys and role passwords stay in `%APPDATA%` (optional OS‑keychain hardening later).

## 9. TestRail + PM configuration (to make it effective)
- **Add `custom_case_test_category`** (Smoke / Regression / Sanity) — there is no structured field today; this powers reliable categorisation and pack runs.
- **Add `custom_case_data_requirement`** — keys the shared data/role contract to each case.
- **Hygiene** on existing fields: `custom_case_automated` (Planned…Not Automated), `custom_case_automated_by` (1 Vishnu / 2 Varsha / 3 Vivek — keep stable), `custom_case_execution_method` (Manual/Automated). Authoring write‑back sets Automated + execution=Auto; a nightly reconcile keeps it honest.
- **Reuse** `custom_case_reusabilityfrequency` and `custom_case_business_criticality` to rank the **automation backlog**.
- **Naming**: plan = ticket id, run = `<ticket> - Automation <pack> R<n>` so executions map to tickets.
- **PM**: keep a PR/Release‑Note link per automatable ticket; optional "automation candidate" flag to prioritise.

## 10. Rollout roadmap (each phase shippable)
- **Phase 0 — Prototype (done):** clickable, graphics‑rich app covering all surfaces with real‑shaped data; conveys the concept to the team and client.
- **Phase 1 — Core loop live:** real shell + self‑updater + bootstrap + clone; Discovery wired to live `/automation/*`; **run** existing cases in Staging with live log, artifacts, TestRail push, on‑fail bug; **author → run → commit → PR** for one case.
- **Phase 2 — Authoring at scale:** multi‑select batch authoring; **heal**; **API** + **Data‑gen** executing for real; **Backlog/Candidates** and **Maintenance** worklists.
- **Phase 3 — Data/role GA + governance:** data‑requirement catalogue populated for core modules; data‑ready badges everywhere; per‑env role resolution hardened; manager **Reviews** surface; telemetry.
- **Phase 4 — TestRail config rollout & retire legacy:** Smoke/Regression field live; retire the old `runner-server.js` / `test_plan_runner.py`.

## 11. Value & success metrics
- **Manual time saved** per cycle (sum of automated‑case execution time) — already trending (~1,700 h to date in the prototype's model).
- **Coverage %** per module and overall, rising over time.
- **Utilisation** — automated executions ÷ total executions (reuse of what's built).
- **Bugs caught by automation** — defect‑escape reduction.
- **Adoption** — # of testers running automation; # contributors authoring.
- **Cycle time** — regression turnaround before vs after.

## 12. Risks & mitigations
- **Claude CLI access per machine** → governance for N users (per‑user subscription vs shared API key); decide before Phase 1.
- **`pre_main` discipline** → enforced by own‑branch authoring + reset‑before‑run.
- **Secrets at rest** → local‑only now; OS‑keychain option later.
- **No concurrent logins** → sequential runs; prefer per‑user accounts to avoid env collisions.
- **TestRail rate limits** → cached catalog, 429‑aware backoff.
- **Smoke/Regression field missing** → spec‑tag inference until the TestRail field is added (top config ask).

## 13. What the prototype demonstrates today
`automation-runner/prototype.html` (open in any browser — no install) shows: the full **Discovery** dashboard with every metric module‑by‑module; **My Work**; **UI Automation** with single/multi‑select run + the describe/record/paste **Automate** workspace → generate → commit → PR; **API Automation**; **Data Generation**; environment switcher; and settings. It's presentation‑ready for both the team and the client.
