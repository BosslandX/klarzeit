import type { VacationDay } from '../../domain/employment';
import { absenceStatusLabel, isVacationDayRemovable } from '../../domain/clockodo-absence';
import { formatDateWithWeekday } from '../../domain/time';

export function VacationDayRow({
  day,
  employmentLabel,
  showClockodo,
  onRemove,
}: {
  day: VacationDay;
  employmentLabel: string;
  showClockodo: boolean;
  onRemove: () => void;
}) {
  return (
    <li>
      <span>
        {formatDateWithWeekday(day.date)}
        <span className="muted small"> ({employmentLabel})</span>
        {showClockodo && (
          <span className="muted small">
            {' '}
            · Clockodo: {absenceStatusLabel(day.clockodoAbsence)}
          </span>
        )}
      </span>
      {isVacationDayRemovable(day) ? (
        <button className="link-btn danger" type="button" onClick={onRemove}>
          entfernen
        </button>
      ) : (
        <span className="muted small">erst in Clockodo zurueckziehen</span>
      )}
    </li>
  );
}
