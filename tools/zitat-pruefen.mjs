// Prueft woertliche Zitate gegen den Seitentext (Chrome via puppeteer-core).
// Aufruf: node zitat-pruefen.mjs [--dump N] <angaben.json> [weitere.json ...]
// Angaben: [{ anbieter, feld, wert, url, zitat }]
// Ergebnis je Angabe: ok | ok-leerzeichen | nur-quelltext | fehlt | kein-zitat | seite-fehlt
// Kontrolle je Seite: ein verfaelschtes Zitat MUSS "fehlt" ergeben, sonst ist die Seite ungueltig.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PARALLEL = 4;

const args = process.argv.slice(2);
let dump = 0;
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dump') dump = Number(args[++i]);
  else files.push(args[i]);
}

function norm(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/[\u00a0\u202f\u2007\u2009\u200a\u2002\u2003]/g, ' ')
    .replace(/[\u200b\u200c\u200d\u00ad\ufeff]/g, '')
    .replace(/[\u201e\u201c\u201d\u00ab\u00bb\u2033]/g, '"')
    .replace(/[\u201a\u2018\u2019\u2039\u203a\u2032`\u00b4]/g, "'")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
const strip = (s) => s.replace(/\s+/g, '');

function bewerte(zitat, seite) {
  const q = norm(zitat);
  if (!q) return 'kein-zitat';
  if (seite.vis.includes(q)) return 'ok';
  if (seite.visS.includes(strip(q))) return 'ok-leerzeichen';
  if (seite.all.includes(q) || seite.allS.includes(strip(q))) return 'nur-quelltext';
  return 'fehlt';
}

async function ladeSeite(browser, ua, url) {
  const page = await browser.newPage();
  let status = null;
  let fehler = null;
  try {
    await page.setUserAgent(ua);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8' });
    await page.setViewport({ width: 1366, height: 900 });
    try {
      const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
      status = resp ? resp.status() : null;
    } catch (e) {
      fehler = String(e?.message ?? e).slice(0, 100);
    }
    try {
      await page.evaluate(async () => {
        for (let i = 0, y = 0; i < 40 && y < document.body.scrollHeight; i++, y += 900) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 120));
        }
      });
    } catch {
      /* Seite ohne body: unten als leer erkannt */
    }
    await new Promise((r) => setTimeout(r, 1200));
    const t = await page.evaluate(() => ({
      vis: document.body ? document.body.innerText : '',
      all: document.documentElement ? document.documentElement.textContent : '',
      title: document.title,
      finalUrl: location.href,
    }));
    const vis = norm(t.vis);
    const all = norm(t.all);
    const blockiert =
      vis.length < 400 ||
      /just a moment|access denied|attention required|captcha|cf-chl|request blocked|zugriff verweigert/.test(
        vis.slice(0, 3000),
      );
    return { status, fehler, title: t.title, finalUrl: t.finalUrl, roh: t.vis, vis, all, visS: strip(vis), allS: strip(all), blockiert };
  } catch (e) {
    return { status, fehler: String(e?.message ?? e).slice(0, 100), title: '', finalUrl: '', roh: '', vis: '', all: '', visS: '', allS: '', blockiert: true };
  } finally {
    await page.close().catch(() => {});
  }
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=de-DE'] });
const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');

for (const file of files) {
  const angaben = JSON.parse(readFileSync(file, 'utf8'));
  const urls = [...new Set(angaben.filter((a) => a.url && /^https?:/.test(a.url)).map((a) => a.url))];
  const seiten = new Map();
  let next = 0;
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      while (next < urls.length) {
        const url = urls[next++];
        seiten.set(url, await ladeSeite(browser, ua, url));
      }
    }),
  );

  const ergebnis = angaben.map((a) => {
    const s = seiten.get(a.url);
    if (!s) return { ...a, pruefung: 'seite-fehlt' };
    return { ...a, pruefung: bewerte(a.zitat, s) };
  });

  console.log(`\n=== ${file}: ${angaben.length} Angaben, ${urls.length} Seiten`);
  for (const url of urls) {
    const s = seiten.get(url);
    const probe = angaben.find((a) => a.url === url && norm(a.zitat));
    const kontrolle = probe ? bewerte(`${probe.zitat} xqzvj kontrollwort`, s) : 'ohne-zitat';
    s.kontrolle = kontrolle;
    const ungueltig = kontrolle !== 'fehlt' && kontrolle !== 'ohne-zitat';
    console.log(
      `\n[http ${s.status ?? '-'} | ${s.vis.length} Zeichen | blockiert ${s.blockiert ? 'JA' : 'nein'} | Kontrolle ${kontrolle}${ungueltig ? ' !!UNGUELTIG' : ''}${s.fehler ? ' | ' + s.fehler : ''}]`,
    );
    console.log(`  ${url}${s.finalUrl && s.finalUrl !== url ? '  ->  ' + s.finalUrl : ''}`);
    for (const e of ergebnis.filter((x) => x.url === url)) {
      console.log(`  ${e.pruefung.padEnd(14)} ${e.anbieter} | ${e.feld} | ${String(e.wert).slice(0, 90)}`);
    }
    if (dump > 0) console.log('  --- Text ---\n' + s.roh.slice(0, dump) + '\n  --- Ende ---');
  }
  const ohneUrl = ergebnis.filter((e) => !e.url || !/^https?:/.test(e.url));
  if (ohneUrl.length) {
    console.log('\n[ohne URL]');
    for (const e of ohneUrl) console.log(`  ${e.pruefung.padEnd(14)} ${e.anbieter} | ${e.feld} | ${String(e.wert).slice(0, 90)}`);
  }
  const zaehl = {};
  for (const e of ergebnis) zaehl[e.pruefung] = (zaehl[e.pruefung] ?? 0) + 1;
  console.log('\nSumme:', JSON.stringify(zaehl));
  const seitenInfo = Object.fromEntries(
    [...seiten].map(([u, s]) => [u, { status: s.status, zeichen: s.vis.length, blockiert: s.blockiert, kontrolle: s.kontrolle, finalUrl: s.finalUrl, title: s.title, fehler: s.fehler }]),
  );
  writeFileSync(file.replace(/\.json$/, '.geprueft.json'), JSON.stringify({ ergebnis, seiten: seitenInfo }, null, 2));
}

await browser.close();
