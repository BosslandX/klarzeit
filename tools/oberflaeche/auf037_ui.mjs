// Oberflaechenprobe AUF-037: Hinweise nach dem Arbeitszeitgesetz in "Erfassung" und "Eintraege".
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const [URL] = process.argv.slice(2);
const ergebnisse = [];
const pruefe = (name, ok, detail = '') => ergebnisse.push({ name, ok: Boolean(ok), detail });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const heute = new Date();
const um = (tagVersatz, h, m = 0) => new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() + tagVersatz, h, m).getTime();
const ZEHN = 'Arbeitszeitgesetz: Mehr als 10 Stunden gearbeitet (10:30 h) \u2013 \u00a7 3 ArbZG';
const PAUSE = 'Arbeitszeitgesetz: Pausen 30 statt mindestens 45 Minuten \u2013 \u00a7 4 ArbZG';

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--lang=de-DE'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    const P = 'CapacitorStorage.';
    localStorage.clear();
    localStorage.setItem(P + 'profile', JSON.stringify({ vorname: 'Max', nachname: 'Mustermann', personalnummer: '', arbeitgeber: '', abteilung: '' }));
    localStorage.setItem(P + 'employments', JSON.stringify([{ id: 'emp-1', name: 'Vollzeit', arbeitgeber: 'Muster GmbH', personalnummer: '', abteilung: '', startDate: new Date(2026, 0, 1).getTime(), endDate: null, weeklyHours: 40, workdaysPerWeek: 5, vacationYearMode: 'both', openingBalanceMs: 0, contractVacationDays: null, includedOvertimeHoursPerMonth: null, balanceNote: '', clockodo: null }]));
    localStorage.setItem(P + 'activeEmployment', 'emp-1');
  });
  // Heute 07:00-18:00 mit 30 Minuten Pause (10:30 h), gestern 08:00-16:30 mit 30 Minuten (unauffaellig).
  await page.evaluate((eintraege) => new Promise((ok, fehler) => {
    const req = indexedDB.open('zeiterfassung');
    req.onerror = () => fehler(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('entries', 'readwrite');
      for (const [start, end] of eintraege) {
        tx.objectStore('entries').put({ employmentId: 'emp-1', start, end, breakMinutes: 30, activity: 'Montage', note: '', source: 'manual', clockodo: null, createdAt: start, updatedAt: end });
      }
      tx.oncomplete = () => { req.result.close(); ok(); };
      tx.onerror = () => fehler(tx.error);
    };
  }), [[um(0, 7), um(0, 18)], [um(-1, 8), um(-1, 16, 30)]]);
  await page.reload({ waitUntil: 'networkidle0' });
  await pause(500);
  const text = () => page.evaluate(() => document.body.innerText);
  const erfassung = await text();
  pruefe('A1 Erfassung: beide Hinweise fuer heute', erfassung.includes(ZEHN) && erfassung.includes(PAUSE), erfassung.slice(0, 300));
  await page.evaluate(() => [...document.querySelectorAll('.bottom-nav .nav-item')].find((b) => b.textContent.trim().startsWith('Eintr')).click());
  await pause(600);
  const gruppen = await page.evaluate(() => [...document.querySelectorAll('.day-group')].map((g) => g.innerText.replace(/\s+/g, ' ')));
  pruefe('A2 Eintraege: Hinweise unter dem heutigen Tag', gruppen.length === 2 && gruppen[0].includes(ZEHN.replace(/\s+/g, ' ')) && gruppen[0].includes(PAUSE), JSON.stringify(gruppen));
  pruefe('A3 Eintraege: gestern ohne Hinweis', gruppen.length === 2 && !gruppen[1].includes('Arbeitszeitgesetz'), JSON.stringify(gruppen[1] ?? ''));
} catch (err) {
  pruefe('ABBRUCH', false, String(err?.message ?? err));
} finally {
  await browser.close();
}
for (const r of ergebnisse) console.log(`${r.ok ? 'OK  ' : 'ROT '} ${r.name}${r.ok ? '' : '  <- ' + r.detail}`);
const ok = ergebnisse.filter((r) => r.ok).length;
console.log(`${ok}/${ergebnisse.length}`);
process.exit(ok === ergebnisse.length ? 0 : 1);
