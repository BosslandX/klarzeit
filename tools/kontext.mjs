// Zeigt Fundstellen eines Musters mit Umgebung im sichtbaren Seitentext.
// Aufruf: node kontext.mjs <auftraege.json>   ([{ url, muster, max?, breite? }])
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const auftraege = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=de-DE'] });
const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');

for (const a of auftraege) {
  const page = await browser.newPage();
  await page.setUserAgent(ua);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9' });
  await page.setViewport({ width: 1366, height: 900 });
  let status = null;
  try {
    const r = await page.goto(a.url, { waitUntil: 'networkidle2', timeout: 45000 });
    status = r ? r.status() : null;
  } catch {
    status = 'timeout';
  }
  try {
    await page.evaluate(async () => {
      for (let i = 0, y = 0; i < 40 && y < document.body.scrollHeight; i++, y += 900) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
    });
  } catch {
    /* ohne body */
  }
  await new Promise((r) => setTimeout(r, 1200));
  const text = (await page.evaluate(() => (document.body ? document.body.innerText : ''))).replace(/\s+/g, ' ');
  await page.close();
  const re = new RegExp(a.muster, 'gi');
  const treffer = [...text.matchAll(re)];
  const breite = a.breite ?? 110;
  console.log(`\n[http ${status} | ${text.length} Zeichen | ${treffer.length} Treffer /${a.muster}/] ${a.url}`);
  for (const t of treffer.slice(0, a.max ?? 6)) {
    const i = t.index ?? 0;
    console.log(`  …${text.slice(Math.max(0, i - breite), i + breite)}…`);
  }
}
await browser.close();
