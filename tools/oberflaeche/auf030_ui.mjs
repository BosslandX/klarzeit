// Oberflaechenprobe AUF-030: Feiertage im Formular, Urlaubszeitraum, Urlaubstag, Auswertung.
// Aufruf: node auf030_ui.mjs <url>
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const [URL] = process.argv.slice(2);
const ergebnisse = [];
const pruefe = (name, ok, detail = '') => ergebnisse.push({ name, ok: Boolean(ok), detail });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--lang=de-DE'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    const P = 'CapacitorStorage.';
    localStorage.clear();
    localStorage.setItem(P + 'profile', JSON.stringify({ vorname: 'Max', nachname: 'Mustermann', personalnummer: '', arbeitgeber: '', abteilung: '' }));
    const base = { arbeitgeber: 'Muster GmbH', personalnummer: '', abteilung: '', startDate: new Date(2026, 0, 1).getTime(), endDate: null, vacationYearMode: 'both', openingBalanceMs: 0, contractVacationDays: null, includedOvertimeHoursPerMonth: null, balanceNote: '', clockodo: null };
    localStorage.setItem(P + 'employments', JSON.stringify([{ ...base, id: 'emp-1', name: 'Vollzeit', weeklyHours: 40, workdaysPerWeek: 5 }]));
    localStorage.setItem(P + 'activeEmployment', 'emp-1');
    localStorage.setItem(P + 'vacations', '[]');
  });
  await page.reload({ waitUntil: 'networkidle0' });
  const tab = async (l) => {
    await page.evaluate((x) => [...document.querySelectorAll('.bottom-nav .nav-item')].find((b) => b.textContent.trim().startsWith(x)).click(), l);
    await pause(500);
  };
  const text = () => page.evaluate(() => document.body.innerText);
  const waehle = async (land) => {
    await page.evaluate((code) => {
      const sel = [...document.querySelectorAll('label.field')].find((l) => l.textContent.includes('Feiertage (Bundesland')).querySelector('select');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, code);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, land);
    await pause(250);
  };
  const vorschau = () => page.evaluate(() => {
    const p = [...document.querySelectorAll('p')].find((x) => /^Feiertage \d{4}\./.test(x.textContent.trim()));
    const ul = p ? p.nextElementSibling : null;
    return ul ? [...ul.querySelectorAll('li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()) : null;
  });
  const knopfIn = async (zeile, beschriftung) => {
    await page.evaluate((z, b) => {
      const p = [...document.querySelectorAll('p')].find((x) => /^Feiertage \d{4}\./.test(x.textContent.trim()));
      const li = [...p.nextElementSibling.querySelectorAll('li')].find((x) => x.textContent.includes(z));
      [...li.querySelectorAll('button')].find((x) => x.textContent.trim() === b).click();
    }, zeile, beschriftung);
    await pause(250);
  };

  await tab('Mehr');
  await page.evaluate(() => [...document.querySelectorAll('li')].find((x) => x.textContent.includes('Vollzeit') && x.querySelector('.link-btn')).querySelector('.link-btn').click());
  await pause(400);
  pruefe('F1 Auswahl da, ohne Land keine Vorschau', (await text()).includes('Feiertage (Bundesland des Arbeitsorts)') && (await vorschau()) === null);

  await waehle('SN');
  let v = await vorschau();
  pruefe('F2 Sachsen: 11 Feiertage, Buss- und Bettag am 18.11.', v && v.length === 11 && v.some((z) => z.includes('18.11.2026') && z.includes('Buss- und Bettag')), JSON.stringify(v));
  const regional = await page.evaluate(() => [...document.querySelectorAll('label.field.row')].map((l) => l.textContent.trim()));
  pruefe('F3 Sachsen: Fronleichnam zuschaltbar', regional.some((t) => t.startsWith('Fronleichnam')), JSON.stringify(regional));
  await page.evaluate(() => [...document.querySelectorAll('label.field.row')].find((l) => l.textContent.startsWith('Fronleichnam')).querySelector('input').click());
  await pause(250);
  v = await vorschau();
  pruefe('F4 Fronleichnam zugeschaltet: 12', v && v.length === 12 && v.some((z) => z.includes('04.06.2026') && z.includes('Fronleichnam')), JSON.stringify(v));
  await knopfIn('Reformationstag', 'streichen');
  v = await vorschau();
  pruefe('F5 Reformationstag gestrichen, Knopf zurueckholen', v && v.some((z) => z.includes('Reformationstag (gestrichen)') && z.endsWith('zurueckholen')), JSON.stringify(v));
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('p')].find((x) => /^Feiertage \d{4}\./.test(x.textContent.trim()));
    const add = p.nextElementSibling.nextElementSibling;
    const inp = add.querySelector('input[type="date"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '2026-12-24');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await pause(200);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Eigenen Feiertag hinzufuegen')).click());
  await pause(250);
  v = await vorschau();
  pruefe('F6 eigener Feiertag 24.12. mit entfernen', v && v.some((z) => z.includes('24.12.2026') && z.includes('Eigener Feiertag') && z.endsWith('entfernen')), JSON.stringify(v));

  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Aenderungen speichern')).click());
  await pause(600);
  const gespeichert = await page.evaluate(() => JSON.parse(localStorage.getItem('CapacitorStorage.employments'))[0].publicHolidays);
  pruefe('F7 gespeichert: SN, fronleichnam, skip 31.10., extra 24.12.',
    gespeichert && gespeichert.land === 'SN' && JSON.stringify(gespeichert.regional) === '["fronleichnam"]' &&
      gespeichert.skip.length === 1 && new Date(gespeichert.skip[0]).getDate() === 31 &&
      gespeichert.extra.length === 1 && new Date(gespeichert.extra[0]).getDate() === 24,
    JSON.stringify(gespeichert));

  await page.evaluate(() => {
    const setze = (el, w) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, w); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const [von, bis] = document.querySelectorAll('.vac-range input[type="date"]');
    setze(von, '2026-05-11');
    setze(bis, '2026-05-17');
  });
  await pause(300);
  const knopf = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).find((t) => t.includes('Arbeitstag(e) eintragen')) ?? '');
  pruefe('F8 Zeitraum 11.-17.05.: Himmelfahrt uebersprungen, 4 Tage', knopf === '4 Arbeitstag(e) eintragen', knopf);
  pruefe('F9 Hilfetext ohne "kennt die App nicht"', !(await text()).includes('Feiertage kennt die App nicht') && (await text()).includes('Feiertage der Beschaeftigung werden uebersprungen.'));

  await page.evaluate(() => {
    const inp = document.querySelector('.vac-add input[type="date"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '2026-11-18');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await pause(200);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Urlaubstag hinzufuegen').click());
  await pause(500);
  const zeile = await page.evaluate(() => [...document.querySelectorAll('.vac-list li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()).find((t) => t.includes('18.11.2026')) ?? '');
  pruefe('F10 Urlaubstag am Buss- und Bettag markiert', zeile.includes('Feiertag (Buss- und Bettag), zaehlt nicht als Urlaub'), zeile);

  await tab('Reports');
  await page.evaluate(() => [...document.querySelectorAll('.segmented .seg')].find((b) => b.textContent.trim() === 'Monat').click());
  await pause(500);
  const reports = await text();
  pruefe('F11 Auswertung November: Feiertage (1 Tag) +8:00 h', /Feiertage \(1 Tag\)\s*\+8:00 h/.test(reports), (reports.match(/Feiertage[^\n]*\n?[^\n]*/) ?? [''])[0]);
} catch (e) {
  pruefe('ABBRUCH', false, String(e?.message ?? e));
} finally {
  await browser.close();
}
for (const r of ergebnisse) console.log(`${r.ok ? 'OK  ' : 'ROT '} ${r.name}${r.ok ? '' : '  <- ' + r.detail}`);
const ok = ergebnisse.filter((r) => r.ok).length;
console.log(`${ok}/${ergebnisse.length}`);
process.exit(ok === ergebnisse.length ? 0 : 1);
