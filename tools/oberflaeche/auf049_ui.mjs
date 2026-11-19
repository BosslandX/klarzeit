// Oberflaechenprobe AUF-049: Notiz am Urlaubstag, je Zeile der Urlaubsliste in "Mehr". Drei Tage im November 2026:
// 04.11. ohne Notiz, 05.11. mit "Brueckentag", 06.11. in Clockodo genehmigt (laesst sich nicht entfernen). Geprueft
// werden Anzeige, Eintragen (getrimmt), Abbrechen, Loeschen, der beantragte Tag und das Neuladen.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const [URL] = process.argv.slice(2);
const ergebnisse = [];
const pruefe = (name, ok, detail = '') => ergebnisse.push({ name, ok: Boolean(ok), detail });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (y, m, d) => new Date(y, m - 1, d).getTime();
const MI = T(2026, 11, 4);
const DO = T(2026, 11, 5);
const FR = T(2026, 11, 6);

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
    const clockodo = { apiUser: 'testnutzer', syncFrom: d.start, defaultCustomersId: null, defaultProjectsId: null, defaultServicesId: null, billable: null };
    localStorage.setItem(P + 'employments', JSON.stringify([{ id: 'emp-1', name: 'Vollzeit', arbeitgeber: 'Muster GmbH', personalnummer: '', abteilung: '', startDate: d.start, endDate: null, weeklyHours: 40, workdaysPerWeek: 5, vacationYearMode: 'both', openingBalanceMs: 0, contractVacationDays: null, includedOvertimeHoursPerMonth: null, balanceNote: '', clockodo }]));
    localStorage.setItem(P + 'activeEmployment', 'emp-1');
    localStorage.setItem(P + 'vacations', JSON.stringify([
      { employmentId: 'emp-1', date: d.mi, note: '' },
      { employmentId: 'emp-1', date: d.do, note: 'Brueckentag' },
      { employmentId: 'emp-1', date: d.fr, note: '', clockodoAbsence: { id: 9, status: 1, at: 1 } },
    ]));
  }, { start: T(2025, 1, 1), mi: MI, do: DO, fr: FR });
  await page.reload({ waitUntil: 'networkidle0' });
  const mehr = async () => {
    await page.evaluate(() => [...document.querySelectorAll('.bottom-nav .nav-item')].find((b) => b.textContent.trim().startsWith('Mehr')).click());
    await pause(600);
  };
  const zeile = (datum) => page.evaluate((d) => [...document.querySelectorAll('.vac-list li')]
    .map((x) => x.textContent.replace(/\s+/g, ' ').trim()).find((t) => t.includes(d)) ?? '', datum);
  // Klickt in der Zeile des Tages den Knopf mit genau diesem Text; false, wenn es ihn nicht gibt.
  const knopf = async (datum, text) => {
    const ok = await page.evaluate((d, t) => {
      const li = [...document.querySelectorAll('.vac-list li')].find((x) => x.textContent.includes(d));
      const b = li ? [...li.querySelectorAll('button')].find((x) => x.textContent.trim() === t) : undefined;
      if (!b) return false;
      b.click();
      return true;
    }, datum, text);
    await pause(400);
    return ok;
  };
  const feld = () => page.evaluate(() => {
    const el = document.querySelector('input[aria-label="Notiz zum Urlaubstag"]');
    return el ? { wert: el.value, max: el.maxLength } : null;
  });
  const setzeFeld = (wert) => page.evaluate((w) => {
    const el = document.querySelector('input[aria-label="Notiz zum Urlaubstag"]');
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, w);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, wert);
  const gespeichert = (ms) => page.evaluate((t) =>
    JSON.parse(localStorage.getItem('CapacitorStorage.vacations') ?? '[]').find((v) => v.date === t) ?? null, ms);

  await mehr();
  const vorher = await zeile('05.11.2026');
  pruefe('U1 vorhandene Notiz steht in der Zeile ("Notiz: Brueckentag")', vorher.includes('Notiz: Brueckentag'), vorher);

  const k2 = await knopf('04.11.2026', 'Notiz');
  const f2 = await feld();
  pruefe('U2 Knopf "Notiz" oeffnet ein leeres Feld mit hoechstens 200 Zeichen', k2 && f2?.wert === '' && f2?.max === 200, JSON.stringify(f2));

  await setzeFeld('  Hochzeit  ');
  await knopf('04.11.2026', 'speichern');
  const z3 = await zeile('04.11.2026');
  const s3 = await gespeichert(MI);
  pruefe('U3 gespeichert und angezeigt, getrimmt ("Hochzeit")', z3.includes('Notiz: Hochzeit') && s3?.note === 'Hochzeit', `${z3} | ${JSON.stringify(s3)}`);

  const k4 = await knopf('05.11.2026', 'Notiz');
  const f4 = await feld();
  await knopf('05.11.2026', 'abbrechen');
  const z4 = await zeile('05.11.2026');
  const s4 = await gespeichert(DO);
  pruefe('U4 Feld mit der Notiz vorbelegt, "abbrechen" aendert nichts',
    k4 && f4?.wert === 'Brueckentag' && z4.includes('Notiz: Brueckentag') && s4?.note === 'Brueckentag', `${JSON.stringify(f4)} | ${z4}`);

  const k5 = await knopf('05.11.2026', 'Notiz');
  await setzeFeld('');
  await knopf('05.11.2026', 'speichern');
  const z5 = await zeile('05.11.2026');
  const s5 = await gespeichert(DO);
  pruefe('U5 leer gespeichert loescht die Notiz', k5 && !z5.includes('Notiz:') && s5?.note === '', `${z5} | ${JSON.stringify(s5)}`);

  const z6vor = await zeile('06.11.2026');
  const k6 = await knopf('06.11.2026', 'Notiz');
  await setzeFeld('Antrag per Mail');
  await knopf('06.11.2026', 'speichern');
  const z6 = await zeile('06.11.2026');
  const s6 = await gespeichert(FR);
  pruefe('U6 genehmigter Tag ohne "entfernen" bekommt eine Notiz, der Antrag bleibt',
    k6 && !z6vor.includes('entfernen') && z6.includes('Notiz: Antrag per Mail') && s6?.note === 'Antrag per Mail'
      && s6?.clockodoAbsence?.id === 9 && s6?.clockodoAbsence?.status === 1, `${z6} | ${JSON.stringify(s6)}`);

  await page.reload({ waitUntil: 'networkidle0' });
  await mehr();
  const z7a = await zeile('04.11.2026');
  const z7b = await zeile('06.11.2026');
  pruefe('U7 nach dem Neuladen stehen beide Notizen noch da', z7a.includes('Notiz: Hochzeit') && z7b.includes('Notiz: Antrag per Mail'), `${z7a} | ${z7b}`);
} catch (err) {
  pruefe('ABBRUCH', false, String(err?.message ?? err));
} finally {
  await browser.close();
}
for (const r of ergebnisse) console.log(`${r.ok ? 'OK  ' : 'ROT '} ${r.name}${r.ok ? '' : '  <- ' + r.detail}`);
const ok = ergebnisse.filter((r) => r.ok).length;
console.log(`${ok}/${ergebnisse.length}`);
process.exit(ok === ergebnisse.length ? 0 : 1);
