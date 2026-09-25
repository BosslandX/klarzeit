import { useMemo, useState } from 'react';
import {
  addEntry,
  deleteEntry,
  updateEntry,
  useAllEntriesDesc,
} from '../../db/entries';
import { getEmployments, useEmployments } from '../../db/employment';
import { groupByDay } from '../../domain/aggregate';
import type { Period } from '../../domain/aggregate';
import type { TimeEntry } from '../../domain/types';
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

  const showEmploymentInfo = employments.length > 1;
  const employmentName = (id: string) =>
    employments.find((e) => e.id === id)?.name ?? id;

  const filteredEntries = useMemo(() => {
    if (!entries) return undefined;
    if (!filterEmploymentId) return entries;
    return entries.filter((e) => e.employmentId === filterEmploymentId);
  }, [entries, filterEmploymentId]);

  const handleSave = async (draft: EntryDraft) => {
    if (modal?.mode === 'edit' && modal.entry.id != null) {
      await updateEntry(modal.entry.id, draft);
    } else {
      await addEntry(draft);
    }
    setModal(null);
  };

  const handleDelete = async (entry: TimeEntry) => {
    if (entry.id == null) return;
    const ok = window.confirm(
      `Eintrag vom ${formatDateTime(entry.start)} wirklich loeschen?`,
    );
    if (!ok) return;
    await deleteEntry(entry.id);
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
                    {showEmploymentInfo && (
                      <span className="badge entry-employment">
                        {employmentName(e.employmentId)}
                      </span>
                    )}
                  </div>
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
