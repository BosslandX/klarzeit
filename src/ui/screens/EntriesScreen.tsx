import { useCallback, useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  addEntry,
  deleteEntryWithClockodo,
  updateEntryWithClockodo,
  useAllEntriesDesc,
} from '../../db/entries';
import { getClockodoDeletes } from '../../db/clockodo-deletes';
import { getEmployments, useEmployments } from '../../db/employment';
import { transferEmployment, type TransferResult } from '../../clockodo/transfer';
import {
  autoTransferHint,
  startAutoTransfer,
  useAutoTransferResults,
} from '../../clockodo/auto-transfer';
import { refreshClockodoLock } from '../../clockodo/lock';
import { transferStatus } from '../../domain/clockodo-transfer';
import {
  clockodoEntryLabel,
  countLockStates,
  lockHint,
} from '../../domain/clockodo-lock';
import { useClockodoLocks } from '../../db/clockodo-lock';
import type { ClockodoConfig } from '../../domain/clockodo';
import { groupByDay } from '../../domain/aggregate';
import type { Period } from '../../domain/aggregate';
import type { TimeEntry } from '../../domain/types';
import { changedTrackedTimes } from '../../domain/tracked-times';
import {
  formatClock,
  formatDateTime,
  formatDuration,
  netMs,
} from '../../domain/time';
import { getProfile } from '../../db/profile';
import { buildReportPdf, reportFilename } from '../../pdf/report-pdf';
import { sharePdf } from '../../pdf/share';
import { EntryFormModal, type EntryDraft } from '../components/EntryFormModal';
import { IconEdit, IconPlus, IconShare, IconTrash } from '../components/Icons';

type ModalState =
  | { mode: 'create' }
  | { mode: 'edit'; entry: TimeEntry }
  | null;

function defaultManualDraft(): EntryDraft {
  const now = new Date();
  const start = new Date(now);
  start.setHours(9, 0, 0, 0);
  const end = new Date(now);
  end.setHours(17, 0, 0, 0);
  return {
    start: start.getTime(),
    end: end.getTime(),
    breaks: [],
    breakMinutes: 0,
    activity: '',
    note: '',
    source: 'manual',
    clockodo: null,
  };
}


function countTransferBuckets(
  list: TimeEntry[],
  employmentId: string,
  config: ClockodoConfig,
) {
  let open = 0;
  let untimed = 0;
  let incomplete = 0;
  for (const e of list) {
    if (e.employmentId !== employmentId) continue;
    const s = transferStatus(e, config);
    if (s === 'pending' || s === 'changed') open++;
    else if (s === 'untimed-break') untimed++;
    else if (s === 'incomplete') incomplete++;
  }
  return { open, untimed, incomplete };
}

function entryToDraft(entry: TimeEntry): EntryDraft {
  return {
    start: entry.start,
    end: entry.end,
    breaks: entry.breaks ?? [],
    breakMinutes: entry.breakMinutes,
    activity: entry.activity,
    note: entry.note,
    source: entry.source,
    employmentId: entry.employmentId,
    clockodo: entry.clockodo ?? null,
  };
}

export function EntriesScreen() {
  const entries = useAllEntriesDesc();
  const { employments } = useEmployments();
  const [modal, setModal] = useState<ModalState>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [filterEmploymentId, setFilterEmploymentId] = useState<string>('');
  const [transferBusyId, setTransferBusyId] = useState<string | null>(null);
  const [transferOutcome, setTransferOutcome] = useState<
    Record<string, TransferResult | null>
  >({});

  const showEmploymentInfo = employments.length > 1;
  const employmentName = (id: string) =>
    employments.find((e) => e.id === id)?.name ?? id;

  const native = Capacitor.isNativePlatform();
  const clockodoEmployments = useMemo(
    () => employments.filter((e) => e.clockodo != null),
    [employments],
  );
  const { locks, reload: reloadLocks } = useClockodoLocks(
    clockodoEmployments.map((e) => e.id),
  );
  const autoErgebnisse = useAutoTransferResults();
  const [deleteCounts, setDeleteCounts] = useState<Record<string, number>>(
    {},
  );

  const refreshDeleteCounts = useCallback(async () => {
    const next: Record<string, number> = {};
    for (const emp of clockodoEmployments) {
      const ids = await getClockodoDeletes(emp.id);
      next[emp.id] = ids.length;
    }
    setDeleteCounts(next);
  }, [clockodoEmployments]);

  useEffect(() => {
    void refreshDeleteCounts();
  }, [refreshDeleteCounts]);

  // Nach jedem automatischen Lauf stehen Loeschvermerke und Sperrfrist neu.
  useEffect(() => {
    void refreshDeleteCounts();
    void reloadLocks();
  }, [autoErgebnisse, refreshDeleteCounts, reloadLocks]);

  const filteredEntries = useMemo(() => {
    if (!entries) return undefined;
    if (!filterEmploymentId) return entries;
    return entries.filter((e) => e.employmentId === filterEmploymentId);
  }, [entries, filterEmploymentId]);

  const handleSave = async (draft: EntryDraft) => {
    if (modal?.mode === 'edit' && modal.entry.id != null) {
      await updateEntryWithClockodo(modal.entry, draft);
      await refreshDeleteCounts();
    } else {
      await addEntry(draft);
    }
    startAutoTransfer();
    setModal(null);
  };

  const handleDelete = async (entry: TimeEntry) => {
    if (entry.id == null) return;
    const clockodoHint = entry.clockodoSync
      ? '\nEr wird beim naechsten Uebertragen auch in Clockodo geloescht.'
      : '';
    const ok = window.confirm(
      `Eintrag vom ${formatDateTime(entry.start)} wirklich loeschen?${clockodoHint}`,
    );
    if (!ok) return;
    await deleteEntryWithClockodo(entry);
    await refreshDeleteCounts();
    startAutoTransfer();
  };

  const handleSharePdf = async (entry: TimeEntry) => {
    setBusyId(entry.id ?? -1);
    try {
      const profile = await getProfile();
      const period: Period = {
        kind: 'range',
        from: entry.start,
        to: entry.end,
        label: `Einzeleintrag ${formatDateTime(entry.start)}`,
      };
      const employments = await getEmployments();
      const employment =
        employments.find((e) => e.id === entry.employmentId) ?? employments[0];
      const doc = buildReportPdf(profile, period, [entry], employment);
      await sharePdf(doc, reportFilename(period), 'Klarzeit – Einzeleintrag');
    } catch (e) {
      window.alert(
        `Teilen fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusyId(null);
    }
  };


  const handleTransfer = async (employmentId: string) => {
    setTransferBusyId(employmentId);
    setTransferOutcome((o) => ({ ...o, [employmentId]: null }));
    try {
      await refreshClockodoLock(employmentId);
      const result = await transferEmployment(employmentId);
      setTransferOutcome((o) => ({ ...o, [employmentId]: result }));
    } catch (e) {
      window.alert(
        `Uebertragen fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setTransferBusyId(null);
      await refreshDeleteCounts();
      await reloadLocks();
    }
  };

  const now = Date.now();

  const groups = filteredEntries
    ? [...groupByDay(filteredEntries)].reverse()
    : [];

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Eintraege</h1>
      </header>

      {showEmploymentInfo && entries && entries.length > 0 && (
        <label className="field entries-filter">
          <span>Beschaeftigung</span>
          <select
            value={filterEmploymentId}
            onChange={(e) => setFilterEmploymentId(e.target.value)}
          >
            <option value="">Alle Beschaeftigungen</option>
            {employments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      )}


      {entries &&
        clockodoEmployments
          .filter(
            (emp) => !filterEmploymentId || emp.id === filterEmploymentId,
          )
          .map((emp) => {
            const cfg = emp.clockodo!;
            const buckets = countTransferBuckets(entries, emp.id, cfg);
            const outcome = transferOutcome[emp.id];
            const autoHinweis = autoTransferHint(autoErgebnisse[emp.id]);
            return (
              <section key={`clockodo-${emp.id}`} className="card-section">
                <p>
                  Clockodo – {emp.name}: {buckets.open} offen ·{' '}
                  {deleteCounts[emp.id] ?? 0} zu loeschen · {buckets.untimed}{' '}
                  Pause ohne Uhrzeit · {buckets.incomplete} ohne Auswahl
                </p>
                {emp.id in locks &&
                  (() => {
                    const hint = lockHint(
                      countLockStates(
                        entries,
                        emp.id,
                        cfg,
                        locks[emp.id]?.days ?? null,
                        now,
                      ),
                      locks[emp.id],
                    );
                    return hint ? (
                      <p className="error-text">{hint}</p>
                    ) : null;
                  })()}
                {autoHinweis && <p className="error-text">{autoHinweis}</p>}
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!native || transferBusyId === emp.id}
                  title={
                    native
                      ? undefined
                      : 'Clockodo-Uebertragung nur in der Android-App'
                  }
                  onClick={() => void handleTransfer(emp.id)}
                >
                  An Clockodo uebertragen
                </button>
                {!native && (
                  <p className="muted">nur in der Android-App</p>
                )}
                {outcome && (
                  <div className="clockodo-transfer-result">
                    <p>
                      {outcome.sent} uebertragen, {outcome.deleted} in
                      Clockodo geloescht.
                    </p>
                    {outcome.errors.map((err, i) => (
                      <p key={i} className="danger">
                        {err.entryId != null
                          ? formatDateTime(
                              entries.find((x) => x.id === err.entryId)
                                ?.start ?? 0,
                            )
                          : `Clockodo-Eintrag ${err.clockodoId}`}
                        : {err.message}
                      </p>
                    ))}
                    {outcome.stopped && (
                      <p className="danger">Abgebrochen: {outcome.stopped}</p>
                    )}
                  </div>
                )}
              </section>
            );
          })}

      {filteredEntries === undefined ? (
        <div className="center muted">Lade…</div>
      ) : filteredEntries.length === 0 ? (
        <div className="empty">
          Noch keine Eintraege. Erfasse Zeit auf dem Erfassung-Tab oder trage
          ueber „+" eine vergessene Zeit nach.
        </div>
      ) : (
        groups.map((day) => (
          <section key={day.key} className="day-group">
            <div className="day-head">
              <span>{day.label}</span>
              <span className="day-total">{formatDuration(day.totalMs)}</span>
            </div>
            {[...day.entries].reverse().map((e) => (
              <article key={e.id} className="entry-card">
                <div className="entry-main">
                  <div className="entry-time">
                    {formatClock(e.start)}–{formatClock(e.end)}
                    {e.breakMinutes > 0 && (
                      <span className="entry-break"> · {e.breakMinutes} min Pause</span>
                    )}
                  </div>
                  <div className="entry-activity">
                    {e.activity || <span className="muted">(keine Taetigkeit)</span>}
                    {e.source === 'manual' && (
                      <span className="badge">nachgetragen</span>
                    )}
                    {(() => {
                      const t = changedTrackedTimes(e);
                      return t ? (
                        <span className="badge">
                          geaendert, Stoppuhr {formatClock(t.start)}–{formatClock(t.end)}
                        </span>
                      ) : null;
                    })()}
                    {showEmploymentInfo && (
                      <span className="badge entry-employment">
                        {employmentName(e.employmentId)}
                      </span>
                    )}
                  </div>
                  {(() => {
                    const emp = employments.find(
                      (x) => x.id === e.employmentId,
                    );
                    const label = clockodoEntryLabel(
                      e,
                      emp?.clockodo ?? null,
                      locks[e.employmentId] ?? null,
                      now,
                    );
                    return label ? (
                      <div className="muted entry-clockodo">{label}</div>
                    ) : null;
                  })()}
                  {e.note && <div className="entry-note">{e.note}</div>}
                </div>
                <div className="entry-side">
                  <div className="entry-duration">{formatDuration(netMs(e))}</div>
                  <div className="entry-actions">
                    <button
                      className="icon-btn"
                      title="Bearbeiten"
                      onClick={() => setModal({ mode: 'edit', entry: e })}
                    >
                      <IconEdit width={18} height={18} />
                    </button>
                    <button
                      className="icon-btn"
                      title="Als PDF teilen"
                      disabled={busyId === e.id}
                      onClick={() => void handleSharePdf(e)}
                    >
                      <IconShare width={18} height={18} />
                    </button>
                    <button
                      className="icon-btn danger"
                      title="Loeschen"
                      onClick={() => void handleDelete(e)}
                    >
                      <IconTrash width={18} height={18} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        ))
      )}

      <button
        className="fab"
        title="Zeit nachtragen"
        onClick={() => setModal({ mode: 'create' })}
      >
        <IconPlus />
      </button>

      {modal && (
        <EntryFormModal
          title={modal.mode === 'edit' ? 'Eintrag bearbeiten' : 'Zeit nachtragen'}
          initial={
            modal.mode === 'edit' ? entryToDraft(modal.entry) : defaultManualDraft()
          }
          onCancel={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
