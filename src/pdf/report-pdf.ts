import { jsPDF } from 'jspdf';
import autoTable, { type RowInput } from 'jspdf-autotable';
import type { Profile, TimeEntry } from '../domain/types';
import type { Period } from '../domain/aggregate';
import { groupByDay, totalBreakMinutes, totalMs } from '../domain/aggregate';
import {
  decimalHours,
  formatClock,
  formatDate,
  formatDays,
  formatDuration,
  formatSignedDuration,
  netMs,
} from '../domain/time';
import {
  dailyTargetMs,
  employedFractionOfMonth,
  fullMonthlyTargetMs,
  includedOvertimeCapMs,
  waitingPeriodEnd,
  type BalanceLedger,
  type Employment,
  type VacationStatus,
} from '../domain/employment';
import { displayName } from '../db/profile';

/** Zusatzdaten fuer Monatsreports: Arbeitszeitkonto + Urlaub. */
export interface ReportExtras {
  ledger: BalanceLedger;
  vacation: VacationStatus;
}

type RGB = [number, number, number];

// Markenpalette (App-Blau) + neutrale Business-Töne.
const ACCENT: RGB = [37, 99, 235]; // #2563EB
const ACCENT_DK: RGB = [30, 58, 138]; // #1E3A8A
const ACCENT_LT: RGB = [191, 219, 254]; // #BFDBFE
const CARD_BG: RGB = [239, 246, 255]; // #EFF6FF
const INK: RGB = [17, 24, 39]; // #111827
const MUTED: RGB = [107, 114, 128]; // #6B7280
const PANEL: RGB = [243, 244, 246]; // #F3F4F6
const LINE: RGB = [226, 232, 240]; // #E2E8F0
const ROW_ALT: RGB = [247, 249, 252]; // #F7F9FC
const DAYSUM: RGB = [219, 234, 254]; // #DBEAFE
const WHITE: RGB = [255, 255, 255];
const POS: RGB = [22, 163, 74]; // #16A34A (Ueberstunden / Resturlaub)
const NEG: RGB = [220, 38, 38]; // #DC2626 (Minusstunden / ueberzogen)

const MARGIN_X = 40;
const BAND_H = 86;
const BAND_H_COMPACT = 46;

const fill = (doc: jsPDF, c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
const stroke = (doc: jsPDF, c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
const ink = (doc: jsPDF, c: RGB) => doc.setTextColor(c[0], c[1], c[2]);

/** Vektorielles Uhr-Symbol (Markenmotiv): Kreis + Zeiger + Mittelpunkt. */
function drawClock(doc: jsPDF, cx: number, cy: number, r: number, c: RGB): void {
  stroke(doc, c);
  fill(doc, c);
  doc.setLineWidth(r * 0.14);
  doc.circle(cx, cy, r, 'S');
  doc.setLineWidth(r * 0.13);
  doc.line(cx, cy, cx, cy - r * 0.58); // Minutenzeiger nach oben
  doc.line(cx, cy, cx + r * 0.46, cy); // Stundenzeiger nach rechts
  doc.circle(cx, cy, r * 0.12, 'F');
}

/** Farbiges Kopfband mit Logo, Titel und Zeitraum. Kompakt = schmaler (Folgeseiten). */
function drawHeader(doc: jsPDF, period: Period, compact: boolean): void {
  const w = doc.internal.pageSize.getWidth();
  const h = compact ? BAND_H_COMPACT : BAND_H;
  fill(doc, ACCENT);
  doc.rect(0, 0, w, h, 'F');
  fill(doc, ACCENT_DK);
  doc.rect(0, h, w, 3, 'F');

  const cy = h / 2;
  drawClock(doc, MARGIN_X + (compact ? 12 : 17), cy, compact ? 11 : 17, WHITE);
  const tx = MARGIN_X + (compact ? 32 : 46);

  ink(doc, WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(compact ? 12 : 18);
  doc.text('Klarzeit', tx, compact ? cy + 4 : cy - 3);
  if (!compact) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    ink(doc, ACCENT_LT);
    doc.text('Arbeitszeitnachweis', tx, cy + 13);
  }

  ink(doc, WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(compact ? 10 : 12);
  doc.text(period.label, w - MARGIN_X, compact ? cy + 4 : cy - 3, {
    align: 'right',
  });
  if (!compact) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    ink(doc, ACCENT_LT);
    doc.text(`Erstellt am ${formatDate(Date.now())}`, w - MARGIN_X, cy + 13, {
      align: 'right',
    });
  }
}

/** Fußzeile mit Trennlinie und Quelle (Seitenzahl folgt separat). */
function drawFooter(doc: jsPDF): void {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  stroke(doc, LINE);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, h - 30, w - MARGIN_X, h - 30);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  ink(doc, MUTED);
  doc.text('Klarzeit – Arbeitszeitnachweis', MARGIN_X, h - 18);
}

/** Kopfzeilen-Daten: Person aus Profil, Vertrag aus Beschaeftigung. */
export function buildEmployeePanelFields(
  profile: Profile,
  employment: Employment,
): { label: string; value: string }[] {
  const fields: { label: string; value: string }[] = [
    { label: 'Mitarbeiter', value: displayName(profile) },
  ];
  if (employment.personalnummer) {
    fields.push({ label: 'Personalnummer', value: employment.personalnummer });
  }
  const org = [employment.arbeitgeber, employment.abteilung].filter(Boolean).join(' – ');
  if (org) {
    const label =
      employment.arbeitgeber && employment.abteilung
        ? 'Arbeitgeber / Abteilung'
        : employment.arbeitgeber
          ? 'Arbeitgeber'
          : 'Abteilung';
    fields.push({ label, value: org });
  }
  return fields;
}

/** Mitarbeiter-Panel (graue Box mit Label/Wert-Spalten). Gibt das untere Y zurück. */
function drawEmployeePanel(
  doc: jsPDF,
  profile: Profile,
  employment: Employment,
  top: number,
): number {
  const w = doc.internal.pageSize.getWidth();
  const contentW = w - 2 * MARGIN_X;
  const fields = buildEmployeePanelFields(profile, employment);

  const colW = contentW / fields.length;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  const wrapped = fields.map((f) =>
    doc.splitTextToSize(f.value, colW - 22) as string[],
  );
  const maxLines = Math.max(...wrapped.map((w) => w.length));
  const panelH = 22 + maxLines * 13 + 6;

  fill(doc, PANEL);
  doc.roundedRect(MARGIN_X, top, contentW, panelH, 6, 6, 'F');
  fields.forEach((f, i) => {
    const x = MARGIN_X + 14 + i * colW;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    ink(doc, MUTED);
    doc.text(f.label.toUpperCase(), x, top + 17);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    ink(doc, INK);
    doc.text(wrapped[i], x, top + 32);
  });
  return top + panelH;
}

/** KPI-Karten-Reihe (Dashboard-Stil). Gibt das untere Y zurück. */
function drawKpiCards(
  doc: jsPDF,
  top: number,
  cards: { value: string; label: string }[],
): number {
  const w = doc.internal.pageSize.getWidth();
  const contentW = w - 2 * MARGIN_X;
  const gap = 12;
  const cardW = (contentW - gap * (cards.length - 1)) / cards.length;
  const cardH = 54;
  cards.forEach((k, i) => {
    const x = MARGIN_X + i * (cardW + gap);
    fill(doc, CARD_BG);
    doc.roundedRect(x, top, cardW, cardH, 6, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    ink(doc, ACCENT_DK);
    doc.text(k.value, x + 13, top + 25);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    ink(doc, MUTED);
    doc.text(k.label.toUpperCase(), x + 13, top + 41);
  });
  return top + cardH;
}

/** Komma-Dezimalstunden, z.B. 29,03. */
function dec(ms: number): string {
  return decimalHours(ms).toFixed(2).replace('.', ',');
}

interface PanelRow {
  label: string;
  value: string;
  color?: RGB;
  bold?: boolean;
}

/** Helle Info-Karte mit Titel, Label/Wert-Zeilen und kursiver Fussnote. */
function drawInfoPanel(
  doc: jsPDF,
  x: number,
  top: number,
  width: number,
  title: string,
  rows: PanelRow[],
  footnote: string,
): number {
  const pad = 12;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  const footLines = doc.splitTextToSize(footnote, width - 2 * pad) as string[];
  const h = pad + 14 + rows.length * 15 + 6 + footLines.length * 9 + pad - 6;

  fill(doc, CARD_BG);
  doc.roundedRect(x, top, width, h, 6, 6, 'F');

  ink(doc, ACCENT_DK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(title, x + pad, top + pad + 6);

  let ry = top + pad + 6 + 16;
  for (const r of rows) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    ink(doc, MUTED);
    doc.text(r.label, x + pad, ry);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    ink(doc, r.color ?? INK);
    doc.text(r.value, x + width - pad, ry, { align: 'right' });
    ry += 15;
  }

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  ink(doc, MUTED);
  doc.text(footLines, x + pad, ry + 1);
  return top + h;
}

/** Urlaubsblock: Zeilen + Fussnote (reine Textlogik fuer Tests und PDF). */
export function buildVacationPanelText(
  v: VacationStatus,
  emp: Employment,
): { rows: { label: string; value: string }[]; foot: string } {
  const annualLabel = v.fromContract
    ? `Jahresanspruch ${v.year} (Vertrag)`
    : `Jahresanspruch ${v.year} (§ 3 BUrlG)`;
  const rows: { label: string; value: string }[] = [
    { label: annualLabel, value: formatDays(v.annualFull) },
  ];
  if (v.isEntryYear && v.mode === 'both') {
    rows.push({
      label: `anteilig § 5 (${v.fullMonths}/12)`,
      value: formatDays(v.prorataRounded),
    });
  }
  rows.push({ label: `genommen ${v.year}`, value: formatDays(v.taken) });
  rows.push({ label: 'Resturlaub', value: formatDays(v.remaining) });

  const wpw = v.workdaysPerWeek;
  let foot: string;
  if (v.fromContract && emp.contractVacationDays != null) {
    foot =
      `${wpw} Arbeitstage/Woche: Vertrag ${formatDays(emp.contractVacationDays)}; ` +
      `gesetzliches Minimum 24 Werktage x ${wpw}/6 = ${formatDays(v.annualStatutory)}/Jahr. ` +
      (v.isEntryYear
        ? `Wartezeit § 4 erfuellt am ${formatDate(waitingPeriodEnd(emp))}; ` +
          `${v.mode === 'prorata' ? 'anteilig n. § 5' : 'voller Jahresanspruch'}.`
        : 'Bundesurlaubsgesetz.');
  } else {
    foot =
      `${wpw} Arbeitstage/Woche: 24 Werktage x ${wpw}/6 = ${formatDays(v.annualFull)}/Jahr. ` +
      (v.isEntryYear
        ? `Wartezeit § 4 erfuellt am ${formatDate(waitingPeriodEnd(emp))}; ` +
          `${v.mode === 'prorata' ? 'anteilig n. § 5' : 'voller Jahresanspruch'}.`
        : 'Bundesurlaubsgesetz.');
  }
  return { rows, foot };
}

export interface KontoPanelRow {
  label: string;
  value: string;
  tone?: 'pos' | 'neg';
  bold?: boolean;
}

/** Kontoblock: Zeilen + Fussnote (reine Textlogik fuer Tests und PDF). */
export function buildKontoPanelText(
  ledger: BalanceLedger,
  emp: Employment,
): { rows: KontoPanelRow[]; foot: string } {
  const t = ledger.target;
  const saldoTone: 'pos' | 'neg' = t.saldoMs >= 0 ? 'pos' : 'neg';
  const carryTone: 'pos' | 'neg' = ledger.carryIn >= 0 ? 'pos' : 'neg';
  const closeTone: 'pos' | 'neg' = ledger.closing >= 0 ? 'pos' : 'neg';
  const rows: KontoPanelRow[] = [
    { label: 'Soll (Monat)', value: `${formatDuration(t.sollMs)}  (${dec(t.sollMs)})` },
    { label: 'Ist (Monat)', value: `${formatDuration(t.istMs)}  (${dec(t.istMs)})` },
  ];
  if (t.vacationDays > 0) {
    rows.push({
      label: `Urlaub (${formatDays(t.vacationDays)})`,
      value: formatSignedDuration(t.vacationCreditMs),
      tone: 'pos',
    });
  }
  rows.push({ label: 'Saldo (Monat)', value: formatSignedDuration(t.saldoMs), tone: saldoTone });
  if (t.includedOvertimeMs > 0) {
    rows.push({
      label: 'mit Gehalt abgegolten',
      value: formatSignedDuration(-t.includedOvertimeMs),
      tone: 'neg',
    });
  }
  rows.push(
    { label: 'Uebertrag (Vormonate)', value: formatSignedDuration(ledger.carryIn), tone: carryTone },
    {
      label: 'Saldo gesamt (Monatsende)',
      value: formatSignedDuration(ledger.closing),
      tone: closeTone,
      bold: true,
    },
  );
  const monatlSoll = dec(fullMonthlyTargetMs(emp.weeklyHours));
  const urlaubHinweis =
    t.vacationDays > 0
      ? ` Urlaub ist bezahlte Freistellung (§ 1 BUrlG) und entlastet das Soll um ` +
        `bis zu ${dec(dailyTargetMs(emp))} Std./Tag, abzueglich am selben Tag ` +
        `bereits erfasster Zeit.`
      : '';
  let abgeltungHinweis = '';
  if (emp.includedOvertimeHoursPerMonth != null) {
    const h = String(emp.includedOvertimeHoursPerMonth).replace('.', ',');
    const teilmonat = employedFractionOfMonth(emp, t.monthStart) < 1;
    abgeltungHinweis =
      ` Bis ${h} Std. Ueberstunden/Monat sind mit dem Gehalt abgegolten (Arbeitsvertrag)` +
      (teilmonat
        ? `, in diesem Teilmonat anteilig ${dec(includedOvertimeCapMs(emp, t.monthStart))} Std.`
        : '.');
  }
  const hinweis = emp.balanceNote.trim();
  const kontohinweis = hinweis !== '' ? ` ${hinweis}` : '';
  const foot =
    `Basis: ${String(emp.weeklyHours).replace('.', ',')} Std./Woche x 52/12 = ${monatlSoll} Std./Monat. ` +
    `Beschaeftigt seit ${formatDate(emp.startDate)}.${kontohinweis}` +
    abgeltungHinweis +
    urlaubHinweis;
  return { rows, foot };
}

/** Zeichnet Arbeitszeitkonto (links) + Urlaub (rechts) nebeneinander. */
function drawKontoUndUrlaub(
  doc: jsPDF,
  top: number,
  employment: Employment,
  extras: ReportExtras,
): number {
  const w = doc.internal.pageSize.getWidth();
  const contentW = w - 2 * MARGIN_X;
  const gap = 14;
  const colW = (contentW - gap) / 2;
  const emp = employment;
  const { ledger, vacation: v } = extras;

  const { rows: kontoText, foot: kontoFoot } = buildKontoPanelText(ledger, emp);
  const kontoRows: PanelRow[] = kontoText.map((r) => ({
    label: r.label,
    value: r.value,
    color: r.tone === 'pos' ? POS : r.tone === 'neg' ? NEG : undefined,
    bold: r.bold,
  }));

  const { rows: urlaubText, foot: urlaubFoot } = buildVacationPanelText(v, emp);
  const urlaubRows: PanelRow[] = urlaubText.map((r) =>
    r.label === 'Resturlaub'
      ? { ...r, color: v.remaining < 0 ? NEG : POS, bold: true }
      : r,
  );

  const leftB = drawInfoPanel(doc, MARGIN_X, top, colW, 'Arbeitszeitkonto', kontoRows, kontoFoot);
  const rightB = drawInfoPanel(
    doc,
    MARGIN_X + colW + gap,
    top,
    colW,
    'Urlaub',
    urlaubRows,
    urlaubFoot,
  );
  return Math.max(leftB, rightB);
}

/** Baut einen vollstaendigen PDF-Report (Kopfband, Mitarbeiter, KPIs, Tabelle). */
export function buildReportPdf(
  profile: Profile,
  period: Period,
  entries: TimeEntry[],
  employment: Employment,
  extras?: ReportExtras,
): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const w = doc.internal.pageSize.getWidth();

  drawHeader(doc, period, false);
  let y = BAND_H + 3 + 22;
  y = drawEmployeePanel(doc, profile, employment, y) + 16;

  // Arbeitszeitkonto + Urlaub zuerst (nur Monatsreports) — auch ohne Eintraege.
  if (extras) {
    y = drawKontoUndUrlaub(doc, y, employment, extras) + 16;
  }

  if (entries.length === 0) {
    fill(doc, PANEL);
    doc.roundedRect(MARGIN_X, y, w - 2 * MARGIN_X, 44, 6, 6, 'F');
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(11);
    ink(doc, MUTED);
    doc.text('Keine Eintraege in diesem Zeitraum.', MARGIN_X + 14, y + 27);
    drawFooter(doc);
    stampPageNumbers(doc);
    return doc;
  }

  const grandMs = totalMs(entries);
  const days = groupByDay(entries);
  y = drawKpiCards(doc, y, [
    { value: formatDuration(grandMs), label: 'Arbeitszeit (Std:Min)' },
    {
      value: decimalHours(grandMs).toFixed(2).replace('.', ','),
      label: 'Dezimalstunden',
    },
    { value: String(days.length), label: 'Erfasste Tage' },
    { value: `${totalBreakMinutes(entries)} min`, label: 'Pausen gesamt' },
  ]);
  y += 20;

  // Tabelle, nach Tag gruppiert. Tagessumme nur bei >1 Eintrag pro Tag.
  let hasManual = false;
  const body: RowInput[] = [];
  for (const day of days) {
    for (const e of day.entries) {
      if (e.source === 'manual') hasManual = true;
      body.push([
        formatDate(e.start),
        formatClock(e.start),
        formatClock(e.end),
        e.breakMinutes ? String(e.breakMinutes) : '–',
        formatDuration(netMs(e)),
        (e.source === 'manual' ? '* ' : '') + (e.activity || '–'),
      ]);
    }
    if (day.entries.length > 1) {
      body.push([
        {
          content: `Summe ${day.label}`,
          colSpan: 4,
          styles: { halign: 'right', fontStyle: 'bold', fillColor: DAYSUM },
        },
        {
          content: formatDuration(day.totalMs),
          styles: { fontStyle: 'bold', fillColor: DAYSUM, halign: 'right' },
        },
        { content: '', styles: { fillColor: DAYSUM } },
      ]);
    }
  }

  autoTable(doc, {
    startY: y,
    margin: { top: BAND_H_COMPACT + 10, left: MARGIN_X, right: MARGIN_X, bottom: 40 },
    head: [['Datum', 'Start', 'Ende', 'Pause', 'Dauer', 'Taetigkeit']],
    body,
    foot: [
      [
        {
          content: 'Gesamt',
          colSpan: 4,
          styles: { halign: 'right', fontStyle: 'bold' },
        },
        {
          content: formatDuration(grandMs),
          styles: { fontStyle: 'bold', halign: 'right' },
        },
        {
          content: `${decimalHours(grandMs).toFixed(2).replace('.', ',')} Std.`,
          styles: { fontStyle: 'bold' },
        },
      ],
    ],
    theme: 'striped',
    styles: {
      fontSize: 9,
      cellPadding: 5,
      textColor: INK,
      lineColor: LINE,
      lineWidth: 0.4,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: ACCENT,
      textColor: 255,
      fontStyle: 'bold',
      cellPadding: 6,
    },
    alternateRowStyles: { fillColor: ROW_ALT },
    footStyles: { fillColor: ACCENT_DK, textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 74 },
      1: { cellWidth: 44, halign: 'center' },
      2: { cellWidth: 44, halign: 'center' },
      3: { cellWidth: 44, halign: 'center' },
      4: { cellWidth: 56, halign: 'right' },
      5: { cellWidth: 'auto' },
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) drawHeader(doc, period, true);
      drawFooter(doc);
    },
  });

  // Legende fuer manuell nachgetragene Eintraege.
  if (hasManual) {
    const afterTable = (doc as unknown as { lastAutoTable: { finalY: number } })
      .lastAutoTable.finalY;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    ink(doc, MUTED);
    doc.text('*  manuell nachgetragener Eintrag', MARGIN_X, afterTable + 14);
  }

  stampPageNumbers(doc);
  return doc;
}

/** Seitenzahlen "Seite x / y" rechts in die Fußzeile aller Seiten. */
function stampPageNumbers(doc: jsPDF): void {
  const pageCount = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  ink(doc, MUTED);
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.text(`Seite ${i} / ${pageCount}`, w - MARGIN_X, h - 18, {
      align: 'right',
    });
  }
}

/** Erzeugt einen sprechenden Dateinamen, z.B. "Klarzeit_KW23-2026.pdf". */
export function reportFilename(period: Period): string {
  const safe = period.label
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `Klarzeit_${safe || 'Report'}.pdf`;
}
