import { describe, expect, it } from 'vitest';
import {
  contractChanged,
  describeContract,
  historyAfterChange,
  removeContractPeriod,
} from './contract-change';
import { defaultEmployment, type Employment } from './employment';
import { HOUR } from './time';

describe('Vertrag gueltig ab im Formular (AUF-032)', () => {
  const d = (y: number, mo: number, dd: number) => new Date(y, mo - 1, dd).getTime();
  const gespeichert: Employment = {
    ...defaultEmployment,
    startDate: d(2026, 1, 1),
    weeklyHours: 20,
    workdaysPerWeek: 5,
  };

  it('contractChanged: Stunden oder Arbeitstage, nicht beim ersten Eintragen', () => {
    expect(contractChanged(gespeichert, { ...gespeichert, weeklyHours: 30 })).toBe(true);
    expect(
      contractChanged(gespeichert, { ...gespeichert, workdaysPerWeek: 4, workWeekdays: [1, 2, 3, 4] }),
    ).toBe(true);
    expect(
      contractChanged(
        { ...gespeichert, workWeekdays: [1, 2, 3, 4, 5] },
        { ...gespeichert, workWeekdays: [2, 3, 4, 5, 6] },
      ),
    ).toBe(true);
    expect(contractChanged(gespeichert, { ...gespeichert })).toBe(false);
    expect(contractChanged({ ...gespeichert, weeklyHours: 0 }, gespeichert)).toBe(false);
    // Wochentage erstmals gewaehlt, gleiche Zahl: keine Aenderung.
    expect(contractChanged(gespeichert, { ...gespeichert, workWeekdays: [1, 2, 3, 4, 5] })).toBe(false);
  });

  it('historyAfterChange: der bisherige Vertrag gilt bis zum Vortag', () => {
    expect(
      historyAfterChange(gespeichert, { ...gespeichert, weeklyHours: 30 }, d(2026, 4, 1)),
    ).toEqual([{ validUntil: d(2026, 3, 31), weeklyHours: 20, workdaysPerWeek: 5 }]);
    const vorher = [{ validUntil: d(2026, 1, 31), weeklyHours: 10, workdaysPerWeek: 5 }];
    expect(
      historyAfterChange(
        { ...gespeichert, contractHistory: vorher },
        { ...gespeichert, weeklyHours: 30, contractHistory: vorher },
        d(2026, 4, 1) + 5 * HOUR,
      ),
    ).toEqual([...vorher, { validUntil: d(2026, 3, 31), weeklyHours: 20, workdaysPerWeek: 5 }]);
  });

  it('historyAfterChange: Korrektur und unveraenderter Vertrag lassen die Liste, ein schlechtes Datum ergibt null', () => {
    expect(historyAfterChange(gespeichert, { ...gespeichert, weeklyHours: 30 }, null)).toBeUndefined();
    expect(historyAfterChange(gespeichert, { ...gespeichert }, d(2026, 4, 1))).toBeUndefined();
    expect(historyAfterChange(gespeichert, { ...gespeichert, weeklyHours: 30 }, d(2025, 12, 1))).toBeNull();
    const spaeter = [{ validUntil: d(2026, 5, 31), weeklyHours: 10, workdaysPerWeek: 5 }];
    expect(
      historyAfterChange(
        gespeichert,
        { ...gespeichert, weeklyHours: 30, contractHistory: spaeter },
        d(2026, 4, 1),
      ),
    ).toBeNull();
    const gleich = [{ validUntil: d(2026, 3, 31), weeklyHours: 10, workdaysPerWeek: 5 }];
    expect(
      historyAfterChange(
        gespeichert,
        { ...gespeichert, weeklyHours: 30, contractHistory: gleich },
        d(2026, 4, 1),
      ),
    ).toBeNull();
  });

  it('removeContractPeriod und describeContract', () => {
    const zwei = [
      { validUntil: d(2026, 1, 31), weeklyHours: 10, workdaysPerWeek: 5 },
      { validUntil: d(2026, 3, 31), weeklyHours: 20.5, workdaysPerWeek: 4, workWeekdays: [0, 1, 3, 5] },
    ];
    expect(removeContractPeriod(zwei, d(2026, 1, 31))).toEqual([zwei[1]]);
    expect(removeContractPeriod([zwei[0]], d(2026, 1, 31))).toBeUndefined();
    expect(describeContract(zwei[0])).toBe('10 Std./Woche, 5 Arbeitstage');
    expect(describeContract(zwei[1])).toBe('20,5 Std./Woche, Mo Mi Fr So');
  });
});
