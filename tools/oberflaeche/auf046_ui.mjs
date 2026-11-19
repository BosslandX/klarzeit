// Oberflaechenprobe AUF-046: halbe Urlaubstage -- Kaestchen beim Einzeltag (Mehr), Kennzeichen in der Liste, die
// Zaehlung 0,5 in Konto und Urlaubsstand (Reports, Monat) und gespeichert als halfDay: true. Zwei Tage im laufenden
// Monat November 2026 (die Auswertung zeigt ihn ohne Blaettern): 04.11. halb, 05.11. ganz.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const [URL] = process.argv.slice(2);
const ergebnisse = [];
const pruefe = (name, ok, detail = '') => ergebnisse.push({ name, ok: Boolean(ok), detail });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const reiter = async (name) => {
    await page.evaluate((n) => [...document.querySelectorAll('.bottom-nav .nav-item')].find((b) => b.textContent.trim().startsWith(n)).click(), name);
    await pause(600);
  };
  const kaestchen = () => page.evaluate(() => {
    const l = [...document.querySelectorAll('label.field.row')].find((x) => x.textContent.trim().startsWith('halber Tag'));
    return l ? l.querySelector('input[type="checkbox"]') !== null : false;
  });
  const eintragen = async (datum, halb) => {
    await page.evaluate((d) => {
      const inp = document.querySelector('.vac-add input[type="date"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, d);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }, datum);
    await pause(200);
    if (halb) {
      // bedingt: am Stand ohne halbe Tage (Gegenprobe) fehlt das Kaestchen, dann melden U2/U3/U5 rot statt ABBRUCH
      await page.evaluate(() => [...document.querySelectorAll('label.field.row')].find((x) => x.textContent.trim().startsWith('halber Tag'))?.querySelector('input')?.click());
      await pause(200);
    }
    await page.evaluate(() => [...document.querySelectorAll('.vac-add button')].find((b) => b.textContent.includes('Urlaubstag hinzufuegen')).click());
    await pause(500);
  };
  const zeile = (datum) => page.evaluate((d) => [...document.querySelectorAll('.vac-list li')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()).find((t) => t.includes(d)) ?? '', datum);

  await reiter('Mehr');
  pruefe('U1 Mehr: Kaestchen "halber Tag" beim Einzeltag', await kaestchen());
  await eintragen('2026-11-04', true);
  const halb = await zeile('04.11.2026');
  pruefe('U2 der halbe Tag steht in der Liste mit "halber Tag"', halb.includes('halber Tag'), halb);
  const nachher = await page.evaluate(() => {
    const l = [...document.querySelectorAll('label.field.row')].find((x) => x.textContent.trim().startsWith('halber Tag'));
    return l ? l.querySelector('input').checked : null;
  });
  pruefe('U3 nach dem Eintragen ist das Kaestchen wieder leer', nachher === false, String(nachher));
  await eintragen('2026-11-05', false);
  const ganz = await zeile('05.11.2026');
  pruefe('U4 der ganze Tag steht ohne "halber Tag" in der Liste', ganz !== '' && !ganz.includes('halber Tag'), ganz);
  const gespeichert = await page.evaluate(() => JSON.parse(localStorage.getItem('CapacitorStorage.vacations') ?? '[]'));
  const tag = (d) => gespeichert.find((x) => new Date(x.date).getDate() === d);
  pruefe('U5 gespeichert: 04.11. mit halfDay true, 05.11. ohne das Feld',
    tag(4)?.halfDay === true && tag(5) !== undefined && !('halfDay' in tag(5)), JSON.stringify(gespeichert));

  await reiter('Reports');
  await page.evaluate(() => [...document.querySelectorAll('.seg')].find((b) => b.textContent.trim() === 'Monat').click());
  await pause(800);
  // Beschriftung und Wert getrennt: zwischen <span> und <strong> steht kein Leerzeichen
  const reihen = await page.evaluate(() => [...document.querySelectorAll('.konto-row')].map((x) =>
    `${x.querySelector('span')?.textContent.trim() ?? ''}|${x.querySelector('strong')?.textContent.trim() ?? ''}`));
  pruefe('U6 Reports, Monat: Kontozeile "Urlaub (1,50 Tage)"', reihen.some((t) => t.startsWith('Urlaub (1,50 Tage)|')), JSON.stringify(reihen));
  pruefe('U7 Reports, Monat: Urlaubsstand "genommen" = "1,50 Tage"', reihen.includes('genommen|1,50 Tage'), JSON.stringify(reihen));
} catch (err) {
  pruefe('ABBRUCH', false, String(err?.message ?? err));
} finally {
  await browser.close();
}
for (const r of ergebnisse) console.log(`${r.ok ? 'OK  ' : 'ROT '} ${r.name}${r.ok ? '' : '  <- ' + r.detail}`);
const ok = ergebnisse.filter((r) => r.ok).length;
console.log(`${ok}/${ergebnisse.length}`);
process.exit(ok === ergebnisse.length ? 0 : 1);
