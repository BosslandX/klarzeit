import { useState } from 'react';
import type { VacationCarry } from '../../domain/employment';

/**
 * Resturlaub-Uebertrag einer Beschaeftigung (AUF-048): ab welchem Jahr, mit welchem Rest es beginnt, und die
 * verfallenen Tage je Jahr. "kein Uebertrag" = wie bis 1.14. Das Jahr ist eine Auswahl: ein Zahlenfeld waere
 * waehrend des Tippens ungueltig ("202") und leerte sich.
 */
export function VacationCarryField({
  value,
  onChange,
}: {
  value: VacationCarry | undefined;
  onChange: (next: VacationCarry | undefined) => void;
}) {
  const [jahr] = useState(() => new Date().getFullYear());
  const auswahl = [
    ...new Set([...(value ? [value.fromYear] : []), ...Array.from({ length: 7 }, (_, i) => jahr - 5 + i)]),
  ].sort((a, b) => a - b);
  const jahre =
    value === undefined
      ? []
      : Array.from({ length: Math.max(0, jahr - value.fromYear + 1) }, (_, i) => value.fromYear + i);
  const tage = (raw: string): number => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const setVerfallen = (y: number, raw: string) => {
    if (value === undefined) return;
    const rest = value.lapsed.filter((l) => l.year !== y);
    const n = tage(raw);
    const lapsed = n > 0 ? [...rest, { year: y, days: n }] : rest;
    onChange({ ...value, lapsed: [...lapsed].sort((a, b) => a.year - b.year) });
  };
  return (
    <>
      <label className="field">
        <span>Resturlaub-Uebertrag ab Jahr</span>
        <select
          value={value?.fromYear ?? ''}
          onChange={(e) => {
            if (e.target.value === '') {
              onChange(undefined);
              return;
            }
            const y = Number(e.target.value);
            onChange({
              fromYear: y,
              startDays: value?.startDays ?? 0,
              lapsed: (value?.lapsed ?? []).filter((l) => l.year >= y),
            });
          }}
        >
          <option value="">kein Uebertrag</option>
          {auswahl.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      {value !== undefined && (
        <>
          <label className="field">
            <span>Rest zu Beginn von {value.fromYear} (Tage)</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.5"
              min="0"
              value={value.startDays}
              onChange={(e) => onChange({ ...value, startDays: tage(e.target.value) })}
            />
          </label>
          {jahre.map((y) => (
            <label className="field" key={y}>
              <span>verfallen {y} (Tage)</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.5"
                min="0"
                value={value.lapsed.find((l) => l.year === y)?.days ?? ''}
                onChange={(e) => setVerfallen(y, e.target.value)}
              />
            </label>
          ))}
          <p className="muted small">
            Ab {value.fromYear} geht der Rest jedes Jahres ins naechste, ein Minus nicht (§§ 1, 7 Abs. 3
            BUrlG). Verfallen kann Urlaub nur, wenn der Arbeitgeber vorher auf den Verfall hingewiesen hat
            (BAG, Urteil vom 19.02.2019 – 9 AZR 423/16) – darum traegst du ihn selbst ein, ebenso eine
            vereinbarte Verrechnung.
          </p>
        </>
      )}
    </>
  );
}
