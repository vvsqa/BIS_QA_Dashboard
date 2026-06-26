# -*- coding: utf-8 -*-
"""Single-page UI for BIS Bug Reporter (served by app.py)."""

HTML_PAGE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>BIS Bug Reporter</title>
<style>
  :root{
    --bg:#0e1116; --panel:#161b22; --panel2:#1c2330; --line:#2a313c;
    --txt:#e6edf3; --muted:#8b97a7; --acc:#3b82f6; --acc2:#60a5fa;
    --ok:#22c55e; --warn:#f59e0b; --bad:#ef4444; --chip:#222b39;
  }
  /* ---- theme selector palettes (applied via html[data-theme=...]) ---- */
  html[data-theme="light"]{
    --bg:#f4f6f9; --panel:#ffffff; --panel2:#eef2f6; --line:#d4dae2;
    --txt:#1f2430; --muted:#5b6675; --acc:#2563eb; --acc2:#1d4ed8;
    --ok:#15803d; --warn:#b45309; --bad:#dc2626; --chip:#e6ebf1;
  }
  html[data-theme="midnight"]{
    --bg:#0b1020; --panel:#131a2e; --panel2:#1a2440; --line:#2a3658;
    --txt:#e6ebf5; --muted:#8a94b0; --acc:#7c3aed; --acc2:#a78bfa; --chip:#1f2a48;
  }
  html[data-theme="forest"]{
    --bg:#0c1413; --panel:#14201d; --panel2:#1a2a26; --line:#2a3d38;
    --txt:#e3efe9; --muted:#8aa39a; --acc:#14b8a6; --acc2:#2dd4bf; --chip:#1d2e29;
  }
  html[data-theme="light"] body::before{ opacity:.20; }   /* dim the aurora on the light theme */
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;overflow-x:hidden}
  /* Animated aurora background — slow drifting colour blobs behind the content. */
  body::before{content:"";position:fixed;inset:-20%;z-index:0;pointer-events:none;filter:blur(70px);opacity:.5;
    background:
      radial-gradient(38% 38% at 18% 22%, rgba(124,58,237,.40), transparent 70%),
      radial-gradient(34% 34% at 82% 18%, rgba(59,130,246,.38), transparent 70%),
      radial-gradient(40% 40% at 70% 85%, rgba(34,197,94,.22), transparent 70%),
      radial-gradient(34% 34% at 25% 88%, rgba(236,72,153,.22), transparent 70%);
    animation:aurora 22s ease-in-out infinite alternate}
  @keyframes aurora{
    0%{transform:translate3d(0,0,0) scale(1)}
    50%{transform:translate3d(2%,-2%,0) scale(1.08)}
    100%{transform:translate3d(-2%,2%,0) scale(1.04)}}
  .wrap{max-width:960px;margin:0 auto;padding:18px 20px 60px;position:relative;z-index:1}
  header{display:flex;align-items:center;gap:12px;margin-bottom:14px}
  header h1{font-size:18px;margin:0;font-weight:800;letter-spacing:.2px;
    background:linear-gradient(90deg,#a78bfa,#60a5fa,#34d399,#60a5fa,#a78bfa);
    background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;
    animation:titleflow 8s linear infinite}
  @keyframes titleflow{to{background-position:300% 0}}
  header h1 .bug{display:inline-block;-webkit-text-fill-color:initial;color:initial;transform-origin:60% 80%;animation:wiggle 3.2s ease-in-out infinite}
  @keyframes wiggle{0%,86%,100%{transform:rotate(0)}90%{transform:rotate(-14deg)}94%{transform:rotate(12deg)}98%{transform:rotate(-6deg)}}
  header .who{margin-left:auto;color:var(--muted);font-size:12.5px}
  header .who b{color:var(--acc2)}
  .iconbtn{background:var(--panel2);border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12.5px}
  .iconbtn:hover{border-color:var(--acc)}
  .tabs{display:flex;gap:6px;margin-bottom:14px}
  .tab{padding:8px 16px;border-radius:999px;background:var(--panel);border:1px solid var(--line);cursor:pointer;color:var(--muted);font-weight:600;font-size:13px}
  .tab.on{background:var(--acc);border-color:var(--acc);color:#fff}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:14px}
  .card h2{font-size:13px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:0 0 12px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
  .full{grid-column:1/-1}
  label{display:block;font-size:12px;color:var(--muted);margin:0 0 4px;font-weight:600}
  label .req{color:var(--bad);margin-left:3px}
  input,select,textarea{width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:9px;color:var(--txt);padding:9px 10px;font:inherit;outline:none}
  input:focus,select:focus,textarea:focus{border-color:var(--acc)}
  textarea{resize:vertical;min-height:84px;white-space:pre-wrap;overflow-wrap:break-word;line-height:1.5}
  input{text-overflow:ellipsis}
  .hint{font-size:11.5px;color:var(--muted);margin-top:3px}
  .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .btn{background:var(--acc);border:none;color:#fff;border-radius:10px;padding:11px 20px;font-weight:700;cursor:pointer;font-size:14px}
  .btn:hover{background:var(--acc2)} .btn:disabled{opacity:.5;cursor:default}
  .btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--txt)}
  .btn.ai{background:linear-gradient(90deg,#7c3aed,#3b82f6)}
  .adv summary{cursor:pointer;color:var(--muted);font-weight:600;font-size:12.5px;margin-bottom:8px}
  .toast{position:fixed;left:50%;transform:translateX(-50%);bottom:24px;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px 18px;max-width:80%;box-shadow:0 8px 30px rgba(0,0,0,.5);display:none;z-index:50}
  .toast.ok{border-color:var(--ok)} .toast.bad{border-color:var(--bad)} .toast.show{display:block}
  .toast a{color:var(--acc2)}
  .modal{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;z-index:40}
  .modal.show{display:flex}
  .modal .card{max-width:520px;width:92%;margin:0}
  .rt{display:flex;flex-direction:column;gap:8px}
  .rt .item{display:flex;gap:12px;align-items:center;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
  .rt .item:hover{border-color:var(--acc)}
  .rt .sev{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--chip);white-space:nowrap}
  .sev.Crash,.sev.Critical{background:#3a1416;color:#fca5a5}
  .sev.Major{background:#3a2a12;color:#fcd34d}
  .sev.Minor{background:#13314a;color:#93c5fd}
  .rt .id{font-weight:700;color:var(--acc2)}
  .rt .sub{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rt .st{font-size:11px;color:var(--muted);white-space:nowrap}
  .empty{color:var(--muted);text-align:center;padding:24px}
  .spin{display:inline-block;width:14px;height:14px;border:2px solid var(--line);border-top-color:var(--acc);border-radius:50%;animation:sp .7s linear infinite;vertical-align:-2px}
  @keyframes sp{to{transform:rotate(360deg)}}
  .src{font-size:11px;color:var(--muted)}
  @keyframes aifill{0%{background:#1d3a5f;border-color:var(--acc2)}100%{background:var(--panel2);border-color:var(--line)}}
  .ai-filled{animation:aifill 1.6s ease-out}

  /* ---- graphics & motion polish ---- */
  .iconbtn,.tab,.btn,.card,.rt .item,input,select,textarea{transition:background .2s,border-color .2s,color .2s,transform .15s,box-shadow .2s}
  .card{position:relative;overflow:hidden;backdrop-filter:blur(2px);box-shadow:0 6px 20px rgba(0,0,0,.25);animation:fadeUp .5s both}
  /* thin accent sheen along the top of each card */
  .card::before{content:"";position:absolute;left:0;top:0;height:2px;width:100%;
    background:linear-gradient(90deg,transparent,var(--acc),#a78bfa,transparent);opacity:.55}
  .card:nth-of-type(1){animation-delay:.04s}.card:nth-of-type(2){animation-delay:.1s}
  .card:nth-of-type(3){animation-delay:.16s}.card:nth-of-type(4){animation-delay:.22s}
  @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  .tab{transition:background .2s,border-color .2s,color .2s,transform .15s}
  .tab:hover{transform:translateY(-1px);color:var(--txt)}
  .tab.on{box-shadow:0 4px 14px rgba(59,130,246,.35)}
  .btn:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(59,130,246,.35)}
  .btn:active{transform:translateY(0)}
  .iconbtn:hover{transform:translateY(-1px)}
  /* AI / Fill buttons: living gradient + sweeping shimmer */
  .btn.ai{background:linear-gradient(90deg,#7c3aed,#3b82f6,#7c3aed);background-size:200% 100%;
    animation:aiflow 4s linear infinite;position:relative;overflow:hidden}
  .btn.ai:hover{box-shadow:0 6px 22px rgba(124,58,237,.5)}
  @keyframes aiflow{to{background-position:200% 0}}
  .btn.ai::after{content:"";position:absolute;top:0;left:-60%;width:40%;height:100%;
    background:linear-gradient(100deg,transparent,rgba(255,255,255,.35),transparent);
    transform:skewX(-18deg);animation:sheen 3.2s ease-in-out infinite}
  @keyframes sheen{0%,60%{left:-60%}100%{left:130%}}
  /* progress-style bar shown on the AI button while it works (toggled via .working) */
  .btn.ai.working{cursor:progress}
  @media (prefers-reduced-motion:reduce){
    *,*::before,*::after{animation:none!important;transition:none!important}
  }
</style>
</head>
<body>
<script>/* apply the saved theme before render to avoid a flash */
try{ document.documentElement.setAttribute('data-theme', localStorage.getItem('bugrep_theme')||'dark'); }catch(e){}</script>
<div class="wrap">
  <header>
    <h1><span class="bug">🐞</span> BIS Bug Reporter</h1>
    <div class="who" id="who"></div>
    <select class="iconbtn" id="themeSel" onchange="setTheme(this.value)" title="Theme" style="padding:6px 8px;cursor:pointer">
      <option value="dark">🌙 Dark</option>
      <option value="light">☀ Light</option>
      <option value="midnight">🌌 Midnight</option>
      <option value="forest">🌿 Forest</option>
    </select>
    <button class="iconbtn" onclick="window.open('/guide','_blank')" title="Open the user guide (PDF)">📖 User Guide</button>
    <button class="iconbtn" id="updateBtn" onclick="applyUpdate()" title="Check for and install the latest version" style="display:none"></button>
    <button class="iconbtn" onclick="openSettings()">⚙ Settings</button>
  </header>

  <div class="tabs">
    <div class="tab on" id="tabCreate" onclick="showTab('create')">Create Bug</div>
    <div class="tab" id="tabBulk" onclick="showTab('bulk')">Bulk · 1 message → many</div>
    <div class="tab" id="tabRetest" onclick="showTab('retest')">My Pending Retests</div>
    <div class="tab" id="tabImpact" onclick="showTab('impact')">📊 Impact</div>
  </div>

  <!-- ============================ CREATE ============================ -->
  <div id="viewCreate">
    <div class="card">
      <h2>① Build the bug <span class="src">(use any one — or any combination — of these)</span></h2>
      <div class="grid">
        <div class="full">
          <label>🎥 Jam video link <span class="src">(optional — real steps, transcript, browser/OS/environment, ticket)</span></label>
          <input id="jam_link" placeholder="https://jam.dev/… (recorded reproduction)" oninput="var z=document.getElementById('jam_link_display'); if(z) z.value=this.value"/>
        </div>
        <div>
          <label>🧪 TestRail Case ID <span class="src">(optional — canonical steps/expected)</span></label>
          <input id="case_id" type="number" placeholder="e.g. 244812" onkeydown="if(event.key==='Enter')fillBug()"/>
        </div>
        <div></div>
        <div class="full">
          <label>📝 Notes / what you saw <span class="src">(optional — anything to add or clarify)</span></label>
          <textarea id="rough" style="min-height:64px" placeholder="e.g. only on Chrome; expected the icon at the end; price=0 → 500 error instead of validation"></textarea>
        </div>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn ai" id="fillBugBtn" onclick="fillBug()">⚡ Fill the bug</button>
        <span class="src" id="fillMsg"></span>
      </div>
      <div class="hint" style="margin-top:6px">Give a Jam link, a test-case ID, notes — or any mix. <b>Fill the bug</b> merges them: canonical steps/expected from the test case, the real reproduction + browser/OS/environment from the Jam, your notes layered on top — then a light AI pass cleans the wording.
        <a href="#" onclick="document.getElementById('jamTip').open=true;return false">narration tips</a></div>
      <details id="jamTip" style="margin-top:6px">
        <summary class="src" style="cursor:pointer">💡 How to narrate your Jam</summary>
        <div class="hint" style="margin-top:6px;line-height:1.6">
          Say the <b>ticket number</b> once, then cue words so Expected/Actual split cleanly:
          <div style="margin-top:6px;padding:8px 10px;background:var(--panel2);border:1px solid var(--line);border-radius:8px">
            "Ticket <b>15017</b>. <b>To reproduce</b>: open Company Settings → System Modules.
            <b>Expected</b>: the boxes shouldn't overlap. <b>But actually</b>: the boxes overlap and the course id is missing."
          </div>
        </div>
      </details>
    </div>

    <div class="card">
      <h2>Bug details</h2>
      <div class="grid">
        <div>
          <label>PM Ticket ID<span class="req">*</span></label>
          <input id="ticket_id" type="number" placeholder="e.g. 20861" oninput="ticketTouched()"/>
          <div class="hint" id="ticketTitle"></div>
        </div>
        <div>
          <label>Parent task <span class="src">(optional — Redmine task #; bug nests under it)</span></label>
          <input id="parent_task_id" type="number" placeholder="e.g. 11262"/>
        </div>
        <div>
          <label>Severity<span class="req">*</span></label>
          <select id="severity"></select>
        </div>
        <div class="full">
          <label>Summary (subject)<span class="req">*</span></label>
          <input id="subject" placeholder="Concise one-line title"/>
        </div>
        <div>
          <label>Environment<span class="req">*</span></label>
          <select id="environment" onchange="syncFailLabel()"></select>
        </div>
        <div>
          <label>Type<span class="req">*</span></label>
          <select id="type"></select>
        </div>
        <div class="full">
          <label>Jam / proof-of-testing link<span class="req">*</span> <span class="src">(from ① above)</span></label>
          <input id="jam_link_display" readonly placeholder="paste the Jam link in ① above" style="opacity:.7" onclick="document.getElementById('jam_link').scrollIntoView()"/>
        </div>
        <div>
          <label>Module</label>
          <select id="module"></select>
        </div>
        <div>
          <label>Assign to (developer)</label>
          <select id="assignee"></select>
        </div>
        <div class="full">
          <label>Steps to Reproduce</label>
          <textarea id="steps" placeholder="1. ...&#10;2. ..."></textarea>
        </div>
        <div class="full">
          <label>Test Data</label>
          <textarea id="test_data" placeholder="Accounts / inputs used (optional)"></textarea>
        </div>
        <div>
          <label>Expected</label>
          <textarea id="expected"></textarea>
        </div>
        <div>
          <label>Actual</label>
          <textarea id="actual"></textarea>
        </div>
      </div>

      <details class="adv" id="advDefaults" style="margin-top:14px">
        <summary>Advanced — defaults (Platform / OS / Browser / Devices / versions)</summary>
        <div class="grid3">
          <div><label>Platform<span class="req">*</span></label><select id="platform"></select></div>
          <div><label>OS<span class="req">*</span></label><select id="os"></select></div>
          <div><label>Browser<span class="req">*</span></label><select id="browser"></select></div>
          <div><label>Devices<span class="req">*</span></label><select id="devices"></select></div>
          <div><label>Build Version<span class="req">*</span></label><select id="build_version"></select></div>
          <div><label>Fix Version (Mobile)<span class="req">*</span></label><select id="fix_version_mobile"></select></div>
        </div>
        <div class="hint" style="margin-top:8px">These remember your choices for next time. <a href="#" onclick="saveDefaults();return false">Save as my defaults</a></div>
      </details>

      <div style="margin-top:14px;padding:9px 11px;border:1px dashed var(--line);border-radius:9px">
        <label style="display:flex;align-items:center;gap:6px;margin:0;color:var(--txt)">
          <input type="checkbox" id="failTr" style="width:auto"/> 🧪 Also mark the TestRail case <b id="failTrEnv">Failed</b> <span class="src">(when a TestRail Case ID is set above)</span>
        </label>
        <input id="tr_run_ref" placeholder="Run id/link — only if the case is in several runs and the environment can't pick" style="width:100%;margin-top:7px"/>
        <label style="display:flex;align-items:center;gap:6px;margin:9px 0 0;color:var(--txt)">
          <input type="checkbox" id="makeTc" style="width:auto"/> ➕ No matching case? Create one in TestRail from this bug &amp; add it to the plan <span class="src">(when no Case ID — for future runs)</span>
        </label>
      </div>
      <div class="row" style="margin-top:14px">
        <button class="btn" id="createBtn" onclick="createBug()">Create bug in Redmine</button>
        <button class="btn ghost" id="clearBtn" onclick="clearForm()">Clear</button>
        <span class="src" id="createMsg"></span>
      </div>
    </div>
  </div>

  <!-- ============================ BULK ============================ -->
  <div id="viewBulk" style="display:none">
    <div class="card">
      <h2>Many bugs from one Jam video <span class="src">(or a typed message) — review each before creating)</span></h2>

      <details class="adv" id="bulkTips" open style="margin-bottom:10px">
        <summary>🎥 Recording tips — how to capture several bugs in one video (important for a clean split)</summary>
        <div class="hint" style="line-height:1.7">
          • <b>Number each bug out loud:</b> “<i>Bug one …</i>”, “<i>Next, bug two …</i>”, “<i>Third issue …</i>”. The clear boundary is what lets the AI split them.<br/>
          • For each bug say: <b>what’s wrong</b>, then <b>what should happen</b> (“it should …”), and the <b>area/screen</b>.<br/>
          • If a bug maps to a <b>TestRail case</b>, say its id (“<i>this is case 244812</i>”) or list the ids below <b>in the same order</b> you describe the bugs.<br/>
          • Mention the <b>test data</b> you used (account/role, record, file, values). <b>Don’t read out passwords</b> — they’re masked anyway.<br/>
          • Say the <b>severity</b> if you know it (“minor / cosmetic”, “major”, “crash”). Pause briefly between bugs.
        </div>
      </details>

      <label>🎥 Jam video link <span class="src">(one recording explaining several bugs)</span></label>
      <input id="bulkJam" placeholder="https://jam.dev/… — its narration is split into separate bugs"/>
      <div class="row" style="margin-top:10px">
        <div style="flex:1;min-width:220px"><label>🧪 TestRail Case IDs <span class="src">(optional, comma-separated, in the order the bugs are described)</span></label>
          <input id="bulkCases" placeholder="e.g. 244812, 244813, 244820"/></div>
      </div>
      <label style="margin-top:10px">📝 Extra notes <span class="src">(optional — typed description; works with or instead of the video)</span></label>
      <textarea id="bulkMsg" style="min-height:90px" placeholder="e.g. Ticket 20861, staging, Chrome. Anything to add or clarify per bug."></textarea>

      <div class="row" style="margin-top:10px">
        <input id="bulkTicket" type="number" placeholder="Default Ticket ID (optional)" style="max-width:200px"/>
        <input id="bulkParent" type="number" placeholder="Parent task # (optional — nests all bugs)" style="max-width:260px"/>
        <input id="bulkMax" type="number" placeholder="# bugs (optional)" style="max-width:150px"/>
      </div>
      <div class="row" style="margin-top:10px">
        <label style="display:flex;align-items:center;gap:6px;margin:0;color:var(--txt)"><input type="checkbox" id="bulkAi" checked style="width:auto"/> Use AI to split into bugs <span class="src">(Claude; off = one bug per test-case id)</span></label>
        <button class="btn ai" id="parseBtn" onclick="parseBulk()">⚡ Split into bugs</button>
        <span class="src" id="bulkInfo"></span>
      </div>
      <div class="hint" style="margin-top:6px">The video’s narration (and any case ids) are split into separate, editable bugs — each one shares the same Jam link as its proof. Review &amp; edit below, then Create all.</div>
    </div>
    <div id="bulkList"></div>
    <div class="card" id="bulkActions" style="display:none">
      <div class="row">
        <button class="btn" id="createAllBtn" onclick="createAll()">✓ Create all selected</button>
        <button class="iconbtn" onclick="renderBulk([]);document.getElementById('bulkActions').style.display='none'">Clear results</button>
        <span class="src" id="createAllMsg" style="margin-left:auto"></span>
      </div>
    </div>
  </div>

  <!-- ============================ RETEST ============================ -->
  <div id="viewRetest" style="display:none">
    <div class="card">
      <h2>My pending retests <span class="src">(bugs dev released back to you)</span></h2>
      <div class="row" style="margin-bottom:12px">
        <input id="rtTicket" type="number" placeholder="Filter by Ticket ID (optional)" style="max-width:240px" onkeydown="if(event.key==='Enter')loadRetests()"/>
        <button class="btn ghost" onclick="loadRetests()">Refresh</button>
        <button class="iconbtn" onclick="document.getElementById('rtTicket').value='';loadRetests()">Clear</button>
        <span class="src" id="rtCount" style="margin-left:auto"></span>
      </div>
      <div class="rt" id="rtList"><div class="empty">Loading…</div></div>
    </div>
  </div>

  <!-- ============================ IMPACT ============================ -->
  <div id="viewImpact" style="display:none">
    <div class="card" style="margin-bottom:14px">
      <div class="row"><h2 style="margin:0">📊 Impact — usage &amp; time saved</h2>
        <button class="btn ghost" style="margin-left:auto" onclick="loadImpact()">↻ Refresh</button></div>
    </div>
    <div id="impactBody"><div class="empty">Loading…</div></div>
  </div>
</div>

<!-- Settings modal -->
<div class="modal" id="settings">
  <div class="card">
    <h2>Settings</h2>
    <div class="grid">
      <div class="full">
        <label>Redmine API key<span class="req">*</span> <span class="src">(Redmine → My account → API access key)</span></label>
        <input id="cf_key" placeholder="paste your key — leave blank to keep existing"/>
        <div class="hint" id="keyState"></div>
      </div>
      <div class="full"><label>You</label><div id="cf_whoami" class="hint" style="font-size:13px">— your name is fetched automatically from this key —</div></div>
      <div class="full">
        <label>Jam token (PAT) <span class="src">(jam.dev → Settings → Integrations → AI Agents)</span></label>
        <input id="cf_jam" placeholder="jam_pat_… — leave blank to keep existing"/>
        <div class="hint" id="jamState"></div>
      </div>
      <div><label>TestRail email <span class="src">(for failing a case under your name)</span></label>
        <input id="cf_tremail" placeholder="you@bispartners.ca"/></div>
      <div><label>TestRail API key <span class="src">(TestRail → My Settings → API Keys)</span></label>
        <input id="cf_trkey" placeholder="leave blank to keep existing"/>
        <div class="hint" id="trState"></div></div>
      <div><label>Redmine URL</label><input id="cf_redmine"/></div>
      <div><label>Dashboard URL (for AI)</label><input id="cf_dash"/></div>
    </div>
    <div class="row" style="margin-top:14px">
      <button class="btn" id="saveSetBtn" onclick="saveSettings()">Save</button>
      <button class="btn ghost" onclick="closeSettings()">Close</button>
      <span class="src" id="setMsg"></span>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const $ = id => document.getElementById(id);
let META=null, CFG=null;
const SELECTS=['severity','environment','type','module','platform','os','browser','devices','build_version','fix_version_mobile'];
const FIELDKEY={severity:'severity',environment:'environment',type:'type',module:'module',platform:'platform',os:'os',browser:'browser',devices:'devices',build_version:'build_version',fix_version_mobile:'fix_version_mobile'};

function toast(msg,kind){const t=$('toast');t.className='toast show '+(kind||'');t.innerHTML=msg;clearTimeout(t._t);t._t=setTimeout(()=>t.className='toast',kind==='bad'?9000:6000);}
function flash(id){const el=$(id); if(!el) return; el.classList.remove('ai-filled'); void el.offsetWidth; el.classList.add('ai-filled');}

function fillSelect(id,values,sel){
  const el=$(id); if(!el) return;
  el.innerHTML='';
  if(id==='module'||id==='type'||id==='severity'){const o=document.createElement('option');o.value='';o.textContent='—';el.appendChild(o);}
  (values||[]).forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;el.appendChild(o);});
  if(sel && (values||[]).includes(sel)) el.value=sel;
}

async function boot(){
  try{ CFG=await (await fetch('/config')).json(); }catch(e){ CFG={}; }
  $('who').innerHTML = CFG.tester_name ? ('Reporting as <b>'+CFG.tester_name+'</b>') : '<span style="color:#f59e0b">⚠ set your name & API key in Settings</span>';
  try{
    META=await (await fetch('/meta')).json();
    const f=META.fields||{};
    SELECTS.forEach(s=>{
      const info=f[FIELDKEY[s]]||{};
      const def=(CFG.defaults||{})[s];
      fillSelect(s, info.values||[], def);
    });
    fillAssignee('assignee');
    if($('module')) $('module').value='';
    if($('type') && (CFG.defaults||{}).type) {}
    syncFailLabel();
  }catch(e){
    toast('Could not load Redmine field definitions: '+(e.message||e)+'. Connect to the network once.','bad');
  }
  if(!CFG.key_set){ openSettings(); }
  checkUpdate();
}

/* ---- self-update ---- */
let UPDATE=null;
async function checkUpdate(){
  try{
    const d=await (await fetch('/update/check')).json();
    UPDATE=d;
    const b=$('updateBtn'); if(!b) return;
    if(d.available && d.frozen){
      b.style.display='';
      b.textContent='⬆ Update to '+d.latest;
      b.title=(d.notes||('Version '+d.latest+' is available'))+' — click to install';
    }else{
      b.style.display='none';
    }
  }catch(e){ /* offline / older server — silently skip */ }
}
async function applyUpdate(){
  if(!UPDATE||!UPDATE.available) return;
  const b=$('updateBtn');
  if(!confirm('Update BIS Bug Reporter to '+UPDATE.latest+'?\n\n'+(UPDATE.notes||'')+'\n\nThe app will download the new version and restart.')) return;
  b.disabled=true; b.textContent='⬇ Downloading…';
  try{
    const r=await fetch('/update/apply',{method:'POST'});
    const d=await r.json();
    if(!r.ok) throw new Error(d.detail||r.statusText);
    b.textContent='✓ Restarting…';
    toast('Updating to '+d.version+' — the app will reopen in a moment. You can close this tab.','ok');
  }catch(e){
    b.disabled=false; b.textContent='⬆ Update to '+UPDATE.latest;
    toast('Update failed: '+(e.message||e),'bad');
  }
}

function ticketTouched(){ clearTimeout(window._tt); window._tt=setTimeout(fetchTicketTitle,500); }
async function fetchTicketTitle(){ /* title is shown after AI polish; keep light here */ }

async function fillForm(useAi){
  const note=$('rough').value.trim();
  if(!note){ toast('Type a rough note first.','bad'); return; }
  const b1=$('fillBtn'), b2=$('polishBtn'); b1.disabled=true; b2.disabled=true;
  $('polishMsg').innerHTML='<span class="spin"></span> '+(useAi?'asking Claude…':'reading ticket data…');
  try{
    const body={rough_note:note, ticket_id: $('ticket_id').value? parseInt($('ticket_id').value):null, severity: $('severity').value||null, use_ai:!!useAi};
    const r=await fetch('/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!r.ok){ const e=await r.json().catch(()=>({})); throw new Error(e.detail||r.statusText); }
    const d=await r.json();
    const put=(id,v)=>{ if(v && $(id)){ $(id).value=v; flash(id); } };
    put('subject',d.subject); put('steps',d.steps); put('test_data',d.test_data); put('expected',d.expected); put('actual',d.actual);
    if(d.ticket_id && $('ticket_id') && !$('ticket_id').value){ $('ticket_id').value=d.ticket_id; flash('ticket_id'); }
    const setIf=(id,v)=>{ if(v && $(id) && [...$(id).options].some(o=>o.value===v)){ $(id).value=v; flash(id); return true; } return false; };
    setIf('severity',d.severity); setIf('type',d.type); setIf('module',d.module); setIf('environment',d.environment);
    const advTouched=[setIf('platform',d.platform),setIf('os',d.os),setIf('browser',d.browser)].some(Boolean);
    if(advTouched){ var adv=document.getElementById('advDefaults'); if(adv) adv.open=true; }
    if(d.assigned_to_id && $('assignee')){ $('assignee').value=String(d.assigned_to_id); flash('assignee'); }
    const tr=d.testrail||{};
    const trMsg = (tr.manual_cases!=null||tr.automated_cases!=null) ? (' · TestRail: '+(tr.manual_cases||0)+' manual / '+(tr.automated_cases||0)+' automated') : '';
    if(d.ai){ $('polishMsg').textContent='✓ AI filled the form — review/edit every field, add your Jam link, then Create.'+trMsg; }
    else if(d.ai_unavailable||d.ai_failed){ $('polishMsg').textContent='⚠ AI unavailable — filled from ticket data instead. Review & edit.'+trMsg; }
    else{ $('polishMsg').textContent='✓ Filled from ticket data (no AI) — review & edit, then Create.'+trMsg; }
  }catch(e){
    $('polishMsg').textContent=''; toast((useAi?'AI polish':'Auto-fill')+' failed: '+(e.message||e)+'. You can still fill the form manually — create works.','bad');
  }finally{ b1.disabled=false; b2.disabled=false; }
}

async function loadCase(){
  const cid=val('case_id');
  if(!cid){ toast('Enter a TestRail Case ID first.','bad'); return; }
  const btn=$('caseBtn'); btn.disabled=true; $('caseMsg').innerHTML='<span class="spin"></span> loading case…';
  try{
    const r=await fetch('/case?case_id='+encodeURIComponent(cid));
    const d=await r.json();
    if(!r.ok) throw new Error(d.detail||r.statusText);
    const put=(id,v)=>{ if(v && $(id)){ $(id).value=v; flash(id); } };
    put('subject',d.subject); put('steps',d.steps); put('expected',d.expected); put('test_data',d.test_data);
    if(d.ticket_id){ $('ticket_id').value=d.ticket_id; flash('ticket_id'); }
    const setIf=(id,v)=>{ if(v && $(id) && [...$(id).options].some(o=>o.value===v)){ $(id).value=v; flash(id); return true; } return false; };
    if(setIf('platform',d.platform)){ var adv=document.getElementById('advDefaults'); if(adv) adv.open=true; }
    $('caseMsg').textContent='✓ Loaded "'+(d.title||('case '+cid))+'" — add what went wrong in Actual + your Jam link, pick severity, Create.';
  }catch(e){ $('caseMsg').textContent=''; toast('Could not load case: '+(e.message||e),'bad'); }
  finally{ btn.disabled=false; }
}

async function loadJam(){
  const link=val('jam_link');
  if(!link){ toast('Paste a Jam link first.','bad'); return; }
  const btn=$('jamBtn'); btn.disabled=true; $('jamMsg').innerHTML='<span class="spin"></span> reading the Jam recording (video + audio)…';
  const setIf=(id,v)=>{ if(v && $(id) && [...$(id).options].some(o=>o.value===v)){ $(id).value=v; flash(id); return true; } return false; };
  const put=(id,v)=>{ if(v && $(id)){ $(id).value=v; flash(id); } };
  try{
    const note=val('rough');
    const r=await fetch('/jam?link='+encodeURIComponent(link)+(note?('&note='+encodeURIComponent(note)):''));
    const d=await r.json();
    if(!r.ok) throw new Error(d.detail||r.statusText);
    // every field straight from the recording + your note — NO AI
    if(d.ticket_id && $('ticket_id') && !$('ticket_id').value){ $('ticket_id').value=d.ticket_id; flash('ticket_id'); }
    put('subject',d.subject); put('steps',d.steps); put('expected',d.expected); put('actual',d.actual);
    setIf('environment',d.environment); setIf('severity',d.severity); setIf('type',d.type); setIf('module',d.module);
    setIf('platform',d.platform); setIf('os',d.os); setIf('browser',d.browser);
    if(d.platform||d.os||d.browser){ var aa=document.getElementById('advDefaults'); if(aa) aa.open=true; }
    if(d.jam_id && $('jam_link_display')) $('jam_link_display').value=val('jam_link');
    $('jamMsg').textContent='✓ Filled from the recording'+(note?' + your note':'')+' — formatting steps…';
    // minimal AI formatting pass: numbers the steps + tidies the title (fast; rule fallback if AI off)
    try{
      const fr=await fetch('/format',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subject:val('subject'),steps:val('steps'),expected:val('expected'),actual:val('actual')})});
      const f=await fr.json();
      if(fr.ok){ put('subject',f.subject); put('steps',f.steps); put('expected',f.expected); put('actual',f.actual);
        $('jamMsg').textContent='✓ Filled from the recording'+(note?' + note':'')+(f.ai?', steps formatted with AI':'')+' — review & Create.'; }
      else { $('jamMsg').textContent='✓ Filled from the recording — review & Create.'; }
    }catch(_){ $('jamMsg').textContent='✓ Filled from the recording — review & Create.'; }
  }catch(e){ $('jamMsg').textContent=''; toast('Jam load failed: '+(e.message||e),'bad'); }
  finally{ btn.disabled=false; }
}

function val(id){ return ($(id).value||'').trim(); }

// Unified combiner: Jam link + TestRail case ID + notes — any one, or any mix.
async function fillBug(){
  const link=val('jam_link'), caseId=val('case_id'), note=val('rough');
  if(!link && !caseId && !note){ toast('Add a Jam link, a TestRail case ID, or some notes first.','bad'); return; }
  if(!window._fillStart) window._fillStart=Date.now();   // start the fill->create timer (for time-saved stats)
  const btn=$('fillBugBtn'); btn.disabled=true; $('fillMsg').innerHTML='<span class="spin"></span> building the bug…';
  const put=(id,v)=>{ if(v && $(id)){ $(id).value=v; flash(id); } };
  const setIf=(id,v)=>{ if(v && $(id) && [...$(id).options].some(o=>o.value===v)){ $(id).value=v; flash(id); return true; } return false; };
  const m={}; const used=[];
  try{
    // 1) TestRail case -> canonical steps / expected / test data / ticket / platform / subject
    if(caseId){
      const r=await fetch('/case?case_id='+encodeURIComponent(caseId)); const d=await r.json();
      if(r.ok){ m.subject=d.subject; m.steps=d.steps; m.expected=d.expected; m.test_data=d.test_data; m.ticket_id=d.ticket_id; m.platform=d.platform; used.push('test case'); }
      else toast('Case: '+(d.detail||r.statusText),'bad');
    }
    // 2) Jam -> actual(transcript)+env/browser/os+ticket+severity/type/module; steps/expected only if the case didn't supply them
    if(link){
      const r=await fetch('/jam?link='+encodeURIComponent(link)+(note?('&note='+encodeURIComponent(note)):'')); const d=await r.json();
      if(r.ok){
        m.actual=d.actual; m.environment=d.environment; m.browser=d.browser; m.os=d.os;
        // Test Data: keep the TestRail case's canonical data if present, and append the concrete
        // values observed in the recording (account/files/dates/volumes — password masked).
        if(d.test_data){ m.test_data = m.test_data ? (m.test_data+'\n\nObserved in recording:\n'+d.test_data) : d.test_data; }
        m.severity=m.severity||d.severity; m.type=m.type||d.type; m.module=m.module||d.module;
        m.subject=m.subject||d.subject; m.platform=m.platform||d.platform; m.ticket_id=m.ticket_id||d.ticket_id;
        if(!m.steps) m.steps=d.steps; if(!m.expected) m.expected=d.expected;
        m._jam=d.jam_id; used.push('Jam');
      } else toast('Jam: '+(d.detail||r.statusText),'bad');
    }
    // 3) notes-only (no jam, no case) -> rule auto-fill from the note
    if(!link && !caseId && note){
      const r=await fetch('/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rough_note:note, ticket_id: val('ticket_id')?parseInt(val('ticket_id')):null, use_ai:false})});
      const d=await r.json();
      if(r.ok){ ['subject','steps','expected','actual','severity','type','module','environment','platform'].forEach(k=>{ if(d[k]) m[k]=d[k]; }); m.ticket_id=m.ticket_id||d.ticket_id; used.push('notes'); }
    }
    // notes + case (no jam): the note is what was observed -> Actual
    if(note && !m.actual) m.actual=note;
    // apply merged
    if(m.ticket_id && !val('ticket_id')){ $('ticket_id').value=m.ticket_id; flash('ticket_id'); }
    put('subject',m.subject); put('steps',m.steps); put('expected',m.expected); put('actual',m.actual); put('test_data',m.test_data);
    setIf('severity',m.severity); setIf('type',m.type); setIf('module',m.module); setIf('environment',m.environment);
    const adv=[setIf('platform',m.platform),setIf('os',m.os),setIf('browser',m.browser)].some(Boolean);
    if(adv){ var a=document.getElementById('advDefaults'); if(a) a.open=true; }
    if(m._jam && $('jam_link_display')) $('jam_link_display').value=val('jam_link');
    if(!used.length){ $('fillMsg').textContent=''; return; }
    $('fillMsg').textContent='✓ Filled from '+used.join(' + ')+' — formatting…';
    // 4) minimal AI format pass — numbers steps + tidies wording (rule fallback if AI off)
    try{
      const fr=await fetch('/format',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subject:val('subject'),steps:val('steps'),expected:val('expected'),actual:val('actual')})});
      const f=await fr.json();
      if(fr.ok){ put('subject',f.subject); put('steps',f.steps); put('expected',f.expected); put('actual',f.actual);
        $('fillMsg').textContent='✓ Filled from '+used.join(' + ')+(f.ai?', formatted with AI':'')+' — review & Create.'; }
      else $('fillMsg').textContent='✓ Filled from '+used.join(' + ')+' — review & Create.';
    }catch(_){ $('fillMsg').textContent='✓ Filled from '+used.join(' + ')+' — review & Create.'; }
  }catch(e){ $('fillMsg').textContent=''; toast('Fill failed: '+(e.message||e),'bad'); }
  finally{ btn.disabled=false; }
}

function clearForm(){
  ['case_id','rough','ticket_id','subject','jam_link','steps','test_data','expected','actual'].forEach(i=>{ if($(i)) $(i).value=''; });
  // reset list fields to user defaults, keep severity/type unset
  const f=(META&&META.fields)||{}; const dz=(CFG&&CFG.defaults)||{};
  ['severity','type','module','environment'].forEach(s=>{ if($(s)) $(s).value=(s==='environment'?(dz.environment||''):''); });
  ['platform','os','browser','devices','build_version','fix_version_mobile'].forEach(s=>{ if($(s)&&dz[s]) $(s).value=dz[s]; });
  if($('assignee')) $('assignee').value='';
  if($('fillMsg')) $('fillMsg').textContent=''; if($('createMsg')) $('createMsg').textContent='';
  if($('ticketTitle')) $('ticketTitle').textContent='';
  if($('ticket_id')) $('ticket_id').focus();
}

async function createBug(){
  const req=[['ticket_id','PM Ticket ID'],['subject','Summary'],['severity','Severity'],['environment','Environment'],['type','Type'],['jam_link','Jam link']];
  for(const [id,name] of req){ if(!val(id)){ toast('Missing required: '+name,'bad'); $(id).focus(); return; } }
  const b={
    subject:val('subject'), ticket_id:parseInt(val('ticket_id')), severity:val('severity'),
    environment:val('environment'), type:val('type'), module:val('module'),
    platform:val('platform'), os:val('os'), browser:val('browser'), devices:val('devices'),
    build_version:val('build_version'), fix_version_mobile:val('fix_version_mobile'),
    jam_link:val('jam_link'), steps:val('steps'), test_data:val('test_data'),
    expected:val('expected'), actual:val('actual'),
    assigned_to_id: val('assignee')? parseInt(val('assignee')):null,
    parent_task_id: val('parent_task_id')? parseInt(val('parent_task_id')):null,
    case_id: val('case_id')? parseInt(val('case_id')):null,
    fail_testrail: !!($('failTr') && $('failTr').checked),
    testrail_run_ref: val('tr_run_ref'),
    create_testcase: !!($('makeTc') && $('makeTc').checked),
    source: (function(){ const uj=!!val('jam_link'), uc=!!val('case_id'), un=!!val('rough');
      return (uj&&uc)?'combo':uj?'jam':uc?'case':un?'notes':'manual'; })(),
    tool_seconds: window._fillStart ? Math.round((Date.now()-window._fillStart)/1000) : null
  };
  if(b.fail_testrail && !b.case_id){ toast('To fail a TestRail case, enter a TestRail Case ID first (or untick the option).','bad'); return; }
  if(b.create_testcase && b.case_id){ toast('You already have a Case ID — untick "create a case" (use "mark Failed" instead).','bad'); return; }
  const btn=$('createBtn'); btn.disabled=true; $('createMsg').innerHTML='<span class="spin"></span> creating…';
  try{
    const r=await fetch('/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
    const d=await r.json();
    if(!r.ok) throw new Error(d.detail||r.statusText);
    let extra='';
    if(d.testrail){ extra = d.testrail.ok
      ? ' · 🧪 case '+b.case_id+' marked Failed (<a href="'+(d.testrail.run_url||'#')+'" target="_blank">run</a>)'
      : ' · ⚠ TestRail not updated: '+(d.testrail.error||'failed'); }
    if(d.testcase){ extra += d.testcase.ok
      ? ' · ➕ TestRail case '+d.testcase.case_id+' created & added to '+((d.testcase.added_runs||[]).length)+' run(s) (<a href="'+(d.testcase.case_url||'#')+'" target="_blank">case</a>)'
      : ' · ⚠ Case not created: '+(d.testcase.error||'failed'); }
    const bad = (d.testrail&&!d.testrail.ok)||(d.testcase&&!d.testcase.ok);
    toast('✓ Bug created: <a href="'+d.url+'" target="_blank">#'+d.id+'</a>'+extra, bad?'bad':'ok');
    $('createMsg').innerHTML='Created <a href="'+d.url+'" target="_blank">#'+d.id+'</a>'+extra;
    // reset the bug-specific fields, keep defaults
    ['subject','jam_link','steps','test_data','expected','actual','rough','case_id','tr_run_ref'].forEach(i=>{ if($(i)) $(i).value=''; });
    if($('failTr')) $('failTr').checked=false;
    if($('makeTc')) $('makeTc').checked=false;
    window._fillStart=null;   // reset the fill timer for the next bug
    // If a new TestRail case was just generated, surface its id in the Case ID field (visible + reusable).
    if(d.testcase && d.testcase.ok && d.testcase.case_id && $('case_id')){ $('case_id').value=d.testcase.case_id; flash('case_id'); }
    if($('fillMsg')) $('fillMsg').textContent='';
  }catch(e){
    $('createMsg').textContent=''; toast('Create failed: '+(e.message||e),'bad');
  }finally{ btn.disabled=false; }
}

function syncFailLabel(){ const e=val('environment'); if($('failTrEnv')) $('failTrEnv').textContent = e? ('Failed in '+e) : 'Failed'; }

async function saveDefaults(){
  const defaults={}; ['platform','os','browser','devices','build_version','fix_version_mobile','environment'].forEach(s=>{ if($(s)) defaults[s]=val(s); });
  await fetch('/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tester_name:CFG.tester_name||'',redmine_api_key:'',redmine_url:CFG.redmine_url||'',dashboard_url:CFG.dashboard_url||'',defaults})});
  CFG=await (await fetch('/config')).json();
  toast('✓ Defaults saved','ok');
}

/* ---- bulk (one message -> many bugs) ---- */
let BULK=[];
function opts(values,sel,blank){
  let h = blank?('<option value="">'+blank+'</option>'):'';
  (values||[]).forEach(v=>{ h+='<option value="'+v+'"'+(v===sel?' selected':'')+'>'+v+'</option>'; });
  return h;
}
function fv(k){ return ((META&&META.fields&&META.fields[k])||{}).values||[]; }
function assigneeOptions(sel){
  let h='<option value="">— unassigned —</option>';
  ((META&&META.assignees)||[]).forEach(a=>{ h+='<option value="'+a.id+'"'+(String(a.id)===String(sel)?' selected':'')+'>'+esc(a.name)+(a.role?(' ('+a.role+')'):'')+'</option>'; });
  return h;
}
function fillAssignee(id,sel){ const el=$(id); if(el) el.innerHTML=assigneeOptions(sel); }
function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

async function parseBulk(){
  const jam=val('bulkJam'), cases=val('bulkCases'), notes=val('bulkMsg');
  if(!jam && !notes && !cases){ toast('Add a Jam video link, some notes, or test-case ids first.','bad'); return; }
  const btn=$('parseBtn'); btn.disabled=true;
  let jamTicket=null;
  try{
    // 1) If a Jam video is given, pull its narration and use it as the source the AI splits.
    let parts=[];
    if(jam){
      $('bulkInfo').innerHTML='<span class="spin"></span> watching the video…';
      const r=await fetch('/jam?link='+encodeURIComponent(jam));
      const d=await r.json();
      if(!r.ok) throw new Error('Jam: '+(d.detail||r.statusText));
      jamTicket=d.ticket_id||null;
      if(d.transcript) parts.push('Video narration (the tester walks through SEVERAL bugs in sequence — split them):\n'+d.transcript);
      if(d.steps) parts.push('Observed actions in the recording:\n'+d.steps);
      if(d.test_data) parts.push('Test data observed (password masked):\n'+d.test_data);
    }
    if(notes) parts.push('Additional notes from the tester:\n'+notes);
    if(cases) parts.push('TestRail case ids for these bugs, in the order the bugs are described: '+cases);
    const message=parts.join('\n\n');

    $('bulkInfo').innerHTML='<span class="spin"></span> '+($('bulkAi').checked?'splitting into bugs…':'reading test cases…');
    const body={message:message,
      ticket_id: val('bulkTicket')?parseInt(val('bulkTicket')):(jamTicket||null),
      use_ai:$('bulkAi').checked,
      max_bugs: val('bulkMax')?parseInt(val('bulkMax')):null};
    const r=await fetch('/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    if(!r.ok) throw new Error(d.detail||r.statusText);
    // Every bug came from the same recording -> share its Jam link as proof.
    d.bugs.forEach(b=>{ if(!b.jam_link && jam) b.jam_link=jam; });
    BULK=d.bugs;
    renderBulk(BULK);
    $('bulkInfo').textContent='✓ '+d.count+' bug'+(d.count===1?'':'s')+(jam?' from the video':'')+(d.ai?' (AI split)':' (from test cases)')+' — review & edit, then Create all.';
    $('bulkActions').style.display = d.count? '':'none';
  }catch(e){ $('bulkInfo').textContent=''; toast('Split failed: '+(e.message||e),'bad'); }
  finally{ btn.disabled=false; }
}

function renderBulk(bugs){
  const wrap=$('bulkList'); wrap.innerHTML='';
  bugs.forEach((b,i)=>{
    const c=document.createElement('div'); c.className='card bcard'; c.id='bc'+i;
    c.innerHTML =
      '<div class="row" style="align-items:center;margin-bottom:10px">'+
        '<input type="checkbox" id="b'+i+'_on" checked style="width:auto"/>'+
        '<b style="color:var(--acc2)">Bug '+(i+1)+'</b>'+
        (b.case_id?'<span class="src">· case '+b.case_id+'</span>':'')+
        '<span class="src" id="b'+i+'_st" style="margin-left:auto"></span>'+
      '</div>'+
      '<label>Summary<span class="req">*</span></label><input id="b'+i+'_subject" value="'+esc(b.subject)+'"/>'+
      '<div class="grid3" style="margin-top:8px">'+
        '<div><label>Ticket ID<span class="req">*</span></label><input id="b'+i+'_ticket" type="number" value="'+(b.ticket_id||'')+'"/></div>'+
        '<div><label>Parent task</label><input id="b'+i+'_parent" type="number" placeholder="nests under task #" value="'+(b.parent_task_id||'')+'"/></div>'+
        '<div><label>Severity<span class="req">*</span></label><select id="b'+i+'_severity">'+opts(fv('severity'),b.severity,'—')+'</select></div>'+
        '<div><label>Type<span class="req">*</span></label><select id="b'+i+'_type">'+opts(fv('type'),b.type,'—')+'</select></div>'+
        '<div><label>Environment<span class="req">*</span></label><select id="b'+i+'_environment">'+opts(fv('environment'),b.environment||(CFG.defaults||{}).environment,'—')+'</select></div>'+
        '<div><label>Platform</label><select id="b'+i+'_platform">'+opts(fv('platform'),b.platform||(CFG.defaults||{}).platform,'—')+'</select></div>'+
        '<div><label>Module</label><select id="b'+i+'_module">'+opts(fv('module'),b.module,'—')+'</select></div>'+
        '<div><label>Assign to (developer)</label><select id="b'+i+'_assignee">'+assigneeOptions(b.assigned_to_id)+'</select></div>'+
      '</div>'+
      '<label style="margin-top:8px">Jam link<span class="req">*</span></label><input id="b'+i+'_jam" value="'+esc(b.jam_link)+'" placeholder="https://jam.dev/…"/>'+
      '<details style="margin-top:8px"><summary class="src" style="cursor:pointer">Steps / Expected / Actual</summary>'+
        '<label style="margin-top:6px">Steps</label><textarea id="b'+i+'_steps">'+esc(b.steps)+'</textarea>'+
        '<label>Expected</label><textarea id="b'+i+'_expected">'+esc(b.expected)+'</textarea>'+
        '<label>Actual</label><textarea id="b'+i+'_actual">'+esc(b.actual)+'</textarea>'+
        '<label>Test Data</label><textarea id="b'+i+'_test_data">'+esc(b.test_data)+'</textarea>'+
      '</details>';
    wrap.appendChild(c);
  });
}

async function createAll(){
  const dz=CFG.defaults||{}; let ok=0, fail=0, done=0;
  const idxs=BULK.map((_,i)=>i).filter(i=>$('b'+i+'_on') && $('b'+i+'_on').checked);
  if(!idxs.length){ toast('No bugs selected.','bad'); return; }
  const btn=$('createAllBtn'); btn.disabled=true;
  for(const i of idxs){
    const st=$('b'+i+'_st'); st.innerHTML='<span class="spin"></span>';
    const g=(s)=>($('b'+i+'_'+s)?$('b'+i+'_'+s).value.trim():'');
    const miss=[]; if(!g('ticket'))miss.push('Ticket'); if(!g('subject'))miss.push('Summary'); if(!g('severity'))miss.push('Severity'); if(!g('type'))miss.push('Type'); if(!g('environment'))miss.push('Environment'); if(!g('jam'))miss.push('Jam');
    if(miss.length){ st.textContent='⚠ missing: '+miss.join(', '); st.style.color='#fca5a5'; fail++; done++; continue; }
    const parent = g('parent') ? parseInt(g('parent')) : (val('bulkParent') ? parseInt(val('bulkParent')) : null);
    const body={subject:g('subject'),ticket_id:parseInt(g('ticket')),severity:g('severity'),environment:g('environment'),type:g('type'),module:g('module'),
      platform:g('platform')||dz.platform||'',os:dz.os||'',browser:dz.browser||'',devices:dz.devices||'',build_version:dz.build_version||'',fix_version_mobile:dz.fix_version_mobile||'',
      jam_link:g('jam'),steps:g('steps'),test_data:g('test_data'),expected:g('expected'),actual:g('actual'),
      parent_task_id:parent,
      assigned_to_id:g('assignee')?parseInt(g('assignee')):null, source:'bulk', tool_seconds:null};
    try{
      const r=await fetch('/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const d=await r.json();
      if(!r.ok) throw new Error(d.detail||r.statusText);
      st.innerHTML='✓ <a href="'+d.url+'" target="_blank">#'+d.id+'</a>'; st.style.color='';
      if($('b'+i+'_on')) $('b'+i+'_on').checked=false;
      ok++;
    }catch(e){ st.textContent='✗ '+(e.message||e); st.style.color='#fca5a5'; fail++; }
    done++; $('createAllMsg').textContent=done+'/'+idxs.length+' processed';
  }
  btn.disabled=false;
  toast('Created '+ok+(fail?(' · '+fail+' failed/skipped'):'')+'.', fail?'bad':'ok');
}

/* ---- retests ---- */
function showTab(t){
  $('tabCreate').classList.toggle('on',t==='create');
  $('tabBulk').classList.toggle('on',t==='bulk');
  $('tabRetest').classList.toggle('on',t==='retest');
  if($('tabImpact')) $('tabImpact').classList.toggle('on',t==='impact');
  $('viewCreate').style.display = t==='create'?'':'none';
  $('viewBulk').style.display = t==='bulk'?'':'none';
  $('viewRetest').style.display = t==='retest'?'':'none';
  if($('viewImpact')) $('viewImpact').style.display = t==='impact'?'':'none';
  if(t==='retest') loadRetests();
  if(t==='impact') loadImpact();
}
async function loadImpact(){
  const wrap=$('impactBody'); wrap.innerHTML='<div class="empty"><span class="spin"></span> Loading…</div>';
  try{
    const r=await fetch('/impact-stats');
    const d=await r.json(); if(!r.ok) throw new Error(d.detail||r.statusText);
    const card=(big,lab,sub)=>'<div style="flex:1;min-width:140px;background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:14px 16px"><div style="font-size:26px;font-weight:800;color:var(--acc2)">'+big+'</div><div style="font-size:12px;color:var(--muted)">'+lab+'</div>'+(sub?'<div style="font-size:11px;color:var(--muted);margin-top:3px">'+sub+'</div>':'')+'</div>';
    let h='<div class="row" style="gap:12px;margin-bottom:14px">';
    h+=card(d.total_bugs, 'bugs filed with the tool');
    h+=card('~'+d.total_saved_hours+' h', 'time saved overall', 'vs ~'+d.baseline_minutes+' min/bug by hand');
    h+=card(d.this_week.bugs+' · ~'+d.this_week.saved_hours+'h', 'this week', d.this_month.bugs+' bugs · ~'+d.this_month.saved_hours+'h this month');
    if(d.avg_tool_minutes!=null) h+=card('~'+d.avg_tool_minutes+' min', 'avg time in the tool', 'per bug (measured)');
    h+='</div>';
    if(d.me){ h+='<div class="card" style="margin:0 0 14px"><b>You ('+(CFG.tester_name||'')+'):</b> '+d.me.bugs+' bugs · ~'+d.me.saved_hours+' h saved</div>'; }
    // by tester
    h+='<div class="card" style="margin:0 0 14px"><h2 style="margin-top:0">By tester</h2><table class="rt" style="width:100%"><tbody>';
    (d.by_reporter||[]).forEach(p=>{ h+='<tr class="item"><td class="sub" style="font-weight:600">'+p.name+'</td><td class="st">'+p.bugs+' bugs</td><td class="st" style="color:var(--acc2)">~'+p.saved_hours+' h</td></tr>'; });
    if(!(d.by_reporter||[]).length) h+='<tr><td class="empty">No bugs logged yet.</td></tr>';
    h+='</tbody></table></div>';
    // by source
    const srcs=d.by_source||{}; const order=['jam','case','combo','notes','bulk','manual'];
    h+='<div class="card" style="margin:0 0 14px"><h2 style="margin-top:0">By input source</h2><div class="row" style="gap:8px;flex-wrap:wrap">';
    order.forEach(s=>{ if(srcs[s]) h+='<span class="sev" style="background:var(--chip);padding:4px 10px">'+s+': <b>'+srcs[s]+'</b></span>'; });
    h+='</div></div>';
    // recent weeks
    if((d.by_week||[]).length){ h+='<div class="card" style="margin:0"><h2 style="margin-top:0">Recent weeks</h2><table class="rt" style="width:100%"><tbody>';
      d.by_week.slice().reverse().forEach(w=>{ h+='<tr class="item"><td class="sub">week of '+w.week+'</td><td class="st">'+w.bugs+' bugs</td><td class="st" style="color:var(--acc2)">~'+w.saved_hours+' h</td></tr>'; });
      h+='</tbody></table></div>'; }
    h+='<div class="hint" style="margin-top:10px">Time saved = ~'+d.baseline_minutes+' min manual baseline per bug (plus a bonus when a TestRail case is failed/created) minus the measured time in the tool. Tune the baseline on the server if needed.</div>';
    wrap.innerHTML=h;
  }catch(e){ wrap.innerHTML='<div class="empty" style="color:#fca5a5">Could not load stats: '+(e.message||e)+'</div>'; }
}
async function loadRetests(){
  const tid=val('rtTicket'); const list=$('rtList');
  list.innerHTML='<div class="empty"><span class="spin"></span> Loading…</div>'; $('rtCount').textContent='';
  try{
    const r=await fetch('/my-retests'+(tid?('?ticket_id='+encodeURIComponent(tid)):''));
    const d=await r.json();
    if(!r.ok) throw new Error(d.detail||r.statusText);
    $('rtCount').textContent=d.count+' bug'+(d.count===1?'':'s')+' you reported, released back for retest';
    const groups=d.groups||[];
    if(!groups.length){ list.innerHTML='<div class="empty">🎉 Nothing pending retest'+(tid?(' for ticket '+tid):'')+'.</div>'; return; }
    list.innerHTML='';
    groups.forEach(g=>{
      const hdr=document.createElement('div');
      hdr.style.cssText='margin:14px 0 6px;font-weight:700;color:var(--acc2);font-size:13px;border-bottom:1px solid var(--line);padding-bottom:5px';
      const label=(g.ticket_id==='No ticket')?'No ticket':('Ticket #'+g.ticket_id);
      hdr.innerHTML=label+' <span class="src">('+g.bugs.length+' bug'+(g.bugs.length===1?'':'s')+' released to QA)</span>';
      list.appendChild(hdr);
      g.bugs.forEach(i=>{
        const el=document.createElement('div'); el.className='item';
        el.innerHTML='<span class="id">#'+i.id+'</span>'+
          '<span class="sev '+(i.severity||'')+'">'+(i.severity||'—')+'</span>'+
          '<span class="sub" title="'+(i.subject||'').replace(/"/g,'&quot;')+'">'+(i.subject||'')+'</span>'+
          '<span class="st">'+(i.status||'')+(i.environment?(' · '+i.environment):'')+'</span>';
        el.onclick=()=>window.open(i.url,'_blank');
        list.appendChild(el);
      });
    });
  }catch(e){ list.innerHTML='<div class="empty" style="color:#fca5a5">'+(e.message||e)+'</div>'; }
}

/* ---- settings ---- */
function openSettings(){ $('cf_redmine').value=CFG.redmine_url||''; $('cf_dash').value=CFG.dashboard_url||''; $('cf_key').value=''; $('cf_jam').value=''; $('cf_tremail').value=CFG.testrail_email||''; $('cf_trkey').value=''; $('cf_whoami').textContent=CFG.tester_name?('✓ '+CFG.tester_name):'— your name is fetched automatically from this key —'; $('keyState').textContent=CFG.key_set?('Key set ('+CFG.key_tail+'). Leave blank to keep.'):'No key set yet — paste your Redmine API key.'; $('jamState').textContent=CFG.jam_set?('Jam token set ('+CFG.jam_tail+'). Leave blank to keep.'):'No Jam token yet (optional — needed only for 🎥 Load from Jam).'; if($('trState')) $('trState').textContent=CFG.testrail_set?('TestRail key set ('+CFG.testrail_tail+'). Leave blank to keep.'):'Optional — set it to fail cases under your own name (else the shared key is used).'; $('setMsg').textContent=''; $('settings').classList.add('show'); }
function closeSettings(){ $('settings').classList.remove('show'); }
async function saveSettings(){
  const body={tester_name:'',redmine_api_key:val('cf_key'),jam_pat:val('cf_jam'),testrail_email:val('cf_tremail'),testrail_api_key:val('cf_trkey'),redmine_url:val('cf_redmine'),dashboard_url:val('cf_dash'),defaults:{}};
  const btn=$('saveSetBtn'); btn.disabled=true; $('setMsg').innerHTML='<span class="spin"></span> verifying key…';
  try{
    const r=await fetch('/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    if(!r.ok) throw new Error(d.detail||r.statusText);
    if(d.tester_name) $('cf_whoami').textContent='✓ '+d.tester_name;
    closeSettings(); await boot(); toast('✓ Settings saved — reporting as '+(d.tester_name||CFG.tester_name||'you'),'ok');
  }catch(e){ $('setMsg').textContent=''; toast('Could not save: '+(e.message||e),'bad'); }
  finally{ btn.disabled=false; }
}

function setTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  try{ localStorage.setItem('bugrep_theme', t); }catch(e){}
  var s=document.getElementById('themeSel'); if(s) s.value=t;
}
// reflect the saved theme in the dropdown on load
(function(){ try{ var t=localStorage.getItem('bugrep_theme')||'dark'; var s=document.getElementById('themeSel'); if(s) s.value=t; }catch(e){} })();
boot();
</script>
</body>
</html>
"""
