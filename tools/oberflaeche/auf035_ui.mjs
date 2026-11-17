// Oberflaechenprobe AUF-035: Stoppuhr-Eintrag bearbeiten, Hinweis "geaendert, Stoppuhr ..." in "Eintraege".
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const [URL] = process.argv.slice(2);
const ergebnisse = [];
const pruefe = (name, ok, detail = '') => ergebnisse.push({ name, ok: Boolean(ok), detail });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const heute = new Date();
const um = (h, m = 0) => new Date(heute.getFullYear(), heute.getMonth(), heute.getDate(), h, m).getTime();
const lokal = (ms) => {
  const d = new Date(ms);
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
};

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--lang=de-DE'] });
try {
  const page = await browser.newPage();
  page.on('dialog', async (dlg) => { await dlg.accept(); });
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    const P = 'CapacitorStorage.';
    localStorage.clear();
    localStorage.setItem(P + 'profile', JSON.stringify({ vorname: 'Max', nachname: 'Mustermann', personalnummer: '', arbeitgeber: '', abteilung: '' }));
    localStorage.setItem(P + 'employments', JSON.stringify([{ id: 'emp-1', name: 'Vollzeit', arbeitgeber: 'Muster GmbH', personalnummer: '', abteilung: '', startDate: new Date(2026, 0, 1).getTime(), endDate: null, weeklyHours: 40, workdaysPerWeek: 5, vacationYearMode: 'both', openingBalanceMs: 0, contractVacationDays: null, includedOvertimeHoursPerMonth: null, balanceNote: '', clockodo: null }]));
    localStorage.setItem(P + 'activeEmployment', 'emp-1');
  });
  // Ein Stoppuhr-Eintrag von heute, 08:00 bis 16:00, direkt in die IndexedDB der App.
  await page.evaluate((start, end) => new Promise((ok, fehler) => {
    const req = indexedDB.open('zeiterfassung');
    req.onerror = () => fehler(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('entries', 'readwrite');
      tx.objectStore('entries').put({ employmentId: 'emp-1', start, end, breakMinutes: 0, breaks: [], activity: 'Montage', note: '', source: 'tracked', clockodo: null, createdAt: start, updatedAt: end });
      tx.oncomplete = () => { req.result.close(); ok(); };
      tx.onerror = () => fehler(tx.error);
    };
  }), um(8), um(16));
  await page.reload({ waitUntil: 'networkidle0' });
  const tab = async (l) => { await page.evaluate((x) => [...document.querySelectorAll('.bottom-nav .nav-item')].find((b) => b.textContent.trim().startsWith(x)).click(), l); await pause(600); };
  const karte = () => page.evaluate(() => [...document.querySelectorAll('.entry-card')].map((k) => k.innerText.replace(/\s+/g, ' ')).find((t) => t.includes('Montage')) ?? '');
  const bearbeiten = async (feld, wert) => {
    await page.evaluate(() => [...document.querySelectorAll('.entry-card')].find((k) => k.innerText.includes('Montage')).querySelector('[title="Bearbeiten"]').click());
    await pause(400);
    await page.evaluate((f, w) => {
      const inp = [...document.querySelectorAll('.modal label.field')].find((l) => l.querySelector('span')?.textContent === f).querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, w);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }, feld, wert);
    await pause(200);
    await page.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'Speichern').click());
    await pause(700);
  };

  await tab('Eintr');
  const vorher = await karte();
  pruefe('S1 Eintrag sichtbar, noch ohne Hinweis', vorher.includes('08:00') && !vorher.includes('geaendert'), vorher);
  await bearbeiten('Beginn', lokal(um(7, 30)));
  const nach1 = await karte();
  pruefe('S2 nach Aenderung des Beginns: Hinweis mit Stoppuhr 08:00-16:00', nach1.includes('07:30') && nach1.includes('geaendert, Stoppuhr 08:00\u201316:00'), nach1);
  await bearbeiten('Ende', lokal(um(17)));
  const nach2 = await karte();
  pruefe('S3 zweite Aenderung: die ersten Stoppuhr-Zeiten bleiben', nach2.includes('17:00') && nach2.includes('geaendert, Stoppuhr 08:00\u201316:00'), nach2);
  await bearbeiten('Beginn', lokal(um(8)));
  await bearbeiten('Ende', lokal(um(16)));
  const zurueck = await karte();
  pruefe('S4 auf die Stoppuhr-Zeiten zurueckgesetzt: kein Hinweis', zurueck.includes('08:00') && !zurueck.includes('geaendert'), zurueck);
} catch (err) {
  pruefe('ABBRUCH', false, String(err?.message ?? err));
} finally {
  await browser.close();
}
for (const r of ergebnisse) console.log(`${r.ok ? 'OK  ' : 'ROT '} ${r.name}${r.ok ? '' : '  <- ' + r.detail}`);
const ok = ergebnisse.filter((r) => r.ok).length;
console.log(`${ok}/${ergebnisse.length}`);
process.exit(ok === ergebnisse.length ? 0 : 1);
