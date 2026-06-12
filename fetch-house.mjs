import { chromium } from 'playwright-core';
import { writeFileSync } from 'fs';
const url = process.argv[2], out = process.argv[3];
const b = await chromium.launch({ channel: 'chrome', headless: true });
const pg = await b.newPage();
await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
for (const sel of ['#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll','button:has-text("Godta alle")','button:has-text("Aksepter")','button:has-text("Accept")','#onetrust-accept-btn-handler','button:has-text("OK")']) {
  try { await pg.click(sel, { timeout: 2500 }); break; } catch {}
}
await pg.waitForLoadState('networkidle').catch(()=>{});
await pg.waitForTimeout(3500);
for (let i=0;i<8;i++){ await pg.mouse.wheel(0, 1800); await pg.waitForTimeout(500); }
writeFileSync(out, await pg.content());
await b.close();
console.log('saved', out);
