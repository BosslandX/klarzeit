import { describe, expect, it } from 'vitest';
import {
  buildEmployeePanelFields,
  buildKontoPanelText,
  buildVacationPanelText,
  buildReportPdf,
  entryLegend,
  entryMark,
} from './report-pdf';
import { monthPeriod } from '../domain/aggregate';
import type { Profile, TimeEntry } from '../domain/types';
import {
  buildBalanceLedger,
  buildVacationStatus,
  defaultEmployment,
  type Employment,
} from '../domain/employment';
import { splitVacationAndSickness } from '../domain/sickness';

describe('PDF-Kopf je Beschaeftigung', () => {
  it('buildEmployeePanelFields traegt Vertragsfelder der Beschaeftigung, nicht des Profils', () => {
    const profile: Profile = {
      vorname: 'Max',
      nachname: 'Mustermann',
      personalnummer: 'PN-PROFIL',
      arbeitgeber: 'Profil AG',
      abteilung: 'Profil-Abteilung',
    };
    const employment: Employment = {
      ...defaultEmployment,
      id: 'emp-x',
      personalnummer: 'PN-VERTRAG',
      arbeitgeber: 'Vertrag GmbH',
      abteilung: 'Vertrag-Team',
    };
    const fields = buildEmployeePanelFields(profile, employment);
    const blob = fields.map((f) => f.value).join('|');
    expect(blob).toContain('PN-VERTRAG');
    expect(blob).toContain('Vertrag GmbH');
    expect(blob).toContain('Vertrag-Team');
    expect(blob).not.toContain('PN-PROFIL');
    expect(blob).not.toContain('Profil AG');
  });
});

describe('Urlaubsblock PDF-Text', () => {
  const empFixture: Employment = {
    ...defaultEmployment,
    startDate: new Date(2026, 4, 1).getTime(),
    workdaysPerWeek: 4,
    contractVacationDays: null,
  };

  it('ohne Vertragswert Folgejahr: Fussnote und erste Zeile wie bisher', () => {
    const v = buildVacationStatus(empFixture, [], 2027);
    const { rows, foot } = buildVacationPanelText(v, empFixture);
    expect(rows[0].label).toBe('Jahresanspruch 2027 (§ 3 BUrlG)');
    expect(foot).toBe(
      '4 Arbeitstage/Woche: 24 Werktage x 4/6 = 16 Tage/Jahr. Bundesurlaubsgesetz.',
    );
  });

  it('mit Vertragswert 30: Zeile (Vertrag) und Fussnote mit 30 und 16', () => {
    const withContract = { ...empFixture, contractVacationDays: 30 };
    const v = buildVacationStatus(withContract, [], 2027);
    const { rows, foot } = buildVacationPanelText(v, withContract);
    expect(rows[0].label).toBe('Jahresanspruch 2027 (Vertrag)');
    expect(rows[0].value).toBe('30 Tage');
    expect(foot).toContain('30');
    expect(foot).toContain('16');
  });
});

describe('Kontoblock PDF-Text (AUF-016)', () => {
  const empK: Employment = {
    ...defaultEmployment,
    startDate: new Date(2026, 4, 1).getTime(),
    weeklyHours: 30,
    workdaysPerWeek: 5,
    includedOvertimeHoursPerMonth: null,
    balanceNote: 'Ausgleich n. § 2 (4) Arbeitsvertrag.',
  };

  function entry(y: number, mo: number, d: number, fromH: number, toH: number): TimeEntry {
    const start = new Date(y, mo - 1, d, fromH, 0).getTime();
    const end = new Date(y, mo - 1, d, toH, 0).getTime();
    return {
      employmentId: 'emp-1',
      start,
      end,
      breakMinutes: 0,
      activity: 'Test',
      note: '',
      source: 'manual',
      createdAt: start,
      updatedAt: start,
    };
  }

  function mai145() {
    const list: TimeEntry[] = [];
    for (let d = 1; d <= 14; d++) list.push(entry(2026, 5, d, 8, 18));
    list.push(entry(2026, 5, 20, 8, 13));
    return list;
  }

  it('Kontoblock ohne Abgeltung: Zeilen und Fussnote wie bisher', () => {
    const ref = new Date(2026, 4, 31).getTime();
    const ledger = buildBalanceLedger(empK, mai145(), ref)!;
    const { rows, foot } = buildKontoPanelText(ledger, empK);
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ['Soll (Monat)', '130:00 h  (130,00)'],
      ['Ist (Monat)', '145:00 h  (145,00)'],
      ['Saldo (Monat)', '+15:00 h'],
      ['Uebertrag (Vormonate)', '0:00 h'],
      ['Saldo gesamt (Monatsende)', '+15:00 h'],
    ]);
    expect(foot).toBe(
      'Basis: 30 Std./Woche x 52/12 = 130,00 Std./Monat. Beschaeftigt seit 01.05.2026. Ausgleich n. § 2 (4) Arbeitsvertrag.',
    );
  });

  it('Kontoblock mit Abgeltung: Zeile mit Gehalt abgegolten und Fussnote', () => {
    const withClause = { ...empK, includedOvertimeHoursPerMonth: 10 };
    const ref = new Date(2026, 4, 31).getTime();
    const ledger = buildBalanceLedger(withClause, mai145(), ref)!;
    const { rows, foot } = buildKontoPanelText(ledger, withClause);
    const mapped = rows.map((r) => [r.label, r.value]);
    const idx = mapped.findIndex((r) => r[0] === 'Saldo (Monat)');
    expect(mapped[idx + 1]).toEqual(['mit Gehalt abgegolten', '-10:00 h']);
    expect(rows[idx + 1].tone).toBe('neg');
    expect(mapped[mapped.length - 1]).toEqual(['Saldo gesamt (Monatsende)', '+5:00 h']);
    expect(foot).toBe(
      'Basis: 30 Std./Woche x 52/12 = 130,00 Std./Monat. Beschaeftigt seit 01.05.2026. Ausgleich n. § 2 (4) Arbeitsvertrag. Bis 10 Std. Ueberstunden/Monat sind mit dem Gehalt abgegolten (Arbeitsvertrag).',
    );
  });

  it('Kontoblock im Teilmonat: anteilige Grenze in der Fussnote', () => {
    const teil = {
      ...empK,
      startDate: new Date(2026, 8, 16).getTime(),
      includedOvertimeHoursPerMonth: 10,
    };
    const ents: TimeEntry[] = [];
    for (let d = 16; d <= 22; d++) ents.push(entry(2026, 9, d, 8, 18));
    ents.push(entry(2026, 9, 23, 8, 11));
    const ref = new Date(2026, 8, 30).getTime();
    const ledger = buildBalanceLedger(teil, ents, ref)!;
    const { rows, foot } = buildKontoPanelText(ledger, teil);
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ['Soll (Monat)', '65:00 h  (65,00)'],
      ['Ist (Monat)', '73:00 h  (73,00)'],
      ['Saldo (Monat)', '+8:00 h'],
      ['mit Gehalt abgegolten', '-5:00 h'],
      ['Uebertrag (Vormonate)', '0:00 h'],
      ['Saldo gesamt (Monatsende)', '+3:00 h'],
    ]);
    expect(foot).toBe(
      'Basis: 30 Std./Woche x 52/12 = 130,00 Std./Monat. Beschaeftigt seit 16.09.2026. Ausgleich n. § 2 (4) Arbeitsvertrag. Bis 10 Std. Ueberstunden/Monat sind mit dem Gehalt abgegolten (Arbeitsvertrag), in diesem Teilmonat anteilig 5,00 Std.',
    );
  });

  it('Kontoblock: leerer Hinweis druckt keinen Satz', () => {
    const ref = new Date(2026, 4, 31).getTime();
    const ledger = buildBalanceLedger({ ...empK, balanceNote: '' }, mai145(), ref)!;
    const { foot } = buildKontoPanelText(ledger, { ...empK, balanceNote: '' });
    expect(foot).toBe(
      'Basis: 30 Std./Woche x 52/12 = 130,00 Std./Monat. Beschaeftigt seit 01.05.2026.',
    );
  });

  it('Kontoblock: eigener Hinweis steht nach dem Beschaeftigungsbeginn', () => {
    const emp = {
      ...empK,
      balanceNote: 'Ausgleich n. § 9 (1) Arbeitsvertrag.',
    };
    const ref = new Date(2026, 4, 31).getTime();
    const ledger = buildBalanceLedger(emp, mai145(), ref)!;
    const { foot } = buildKontoPanelText(ledger, emp);
    expect(foot).toBe(
      'Basis: 30 Std./Woche x 52/12 = 130,00 Std./Monat. Beschaeftigt seit 01.05.2026. Ausgleich n. § 9 (1) Arbeitsvertrag.',
    );
  });

  it('Kontoblock: Hinweis wird getrimmt, nur Leerzeichen zaehlen als leer', () => {
    const ref = new Date(2026, 4, 31).getTime();
    const leer = { ...empK, balanceNote: '   ' };
    const ledgerLeer = buildBalanceLedger(leer, mai145(), ref)!;
    expect(buildKontoPanelText(ledgerLeer, leer).foot).toBe(
      'Basis: 30 Std./Woche x 52/12 = 130,00 Std./Monat. Beschaeftigt seit 01.05.2026.',
    );
    const mit = { ...empK, balanceNote: '  Testhinweis.  ' };
    const ledgerMit = buildBalanceLedger(mit, mai145(), ref)!;
    expect(buildKontoPanelText(ledgerMit, mit).foot).toBe(
      'Basis: 30 Std./Woche x 52/12 = 130,00 Std./Monat. Beschaeftigt seit 01.05.2026. Testhinweis.',
    );
  });
});

describe('Kontoblock mit Feiertagen (AUF-030)', () => {
  const bayern: Employment = {
    ...defaultEmployment,
    startDate: new Date(2026, 0, 1).getTime(),
    weeklyHours: 40,
    workdaysPerWeek: 5,
    balanceNote: '',
    publicHolidays: { land: 'BY', regional: [], extra: [], skip: [] },
  };

  it('Kontoblock: Zeile Feiertage und Fussnote, wenn der Monat Feiertage hat', () => {
    const ledger = buildBalanceLedger(bayern, [], new Date(2026, 4, 31).getTime())!;
    const { rows, foot } = buildKontoPanelText(ledger, bayern);
    expect(rows.map((r) => [r.label, r.value])).toContainEqual(['Feiertage (3 Tage)', '+24:00 h']);
    expect(foot).toContain(
      'Feiertage (Bayern) entlasten an Arbeitstagen das Soll um bis zu 8,00 Std./Tag (§ 2 EntgFG)',
    );
  });

  it('Kontoblock: ohne Feiertag im Monat keine Zeile und kein Satz', () => {
    const ledger = buildBalanceLedger(bayern, [], new Date(2026, 6, 31).getTime())!;
    const { rows, foot } = buildKontoPanelText(ledger, bayern);
    expect(rows.some((r) => r.label.startsWith('Feiertage'))).toBe(false);
    expect(foot).not.toContain('EntgFG');
  });
});

describe('Kontoblock mit Krankheit (AUF-034)', () => {
  const vollzeit: Employment = {
    ...defaultEmployment,
    startDate: new Date(2026, 0, 1).getTime(),
    weeklyHours: 40,
    workdaysPerWeek: 5,
    balanceNote: '',
  };
  const tag = (dd: number) => new Date(2026, 10, dd).getTime();

  it('Kontoblock: Zeile Krankheit und Fussnote, wenn der Monat Krankheitstage hat', () => {
    // Mo 09.11. bis So 15.11.2026 mit Bescheinigung: fuenf Arbeitstage.
    const { sickDates } = splitVacationAndSickness(
      [],
      [{ employmentId: vollzeit.id, from: tag(9), to: tag(15), certificate: true }],
      vollzeit.id,
    );
    const ledger = buildBalanceLedger(vollzeit, [], tag(20), [], sickDates)!;
    const { rows, foot } = buildKontoPanelText(ledger, vollzeit);
    expect(rows.map((r) => [r.label, r.value])).toContainEqual(['Krankheit (5 Tage)', '+40:00 h']);
    expect(foot).toContain(
      'Krankheitstage entlasten an Arbeitstagen das Soll um bis zu 8,00 Std./Tag (§ 4 Abs. 1 EntgFG)',
    );
  });

  it('Kontoblock: ohne Krankheitstage keine Zeile und kein Satz', () => {
    const ledger = buildBalanceLedger(vollzeit, [], tag(20))!;
    const { rows, foot } = buildKontoPanelText(ledger, vollzeit);
    expect(rows.some((r) => r.label.startsWith('Krankheit'))).toBe(false);
    expect(foot).not.toContain('Krankheitstage');
  });
});

describe('Zeichen vor der Taetigkeit (AUF-035)', () => {
  const H = 3_600_000;
  const basis: TimeEntry = {
    employmentId: 'emp-1',
    start: 8 * H,
    end: 16 * H,
    breakMinutes: 0,
    activity: 'a',
    note: '',
    source: 'tracked',
    createdAt: 0,
    updatedAt: 0,
  };
  const geaendert: TimeEntry = { ...basis, end: 17 * H, trackedTimes: { start: 8 * H, end: 16 * H } };
  const nachgetragen: TimeEntry = { ...basis, source: 'manual' };

  it('entryMark: Stern fuer nachgetragen, Grad fuer geaenderte Stoppuhr-Zeit', () => {
    expect([entryMark(basis), entryMark(nachgetragen), entryMark(geaendert)]).toEqual([
      '',
      '* ',
      '° ',
    ]);
  });

  it('entryLegend: je benutztes Zeichen eine Zeile', () => {
    expect(entryLegend([basis])).toEqual([]);
    expect(entryLegend([geaendert, nachgetragen])).toEqual([
      '*  manuell nachgetragener Eintrag',
      '°  Stoppuhr-Zeit nachtraeglich geaendert',
    ]);
    expect(entryLegend([geaendert])).toEqual(['°  Stoppuhr-Zeit nachtraeglich geaendert']);
  });
});

describe('Veranlassung im PDF (AUF-036)', () => {
  it('PDF: Zeile unter dem Eintrag, nur wenn eine Veranlassung eingetragen ist', () => {
    const H = 3_600_000;
    const tag = new Date(2026, 10, 9).getTime();
    const emp: Employment = { ...defaultEmployment, startDate: new Date(2026, 0, 1).getTime(), weeklyHours: 40 };
    const profil: Profile = { vorname: 'Max', nachname: 'Muster', personalnummer: '', arbeitgeber: '', abteilung: '' };
    const eintrag: TimeEntry = {
      employmentId: emp.id,
      start: tag + 8 * H,
      end: tag + 18 * H,
      breakMinutes: 30,
      activity: 'Montage',
      note: '',
      source: 'manual',
      createdAt: 0,
      updatedAt: 0,
      overtimeAuthorization: 'angeordnet von der Teamleitung am 09.11. per E-Mail',
    };
    const mit = buildReportPdf(profil, monthPeriod(tag), [eintrag], emp).output();
    expect(mit).toContain('Veranlassung: angeordnet von der Teamleitung am 09.11. per E-Mail');
    const ohne = buildReportPdf(profil, monthPeriod(tag), [{ ...eintrag, overtimeAuthorization: '' }], emp);
    expect(ohne.output()).not.toContain('Veranlassung:');
  });
});
