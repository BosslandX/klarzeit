import { useState } from 'react';
import type { Employment } from '../../domain/employment';
import {
  longSickHint,
  longSickRuns,
  sickPeriodLabel,
  type SickPeriod,
} from '../../domain/sickness';
import { fromDateInput } from '../../domain/time';
import { addSickPeriod, removeSickPeriod } from '../../db/sickness';

/**
 * Krankheitszeiten der unter "Urlaub fuer Beschaeftigung" gewaehlten Beschaeftigung (AUF-034):
 * eintragen (von, bis, Bescheinigung), auflisten, entfernen; Hinweis bei mehr als sechs Wochen.
 */
export function SickPeriodsSection({
  employment,
  periods,
  showName,
  onChange,
}: {
  employment: Employment | undefined;
  periods: readonly SickPeriod[];
  showName: boolean;
  onChange: () => Promise<void>;
}) {
  const [von, setVon] = useState('');
  const [bis, setBis] = useState('');
  const [bescheinigt, setBescheinigt] = useState(false);
  const [meldung, setMeldung] = useState('');
  if (!employment) return null;
  const eigene = periods.filter((p) => p.employmentId === employment.id);
  const lange = longSickRuns(periods, employment.id);

  const eintragen = async () => {
    const from = fromDateInput(von);
    const to = fromDateInput(bis);
    if (Number.isNaN(from) || Number.isNaN(to)) return;
    const neu = await addSickPeriod({
      employmentId: employment.id,
      from,
      to,
      certificate: bescheinigt,
    });
    if (neu === null) {
      setMeldung(
        'Nicht eingetragen: Das Ende liegt vor dem Beginn, oder der Zeitraum ueberschneidet sich ' +
          'mit einem eingetragenen.',
      );
      return;
    }
    setVon('');
    setBis('');
    setMeldung('');
    await onChange();
  };

  const entfernen = async (p: SickPeriod) => {
    if (!window.confirm(`Krankheitszeit ${sickPeriodLabel(p)} entfernen?`)) return;
    await removeSickPeriod(p.employmentId, p.from);
    await onChange();
  };

  return (
    <>
      <h3 className="sub-head">Krankheitszeiten{showName ? ` (${employment.name})` : ''}</h3>
      <p className="muted small">
        Krankheitstage entlasten das Arbeitszeitkonto an Arbeitstagen bis zum Tagessoll
        (§ 4 Abs. 1 EntgFG). Mit aerztlicher Bescheinigung zaehlt ein Urlaubstag im Zeitraum
        nicht als Urlaub (§ 9 BUrlG).
      </p>
      <div className="vac-range">
        <label className="field">
          <span>krank von</span>
          <input
            type="date"
            value={von}
            onChange={(e) => {
              setVon(e.target.value);
              setMeldung('');
            }}
          />
        </label>
        <label className="field">
          <span>bis</span>
          <input
            type="date"
            value={bis}
            onChange={(e) => {
              setBis(e.target.value);
              setMeldung('');
            }}
          />
        </label>
      </div>
      <label className="field row">
        <span>Aerztliche Bescheinigung liegt vor</span>
        <input
          type="checkbox"
          checked={bescheinigt}
          onChange={(e) => setBescheinigt(e.target.checked)}
        />
      </label>
      <button className="btn btn-block" disabled={!von || !bis} onClick={() => void eintragen()}>
        Krankheit eintragen
      </button>
      {meldung && <p className="muted small">{meldung}</p>}
      {lange.map((l) => (
        <p key={l.from} className="muted small">
          {longSickHint(l)}
        </p>
      ))}
      {eigene.length === 0 ? (
        <p className="muted small">Noch keine Krankheitszeiten erfasst.</p>
      ) : (
        <ul className="vac-list">
          {eigene.map((p) => (
            <li key={p.from}>
              <span>{sickPeriodLabel(p)}</span>
              <button className="link-btn danger" type="button" onClick={() => void entfernen(p)}>
                entfernen
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
