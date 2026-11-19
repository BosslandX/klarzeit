// Oberflaechenprobe AUF-048: Resturlaub-Uebertrag ab Startwert. In "Beschaeftigung bearbeiten" ab Jahr 2026, Rest zu
// Beginn 5, verfallen 2026 2 Tage; die Auswertung (Reports, Monat November 2026) zeigt Uebertrag, verfallen und den Rest
// 20 + 5 - 2 - 1 = 22 (ein Urlaubstag am 04.11.2026). Beschaeftigung seit 2025, damit 2026 kein Eintrittsjahr ist.
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
    localStorage.setItem(P + 'employments', JSON.stringify([{ id: 'emp-1', name: 'Vollzeit', arbeitgeber: 'Muster GmbH', personalnummer: '', abteilung: '', startDate: new Date(2025, 0, 1).getTime(), endDate: null, weeklyHours: 40, workdaysPerWeek: 5, vacationYearMode: 'both', openingBalanceMs: 0, contractVacationDays: null, includedOvertimeHoursPerMonth: null, balanceNote: '', clockodo: null }]));
    localStorage.setItem(P + 'activeEmployment', 'emp-1');
    localStorage.setItem(P + 'vacations', JSON.stringify([{ employmentId: 'emp-1', date: new Date(2026, 10, 4).getTime(), note: '' }]));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  const reiter = async (name) => {
    await page.evaluate((n) => [...document.querySelectorAll('.bottom-nav .nav-item')].find((b) => b.textContent.trim().startsWith(n)).click(), name);
    await pause(600);
  };
  // Ein Feld nach seiner Beschriftung; liefert null, wenn es fehlt (Gegenprobe am alten Stand meldet dann rot statt ABBRUCH).
  const hat = (beschriftung, art) => page.evaluate((b, a) => {
    const l = [...document.querySelectorAll('label.field')].find((x) => x.querySelector('span')?.textContent.trim().startsWith(b));
    return l?.querySelector(a) ? true : false;
  }, beschriftung, art);
  const setze = (beschriftung, art, wert) => page.evaluate((b, a, w) => {
    const l = [...document.querySelectorAll('label.field')].find((x) => x.querySelector('span')?.textContent.trim().startsWith(b));
    const el = l?.querySelector(a);
    if (!el) return false;
    const proto = a === 'select' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, w);
    el.dispatchEvent(new Event(a === 'select' ? 'change' : 'input', { bubbles: true }));
    return true;
  }, beschriftung, art, wert);

  await reiter('Mehr');
  await page.evaluate(() => [...document.querySelectorAll('li')].find((x) => x.textContent.includes('Vollzeit') && x.querySelector('.link-btn')).querySelector('.link-btn').click());
  await pause(600);
  pruefe('U1 Beschaeftigung bearbeiten: Auswahl "Resturlaub-Uebertrag ab Jahr"', await hat('Resturlaub-Uebertrag ab Jahr', 'select'));
  await setze('Resturlaub-Uebertrag ab Jahr', 'select', '2026');
  await pause(300);
  pruefe('U2 nach der Wahl: Feld "Rest zu Beginn von 2026 (Tage)"', await hat('Rest zu Beginn von 2026', 'input'));
  await setze('Rest zu Beginn von 2026', 'input', '5');
  await pause(200);
  pruefe('U3 Feld "verfallen 2026 (Tage)"', await hat('verfallen 2026', 'input'));
  await setze('verfallen 2026', 'input', '2');
  await pause(200);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Aenderungen speichern'))?.click());
  await pause(600);
  const gespeichert = await page.evaluate(() => JSON.parse(localStorage.getItem('CapacitorStorage.employments') ?? '[]')[0]?.vacationCarry ?? null);
  pruefe('U4 gespeichert: vacationCarry ab 2026, Rest 5, verfallen 2026 2',
    JSON.stringify(gespeichert) === JSON.stringify({ fromYear: 2026, startDays: 5, lapsed: [{ year: 2026, days: 2 }] }), JSON.stringify(gespeichert));

  await reiter('Reports');
  await page.evaluate(() => [...document.querySelectorAll('.seg')].find((b) => b.textContent.trim() === 'Monat').click());
  await pause(800);
  // Beschriftung und Wert getrennt: zwischen <span> und <strong> steht kein Leerzeichen
  const reihen = await page.evaluate(() => [...document.querySelectorAll('.konto-row')].map((x) =>
    `${x.querySelector('span')?.textContent.trim() ?? ''}|${x.querySelector('strong')?.textContent.trim() ?? ''}`));
  pruefe('U5 Reports, Monat: "Uebertrag aus 2025" = "5 Tage"', reihen.includes('Uebertrag aus 2025|5 Tage'), JSON.stringify(reihen));
  pruefe('U6 Reports, Monat: "verfallen" = "-2 Tage"', reihen.includes('verfallen|-2 Tage'), JSON.stringify(reihen));
  pruefe('U7 Reports, Monat: "Resturlaub" = "22 Tage" (20 + 5 - 2 - 1)', reihen.includes('Resturlaub|22 Tage'), JSON.stringify(reihen));
} catch (err) {
  pruefe('ABBRUCH', false, String(err?.message ?? err));
} finally {
  await browser.close();
}
for (const r of ergebnisse) console.log(`${r.ok ? 'OK  ' : 'ROT '} ${r.name}${r.ok ? '' : '  <- ' + r.detail}`);
const ok = ergebnisse.filter((r) => r.ok).length;
console.log(`${ok}/${ergebnisse.length}`);
process.exit(ok === ergebnisse.length ? 0 : 1);
