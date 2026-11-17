import { useEffect, useState } from 'react';
import { addDays, addMonths, addWeeks, format, getYear, startOfMonth } from 'date-fns';
import {
  dayPeriod,
  groupByDay,
  monthPeriod,
  rangePeriod,
  totalBreakMinutes,
  totalMs,
  weekPeriod,
  type Period,
  type PeriodKind,
} from '../../domain/aggregate';
import {
  buildBalanceLedger,
  buildVacationStatus,
} from '../../domain/employment';
import {
  getEntriesInRange,
  getEntriesInRangeForEmployment,
  useEntriesInRangeForEmployment,
} from '../../db/entries';
import { getProfile } from '../../db/profile';
import {
  getActiveEmploymentId,
  getVacationDays,
  useEmployments,
  useVacationDays,
} from '../../db/employment';
import { getSickPeriods, useSickPeriods } from '../../db/sickness';
import { splitVacationAndSickness } from '../../domain/sickness';
import {
  decimalHours,
  formatClock,
  formatDays,
  formatDuration,
  formatSignedDuration,
  fromDateInput,
  netMs,
} from '../../domain/time';
import { buildReportPdf, reportFilename, type ReportExtras } from '../../pdf/report-pdf';
import { entriesToCsv } from '../../db/backup';
import { sharePdf, shareTextFile } from '../../pdf/share';
import { IconChevronLeft, IconChevronRight, IconShare } from '../components/Icons';

const KINDS: { key: PeriodKind; label: string }[] = [
  { key: 'day', label: 'Tag' },
  { key: 'week', label: 'Woche' },
  { key: 'month', label: 'Monat' },
  { key: 'range', label: 'Zeitraum' },
];

function buildPeriod(
  kind: PeriodKind,
  ref: number,
  from: number,
  to: number,
): Period {
  switch (kind) {
    case 'day':
      return dayPeriod(ref);
    case 'week':
      return weekPeriod(ref);
    case 'month':
      return monthPeriod(ref);
    case 'range':
      return rangePeriod(from, to);
  }
}

export function ReportsScreen() {
  const [kind, setKind] = useState<PeriodKind>('week');
  const [ref, setRef] = useState<number>(Date.now());
  const [rangeFrom, setRangeFrom] = useState<number>(
    addDays(Date.now(), -7).getTime(),
  );
  const [rangeTo, setRangeTo] = useState<number>(Date.now());
  const [busy, setBusy] = useState(false);
  const [selectedEmploymentId, setSelectedEmploymentId] = useState('');

  const { employments, loading: empsLoading } = useEmployments();
  const showEmploymentPicker = employments.length > 1;

  useEffect(() => {
    if (empsLoading || employments.length === 0) return;
    void getActiveEmploymentId().then((activeId) => {
      setSelectedEmploymentId((prev) => {
        if (prev && employments.some((e) => e.id === prev)) return prev;
        return employments.some((e) => e.id === activeId)
          ? activeId
          : employments[0].id;
      });
    });
  }, [empsLoading, employments]);

  const employment =
    employments.find((e) => e.id === selectedEmploymentId) ?? employments[0];
  const employmentId = employment?.id ?? '';

  const period = buildPeriod(kind, ref, rangeFrom, rangeTo);
  const entries =
    useEntriesInRangeForEmployment(period.from, period.to, employmentId) ?? [];
  const grandMs = totalMs(entries);
  const days = groupByDay(entries);

  const { days: vacationDays } = useVacationDays();
  const isMonth = kind === 'month';
  const ledgerEntries =
    useEntriesInRangeForEmployment(
      employment ? Math.min(employment.startDate, period.from) : period.from,
      period.to,
      employmentId,
    ) ?? [];
  const vacationDates = vacationDays
    .filter((d) => d.employmentId === employmentId)
    .map((d) => d.date);
  const { periods: sickPeriods } = useSickPeriods();
  // Urlaub und Krankheit nach § 9 BUrlG getrennt (AUF-034).
  const geteilt = splitVacationAndSickness(vacationDates, sickPeriods, employmentId);
  const ledger =
    isMonth && employment
      ? buildBalanceLedger(
          employment,
          ledgerEntries,
          ref,
          geteilt.vacationDates,
          geteilt.sickDates,
        )
      : null;
  const vacation =
    isMonth && employment
      ? buildVacationStatus(employment, geteilt.vacationDates, getYear(period.from))
      : null;

  const shift = (dir: -1 | 1) => {
    if (kind === 'day') setRef((r) => addDays(r, dir).getTime());
    else if (kind === 'week') setRef((r) => addWeeks(r, dir).getTime());
    else if (kind === 'month')
      setRef((r) => {
        const next = addMonths(r, dir).getTime();
        if (dir === 1 && startOfMonth(next).getTime() > startOfMonth(Date.now()).getTime()) {
          return r;
        }
        return next;
      });
  };

  const handlePdf = async () => {
    if (!employment) return;
    setBusy(true);
    try {
      const profile = await getProfile();
      let extras: ReportExtras | undefined;
      let bodyEntries = entries;
      if (isMonth) {
        const [vac, krank, wide] = await Promise.all([
          getVacationDays(),
          getSickPeriods(),
          getEntriesInRangeForEmployment(
            Math.min(employment.startDate, period.from),
            period.to,
            employment.id,
          ),
        ]);
        const vacForEmp = vac.filter((d) => d.employmentId === employment.id);
        bodyEntries = wide.filter(
          (e) => e.start >= period.from && e.start <= period.to,
        );
        const teil = splitVacationAndSickness(
          vacForEmp.map((d) => d.date),
          krank,
          employment.id,
        );
        const led = buildBalanceLedger(employment, wide, ref, teil.vacationDates, teil.sickDates);
        if (led) {
          extras = {
            ledger: led,
            vacation: buildVacationStatus(
              employment,
              teil.vacationDates,
              getYear(period.from),
            ),
          };
        }
      }
      const doc = buildReportPdf(profile, period, bodyEntries, employment, extras);
      await sharePdf(doc, reportFilename(period), `Klarzeit – ${period.label}`);
    } catch (e) {
      window.alert(
        `PDF fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCsv = async () => {
    setBusy(true);
    try {
      const csv = entriesToCsv(entries, employments);
      const name = reportFilename(period).replace(/\.pdf$/i, '.csv');
      await shareTextFile(csv, name, `Klarzeit – ${period.label}`, 'text/csv');
    } catch (e) {
      window.alert(
        `CSV fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Reports</h1>
      </header>

      <div className="segmented">
        {KINDS.map((k) => (
          <button
            key={k.key}
            className={`seg${kind === k.key ? ' active' : ''}`}
            onClick={() => setKind(k.key)}
          >
            {k.label}
          </button>
        ))}
      </div>

      {showEmploymentPicker && employment && (
        <label className="field">
          <span>Beschaeftigung</span>
          <select
            value={selectedEmploymentId}
            onChange={(e) => setSelectedEmploymentId(e.target.value)}
          >
            {employments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.arbeitgeber ? ` — ${e.arbeitgeber}` : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      {kind === 'range' ? (
        <div className="range-row">
          <label className="field">
            <span>Von</span>
            <input
              type="date"
              value={format(rangeFrom, 'yyyy-MM-dd')}
              onChange={(e) => {
                const t = fromDateInput(e.target.value);
                if (!Number.isNaN(t)) setRangeFrom(t);
              }}
            />
          </label>
          <label className="field">
            <span>Bis</span>
            <input
              type="date"
              value={format(rangeTo, 'yyyy-MM-dd')}
              onChange={(e) => {
                const t = fromDateInput(e.target.value);
                if (!Number.isNaN(t)) setRangeTo(t);
              }}
            />
          </label>
        </div>
      ) : (
        <div className="period-nav">
          <button className="icon-btn" onClick={() => shift(-1)} title="Zurueck">
            <IconChevronLeft />
          </button>
          <span className="period-label">{period.label}</span>
          <button className="icon-btn" onClick={() => shift(1)} title="Weiter">
            <IconChevronRight />
          </button>
        </div>
      )}

      <div className="report-summary">
        <div>
          <span className="muted">Gesamt</span>
          <strong>{formatDuration(grandMs)}</strong>
          <small>{decimalHours(grandMs).toFixed(2)} Std.</small>
        </div>
        <div>
          <span className="muted">Tage</span>
          <strong>{days.length}</strong>
        </div>
        <div>
          <span className="muted">Eintraege</span>
          <strong>{entries.length}</strong>
        </div>
        <div>
          <span className="muted">Pausen</span>
          <strong>{totalBreakMinutes(entries)} min</strong>
        </div>
      </div>

      {isMonth && ledger && vacation && (
        <div className="konto-grid">
          <section className="konto-card">
            <h3>Arbeitszeitkonto</h3>
            <div className="konto-row">
              <span>Soll (Monat)</span>
              <strong>{formatDuration(ledger.target.sollMs)}</strong>
            </div>
            <div className="konto-row">
              <span>Ist (Monat)</span>
              <strong>{formatDuration(ledger.target.istMs)}</strong>
            </div>
            {ledger.target.vacationDays > 0 && (
              <div className="konto-row">
                <span>Urlaub ({formatDays(ledger.target.vacationDays)})</span>
                <strong className="pos">
                  {formatSignedDuration(ledger.target.vacationCreditMs)}
                </strong>
              </div>
            )}
            {ledger.target.holidayDays > 0 && (
              <div className="konto-row">
                <span>Feiertage ({formatDays(ledger.target.holidayDays)})</span>
                <strong className="pos">
                  {formatSignedDuration(ledger.target.holidayCreditMs)}
                </strong>
              </div>
            )}
            {ledger.target.sickDays > 0 && (
              <div className="konto-row">
                <span>Krankheit ({formatDays(ledger.target.sickDays)})</span>
                <strong className="pos">
                  {formatSignedDuration(ledger.target.sickCreditMs)}
                </strong>
              </div>
            )}
            <div className="konto-row">
              <span>Saldo (Monat)</span>
              <strong className={ledger.target.saldoMs >= 0 ? 'pos' : 'neg'}>
                {formatSignedDuration(ledger.target.saldoMs)}
              </strong>
            </div>
            {ledger.target.includedOvertimeMs > 0 && (
              <div className="konto-row">
                <span>mit Gehalt abgegolten</span>
                <strong className="neg">
                  {formatSignedDuration(-ledger.target.includedOvertimeMs)}
                </strong>
              </div>
            )}
            <div className="konto-row">
              <span>Uebertrag (Vormonate)</span>
              <strong className={ledger.carryIn >= 0 ? 'pos' : 'neg'}>
                {formatSignedDuration(ledger.carryIn)}
              </strong>
            </div>
            <div className="konto-row total">
              <span>Saldo gesamt (Monatsende)</span>
              <strong className={ledger.closing >= 0 ? 'pos' : 'neg'}>
                {formatSignedDuration(ledger.closing)}
              </strong>
            </div>
          </section>
          <section className="konto-card">
            <h3>Urlaub {vacation.year}</h3>
            <div className="konto-row">
              <span>
                {vacation.fromContract
                  ? 'Anspruch (Vertrag)'
                  : 'Anspruch (§ 3 BUrlG)'}
              </span>
              <strong>{formatDays(vacation.annualFull)}</strong>
            </div>
            {vacation.isEntryYear && vacation.mode === 'both' && (
              <div className="konto-row">
                <span>anteilig § 5 ({vacation.fullMonths}/12)</span>
                <strong>{formatDays(vacation.prorataRounded)}</strong>
              </div>
            )}
            <div className="konto-row">
              <span>genommen</span>
              <strong>{formatDays(vacation.taken)}</strong>
            </div>
            <div className="konto-row total">
              <span>Resturlaub</span>
              <strong className={vacation.remaining < 0 ? 'neg' : 'pos'}>
                {formatDays(vacation.remaining)}
              </strong>
            </div>
          </section>
        </div>
      )}

      <div className="report-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => void handlePdf()}>
          <IconShare width={18} height={18} /> PDF erstellen &amp; teilen
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => void handleCsv()}>
          CSV exportieren
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="empty">Keine Eintraege in diesem Zeitraum.</div>
      ) : (
        days.map((day) => (
          <section key={day.key} className="day-group">
            <div className="day-head">
              <span>{day.label}</span>
              <span className="day-total">{formatDuration(day.totalMs)}</span>
            </div>
            {day.entries.map((e) => (
              <article key={e.id} className="entry-card readonly">
                <div className="entry-main">
                  <div className="entry-time">
                    {formatClock(e.start)}–{formatClock(e.end)}
                    {e.breakMinutes > 0 && (
                      <span className="entry-break"> · {e.breakMinutes} min Pause</span>
                    )}
                  </div>
                  <div className="entry-activity">
                    {e.activity || <span className="muted">(keine Taetigkeit)</span>}
                  </div>
                </div>
                <div className="entry-duration">{formatDuration(netMs(e))}</div>
              </article>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
