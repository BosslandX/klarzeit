// Oberflaechenprobe AUF-041: Hinweis zur Wartezeit (§ 3 Abs. 3 EntgFG) in den Krankheitszeiten (Mehr).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const [URL] = process.argv.slice(2);
const ergebnisse = [];
const pruefe = (name, ok, detail = '') => ergebnisse.push({ name, ok: Boolean(ok), detail });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (y, m, d) => new Date(y, m - 1, d).getTime();
const HINWEIS = 'Krank in den ersten vier Wochen der Beschaeftigung (bis 28.10.2026): Der Anspruch auf Entgeltfortzahlung entsteht erst nach vierwoechiger ununterbrochener Dauer des Arbeitsverhaeltnisses (\u00a7 3 Abs. 3 EntgFG). Das Konto rechnet die Tage weiter ohne Minusstunden.';

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--lang=de-DE'] });
try {
  const page = await browser.newPage();
  page.on('dialog', async (dlg) => { await dlg.accept(); });
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(URL, { waitUntil: 'networkidle0' });
  const fuellen = (krank) => page.evaluate((d, k) => {
    const P = 'CapacitorStorage.';
    localStorage.clear();
    localStorage.setItem(P + 'profile', JSON.stringify({ vorname: 'Max', nachname: 'Mustermann', personalnummer: '', arbeitgeber: '', abteilung: '' }));
    // Beschaeftigt seit Donnerstag, 01.10.2026: die Wartezeit endet mit dem 28.10.2026.
    localStorage.setItem(P + 'employments', JSON.stringify([{ id: 'emp-1', name: 'Vollzeit', arbeitgeber: 'Muster GmbH', personalnummer: '', abteilung: '', startDate: d.start, endDate: null, weeklyHours: 40, workdaysPerWeek: 5, vacationYearMode: 'both', openingBalanceMs: 0, contractVacationDays: null, includedOvertimeHoursPerMonth: null, balanceNote: '', clockodo: null }]));
    localStorage.setItem(P + 'activeEmployment', 'emp-1');
    localStorage.setItem(P + 'sickPeriods', JSON.stringify(k));
  }, { start: T(2026, 10, 1) }, krank);
  const mehr = async () => {
    await page.reload({ waitUntil: 'networkidle0' });
    await page.evaluate(() => [...document.querySelectorAll('.bottom-nav .nav-item')].find((b) => b.textContent.trim().startsWith('Mehr')).click());
    await pause(700);
    return page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  };

  await fuellen([{ employmentId: 'emp-1', from: T(2026, 10, 20), to: T(2026, 10, 22), certificate: true }]);
  const mit = await mehr();
  pruefe('U1 Krankheit vom 20. bis 22.10.2026: Hinweis zur Wartezeit bis 28.10.2026', mit.includes(HINWEIS), mit.slice(mit.indexOf('Krankheitszeiten'), mit.indexOf('Krankheitszeiten') + 600));

  await fuellen([{ employmentId: 'emp-1', from: T(2026, 11, 2), to: T(2026, 11, 3), certificate: true }]);
  const ohne = await mehr();
  pruefe('U2 Krankheit erst im November: kein Hinweis zur Wartezeit', !ohne.includes('ersten vier Wochen'), ohne.slice(ohne.indexOf('Krankheitszeiten'), ohne.indexOf('Krankheitszeiten') + 400));
  pruefe('U3 Gegenprobe: der Zeitraum steht in der Liste', ohne.includes('02.11.2026 bis 03.11.2026 (2 Kalendertage), mit Bescheinigung'), ohne.slice(ohne.indexOf('Krankheitszeiten'), ohne.indexOf('Krankheitszeiten') + 400));
} catch (err) {
  pruefe('ABBRUCH', false, String(err?.message ?? err));
} finally {
  await browser.close();
}
for (const r of ergebnisse) console.log(`${r.ok ? 'OK  ' : 'ROT '} ${r.name}${r.ok ? '' : '  <- ' + r.detail}`);
const ok = ergebnisse.filter((r) => r.ok).length;
console.log(`${ok}/${ergebnisse.length}`);
process.exit(ok === ergebnisse.length ? 0 : 1);
