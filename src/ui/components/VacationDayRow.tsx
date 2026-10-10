import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { VacationDay } from '../../domain/employment';
import { absenceStatusLabel, isVacationDayRemovable } from '../../domain/clockodo-absence';
import { formatDateWithWeekday } from '../../domain/time';
import {
  vacationWithdrawQuestion,
  vacationWithdrawSummary,
  withdrawVacationRequest,
} from '../../clockodo/vacation-transfer';

export function VacationDayRow({
  day,
  days,
  employmentLabel,
  showClockodo,
  onRemove,
  onWithdrawn,
}: {
  day: VacationDay;
  days: readonly VacationDay[];
  employmentLabel: string;
  showClockodo: boolean;
  onRemove: () => void;
  onWithdrawn: () => Promise<void>;
}) {
  const native = Capacitor.isNativePlatform();
  const [busy, setBusy] = useState(false);
  const removable = isVacationDayRemovable(day);
  const absenceId = day.clockodoAbsence?.id;
  const showWithdraw = !removable && showClockodo && absenceId !== undefined;

  const handleWithdraw = async () => {
    if (absenceId === undefined) return;
    const ok = window.confirm(
      vacationWithdrawQuestion(days, day.employmentId, absenceId),
    );
    if (!ok) return;
    setBusy(true);
    try {
      const r = await withdrawVacationRequest(day.employmentId, absenceId);
      window.alert(vacationWithdrawSummary(r));
      await onWithdrawn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      window.alert(`Zurueckziehen fehlgeschlagen: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

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
      {removable ? (
        <button className="link-btn danger" type="button" onClick={onRemove}>
          entfernen
        </button>
      ) : showWithdraw ? (
        <button
          className="link-btn danger"
          type="button"
          disabled={busy || !native}
          title={native ? undefined : 'Zurueckziehen nur in der Android-App'}
          onClick={() => void handleWithdraw()}
        >
          zurueckziehen
        </button>
      ) : (
        <span className="muted small">erst in Clockodo zurueckziehen</span>
      )}
    </li>
  );
}
