// Oberflaechenprobe AUF-027: Wochentage im Beschaeftigungsformular, Speichern, Urlaubszeitraum.
// Aufruf: node auf027_ui.mjs <url> <screenshot-praefix>
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const [URL, SHOT] = process.argv.slice(2);

const ergebnisse = [];
const pruefe = (name, ok, detail = '') => ergebnisse.push({ name, ok: Boolean(ok), detail });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=de-DE'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    const P = 'CapacitorStorage.';
    localStorage.clear();
    localStorage.setItem(P + 'profile', JSON.stringify({ vorname: 'Max', nachname: 'Mustermann', personalnummer: '', arbeitgeber: '', abteilung: '' }));
    const base = { arbeitgeber: 'Muster GmbH', personalnummer: '', abteilung: '', startDate: new Date(2026, 0, 1).getTime(), endDate: null, vacationYearMode: 'both', openingBalanceMs: 0, contractVacationDays: null, includedOvertimeHoursPerMonth: null, balanceNote: '', clockodo: null };
    localStorage.setItem(P + 'employments', JSON.stringify([
      { ...base, id: 'emp-1', name: 'Teilzeit', weeklyHours: 20, workdaysPerWeek: 4 },
      { ...base, id: 'emp-2', name: 'Vollzeit', weeklyHours: 40, workdaysPerWeek: 5 },
    ]));
    localStorage.setItem(P + 'activeEmployment', 'emp-1');
    localStorage.setItem(P + 'vacations', '[]');
  });
  await page.reload({ waitUntil: 'networkidle0' });

  const tab = async (label) => {
    await page.evaluate((l) => {
      const b = [...document.querySelectorAll('.bottom-nav .nav-item')].find((x) => x.textContent.trim().startsWith(l));
      if (!b) throw new Error('Tab fehlt: ' + l);
      b.click();
    }, label);
    await pause(400);
  };
  const bearbeiten = async (name) => {
    await page.evaluate((n) => {
      const li = [...document.querySelectorAll('li')].find((x) => x.textContent.includes(n) && x.querySelector('.link-btn'));
      if (!li) throw new Error('Beschaeftigung fehlt: ' + n);
      li.querySelector('.link-btn').click();
    }, name);
    await pause(400);
  };
  const zustand = () =>
    page.evaluate(() => {
      const g = document.querySelector('[role="group"][aria-label="Arbeitstage"]');
      const feld = g?.closest('.field');
      return {
        da: Boolean(g),
        knoepfe: g ? [...g.querySelectorAll('button')].map((b) => b.textContent.trim()) : [],
        aktiv: g ? [...g.querySelectorAll('button.active')].map((b) => b.textContent.trim()) : [],
        pressed: g ? [...g.querySelectorAll('button[aria-pressed="true"]')].length : -1,
        label: feld?.querySelector('span')?.textContent.trim() ?? '',
        hinweis: document.body.innerText.includes('Bitte die Wochentage waehlen'),
      };
    });
  const tippe = async (label) => {
    await page.evaluate((l) => {
      const g = document.querySelector('[role="group"][aria-label="Arbeitstage"]');
      const b = [...g.querySelectorAll('button')].find((x) => x.textContent.trim() === l);
      b.click();
    }, label);
    await pause(150);
  };

  await tab('Mehr');
  await bearbeiten('Teilzeit');
  let z = await zustand();
  pruefe('U1 Feld mit sieben Knoepfen Mo..So', z.da && z.knoepfe.join(',') === 'Mo,Di,Mi,Do,Fr,Sa,So', z.knoepfe.join(','));
  pruefe('U2 Bestand 4 Tage: keine Auswahl, Hinweis, Zahl 4', z.aktiv.length === 0 && z.hinweis && z.label === 'Arbeitstage (4 pro Woche)', JSON.stringify(z));
  if (SHOT) await page.screenshot({ path: `${SHOT}-vorher.png`, fullPage: true });

  for (const t of ['Mo', 'Di', 'Mi', 'Do']) await tippe(t);
  z = await zustand();
  pruefe('U3 Mo-Do gewaehlt, Zahl 4, Hinweis weg', z.aktiv.join(',') === 'Mo,Di,Mi,Do' && z.pressed === 4 && z.label === 'Arbeitstage (4 pro Woche)' && !z.hinweis, JSON.stringify(z));
  for (const t of ['Fr', 'Sa', 'So']) await tippe(t);
  z = await zustand();
  pruefe('U4 hoechstens sechs: So bleibt aus', z.aktiv.join(',') === 'Mo,Di,Mi,Do,Fr,Sa' && z.label === 'Arbeitstage (6 pro Woche)', JSON.stringify(z));
  for (const t of ['Sa', 'Fr']) await tippe(t);
  z = await zustand();
  pruefe('U5 zurueck auf Mo-Do', z.aktiv.join(',') === 'Mo,Di,Mi,Do', JSON.stringify(z));
  if (SHOT) await page.screenshot({ path: `${SHOT}-gewaehlt.png`, fullPage: true });

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Aenderungen speichern'));
    b.click();
  });
  await pause(600);
  const gespeichert = await page.evaluate(() => JSON.parse(localStorage.getItem('CapacitorStorage.employments')));
  const e1 = gespeichert.find((e) => e.id === 'emp-1');
  pruefe('U6 gespeichert: workWeekdays [1,2,3,4], workdaysPerWeek 4', JSON.stringify(e1.workWeekdays) === '[1,2,3,4]' && e1.workdaysPerWeek === 4, JSON.stringify({ w: e1.workWeekdays, n: e1.workdaysPerWeek }));
  const e2 = gespeichert.find((e) => e.id === 'emp-2');
  pruefe('U7 andere Beschaeftigung unberuehrt', !('workWeekdays' in e2) && e2.workdaysPerWeek === 5, JSON.stringify(e2));

  await page.evaluate(() => {
    const setze = (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const [von, bis] = document.querySelectorAll('.vac-range input[type="date"]');
    setze(von, '2026-06-08');
    setze(bis, '2026-06-14');
  });
  await pause(300);
  const knopf = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).find((t) => t.includes('Arbeitstag(e) eintragen')) ?? '');
  pruefe('U8 Urlaubszeitraum Mo 08.06.-So 14.06.: 4 Tage', knopf === '4 Arbeitstag(e) eintragen', knopf);
  const hilfe = await page.evaluate(() => document.body.innerText.includes('Es zaehlen die Wochentage der Beschaeftigung'));
  pruefe('U9 neuer Hilfetext beim Zeitraum', hilfe);

  await bearbeiten('Vollzeit');
  z = await zustand();
  pruefe('U10 Bestand 5 Tage: Mo-Fr gezeigt, kein Hinweis', z.aktiv.join(',') === 'Mo,Di,Mi,Do,Fr' && !z.hinweis && z.label === 'Arbeitstage (5 pro Woche)', JSON.stringify(z));
} catch (e) {
  pruefe('ABBRUCH', false, String(e?.message ?? e));
} finally {
  await browser.close();
}
for (const r of ergebnisse) console.log(`${r.ok ? 'OK  ' : 'ROT '} ${r.name}${r.ok ? '' : '  <- ' + r.detail}`);
const ok = ergebnisse.filter((r) => r.ok).length;
console.log(`${ok}/${ergebnisse.length}`);
process.exit(ok === ergebnisse.length ? 0 : 1);
