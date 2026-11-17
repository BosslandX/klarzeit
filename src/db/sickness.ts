import { Preferences } from '@capacitor/preferences';
import { useCallback, useEffect, useState } from 'react';
import { cleanSickPeriods, sickPeriodsOverlap, type SickPeriod } from '../domain/sickness';

/** Preferences-Schluessel der Krankheitszeitraeume (AUF-033); stabiler Bezeichner. */
const KEY_SICK = 'sickPeriods';

/** Alle Krankheitszeitraeume, geprueft; kaputter Inhalt ergibt eine leere Liste. */
export async function getSickPeriods(): Promise<SickPeriod[]> {
  const { value } = await Preferences.get({ key: KEY_SICK });
  if (!value) return [];
  try {
    return cleanSickPeriods(JSON.parse(value));
  } catch {
    return [];
  }
}

export async function saveSickPeriods(list: readonly SickPeriod[]): Promise<void> {
  await Preferences.set({ key: KEY_SICK, value: JSON.stringify(cleanSickPeriods(list)) });
}

/**
 * Traegt einen Zeitraum ein. Taugt er nicht (`to` vor `from`) oder ueberschneidet er einen
 * vorhandenen derselben Beschaeftigung, bleibt alles, wie es war, und das Ergebnis ist null.
 */
export async function addSickPeriod(period: SickPeriod): Promise<SickPeriod[] | null> {
  const [neu] = cleanSickPeriods([period]);
  const current = await getSickPeriods();
  if (neu === undefined || current.some((p) => sickPeriodsOverlap(p, neu))) return null;
  const next = cleanSickPeriods([...current, neu]);
  await saveSickPeriods(next);
  return next;
}

/** Entfernt den Zeitraum einer Beschaeftigung, der an `from` beginnt. */
export async function removeSickPeriod(
  employmentId: string,
  from: number,
): Promise<SickPeriod[]> {
  const next = (await getSickPeriods()).filter(
    (p) => !(p.employmentId === employmentId && p.from === from),
  );
  await saveSickPeriods(next);
  return next;
}

/** Krankheitszeitraeume fuer die Oberflaeche, mit Neuladen nach einer Aenderung (AUF-034). */
export function useSickPeriods(): {
  periods: SickPeriod[];
  refresh: () => Promise<void>;
} {
  const [periods, setPeriods] = useState<SickPeriod[]>([]);
  const refresh = useCallback(async () => {
    setPeriods(await getSickPeriods());
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { periods, refresh };
}
