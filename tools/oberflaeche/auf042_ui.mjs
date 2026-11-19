// Oberflaechenprobe AUF-042: Hinweis zum Rechtsstand der Feiertage frueherer Jahre (Mehr, Beschaeftigung).
// U2 seit AUF-044 angepasst: der 31.10.2017 ist auch im Saarland belegt, der Satz zur Luecke entfaellt.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const [URL] = process.argv.slice(2);
const ergebnisse = [];
const pruefe = (name, ok, detail = '') => ergebnisse.push({ name, ok: Boolean(ok), detail });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const SATZ = 'Fruehere Jahre rechnen nach dem damaligen Recht, ab 2017 amtlich belegt; davor gilt der Stand von 2017.';

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
    localStorage.setItem(P + 'vacations', '[]');
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(() => [...document.querySelectorAll('.bottom-nav .nav-item')].find((b) => b.textContent.trim().startsWith('Mehr')).click());
  await pause(600);
  // Beschaeftigung bearbeiten (wie die Probe von AUF-030).
  await page.evaluate(() => [...document.querySelectorAll('li')].find((x) => x.textContent.includes('Vollzeit') && x.querySelector('.link-btn')).querySelector('.link-btn').click());
  await pause(600);
  const waehle = async (land) => {
    await page.evaluate((code) => {
      const sel = [...document.querySelectorAll('label.field')].find((l) => l.textContent.includes('Feiertage (Bundesland')).querySelector('select');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, code);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, land);
    await pause(300);
  };
  const hinweis = () => page.evaluate(() => [...document.querySelectorAll('p')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()).find((t) => t.startsWith('Fruehere Jahre')) ?? '');

  await waehle('BY');
  const by = await hinweis();
  pruefe('U1 Bayern: Hinweis zum Rechtsstand, ohne Satz zum 31.10.2017', by === SATZ, by);
  await waehle('SL');
  const sl = await hinweis();
  pruefe('U2 Saarland: Hinweis zum Rechtsstand (seit AUF-044 ohne Satz zur Luecke)', sl === SATZ, sl);
  await waehle('');
  const keine = await hinweis();
  pruefe('U3 Gegenprobe: ohne Bundesland kein Hinweis', keine === '', keine);
} catch (err) {
  pruefe('ABBRUCH', false, String(err?.message ?? err));
} finally {
  await browser.close();
}
for (const r of ergebnisse) console.log(`${r.ok ? 'OK  ' : 'ROT '} ${r.name}${r.ok ? '' : '  <- ' + r.detail}`);
const ok = ergebnisse.filter((r) => r.ok).length;
console.log(`${ok}/${ergebnisse.length}`);
process.exit(ok === ergebnisse.length ? 0 : 1);
