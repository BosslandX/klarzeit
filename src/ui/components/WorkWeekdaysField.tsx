import {
  displayedWorkWeekdays,
  toggleWorkWeekday,
  type Employment,
} from '../../domain/employment';

/** Wochentage im Formular, Montag zuerst (0 = Sonntag wie bei getDay). */
const WEEKDAY_BUTTONS: { day: number; label: string }[] = [
  { day: 1, label: 'Mo' },
  { day: 2, label: 'Di' },
  { day: 3, label: 'Mi' },
  { day: 4, label: 'Do' },
  { day: 5, label: 'Fr' },
  { day: 6, label: 'Sa' },
  { day: 0, label: 'So' },
];

/**
 * Arbeitstage einer Beschaeftigung als Wochentage. Ein Tipp waehlt einen Tag an oder ab,
 * onChange bekommt die neue Auswahl. Ohne gewaehlte Wochentage zeigt das Feld bei 5 und 6
 * Arbeitstagen die bisherige Regel, bei 1 bis 4 keine Auswahl, dafuer einen Hinweis.
 */
export function WorkWeekdaysField({
  emp,
  onChange,
}: {
  emp: Pick<Employment, 'workdaysPerWeek' | 'workWeekdays'>;
  onChange: (next: number[]) => void;
}) {
  const shown = displayedWorkWeekdays(emp);
  return (
    <>
      <div className="field">
        <span>Arbeitstage ({emp.workdaysPerWeek} pro Woche)</span>
        <div className="segmented" role="group" aria-label="Arbeitstage">
          {WEEKDAY_BUTTONS.map((w) => {
            const on = shown.includes(w.day);
            return (
              <button
                key={w.day}
                type="button"
                className={`seg${on ? ' active' : ''}`}
                aria-pressed={on}
                onClick={() => {
                  const next = toggleWorkWeekday(shown, w.day);
                  if (next !== null) onChange(next);
                }}
              >
                {w.label}
              </button>
            );
          })}
        </div>
      </div>
      {emp.workWeekdays === undefined && emp.workdaysPerWeek < 5 && (
        <p className="muted small">
          Bitte die Wochentage waehlen. Bis dahin zaehlt ein Urlaubszeitraum Montag bis
          Freitag.
        </p>
      )}
    </>
  );
}
