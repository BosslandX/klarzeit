import { describe, expect, it } from 'vitest';
import { buildEmployeePanelFields } from './report-pdf';
import type { Profile } from '../domain/types';
import { defaultEmployment, type Employment } from '../domain/employment';

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
