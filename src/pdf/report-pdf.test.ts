import { describe, expect, it } from 'vitest';
import { buildEmployeePanelFields, buildVacationPanelText } from './report-pdf';
import type { Profile } from '../domain/types';
import {
  buildVacationStatus,
  defaultEmployment,
  type Employment,
} from '../domain/employment';

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

