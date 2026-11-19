import { format } from 'date-fns';
import { fullMonthlyTargetMs } from '../../domain/balance';
import {
  annualEntitlement,
  type Employment,
  type VacationYearMode,
} from '../../domain/employment';
import { decimalHours, formatDays, fromDateInput, HOUR } from '../../domain/time';
import { ClockodoSettings } from './ClockodoSettings';
import { WorkWeekdaysField } from './WorkWeekdaysField';
import { HolidaySettingsField } from './HolidaySettingsField';
import { ContractChangeField } from './ContractChangeField';

const VACATION_MODE_LABELS: { value: VacationYearMode; label: string }[] = [
  { value: 'both', label: 'Beide (voll + anteilig)' },
  { value: 'full', label: 'Voller Jahresanspruch' },
  { value: 'prorata', label: 'Anteilig (Zwoelftelung)' },
];

/**
 * Formular "Beschaeftigung bearbeiten" (aus MoreScreen ausgelagert, AUF-043). Entwurf, "Gilt ab" und
 * die Anzeige "Gespeichert" bleiben in MoreScreen: Jedes Oeffnen setzt "Gilt ab" zurueck, und
 * "Gespeichert" steht noch da, wenn das Formular kurz nach dem Speichern wieder geoeffnet wird.
 */
export function EmploymentEditForm({
  editingId,
  editDraft,
  setEditDraft,
  saved,
  aenderungAb,
  setAenderungAb,
  empFlash,
  onSave,
  onDelete,
  onCancel,
}: {
  editingId: string;
  editDraft: Employment;
  setEditDraft: (next: Employment) => void;
  saved: Employment | undefined;
  aenderungAb: number | null;
  setAenderungAb: (next: number | null) => void;
  empFlash: boolean;
  onSave: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  // Im Formular ist der Entwurf immer gesetzt; bis AUF-043 stand hier `editDraft ?? vacEmp`.
  const emp = editDraft;
  const setEmpField = <K extends keyof Employment,>(key: K, value: Employment[K]) => {
    setEditDraft({ ...editDraft, [key]: value });
  };

  return (
    <div className="emp-edit">
      <h3 className="sub-head">Beschaeftigung bearbeiten</h3>
      <label className="field">
        <span>Anzeigename</span>
        <input
          type="text"
          value={editDraft.name}
          onChange={(ev) => setEmpField('name', ev.target.value)}
        />
      </label>
      <label className="field">
        <span>Arbeitgeber</span>
        <input
          type="text"
          value={editDraft.arbeitgeber}
          onChange={(ev) => setEmpField('arbeitgeber', ev.target.value)}
        />
      </label>
      <label className="field">
        <span>Personalnummer / ID</span>
        <input
          type="text"
          value={editDraft.personalnummer}
          onChange={(ev) => setEmpField('personalnummer', ev.target.value)}
        />
      </label>
      <label className="field">
        <span>Abteilung / Position</span>
        <input
          type="text"
          value={editDraft.abteilung}
          onChange={(ev) => setEmpField('abteilung', ev.target.value)}
        />
      </label>
      <label className="field">
        <span>Beginn des Arbeitsverhaeltnisses</span>
        <input
          type="date"
          value={format(emp.startDate, 'yyyy-MM-dd')}
          onChange={(e) => {
            const t = fromDateInput(e.target.value);
            if (!Number.isNaN(t)) setEmpField('startDate', t);
          }}
        />
      </label>
      <label className="field">
        <span>Ende (befristet, optional)</span>
        <input
          type="date"
          value={emp.endDate != null ? format(emp.endDate, 'yyyy-MM-dd') : ''}
          onChange={(e) => {
            if (!e.target.value) {
              setEmpField('endDate', null);
              return;
            }
            const t = fromDateInput(e.target.value);
            if (!Number.isNaN(t)) setEmpField('endDate', t);
          }}
        />
      </label>
      <label className="field">
        <span>Wochenarbeitszeit (Stunden)</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          min="0"
          value={emp.weeklyHours}
          onChange={(e) => setEmpField('weeklyHours', Number(e.target.value) || 0)}
        />
      </label>
      <WorkWeekdaysField
        emp={emp}
        onChange={(next) => {
          setEditDraft({ ...editDraft, workWeekdays: next, workdaysPerWeek: next.length });
        }}
      />
      <ContractChangeField
        saved={saved}
        draft={emp}
        ab={aenderungAb}
        onAb={setAenderungAb}
        onDraft={setEditDraft}
      />
      <HolidaySettingsField
        value={emp.publicHolidays}
        onChange={(next) => setEmpField('publicHolidays', next)}
      />
      <label className="field">
        <span>Urlaubsanspruch laut Vertrag (Tage/Jahr)</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.5"
          min="0"
          placeholder={`leer = gesetzlich (${annualEntitlement(emp).statutory})`}
          value={emp.contractVacationDays ?? ''}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === '') {
              setEmpField('contractVacationDays', null);
              return;
            }
            const n = Number(raw);
            setEmpField(
              'contractVacationDays',
              Number.isFinite(n) && n > 0 ? n : null,
            );
          }}
        />
      </label>
      {emp.contractVacationDays != null && !annualEntitlement(emp).fromContract && (
        <p className="muted small">
          Unter dem gesetzlichen Minimum ({annualEntitlement(emp).statutory} Tage/Jahr)
          gilt der gesetzliche Urlaubsanspruch.
        </p>
      )}
      <label className="field">
        <span>Urlaub im Eintrittsjahr ausweisen</span>
        <select
          value={emp.vacationYearMode}
          onChange={(e) =>
            setEmpField('vacationYearMode', e.target.value as VacationYearMode)
          }
        >
          {VACATION_MODE_LABELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Anfangssaldo (Stunden, +/-)</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.25"
          value={decimalHours(emp.openingBalanceMs)}
          onChange={(e) =>
            setEmpField(
              'openingBalanceMs',
              Math.round((Number(e.target.value) || 0) * HOUR),
            )
          }
        />
      </label>
      <label className="field">
        <span>Mit dem Gehalt abgegoltene Ueberstunden (Std./Monat)</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.5"
          min="0"
          placeholder="leer = keine"
          value={emp.includedOvertimeHoursPerMonth ?? ''}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === '') {
              setEmpField('includedOvertimeHoursPerMonth', null);
              return;
            }
            const n = Number(raw);
            setEmpField(
              'includedOvertimeHoursPerMonth',
              Number.isFinite(n) && n > 0 ? n : null,
            );
          }}
        />
      </label>
      <p className="muted small">
        Ueberstunden bis zu dieser Zahl je Monat sind mit dem Gehalt abgegolten
        und zaehlen nicht ins Arbeitszeitkonto. Minusstunden aus Vormonaten
        werden damit nicht verrechnet; im Eintritts- und Austrittsmonat gilt die
        Zahl anteilig.
      </p>
      <label className="field">
        <span>Hinweis im PDF-Kontoblock</span>
        <input
          type="text"
          maxLength={120}
          placeholder="leer = kein Hinweis"
          value={emp.balanceNote}
          onChange={(ev) => setEmpField('balanceNote', ev.target.value)}
        />
      </label>
      <p className="muted small">
        Erscheint im Monats-PDF in der Fussnote des Arbeitszeitkontos, z. B. die
        Fundstelle der Ausgleichsregel im Arbeitsvertrag.
      </p>
      <ClockodoSettings
        employmentId={editingId}
        value={editDraft.clockodo}
        onChange={(next) => setEmpField('clockodo', next)}
      />
      <p className="muted small">
        Monats-Soll:{' '}
        {decimalHours(fullMonthlyTargetMs(emp.weeklyHours))
          .toFixed(2)
          .replace('.', ',')}{' '}
        Std. ·{' '}
        {emp.contractVacationDays != null
          ? `Vertrag: ${formatDays(emp.contractVacationDays)}/Jahr · gesetzl. Minimum: ${annualEntitlement(emp).statutory} Tage/Jahr (BUrlG).`
          : `gesetzl. Urlaub: ${annualEntitlement(emp).statutory} Tage/Jahr (BUrlG).`}
      </p>
      <button className="btn btn-primary" type="button" onClick={onSave}>
        {empFlash ? '✓ Gespeichert' : 'Aenderungen speichern'}
      </button>
      <button
        className="btn danger-outline"
        type="button"
        onClick={onDelete}
      >
        Beschaeftigung loeschen
      </button>
      <button className="btn" type="button" onClick={onCancel}>
        Bearbeiten abbrechen
      </button>
    </div>
  );
}
