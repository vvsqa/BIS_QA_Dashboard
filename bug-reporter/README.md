# BIS Bug Reporter

A small **standalone tool** that lets the QA team file Redmine bugs fast — with an
optional **AI polish** that turns a rough note into a complete, ready-to-file bug.
Each bug is created under **your own Redmine identity** (your API key), so authorship
and notifications work exactly as if you'd filed it in Redmine by hand.

Bugs created here carry the PM **Ticket ID** custom field, so they show up on the QA
dashboard automatically on the next Redmine sync.

---

## For testers — first run

1. Double-click **`Launch BIS Bug Reporter.cmd`** (or **`BIS-Bug-Reporter.exe`**
   directly). It opens a page in your browser (`http://127.0.0.1:8765`).
   Keep the little window open while you use the tool; closing it stops the tool.
2. Click **⚙ Settings** → enter your **name** and your **Redmine API key**, then Save.
   - Get your key from Redmine → top-right avatar → **My account** → **API access key**
     (right side; click *Show*). Copy it.
   - The key is stored **only on your machine** (`%APPDATA%\bis-bug-reporter\config.json`)
     and is sent **only to Redmine**, never to our server.
3. (Optional) open **Advanced** and set your usual Platform / OS / Browser, then
   *Save as my defaults* so you never retype them.

## Filing a bug — two ways

**Fast + AI (recommended):**
1. Type the **PM Ticket ID** and a **rough note** of what happened.
2. Click **✨ Polish with AI** — it fills the subject, steps, expected/actual,
   severity, type, and (when your note implies them) environment/platform/browser.
3. Review, paste your **Jam link**, click **Create bug in Redmine**.

**Manual (no AI / server offline):** just fill the fields yourself and Create. All
field definitions are cached locally after the first online run, so creating a bug
does **not** need the dashboard server — only the AI polish does.

## My Pending Retests

The **My Pending Retests** tab lists *your own* bugs that developers have released
back to QA (status *Released to QA* / *Reopened*) so you know what to re-verify.
Filter by **Ticket ID**. Click any row to open it in Redmine.

---

## For the admin — building / distributing

- Build the EXE: run **`build.cmd`** (needs Python + pip on the build machine).
  Output: `dist\BIS-Bug-Reporter.exe`. Distribute that single file (e.g. shared folder).
- Network needs on a tester machine:
  - **Redmine** (`https://redmine.bissafety.app`) — for metadata + creating bugs + retests.
  - **Dashboard server** (`http://10.1.0.20:8000`) — **only** for the optional AI polish.
- The dashboard server provides two endpoints this tool uses:
  - `GET /bug-meta` — Redmine custom-field id map + allowed values + tracker/status ids
    (needs the admin Redmine key, which testers don't have).
  - `POST /bug-draft` — turns a rough note into a structured draft (Claude; falls back
    to a plain template when the LLM is off).

## Dev run (without building)

```
pip install -r requirements.txt
python app.py
```
