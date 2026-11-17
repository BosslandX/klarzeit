// Oberflaechenprobe AUF-034: Krankheitszeiten eintragen, Hinweise, Auswertung Juni 2026.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const [URL] = process.argv.slice(2);
const ergebnisse = [];
const pruefe = (name, ok, detail = '') => ergebnisse.push({ name, ok: Boolean(ok), detail });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (y, m, d) => new Date(y, m - 1, d).getTime();

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--lang=de-DE'] });
try {
  const page = await browser.newPage();
  page.on('dialog', async (dlg) => { await dlg.accept(); });
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.evaluate((urlaub) => {
    const P = 'CapacitorStorage.';
    localStorage.clear();
    localStorage.setItem(P + 'profile', JSON.stringify({ vorname: 'Max', nachname: 'Mustermann', personalnummer: '', arbeitgeber: '', abteilung: '' }));
    localStorage.setItem(P + 'employments', JSON.stringify([{ id: 'emp-1', name: 'Vollzeit', arbeitgeber: 'Muster GmbH', personalnummer: '', abteilung: '', startDate: new Date(2026, 0, 1).getTime(), endDate: null, weeklyHours: 40, workdaysPerWeek: 5, vacationYearMode: 'both', openingBalanceMs: 0, contractVacationDays: null, includedOvertimeHoursPerMonth: null, balanceNote: '', clockodo: null }]));
    localStorage.setItem(P + 'activeEmployment', 'emp-1');
    localStorage.setItem(P + 'vacations', JSON.stringify(urlaub.map((date) => ({ employmentId: 'emp-1', date, note: '' }))));
  }, [8, 9, 10, 11, 12].map((d) => T(2026, 6, d)));
  await page.reload({ waitUntil: 'networkidle0' });
  const tab = async (l) => { await page.evaluate((x) => [...document.querySelectorAll('.bottom-nav .nav-item')].find((b) => b.textContent.trim().startsWith(x)).click(), l); await pause(500); };
  const text = () => page.evaluate(() => document.body.innerText);
  const setzeDatum = async (label, wert) => {
    await page.evaluate((l, w) => {
      const h = [...document.querySelectorAll('h3')].find((x) => x.textContent.startsWith('Krankheitszeiten'));
      let el = h.nextElementSibling;
      while (el && !el.classList.contains('vac-range')) el = el.nextElementSibling;
      const inp = [...el.querySelectorAll('label.field')].find((x) => x.querySelector('span').textContent === l).querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, w);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }, label, wert);
    await pause(150);
  };
  const eintragen = async (von, bis, au) => {
    await setzeDatum('krank von', von);
    await setzeDatum('bis', bis);
    await page.evaluate((soll) => {
      const box = [...document.querySelectorAll('label.field.row')].find((l) => l.textContent.includes('Bescheinigung liegt vor')).querySelector('input');
      if (box.checked !== soll) box.click();
    }, au);
    await pause(150);
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Krankheit eintragen').click());
    await pause(500);
  };
  const gespeichert = () => page.evaluate(() => JSON.parse(localStorage.getItem('CapacitorStorage.sickPeriods') ?? '[]'));

  await tab('Mehr');
  pruefe('K1 Abschnitt Krankheitszeiten da, noch leer', (await text()).includes('Noch keine Krankheitszeiten erfasst.'));
  await eintragen('2026-06-10', '2026-06-11', true);
  const z1 = '10.06.2026 bis 11.06.2026 (2 Kalendertage), mit Bescheinigung';
  pruefe('K2 eingetragen und gelistet', (await text()).includes(z1) && (await gespeichert()).length === 1, JSON.stringify(await gespeichert()));
  await eintragen('2026-06-11', '2026-06-12', false);
  pruefe('K3 Ueberschneidung abgewiesen', (await text()).includes('Nicht eingetragen') && (await gespeichert()).length === 1);
  const zeilen = await page.evaluate(() => [...document.querySelectorAll('.vac-list li')].map((li) => li.innerText.replace(/\s+/g, ' ')));
  const mi = zeilen.find((z) => z.includes('10.06.2026')) ?? '';
  const mo = zeilen.find((z) => z.includes('08.06.2026')) ?? '';
  pruefe('K4 Urlaubstag 10.06. mit Hinweis § 9, 08.06. ohne', mi.includes('krank mit Bescheinigung, zaehlt nicht als Urlaub') && !mo.includes('krank'), `${mi} | ${mo}`);
  await eintragen('2026-09-01', '2026-10-15', true);
  pruefe('K5 Hinweis ueber sechs Wochen', (await text()).includes('Krank vom 01.09.2026 bis 15.10.2026 (45 Kalendertage)'));

  await tab('Reports');
  await page.evaluate(() => [...document.querySelectorAll('.segmented .seg')].find((b) => b.textContent.trim() === 'Monat').click());
  await pause(400);
  for (let i = 0; i < 24; i++) {
    const titel = await page.evaluate(() => document.querySelector('.period-nav')?.innerText ?? '');
    if (titel.includes('Juni 2026')) break;
    await page.evaluate(() => document.querySelector('.period-nav .icon-btn[title="Zurueck"]').click());
    await pause(250);
  }
  const juni = await text();
  pruefe('K6 Auswertung Juni: Urlaub 3 Tage, Krankheit 2 Tage +16:00 h', /Urlaub \(3 Tage\)\s*\+24:00 h/.test(juni) && /Krankheit \(2 Tage\)\s*\+16:00 h/.test(juni), (juni.match(/Urlaub \([^\n]*\n?[^\n]*|Krankheit \([^\n]*\n?[^\n]*/g) ?? []).join(' | '));
  pruefe('K7 Urlaubsstand: genommen 3 Tage', /genommen\s*3 Tage/.test(juni), (juni.match(/genommen[^\n]*\n?[^\n]*/) ?? [''])[0]);

  await tab('Mehr');
  await page.evaluate(() => {
    const li = [...document.querySelectorAll('.vac-list li')].find((x) => x.innerText.includes('10.06.2026 bis 11.06.2026'));
    li.querySelector('button').click();
  });
  await pause(500);
  const rest = await gespeichert();
  pruefe('K8 entfernt, der lange Zeitraum bleibt', rest.length === 1 && rest[0].from === T(2026, 9, 1) && rest[0].certificate === true, JSON.stringify(rest));
} catch (err) {
  pruefe('ABBRUCH', false, String(err?.message ?? err));
} finally {
  await browser.close();
}
for (const r of ergebnisse) console.log(`${r.ok ? 'OK  ' : 'ROT '} ${r.name}${r.ok ? '' : '  <- ' + r.detail}`);
const ok = ergebnisse.filter((r) => r.ok).length;
console.log(`${ok}/${ergebnisse.length}`);
process.exit(ok === ergebnisse.length ? 0 : 1);
