// Oberflaechenprobe AUF-039: Eintraege vor „Uebertragen ab“, Clockodo-Auswahl im Formular, gesperrter link-btn.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const [URL] = process.argv.slice(2);
const ergebnisse = [];
const pruefe = (name, ok, detail = '') => ergebnisse.push({ name, ok: Boolean(ok), detail });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (y, m, d, h = 0) => new Date(y, m - 1, d, h).getTime();
const VOR = 'vor \u201eUebertragen ab\u201c \u2013 wird nicht uebertragen';
const ZEILE = 'Clockodo \u2013 Vollzeit: 1 offen \u00b7 0 zu loeschen \u00b7 0 Pause ohne Uhrzeit \u00b7 1 ohne Auswahl \u00b7 2 vor \u201eUebertragen ab\u201c';

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--lang=de-DE'] });
try {
  const page = await browser.newPage();
  page.on('dialog', async (dlg) => { await dlg.accept(); });
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.evaluate((d) => {
    const P = 'CapacitorStorage.';
    localStorage.clear();
    localStorage.setItem(P + 'profile', JSON.stringify({ vorname: 'Max', nachname: 'Mustermann', personalnummer: '', arbeitgeber: '', abteilung: '' }));
    // Nur der Kunde ist vorgegeben, die Leistung nicht.
    const clockodo = { apiUser: 'testnutzer', syncFrom: d.ab, defaultCustomersId: 11, defaultProjectsId: null, defaultServicesId: null, billable: null };
    localStorage.setItem(P + 'employments', JSON.stringify([{ id: 'emp-1', name: 'Vollzeit', arbeitgeber: 'Muster GmbH', personalnummer: '', abteilung: '', startDate: d.start, endDate: null, weeklyHours: 40, workdaysPerWeek: 5, vacationYearMode: 'both', openingBalanceMs: 0, contractVacationDays: null, includedOvertimeHoursPerMonth: null, balanceNote: '', clockodo }]));
    localStorage.setItem(P + 'activeEmployment', 'emp-1');
    localStorage.setItem(P + 'clockodoLists:emp-1', JSON.stringify({ fetchedAt: 1, customers: [{ id: 11, name: 'Kunde A' }, { id: 12, name: 'Kunde B' }], projects: [], services: [{ id: 31, name: 'Leistung X' }] }));
    localStorage.setItem(P + 'vacations', JSON.stringify([
      { employmentId: 'emp-1', date: d.genehmigt, note: '', clockodoAbsence: { id: 9, status: 1, at: 1 } },
      { employmentId: 'emp-1', date: d.offen, note: '' },
    ]));
  }, { start: T(2026, 1, 1), ab: T(2026, 10, 1), genehmigt: T(2026, 10, 12), offen: T(2026, 10, 19) });
  // Vier Eintraege: zwei vor „Uebertragen ab“ (29. und 30.09.2026), einer mit Auswahl, einer ohne.
  await page.evaluate((liste) => new Promise((ok, fehler) => {
    const req = indexedDB.open('zeiterfassung');
    req.onerror = () => fehler(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('entries', 'readwrite');
      for (const e of liste) {
        tx.objectStore('entries').put({ employmentId: 'emp-1', breakMinutes: 0, breaks: [], note: '', source: 'manual', createdAt: e.start, updatedAt: e.end, ...e });
      }
      tx.oncomplete = () => { req.result.close(); ok(); };
      tx.onerror = () => fehler(tx.error);
    };
  }), [
    { start: T(2026, 9, 29, 8), end: T(2026, 9, 29, 16), activity: 'Alt eins', clockodo: null },
    { start: T(2026, 9, 30, 8), end: T(2026, 9, 30, 16), activity: 'Alt zwei', clockodo: { customersId: 11, projectsId: null, servicesId: 31 } },
    { start: T(2026, 10, 5, 8), end: T(2026, 10, 5, 16), activity: 'Mit Auswahl', clockodo: { customersId: 11, projectsId: null, servicesId: 31 } },
    { start: T(2026, 10, 6, 8), end: T(2026, 10, 6, 16), activity: 'Ohne Auswahl', clockodo: null },
  ]);
  await page.reload({ waitUntil: 'networkidle0' });
  const tab = async (l) => { await page.evaluate((x) => [...document.querySelectorAll('.bottom-nav .nav-item')].find((b) => b.textContent.trim().startsWith(x)).click(), l); await pause(600); };
  const karte = (n) => page.evaluate((x) => [...document.querySelectorAll('.entry-card')].map((k) => k.innerText.replace(/\s+/g, ' ')).find((t) => t.includes(x)) ?? '', n);

  await tab('Eintr');
  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const kasten = (text.match(/Clockodo \u2013 Vollzeit: [^.]*?ohne Auswahl( \u00b7 \d+ vor \u201eUebertragen ab\u201c)?/) ?? [''])[0];
  pruefe('U1 Kasten zaehlt die zwei Eintraege vor Uebertragen ab', kasten === ZEILE, kasten);
  const alt1 = await karte('Alt eins');
  const alt2 = await karte('Alt zwei');
  pruefe('U2 beide Eintraege vor Uebertragen ab tragen den Stand', alt1.includes(VOR) && alt2.includes(VOR), `${alt1} | ${alt2}`);
  const mit = await karte('Mit Auswahl');
  const ohne = await karte('Ohne Auswahl');
  pruefe('U3 Gegenprobe: die anderen Eintraege wie bisher', mit.includes('noch nicht uebertragen') && !mit.includes(VOR) && ohne.includes('Clockodo-Auswahl fehlt') && !ohne.includes(VOR), `${mit} | ${ohne}`);

  await page.evaluate(() => document.querySelector('.fab').click());
  await pause(800);
  const auswahl = await page.evaluate(() => {
    const feld = (name) => [...document.querySelectorAll('.modal label.field')].find((l) => l.querySelector('span')?.textContent === name)?.querySelector('select');
    const k = feld('Kunde');
    const l = feld('Leistung');
    const alle = [...document.querySelectorAll('.modal select option')].map((o) => o.textContent.trim());
    return { kunde: k?.value ?? 'FEHLT', leistung: l?.value ?? 'FEHLT', id0: alle.filter((t) => t === 'ID 0').length };
  });
  pruefe('U4 nur der Kunde vorgegeben: er ist vorgewaehlt, die Leistung leer', auswahl.kunde === '11' && auswahl.leistung === '', JSON.stringify(auswahl));
  pruefe('U5 keine Scheinoption ID 0', auswahl.id0 === 0, JSON.stringify(auswahl));
  await page.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'Abbrechen').click());
  await pause(400);

  await tab('Mehr');
  const knoepfe = await page.evaluate(() => {
    const k = (t) => [...document.querySelectorAll('.vac-list li button')].find((b) => b.textContent.trim() === t);
    const z = k('zurueckziehen');
    const e = k('entfernen');
    return {
      zurueck: z ? { disabled: z.disabled, opacity: getComputedStyle(z).opacity } : null,
      entfernen: e ? { disabled: e.disabled, opacity: getComputedStyle(e).opacity } : null,
    };
  });
  pruefe('U6 gesperrter link-btn (zurueckziehen im Browser) ist sichtbar gesperrt', knoepfe.zurueck?.disabled === true && knoepfe.zurueck.opacity === '0.5', JSON.stringify(knoepfe));
  pruefe('U7 Gegenprobe: ein freier link-btn bleibt voll sichtbar', knoepfe.entfernen?.disabled === false && knoepfe.entfernen.opacity === '1', JSON.stringify(knoepfe));
} catch (err) {
  pruefe('ABBRUCH', false, String(err?.message ?? err));
} finally {
  await browser.close();
}
for (const r of ergebnisse) console.log(`${r.ok ? 'OK  ' : 'ROT '} ${r.name}${r.ok ? '' : '  <- ' + r.detail}`);
const ok = ergebnisse.filter((r) => r.ok).length;
console.log(`${ok}/${ergebnisse.length}`);
process.exit(ok === ergebnisse.length ? 0 : 1);
