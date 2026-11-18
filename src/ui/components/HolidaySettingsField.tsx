import { useState } from 'react';
import {
  BUNDESLAENDER,
  REGIONALE_FEIERTAGE,
  addExtraHoliday,
  holidayHistoryNote,
  holidayPreview,
  removeExtraHoliday,
  toggleRegionalHoliday,
  toggleSkippedHoliday,
  withHolidayLand,
  type PublicHolidays,
} from '../../domain/holidays';
import { formatDateWithWeekday, fromDateInput } from '../../domain/time';

/**
 * Feiertage einer Beschaeftigung: Bundesland des Arbeitsorts, regionale Tage, eine Vorschau des
 * laufenden Jahres zum Streichen und eigene Tage. Ohne Land keine Feiertage, wie bis 1.12.
 */
export function HolidaySettingsField({
  value,
  onChange,
}: {
  value: PublicHolidays | undefined;
  onChange: (next: PublicHolidays | undefined) => void;
}) {
  const [jahr] = useState(() => new Date().getFullYear());
  const [neuerTag, setNeuerTag] = useState('');
  const hinzufuegen = () => {
    const t = fromDateInput(neuerTag);
    if (value === undefined || Number.isNaN(t)) return;
    onChange(addExtraHoliday(value, t));
    setNeuerTag('');
  };
  return (
    <>
      <label className="field">
        <span>Feiertage (Bundesland des Arbeitsorts)</span>
        <select
          value={value?.land ?? ''}
          onChange={(e) => onChange(withHolidayLand(value, e.target.value))}
        >
          <option value="">keine (wie bisher)</option>
          {BUNDESLAENDER.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      {value !== undefined && (
        <>
          {REGIONALE_FEIERTAGE[value.land].map((r) => (
            <label key={r.key} className="field row">
              <span>{r.name}</span>
              <input
                type="checkbox"
                checked={value.regional.includes(r.key)}
                onChange={() => onChange(toggleRegionalHoliday(value, r.key))}
              />
            </label>
          ))}
          <p className="muted small">
            Feiertage {jahr}. An deinen Arbeitstagen fuellt jeder das Tagessoll auf; ein
            Urlaubstag darauf zaehlt nicht als Urlaub.
          </p>
          <ul className="vac-list">
            {holidayPreview(value, jahr).map((h) => (
              <li key={h.date}>
                <span className={h.gestrichen ? 'muted' : undefined}>
                  {formatDateWithWeekday(h.date)} {h.name}
                  {h.gestrichen ? ' (gestrichen)' : ''}
                </span>
                <button
                  className="link-btn"
                  type="button"
                  onClick={() =>
                    onChange(
                      h.eigen
                        ? removeExtraHoliday(value, h.date)
                        : toggleSkippedHoliday(value, h.date),
                    )
                  }
                >
                  {h.eigen ? 'entfernen' : h.gestrichen ? 'zurueckholen' : 'streichen'}
                </button>
              </li>
            ))}
          </ul>
          <div className="vac-add">
            <input type="date" value={neuerTag} onChange={(e) => setNeuerTag(e.target.value)} />
            <button className="btn" type="button" disabled={!neuerTag} onClick={hinzufuegen}>
              Eigenen Feiertag hinzufuegen
            </button>
          </div>
          <p className="muted small">{holidayHistoryNote(value.land)}</p>
        </>
      )}
    </>
  );
}
