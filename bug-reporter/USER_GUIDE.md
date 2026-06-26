# BIS Bug Reporter — User Guide

A small standalone tool that lets QA file **complete, house-style Redmine bugs in ~1–2 minutes** instead of ~8–11 minutes by hand — pulling the real reproduction from a **Jam video**, the canonical steps from a **TestRail case**, polishing with **AI**, auto-assigning the developer, attaching proof, and (optionally) **marking the TestRail case Failed** in one go.

---

## 1. Getting started (one-time, per machine)

1. **Run it:** double-click `BIS-Bug-Reporter.exe` (or `Launch BIS Bug Reporter.cmd`). Your browser opens to **http://127.0.0.1:8765**. Keep the small window open while you use it; closing it stops the tool.
   - No Python or install needed — it's a single file. Get it from **http://10.1.0.20/BIS-Bug-Reporter.exe** or from whoever shares it.
2. **Open ⚙ Settings** and fill in:
   - **Redmine API key** (Redmine → *My account* → *API access key*). Your **name is fetched automatically** from the key — bugs are filed under *you*.
   - **Jam token (PAT)** *(optional)* — jam.dev → Settings → Integrations → AI Agents. Needed only for "Load from Jam".
   - **TestRail email + API key** *(optional)* — TestRail → *My Settings* → *API Keys*. Needed only to mark cases Failed under your own name (otherwise a shared key is used).
   - **Defaults** (Platform / OS / Browser / Devices / Build / Environment) — set once, *Save as my defaults*, never retype.

> 🔒 **Your keys never leave your machine** (`%APPDATA%\bis-bug-reporter\config.json`). Redmine/TestRail keys are sent only to those services; the Jam token only to Jam.

---

## 2. Filing one bug — three inputs, any combination

At the top of **Create Bug** you can use **any one — or any mix — of three sources**, then click **⚡ Fill the bug**:

| Input | What it contributes |
|---|---|
| 🎥 **Jam video link** | Real reproduction: actual behaviour, **steps**, environment, browser/OS, the ticket id, severity hint, and **Test Data** (account/role, files, dates, values) |
| 🧪 **TestRail Case ID** | The **canonical** steps, expected result, test data, platform, and ticket from the test case |
| 📝 **Notes** | Anything you type to add or clarify |

**⚡ Fill the bug** merges them intelligently — the test case supplies the canonical steps/expected; Jam supplies what actually happened and the environment; your notes layer on top. Then review and adjust.

> 🔐 **Passwords are never captured.** If you say a password in the Jam video, it's masked — the account/role is kept, the secret is dropped.

### Create the bug
- Required fields are flagged; most are pre-filled. The tool also **suggests the developer** to assign (from the ticket's dev fields — never you, the reporter).
- **Parent task (optional):** enter a **Redmine task number** to have the bug created **under that task** (it nests as a sub-issue in Redmine). It stays filled across bugs, so you can file several under the same parent.
- Click **Create bug in Redmine** → you get the **#id and a link**.
- The bug is written in **house style** — clean Steps / Test Data / Expected / Actual fields, **no duplicated description**, Jam link in *Proof of Bug*.

### Optionally fail the TestRail case (closing the loop)
If the bug came from a TestRail case, tick **"🧪 Also mark the TestRail case Failed in `<environment>`"** before creating. The tool then:
- finds the run for that **Environment** automatically (you don't need a run link),
- marks **that case Failed** in the run, and adds a concise note:
  ```
  Failed: <what went wrong>
  Expected: <what should have happened>
  ```
- Only enter a **Run id/link** in the rare case the case sits in several runs and the environment can't pick one.
- This never blocks the bug — the bug is created first; the TestRail update follows.

### No matching test case? Create one and add it to the plan
If the bug **doesn't** map to an existing TestRail case, tick **"➕ No matching case? Create one in TestRail from this bug & add it to the plan"** (shown when no Case ID is set). After the bug is created the tool:
- **builds a TestRail case** from the bug's subject / steps / expected / test data — as **Draft, Not Automated**, linked to the ticket, in a `#<ticket> - Bug-derived cases` section,
- **adds it to every run of the ticket's plan** (Staging/Pre/Live) so it's covered in **all future runs**, and
- **marks it Failed** in the current environment's run (it came from a bug).

So coverage keeps growing automatically: every gap a tester finds becomes a permanent test case in the plan. The **new case id is shown** after creation (and dropped into the Case ID field) so you can see/reuse it. *(Needs an existing plan for the ticket; the two TestRail options are mutually exclusive — case present → mark Failed, case absent → create case.)*

---

## 3. Bulk mode — one Jam video → many bugs

Found 3–5 issues in a single recording? Use the **Bulk** tab.

1. Paste the **🎥 Jam video link** (and optionally a comma-separated list of **TestRail Case IDs**, in the order you describe the bugs).
2. Click **⚡ Split into bugs** — the narration is split into **separate, editable bug cards**, each sharing the video as its proof.
3. Review/edit each, then **Create all**.

**🎥 Recording tips (matter for a clean split):**
- **Number each bug out loud:** *"Bug one… next, bug two…"* — the boundary is what lets it split.
- For each: say **what's wrong**, then **what should happen**, and the **area/screen**.
- Mention the **case id** (or list them below in order), and the **test data** — never read passwords.
- Say the **severity** if you know it; pause briefly between bugs.

---

## 4. My Pending Retests

The **My Pending Retests** tab lists *your own* bugs that developers have released back for retesting — filter by ticket, click to open in Redmine. No more hunting in Redmine for what's waiting on you.

---

## 5. Why use it — advantages

- **~75–80% faster:** ~1.5–2 min/bug vs ~8–11 min by hand. A tester filing ~8 bugs/day saves **~1 hour/day**; a 5-person team **~5 hrs/day**.
- **Consistent, complete bugs:** house-style subject, numbered steps, clear Expected/Actual, correct module/severity/type — every time, by everyone.
- **Real proof, automatically:** the Jam recording is attached and its steps/test-data extracted.
- **Right developer, automatically:** assignee suggested from the ticket.
- **Closes the QA loop both ways:** an existing **TestRail case is failed with a note** in the correct run; if **no case exists**, a new one is **created and added to the plan** — so coverage keeps growing.
- **Bulk capture:** one video → many bugs in minutes.
- **Per-user identity:** every bug/result is attributed to the actual tester (their own keys).
- **Safe:** passwords masked; keys stay local; a TestRail/AI hiccup never blocks bug creation.
- **Zero-friction updates:** a new version **auto-replaces** the old one on the same URL — no manual "End Task".

---

## 6. Updating the tool

Just **re-download and run** the latest `BIS-Bug-Reporter.exe` (http://10.1.0.20/BIS-Bug-Reporter.exe). On launch it tells any older copy to step aside and takes over the normal port — **no Task Manager, no leftover instance**. (One-time only: machines still on a *pre-this-version* build need the old copy closed once.)

---

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| Window flashes and closes | Almost always an old copy already running. The current build auto-uses another port; if needed, close old `BIS-Bug-Reporter.exe` in Task Manager. A startup log is written to `%APPDATA%\bis-bug-reporter\startup.log`. |
| "Windows protected your PC" | Unsigned exe — click **More info → Run anyway**, or right-click the exe → Properties → **Unblock**. |
| AI polish / bulk split / TestRail fail "can't reach server" | Those features call the dashboard backend — be on the company network (reachable at `http://10.1.0.20:8000`). Manual bug creation works offline. |
| Shows an old UI | Re-download the latest exe and hard-refresh the page (Ctrl+F5). |

---

## 8. Future: logging bugs inside PM tickets

**Question:** *We're planning to log bugs in PM, inside each ticket. Can we keep using this tool?*

**Yes — with configuration/adapter changes, not a rewrite.** The tool is built in two layers:

1. **Content engine** (unchanged): Jam → fields, TestRail-case fill, AI polish, bulk split, test-data + password masking, developer suggestion. All of this is independent of *where* the bug is stored.
2. **A thin "create" adapter** that currently posts to Redmine.

To log bugs **into a PM ticket** instead of (or in addition to) Redmine, we add a **PM adapter** behind a target setting:

- **New setting:** `bug_target: redmine | pm` (and optionally `both`), chosen in ⚙ Settings.
- **PM credentials:** a **per-user PM API token** (same pattern as the Redmine/Jam/TestRail keys), stored locally.
- **PM create endpoint:** post the bug under its ticket via PM's API (e.g. a sub-item/bug under the ticket, or a structured entry on the ticket). We already comment on PM tickets today, so the channel exists.
- **Field mapping:** map the tool's fields (subject, steps, expected, actual, test data, severity, environment, proof link, assignee) to PM's bug schema — one small mapping table.

**What stays exactly the same for testers:** the whole experience — Jam fill, TestRail-case fill, AI polish, bulk, test-data, and even the **TestRail "mark Failed"** step. Only the final destination of the created bug changes.

**Things to confirm when PM bug-logging is ready:**
- Does PM expose a **bug/sub-item under a ticket** (preferred) or should bugs be logged as a structured **comment**? This decides the exact PM endpoint + field map.
- Should dashboard analytics (currently fed by the **Redmine** sync) also read PM-logged bugs, or do we keep Redmine as the analytics source during transition? (May warrant `both` mode for a while.)
- Per-user PM tokens vs. a shared service token for attribution.

In short: the heavy lifting (turning a recording/notes into a clean bug) is reusable as-is; pointing it at PM is a contained adapter + config change.

---

*Questions or tweaks: reach out to Vishnu / the QA tooling owner.*
