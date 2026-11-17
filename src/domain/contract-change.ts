import { startOfDay } from 'date-fns';
import type { ContractPeriod, ContractTerms, Employment } from './employment';

/**
 * Wurden Wochenstunden oder Arbeitstage gegenueber dem gespeicherten Vertrag geaendert (AUF-032)?
 * Beim ersten Eintragen (bisher 0 Wochenstunden) nicht, und auch nicht, wenn bei gleicher Zahl
 * erstmals die Wochentage gewaehlt werden: das ist eine Angabe, keine Vertragsaenderung.
 */
export function contractChanged(saved: ContractTerms, next: ContractTerms): boolean {
  if (saved.weeklyHours <= 0) return false;
  if (saved.weeklyHours !== next.weeklyHours || saved.workdaysPerWeek !== next.workdaysPerWeek) {
    return true;
  }
  // Wochentage erstmals gewaehlt (bisher nur ihre Zahl): eine Angabe, keine Vertragsaenderung.
  if (saved.workWeekdays === undefined) return false;
  return saved.workWeekdays.join(',') !== (next.workWeekdays ?? []).join(',');
}

/**
 * Fruehere Vertragsstaende nach dem Speichern (AUF-032): Gilt eine Aenderung ab einem Datum, wird
 * der bisherige Vertrag bis zum Vortag ein frueherer Stand. Ohne Datum (Korrektur von Beginn an)
 * und ohne Aenderung bleibt die Liste von `next`. null: das Datum taugt nicht -- der Vortag liegt
 * vor dem Beginn der Beschaeftigung oder nicht nach dem letzten frueheren Stand.
 */
export function historyAfterChange(
  saved: Employment,
  next: ContractTerms & Pick<Employment, 'contractHistory'>,
  ab: number | null,
): ContractPeriod[] | undefined | null {
  if (ab === null || !contractChanged(saved, next)) return next.contractHistory;
  const tag = startOfDay(ab);
  const bis = new Date(tag.getFullYear(), tag.getMonth(), tag.getDate() - 1).getTime();
  const liste = next.contractHistory ?? [];
  const letzter = liste.length > 0 ? liste[liste.length - 1].validUntil : -Infinity;
  if (bis < startOfDay(saved.startDate).getTime() || bis <= letzter) return null;
  return [
    ...liste,
    {
      validUntil: bis,
      weeklyHours: saved.weeklyHours,
      workdaysPerWeek: saved.workdaysPerWeek,
      ...(saved.workWeekdays ? { workWeekdays: saved.workWeekdays } : {}),
    },
  ];
}

/** Einen frueheren Stand entfernen; der folgende gilt dann auch fuer dessen Zeit. */
export function removeContractPeriod(
  history: readonly ContractPeriod[] | undefined,
  validUntil: number,
): ContractPeriod[] | undefined {
  const rest = (history ?? []).filter((c) => c.validUntil !== validUntil);
  return rest.length > 0 ? rest : undefined;
}

/** Kurzbeschreibung eines Vertragsstands, z. B. "20 Std./Woche, Mo Di Mi Do". */
export function describeContract(terms: ContractTerms): string {
  const kurz = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const stunden = String(terms.weeklyHours).replace('.', ',');
  const tage =
    terms.workWeekdays && terms.workWeekdays.length > 0
      ? [...terms.workWeekdays]
          .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
          .map((t) => kurz[t])
          .join(' ')
      : `${terms.workdaysPerWeek} Arbeitstage`;
  return `${stunden} Std./Woche, ${tage}`;
}
