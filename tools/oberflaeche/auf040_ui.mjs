// Oberflaechenprobe AUF-040: Clockodo-Eintrag „als erledigt markieren“ und „wieder offen“ in „Eintraege“.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const [URL] = process.argv.slice(2);
const ergebnisse = [];
const pruefe = (name, ok, detail = '') => ergebnisse.push({ name, ok: Boolean(ok), detail });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (y, m, d, h = 0) => new Date(y, m - 1, d, h).getTime();
const ERLEDIGT = 'von Hand erledigt \u2013 wird nicht uebertragen';
const FRAGE = 'Eintrag vom 05.10.2026 08:00 als in Clockodo erledigt markieren?\nKlarzeit sendet ihn danach nie mehr, auch nicht nach einer Aenderung.';
const ZURUECK = 'Eintrag vom 05.10.2026 08:00 wieder als offen fuehren?\nIst er vollstaendig, sendet Klarzeit ihn beim naechsten Uebertragen.';

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--lang=de-DE'] });
try {
  const page = await browser.newPage();
  const dialoge = [];
  page.on('dialog', async (dlg) => { dialoge.push(dlg.message()); await dlg.accept(); });
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.evaluate((d) => {
    const P = 'CapacitorStorage.';
    localStorage.clear();
    localStorage.setItem(P + 'profile', JSON.stringify({ vorname: 'Max', nachname: 'Mustermann', personalnummer: '', arbeitgeber: '', abteilung: '' }));
    const clockodo = { apiUser: 'testnutzer', syncFrom: d.ab, defaultCustomersId: 11, defaultProjectsId: null, defaultServicesId: 31, billable: null };
    localStorage.setItem(P + 'employments', JSON.stringify([{ id: 'emp-1', name: 'Vollzeit', arbeitgeber: 'Muster GmbH', personalnummer: '', abteilung: '', startDate: d.start, endDate: null, weeklyHours: 40, workdaysPerWeek: 5, vacationYearMode: 'both', openingBalanceMs: 0, contractVacationDays: null, includedOvertimeHoursPerMonth: null, balanceNote: '', clockodo }]));
    localStorage.setItem(P + 'activeEmployment', 'emp-1');
  }, { start: T(2026, 1, 1), ab: T(2026, 10, 1) });
  // Zwei Eintraege: einer offen (nie uebertragen), einer uebertragen und danach geaendert.
  const ref = { customersId: 11, projectsId: null, servicesId: 31 };
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
    { start: T(2026, 10, 5, 8), end: T(2026, 10, 5, 16), activity: 'Offen', clockodo: ref },
    { start: T(2026, 10, 6, 8), end: T(2026, 10, 6, 16), activity: 'Geaendert', clockodo: ref, clockodoSync: { ids: [5], hash: 'alt', at: 1 } },
  ]);
  await page.reload({ waitUntil: 'networkidle0' });
  const tab = async (l) => { await page.evaluate((x) => [...document.querySelectorAll('.bottom-nav .nav-item')].find((b) => b.textContent.trim().startsWith(x)).click(), l); await pause(600); };
  const karte = (n) => page.evaluate((x) => [...document.querySelectorAll('.entry-card')].map((k) => k.innerText.replace(/\s+/g, ' ')).find((t) => t.includes(x)) ?? '', n);
  const offen = async () => ((await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).match(/Clockodo \u2013 Vollzeit: (\d+) offen/) ?? [null, '?'])[1];
  const klick = async (n, text) => {
    const ok = await page.evaluate((x, t) => {
      const k = [...document.querySelectorAll('.entry-card')].find((c) => c.innerText.includes(x));
      const b = k && [...k.querySelectorAll('button')].find((y) => y.textContent.trim() === t);
      if (!b) return false;
      b.click();
      return true;
    }, n, text);
    await pause(700);
    return ok;
  };

  await tab('Eintr');
  const vorher = await karte('Offen');
  pruefe('U1 offener Eintrag: Stand und Knopf „als erledigt markieren“', vorher.includes('noch nicht uebertragen') && vorher.includes('als erledigt markieren'), vorher);
  const geaendert = await karte('Geaendert');
  pruefe('U2 Gegenprobe: uebertragener Eintrag ohne Knopf', geaendert.includes('geaendert') && !geaendert.includes('als erledigt markieren') && !geaendert.includes('wieder offen'), geaendert);
  pruefe('U3 vorher 2 offen', (await offen()) === '2', await offen());

  const geklickt = await klick('Offen', 'als erledigt markieren');
  pruefe('U4 Rueckfrage nennt Eintrag und Folge', geklickt && dialoge[0] === FRAGE, JSON.stringify(dialoge));
  const nach = await karte('Offen');
  pruefe('U5 danach: von Hand erledigt, Knopf „wieder offen“, 1 offen', nach.includes(ERLEDIGT) && nach.includes('wieder offen') && (await offen()) === '1', `${nach} | ${await offen()}`);

  await page.reload({ waitUntil: 'networkidle0' });
  await tab('Eintr');
  const neu = await karte('Offen');
  pruefe('U6 nach dem Neuladen weiter erledigt', neu.includes(ERLEDIGT), neu);

  const zurueck = await klick('Offen', 'wieder offen');
  const wieder = await karte('Offen');
  pruefe('U7 wieder offen: Rueckfrage, Stand und Zaehlung wie vorher', zurueck && dialoge[1] === ZURUECK && wieder.includes('noch nicht uebertragen') && wieder.includes('als erledigt markieren') && (await offen()) === '2', `${JSON.stringify(dialoge)} | ${wieder}`);
} catch (err) {
  pruefe('ABBRUCH', false, String(err?.message ?? err));
} finally {
  await browser.close();
}
for (const r of ergebnisse) console.log(`${r.ok ? 'OK  ' : 'ROT '} ${r.name}${r.ok ? '' : '  <- ' + r.detail}`);
const ok = ergebnisse.filter((r) => r.ok).length;
console.log(`${ok}/${ergebnisse.length}`);
process.exit(ok === ergebnisse.length ? 0 : 1);
