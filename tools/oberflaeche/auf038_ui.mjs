// Oberflaechenprobe AUF-038: Krankheit beim Urlaubsabgleich mit Clockodo (Mehr, Urlaubstage).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const [URL] = process.argv.slice(2);
const ergebnisse = [];
const pruefe = (name, ok, detail = '') => ergebnisse.push({ name, ok: Boolean(ok), detail });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (y, m, d) => new Date(y, m - 1, d).getTime();
const HINWEIS = 'dort weiter als Urlaub, Klarzeit aendert den Antrag nicht';

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
    const clockodo = { apiUser: 'testnutzer', syncFrom: d.ab, defaultCustomersId: null, defaultProjectsId: null, defaultServicesId: null, billable: null };
    localStorage.setItem(P + 'employments', JSON.stringify([{ id: 'emp-1', name: 'Vollzeit', arbeitgeber: 'Muster GmbH', personalnummer: '', abteilung: '', startDate: d.ab, endDate: null, weeklyHours: 40, workdaysPerWeek: 5, vacationYearMode: 'both', openingBalanceMs: 0, contractVacationDays: null, includedOvertimeHoursPerMonth: null, balanceNote: '', clockodo }]));
    localStorage.setItem(P + 'activeEmployment', 'emp-1');
    const antrag = { id: 9, status: 1, at: 1 };
    localStorage.setItem(P + 'vacations', JSON.stringify([
      { employmentId: 'emp-1', date: d.mo, note: '', clockodoAbsence: antrag },
      { employmentId: 'emp-1', date: d.di, note: '', clockodoAbsence: antrag },
      { employmentId: 'emp-1', date: d.mi, note: '' },
      { employmentId: 'emp-1', date: d.do, note: '' },
      { employmentId: 'emp-1', date: d.fr, note: '' },
    ]));
    localStorage.setItem(P + 'sickPeriods', JSON.stringify([
      { employmentId: 'emp-1', from: d.mo, to: d.mo, certificate: true },
      { employmentId: 'emp-1', from: d.mi, to: d.mi, certificate: true },
      { employmentId: 'emp-1', from: d.fr, to: d.fr, certificate: false },
    ]));
  }, { ab: T(2026, 1, 1), mo: T(2026, 10, 12), di: T(2026, 10, 13), mi: T(2026, 10, 14), do: T(2026, 10, 15), fr: T(2026, 10, 16) });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(() => [...document.querySelectorAll('.bottom-nav .nav-item')].find((b) => b.textContent.trim().startsWith('Mehr')).click());
  await pause(600);
  const text = await page.evaluate(() => document.body.innerText);
  const zeilen = await page.evaluate(() => [...document.querySelectorAll('.vac-list li')].map((li) => li.innerText.replace(/\s+/g, ' ')).filter((z) => z.includes('Clockodo:')));
  const zeile = (datum) => zeilen.find((z) => z.includes(datum)) ?? '';
  const offen = (text.match(/Clockodo – Vollzeit: \d+ Urlaubstag\(e\) offen/) ?? [''])[0];
  pruefe('U1 offen zaehlt den Krankheitstag mit Bescheinigung nicht mit (2)', offen === 'Clockodo – Vollzeit: 2 Urlaubstag(e) offen', offen);
  const mo = zeile('12.10.2026');
  pruefe('U2 genehmigt + krank mit Bescheinigung: Hinweis', mo.includes(`Clockodo: genehmigt – ${HINWEIS}`), mo);
  const di = zeile('13.10.2026');
  pruefe('U3 genehmigt ohne Krankheit: kein Hinweis', di.includes('Clockodo: genehmigt') && !di.includes(HINWEIS), di);
  const mi = zeile('14.10.2026');
  pruefe('U4 offen + krank mit Bescheinigung: nicht beantragt, kein Hinweis', mi.includes('krank mit Bescheinigung') && mi.includes('Clockodo: nicht beantragt') && !mi.includes(HINWEIS), mi);
  const fr = zeile('16.10.2026');
  pruefe('U5 krank ohne Bescheinigung: zaehlt als Urlaub, kein Hinweis', fr.includes('krank ohne Bescheinigung, zaehlt als Urlaub') && !fr.includes(HINWEIS), fr);
  pruefe('U6 fuenf Urlaubszeilen mit Clockodo-Stand', zeilen.length === 5, String(zeilen.length));
} catch (err) {
  pruefe('ABBRUCH', false, String(err?.message ?? err));
} finally {
  await browser.close();
}
for (const r of ergebnisse) console.log(`${r.ok ? 'OK  ' : 'ROT '} ${r.name}${r.ok ? '' : '  <- ' + r.detail}`);
const ok = ergebnisse.filter((r) => r.ok).length;
console.log(`${ok}/${ergebnisse.length}`);
process.exit(ok === ergebnisse.length ? 0 : 1);
