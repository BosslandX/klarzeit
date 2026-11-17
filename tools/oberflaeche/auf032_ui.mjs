// Oberflaechenprobe AUF-032: Vertrag gueltig ab im Formular, Auswertung, Update-Abschnitt.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const [URL] = process.argv.slice(2);
const ergebnisse = [];
const pruefe = (name, ok, detail = '') => ergebnisse.push({ name, ok: Boolean(ok), detail });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const dialoge = [];

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--lang=de-DE'] });
try {
  const page = await browser.newPage();
  page.on('dialog', async (d) => { dialoge.push(d.message()); await d.accept(); });
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    const P = 'CapacitorStorage.';
    localStorage.clear();
    localStorage.setItem(P + 'profile', JSON.stringify({ vorname: 'Max', nachname: 'Mustermann', personalnummer: '', arbeitgeber: '', abteilung: '' }));
    localStorage.setItem(P + 'employments', JSON.stringify([{ id: 'emp-1', name: 'Teilzeit', arbeitgeber: 'Muster GmbH', personalnummer: '', abteilung: '', startDate: new Date(2026, 0, 1).getTime(), endDate: null, weeklyHours: 20, workdaysPerWeek: 5, vacationYearMode: 'both', openingBalanceMs: 0, contractVacationDays: null, includedOvertimeHoursPerMonth: null, balanceNote: '', clockodo: null }]));
    localStorage.setItem(P + 'activeEmployment', 'emp-1');
    localStorage.setItem(P + 'vacations', '[]');
  });
  await page.reload({ waitUntil: 'networkidle0' });
  const tab = async (l) => { await page.evaluate((x) => [...document.querySelectorAll('.bottom-nav .nav-item')].find((b) => b.textContent.trim().startsWith(x)).click(), l); await pause(500); };
  const bearbeiten = async () => { await page.evaluate(() => [...document.querySelectorAll('li')].find((x) => x.textContent.includes('Teilzeit') && x.querySelector('.link-btn')).querySelector('.link-btn').click()); await pause(400); };
  const setzeStunden = async (h) => {
    await page.evaluate((w) => {
      const inp = [...document.querySelectorAll('label.field')].find((l) => l.textContent.includes('Wochenarbeitszeit')).querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, String(w));
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }, h);
    await pause(250);
  };
  const giltAb = () => page.evaluate(() => { const l = [...document.querySelectorAll('label.field')].find((x) => x.textContent.trim().startsWith('Gilt ab')); return l ? l.querySelector('input').value : null; });
  // Ueber die Klasse, nicht den Text: nach dem Speichern zeigt der Knopf 1,8 s lang "Gespeichert".
  const speichern = async () => { await page.evaluate(() => document.querySelector('.emp-edit .btn-primary').click()); await pause(600); };
  const gespeichert = () => page.evaluate(() => JSON.parse(localStorage.getItem('CapacitorStorage.employments'))[0]);
  const text = () => page.evaluate(() => document.body.innerText);

  await tab('Mehr');
  await bearbeiten();
  pruefe('V1 ohne Aenderung keine Frage', (await giltAb()) === null);
  await setzeStunden(30);
  const heute = new Date();
  const erster = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, '0')}-01`;
  pruefe('V2 Aenderung: Gilt ab = 1. des Monats', (await giltAb()) === erster, String(await giltAb()));
  await speichern();
  let e = await gespeichert();
  const vortag = new Date(heute.getFullYear(), heute.getMonth(), 0);
  pruefe('V3 gespeichert: 30 h, frueherer Stand 20 h bis Monatsende davor',
    e.weeklyHours === 30 && e.contractHistory?.length === 1 && e.contractHistory[0].weeklyHours === 20 && e.contractHistory[0].validUntil === vortag.getTime(),
    JSON.stringify({ w: e.weeklyHours, h: e.contractHistory }));

  await bearbeiten();
  const zeile = `bis ${String(vortag.getDate()).padStart(2, '0')}.${String(vortag.getMonth() + 1).padStart(2, '0')}.${vortag.getFullYear()}: 20 Std./Woche, 5 Arbeitstage`;
  pruefe('V4 Liste der frueheren Staende', (await text()).includes(zeile), zeile);

  await setzeStunden(40);
  await page.evaluate((t) => {
    const inp = [...document.querySelectorAll('label.field')].find((x) => x.textContent.trim().startsWith('Gilt ab')).querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, t);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, `${vortag.getFullYear()}-${String(vortag.getMonth() + 1).padStart(2, '0')}-15`);
  await pause(250);
  await speichern();
  e = await gespeichert();
  pruefe('V5 Datum vor dem letzten Stand: Meldung, nichts gespeichert', dialoge.some((m) => m.includes('Gilt ab')) && e.weeklyHours === 30, JSON.stringify({ dialoge, w: e.weeklyHours }));

  await page.evaluate(() => [...document.querySelectorAll('label.field.row')].find((l) => l.textContent.includes('Korrektur')).querySelector('input').click());
  await pause(250);
  pruefe('V6 Korrektur: Datum gesperrt', await page.evaluate(() => [...document.querySelectorAll('label.field')].find((x) => x.textContent.trim().startsWith('Gilt ab')).querySelector('input').disabled));
  await speichern();
  e = await gespeichert();
  pruefe('V7 Korrektur gespeichert: 40 h, Liste unveraendert', e.weeklyHours === 40 && e.contractHistory?.length === 1, JSON.stringify({ w: e.weeklyHours, h: e.contractHistory }));

  await tab('Reports');
  await page.evaluate(() => [...document.querySelectorAll('.segmented .seg')].find((b) => b.textContent.trim() === 'Monat').click());
  await pause(500);
  const diesMonat = await text();
  await page.evaluate(() => document.querySelector('.period-nav .icon-btn[title="Zurueck"]').click());
  await pause(500);
  const vormonat = await text();
  pruefe('V8 Auswertung: Soll diesen Monat 173:20 h (40 h), Vormonat 86:40 h (20 h)',
    /Soll \(Monat\)\s*173:20 h/.test(diesMonat) && /Soll \(Monat\)\s*86:40 h/.test(vormonat),
    [(diesMonat.match(/Soll \(Monat\)[^\n]*\n?[^\n]*/) ?? [''])[0], (vormonat.match(/Soll \(Monat\)[^\n]*\n?[^\n]*/) ?? [''])[0]].join(' | '));

  await tab('Mehr');
  await bearbeiten();
  await page.evaluate(() => { const p = [...document.querySelectorAll('p')].find((x) => x.textContent.trim() === 'Fruehere Vertragsstaende'); [...p.nextElementSibling.querySelectorAll('button')][0].click(); });
  await pause(250);
  await speichern();
  e = await gespeichert();
  pruefe('V9 entfernen: kein frueherer Stand mehr', !('contractHistory' in e), JSON.stringify(e.contractHistory));
  pruefe('V10 App-Update-Abschnitt da', await page.evaluate(() => [...document.querySelectorAll('h2')].some((h) => h.textContent === 'App-Update') && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Nach Update suchen')));
} catch (err) {
  pruefe('ABBRUCH', false, String(err?.message ?? err));
} finally {
  await browser.close();
}
for (const r of ergebnisse) console.log(`${r.ok ? 'OK  ' : 'ROT '} ${r.name}${r.ok ? '' : '  <- ' + r.detail}`);
const ok = ergebnisse.filter((r) => r.ok).length;
console.log(`${ok}/${ergebnisse.length}`);
process.exit(ok === ergebnisse.length ? 0 : 1);
