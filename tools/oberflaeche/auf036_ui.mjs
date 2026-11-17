// Oberflaechenprobe AUF-036: Veranlassung im Formular eintragen, in "Eintraege" sehen, wieder leeren.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const [URL] = process.argv.slice(2);
const ergebnisse = [];
const pruefe = (name, ok, detail = '') => ergebnisse.push({ name, ok: Boolean(ok), detail });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const TEXT = 'angeordnet von der Teamleitung am 09.11. per E-Mail';

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
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(() => [...document.querySelectorAll('.bottom-nav .nav-item')].find((b) => b.textContent.trim().startsWith('Eintr')).click());
  await pause(600);
  const feld = (wert) => page.evaluate((w) => {
    const inp = [...document.querySelectorAll('.modal label.field')].find((l) => l.querySelector('span')?.textContent.startsWith('Veranlassung')).querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, w);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, wert);
  const speichern = async () => { await page.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'Speichern').click()); await pause(700); };
  const karten = () => page.evaluate(() => [...document.querySelectorAll('.entry-card')].map((k) => k.innerText.replace(/\s+/g, ' ')));

  await page.evaluate(() => document.querySelector('.fab[title="Zeit nachtragen"]').click());
  await pause(400);
  const hilfe = await page.evaluate(() => document.querySelector('.modal').innerText.replace(/\s+/g, ' '));
  pruefe('V1 Formular: Feld und Hinweis mit Urteil', hilfe.includes('Veranlassung von Ueberstunden (optional)') && hilfe.includes('5 AZR 359/21'), hilfe.slice(0, 200));
  await feld(TEXT);
  await pause(150);
  await speichern();
  const nach = await karten();
  pruefe('V2 nachgetragener Eintrag zeigt die Veranlassung', nach.some((k) => k.includes(`Veranlassung: ${TEXT}`)), JSON.stringify(nach));
  await page.evaluate(() => [...document.querySelectorAll('.entry-card')][0].querySelector('[title="Bearbeiten"]').click());
  await pause(400);
  const vorbelegt = await page.evaluate(() => [...document.querySelectorAll('.modal label.field')].find((l) => l.querySelector('span')?.textContent.startsWith('Veranlassung')).querySelector('input').value);
  pruefe('V3 Bearbeiten: Feld vorbelegt', vorbelegt === TEXT, vorbelegt);
  await feld('   ');
  await pause(150);
  await speichern();
  const leer = await karten();
  pruefe('V4 geleert: keine Zeile mehr', leer.length === 1 && !leer[0].includes('Veranlassung'), JSON.stringify(leer));
} catch (err) {
  pruefe('ABBRUCH', false, String(err?.message ?? err));
} finally {
  await browser.close();
}
for (const r of ergebnisse) console.log(`${r.ok ? 'OK  ' : 'ROT '} ${r.name}${r.ok ? '' : '  <- ' + r.detail}`);
const ok = ergebnisse.filter((r) => r.ok).length;
console.log(`${ok}/${ergebnisse.length}`);
process.exit(ok === ergebnisse.length ? 0 : 1);
