import { useState } from 'react';
import { differenceInCalendarDays } from 'date-fns';
import {
  dailyTargetMs,
  workdaysInRange,
  type Employment,
  type VacationDay,
} from '../../domain/employment';
import { decimalHours, fromDateInput } from '../../domain/time';
import type { SickPeriod } from '../../domain/sickness';
import { VacationClockodo } from './VacationClockodo';
import { VacationDayRow } from './VacationDayRow';

/**
 * Groesster am Stueck eintragbarer Urlaubszeitraum (Kalendertage). Ein Jahr ist
 * mehr als jeder reale Urlaub; die Grenze verhindert, dass ein Vertipper im
 * Jahresfeld die Vorschau ueber Hunderttausende Tage rechnen laesst.
 */
const MAX_VACATION_RANGE_DAYS = 366;

/**
 * Genommene Urlaubstage: Einzeltag, Zeitraum, Abgleich mit Clockodo und Liste (aus MoreScreen
 * ausgelagert, AUF-043). Die Auswahl "Urlaub fuer Beschaeftigung" bleibt in MoreScreen, weil auch
 * die Krankheitszeiten an ihr haengen.
 */
export function VacationSection({
  employments,
  vacTargetId,
  vacEmp,
  setVacEmpId,
  vacDays,
  addVac,
  addVacMany,
  removeVac,
  refreshVac,
  sickPeriods,
}: {
  employments: readonly Employment[];
  vacTargetId: string;
  vacEmp: Employment | undefined;
  setVacEmpId: (id: string) => void;
  vacDays: readonly VacationDay[];
  addVac: (date: number, note?: string, employmentId?: string) => Promise<void>;
  addVacMany: (dates: readonly number[], employmentId?: string) => Promise<number>;
  removeVac: (date: number, employmentId: string) => Promise<void>;
  refreshVac: () => Promise<void>;
  sickPeriods: readonly SickPeriod[];
}) {
  const [newVacDate, setNewVacDate] = useState('');
  const [vacFrom, setVacFrom] = useState('');
  const [vacTo, setVacTo] = useState('');
  const [vacRangeMsg, setVacRangeMsg] = useState('');

  const empLabel = (id: string) =>
    employments.find((e) => e.id === id)?.name ?? id;

  const handleAddVacation = async () => {
    const t = fromDateInput(newVacDate);
    if (Number.isNaN(t) || !vacTargetId) return;
    await addVac(t, '', vacTargetId);
    setNewVacDate('');
  };

  // Zweiter Erfassungsweg: ganzer Zeitraum statt Einzeltag. Die Vorschau wird
  // bei jeder Eingabe neu berechnet, damit vor dem Klick sichtbar ist, wie
  // viele Tage tatsaechlich eingetragen werden. Die Obergrenze schuetzt den
  // Render-Pfad: ein <input type="date"> laesst Jahreszahlen bis 275760 zu, und
  // workdaysInRange legt pro Kalendertag ein Date-Objekt an.
  const rangeSpanDays =
    Number.isNaN(fromDateInput(vacFrom)) || Number.isNaN(fromDateInput(vacTo))
      ? 0
      : differenceInCalendarDays(fromDateInput(vacTo), fromDateInput(vacFrom)) + 1;
  const rangeTooLong = rangeSpanDays > MAX_VACATION_RANGE_DAYS;
  const rangeDays =
    rangeSpanDays <= 0 || rangeTooLong
      ? []
      : workdaysInRange(
          fromDateInput(vacFrom),
          fromDateInput(vacTo),
          vacEmp ?? { workdaysPerWeek: 5 },
        );

  const handleAddVacationRange = async () => {
    if (rangeDays.length === 0) return;
    const added = await addVacMany(rangeDays, vacTargetId);
    const skipped = rangeDays.length - added;
    setVacFrom('');
    setVacTo('');
    // Inline statt window.alert: die neuen Tage stehen sofort in der Liste
    // darunter, die Meldung ergaenzt nur, was uebersprungen wurde.
    setVacRangeMsg(
      `${added} Urlaubstag(e) eingetragen` +
        (skipped > 0 ? `, ${skipped} war(en) bereits erfasst` : '') +
        '.',
    );
  };

  return (
    <>
      <h3 className="sub-head">Genommene Urlaubstage</h3>
      <p className="muted small">
        Jeder Eintrag zaehlt als 1 Urlaubstag, mindert den Resturlaub des
        jeweiligen Jahres und entlastet das Arbeitszeitkonto um bis zu{' '}
        {vacEmp
          ? decimalHours(dailyTargetMs(vacEmp)).toFixed(2).replace('.', ',')
          : '0,00'}{' '}
        Std. Ist an dem Tag schon Zeit erfasst, wird nur die Differenz
        gutgeschrieben — ein Tag zaehlt nie doppelt.
      </p>
      <label className="field">
        <span>Urlaub fuer Beschaeftigung</span>
        <select
          value={vacTargetId}
          onChange={(e) => setVacEmpId(e.target.value)}
        >
          {employments.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <div className="vac-add">
        <input
          type="date"
          value={newVacDate}
          onChange={(e) => setNewVacDate(e.target.value)}
        />
        <button
          className="btn"
          disabled={!newVacDate}
          onClick={() => void handleAddVacation()}
        >
          Urlaubstag hinzufuegen
        </button>
      </div>

      <p className="muted small vac-or">oder ganzen Zeitraum eintragen:</p>
      <div className="vac-range">
        <label className="field">
          <span>von</span>
          <input
            type="date"
            value={vacFrom}
            onChange={(e) => {
              setVacFrom(e.target.value);
              setVacRangeMsg('');
            }}
          />
        </label>
        <label className="field">
          <span>bis</span>
          <input
            type="date"
            value={vacTo}
            onChange={(e) => {
              setVacTo(e.target.value);
              setVacRangeMsg('');
            }}
          />
        </label>
      </div>
      <button
        className="btn btn-block"
        disabled={rangeDays.length === 0}
        onClick={() => void handleAddVacationRange()}
      >
        {rangeDays.length > 0
          ? `${rangeDays.length} Arbeitstag(e) eintragen`
          : 'Zeitraum eintragen'}
      </button>
      <p className="muted small">
        {rangeTooLong
          ? `Der Zeitraum ist zu lang (max. ${MAX_VACATION_RANGE_DAYS} Tage am Stueck). Bitte Datum pruefen.`
          : vacRangeMsg ||
            'Es zaehlen die Wochentage der Beschaeftigung; ohne gewaehlte Wochentage Montag bis Freitag, ab 6 Arbeitstagen auch der Samstag. Feiertage der Beschaeftigung werden uebersprungen.'}
      </p>

      <VacationClockodo
        employment={vacEmp}
        days={vacDays}
        sickPeriods={sickPeriods}
        onDone={refreshVac}
      />
      {vacDays.length === 0 ? (
        <p className="muted small">Noch keine Urlaubstage erfasst.</p>
      ) : (
        <ul className="vac-list">
          {vacDays.map((d) => (
            <VacationDayRow
              key={`${d.employmentId}-${d.date}`}
              day={d}
              days={vacDays}
              employmentLabel={empLabel(d.employmentId)}
              employment={employments.find((e) => e.id === d.employmentId)}
              onRemove={() => void removeVac(d.date, d.employmentId)}
              onWithdrawn={refreshVac}
              sickPeriods={sickPeriods}
            />
          ))}
        </ul>
      )}
    </>
  );
}
