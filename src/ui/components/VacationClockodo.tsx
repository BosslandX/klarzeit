import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { Employment, VacationDay } from '../../domain/employment';
import { openVacationDayCount } from '../../domain/clockodo-absence';
import {
  transferVacations,
  vacationTransferSummary,
  type VacationTransferResult,
} from '../../clockodo/vacation-transfer';

/** Urlaubsabgleich mit Clockodo — nur auf Knopfdruck. */
export function VacationClockodo({
  employment,
  days,
  onDone,
}: {
  employment: Employment | undefined;
  days: readonly VacationDay[];
  onDone: () => Promise<void>;
}) {
  const native = Capacitor.isNativePlatform();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VacationTransferResult | null>(null);
  const [resultEmpId, setResultEmpId] = useState<string | null>(null);

  if (!employment || employment.clockodo === null) {
    return null;
  }

  const name = employment.name;
  const n = openVacationDayCount(days, employment);
  const summary = result !== null ? vacationTransferSummary(result) : null;
  const showResult = result !== null && resultEmpId === employment.id && summary !== null;

  const handleSync = async () => {
    setBusy(true);
    try {
      const r = await transferVacations(employment.id);
      setResult(r);
      setResultEmpId(employment.id);
      await onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      window.alert(`Abgleich fehlgeschlagen: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vac-clockodo">
      <p>
        Clockodo – {name}: {n} Urlaubstag(e) offen
      </p>
      <button
        type="button"
        className="btn btn-primary"
        disabled={!native || busy}
        title={native ? undefined : 'Clockodo-Abgleich nur in der Android-App'}
        onClick={() => void handleSync()}
      >
        Urlaub mit Clockodo abgleichen
      </button>
      {!native && <p className="muted">nur in der Android-App</p>}
      {showResult && (
        <div className="clockodo-transfer-result">
          {summary.info.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {summary.problems.map((line) => (
            <p key={line} className="danger">
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
