const { chromium } = require('playwright-core');
(async () => {
  const path = 'file:///C:/Apps/qa-dashboard-app/automation-runner/prototype.html';
  const out = 'C:/Users/BIS-DB/AppData/Local/Temp/claude/C--Apps-qa-dashboard-app/f59c474d-6b51-4d82-838d-6d56e80f37f7/scratchpad/';
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1320, height: 1000 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(path, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: out + 'proto_overview.png', fullPage: true });
  // UI automation tab + select a case + run
  await pg.click('[data-tab="ui"]');
  await pg.waitForTimeout(200);
  await pg.evaluate(() => { openModuleInTree('Forms'); });
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: out + 'proto_ui.png', fullPage: true });
  console.log('PAGE ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await b.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
