// Oberflaechenprobe AUF-043: MoreScreen aufgeteilt. Prueft, dass der Zustand, der das Formular
// "Beschaeftigung bearbeiten" ueberdauert, in MoreScreen geblieben ist (U1-U3), und nimmt mit
// AUF043_DATEI=<datei.json> in 15 festen Zustaenden das DOM von "Mehr" ab -- fuer den Vergleich
// alter gegen neuer Stand (gleiche Abzuege = gleiche Oberflaeche).
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const [URL] = process.argv.slice(2);
const DATEI = process.env.AUF043_DATEI;
const ergebnisse = [];
const pruefe = (name, ok, detail = '') => ergebnisse.push({ name, ok: Boolean(ok), detail });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (y, m, d) => new Date(y, m - 1, d).getTime();
const heute = new Date();
const ERSTER = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, '0')}-01`;
const abzuege = [];

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
    const clockodo = { apiUser: 'testnutzer', syncFrom: d.ab, defaultCustomersId: null, defaultProjectsId: null, defaultServicesId: null, billable: null };
    const basis = { personalnummer: '', abteilung: '', startDate: d.ab, endDate: null, workdaysPerWeek: 5, vacationYearMode: 'both', openingBalanceMs: 0, contractVacationDays: null, includedOvertimeHoursPerMonth: null, balanceNote: '' };
    localStorage.setItem(P + 'employments', JSON.stringify([
      { ...basis, id: 'emp-1', name: 'Vollzeit', arbeitgeber: 'Muster GmbH', weeklyHours: 40, clockodo },
      { ...basis, id: 'emp-2', name: 'Minijob', arbeitgeber: '', weeklyHours: 10, clockodo: null },
    ]));
    localStorage.setItem(P + 'activeEmployment', 'emp-1');
    localStorage.setItem(P + 'vacations', JSON.stringify([
      { employmentId: 'emp-1', date: d.mo, note: '', clockodoAbsence: { id: 9, status: 1, at: 1 } },
      { employmentId: 'emp-1', date: d.di, note: '' },
      { employmentId: 'emp-2', date: d.mi, note: '' },
    ]));
    localStorage.setItem(P + 'sickPeriods', JSON.stringify([
      { employmentId: 'emp-1', from: d.do, to: d.fr, certificate: true },
      { employmentId: 'emp-2', from: d.mo, to: d.mo, certificate: false },
    ]));
  }, { ab: T(2026, 1, 1), mo: T(2026, 10, 12), di: T(2026, 10, 13), mi: T(2026, 10, 14), do: T(2026, 10, 15), fr: T(2026, 10, 16) });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(() => [...document.querySelectorAll('.bottom-nav .nav-item')].find((b) => b.textContent.trim().startsWith('Mehr')).click());
  await pause(800);

  const abzug = async (name) => {
    const a = await page.evaluate(() => {
      const s = document.querySelector('.screen');
      return {
        html: s ? s.outerHTML : '',
        werte: s ? [...s.querySelectorAll('input, select, textarea')].map((e) => [e.tagName, e.type, e.value, e.checked === true, e.disabled === true]) : [],
      };
    });
    abzuege.push({ name, ...a });
  };
  // Feld ueber die Beschriftung (span) finden, wahlweise nur in einem Bereich (".vac-range").
  const setze = (beschriftung, wert, ereignis = 'input', bereich = 'body') => page.evaluate((b, w, e, ber) => {
    const l = [...document.querySelector(ber).querySelectorAll('label.field')].find((x) => x.querySelector('span')?.textContent.trim() === b);
    if (!l) throw new Error('Feld fehlt: ' + b);
    const el = l.querySelector('input, select');
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, w);
    el.dispatchEvent(new Event(e, { bubbles: true }));
  }, beschriftung, wert, ereignis, bereich);
  const wert = (beschriftung, bereich = 'body') => page.evaluate((b, ber) => {
    const l = [...document.querySelector(ber).querySelectorAll('label.field')].find((x) => x.querySelector('span')?.textContent.trim() === b);
    return l ? l.querySelector('input, select').value : null;
  }, beschriftung, bereich);
  const knopf = (teil) => page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(t));
    if (!b) throw new Error('Knopf fehlt: ' + t);
    b.click();
  }, teil);
  const speichernText = () => page.evaluate(() => document.querySelector('.emp-edit .btn-primary')?.textContent ?? null);
  const bearbeiten = async (name) => {
    await page.evaluate((n) => {
      const li = [...document.querySelectorAll('li')].find((x) => x.querySelector('strong')?.textContent === n && x.querySelector('.link-btn'));
      if (!li) throw new Error('Beschaeftigung fehlt: ' + n);
      li.querySelector('.link-btn').click();
    }, name);
    await pause(500);
  };

  await abzug('S1 geladen');
  await setze('Vorname', 'Erika');
  await pause(300);
  await abzug('S2 Vorname geaendert');
  await knopf('Profil speichern');
  await pause(300);
  await abzug('S3 Profil gespeichert');
  await bearbeiten('Vollzeit');
  await abzug('S4 Vollzeit bearbeiten');
  await setze('Wochenarbeitszeit (Stunden)', '30');
  await pause(300);
  const ga1 = await wert('Gilt ab');
  await setze('Gilt ab', '2026-06-01');
  await pause(300);
  await abzug('S5 Gilt ab geaendert');
  await bearbeiten('Vollzeit');
  await abzug('S6 Vollzeit erneut geoeffnet');
  await setze('Wochenarbeitszeit (Stunden)', '30');
  await pause(300);
  const ga2 = await wert('Gilt ab');
  pruefe('U2 erneutes Oeffnen setzt "Gilt ab" auf den 1. des Monats zurueck', ga1 === ERSTER && ga2 === ERSTER, `vorher ${ga1}, nach erneutem Oeffnen ${ga2}, erwartet ${ERSTER}`);
  await abzug('S7 nach erneutem Oeffnen geaendert');
  await knopf('Bearbeiten abbrechen');
  await pause(300);
  await abzug('S8 abgebrochen');
  await setze('Urlaub fuer Beschaeftigung', 'emp-2', 'change');
  await pause(400);
  await abzug('S9 Urlaub fuer Minijob');
  await setze('von', '2026-11-02', 'input', '.vac-range');
  await setze('bis', '2026-11-06', 'input', '.vac-range');
  await pause(400);
  await abzug('S10 Zeitraum eingegeben');
  await bearbeiten('Vollzeit');
  const offen = [await wert('von', '.vac-range'), await wert('bis', '.vac-range')];
  await abzug('S11 Formular offen, Zeitraum steht');
  await knopf('Bearbeiten abbrechen');
  await pause(300);
  const zu = [await wert('von', '.vac-range'), await wert('bis', '.vac-range')];
  pruefe('U3 Zeitraum bleibt beim Oeffnen und Schliessen des Formulars stehen', [...offen, ...zu].join() === '2026-11-02,2026-11-06,2026-11-02,2026-11-06', `offen ${offen}, geschlossen ${zu}`);
  await knopf('Arbeitstag(e) eintragen');
  await pause(500);
  await abzug('S12 Zeitraum eingetragen');
  await page.evaluate(() => {
    const el = document.querySelector('.vac-add input[type="date"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '2026-11-20');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await pause(300);
  await knopf('Urlaubstag hinzufuegen');
  await pause(500);
  await abzug('S13 Einzeltag eingetragen');
  await bearbeiten('Vollzeit');
  await knopf('Aenderungen speichern');
  await pause(400);
  await bearbeiten('Vollzeit');
  const t1 = await speichernText();
  await abzug('S14 kurz nach dem Speichern geoeffnet');
  await pause(2200);
  const t2 = await speichernText();
  pruefe('U1 "Gespeichert" steht nach erneutem Oeffnen noch da und laeuft nach 1,8 s ab', t1 === '\u2713 Gespeichert' && t2 === 'Aenderungen speichern', `kurz danach ${t1}, spaeter ${t2}`);
  await abzug('S15 Anzeige abgelaufen');
  pruefe('U4 keine Dialoge', dialoge.length === 0, JSON.stringify(dialoge));
} catch (err) {
  pruefe('ABBRUCH', false, String(err?.message ?? err));
} finally {
  await browser.close();
}
if (DATEI) fs.writeFileSync(DATEI, JSON.stringify(abzuege, null, 1), 'utf8');
for (const r of ergebnisse) console.log(`${r.ok ? 'OK  ' : 'ROT '} ${r.name}${r.ok ? '' : '  <- ' + r.detail}`);
const ok = ergebnisse.filter((r) => r.ok).length;
console.log(`${ok}/${ergebnisse.length}${DATEI ? ` | ${abzuege.length} Abzuege nach ${DATEI}` : ''}`);
process.exit(ok === ergebnisse.length ? 0 : 1);
