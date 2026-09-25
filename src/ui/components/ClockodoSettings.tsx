import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { format, startOfDay } from 'date-fns';
import type { ClockodoConfig } from '../../domain/clockodo';
import type { ClockodoLists } from '../../domain/clockodo';
import { fromDateInput } from '../../domain/time';
import { ClockodoError, fetchLists, fetchMe } from '../../clockodo/client';
import { getClockodoKey, setClockodoKey } from '../../clockodo/key-store';
import { getClockodoLists, saveClockodoLists } from '../../db/clockodo-lists';

type Props = {
  employmentId: string;
  value: ClockodoConfig | null;
  onChange: (next: ClockodoConfig | null) => void;
};

export function ClockodoSettings({
  employmentId,
  value,
  onChange,
}: Props) {
  const enabled = value != null;
  const [keyDraft, setKeyDraft] = useState('');
  const [keySavedFlash, setKeySavedFlash] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [msg, setMsg] = useState('');
  const [lists, setLists] = useState<ClockodoLists | null>(null);
  const native = Capacitor.isNativePlatform();

  useEffect(() => {
    void getClockodoKey(employmentId).then((k) => setHasKey(k != null));
    void getClockodoLists(employmentId).then(setLists);
  }, [employmentId]);

  const patch = (partial: Partial<ClockodoConfig>) => {
    if (!value) return;
    onChange({ ...value, ...partial });
  };

  const onToggle = (next: boolean) => {
    if (!next) {
      // Schluessel und Listen loescht erst das Speichern der Beschaeftigung
      // (MoreScreen) -- ein Abbrechen darf nichts entfernt haben.
      setLists(null);
      setMsg('');
      setKeyDraft('');
      setKeySavedFlash(false);
      onChange(null);
      return;
    }
    onChange({
      apiUser: '',
      syncFrom: startOfDay(new Date()).getTime(),
      defaultCustomersId: null,
      defaultProjectsId: null,
      defaultServicesId: null,
      billable: null,
    });
  };

  const saveKey = async () => {
    const trimmed = keyDraft.trim();
    if (!trimmed) return;
    try {
      await setClockodoKey(employmentId, trimmed);
    } catch {
      setMsg('Schluessel konnte nicht gespeichert werden.');
      return;
    }
    setKeyDraft('');
    setHasKey(true);
    setKeySavedFlash(true);
    setTimeout(() => setKeySavedFlash(false), 2000);
  };

  const testConnection = async () => {
    if (!value) return;
    setMsg('');
    try {
      const apiKey = await getClockodoKey(employmentId);
      if (!apiKey) {
        setMsg('Bitte zuerst den API-Schluessel speichern.');
        return;
      }
      const auth = { apiUser: value.apiUser, apiKey };
      const me = await fetchMe(auth);
      const loaded = await fetchLists(auth);
      await saveClockodoLists(employmentId, loaded);
      setLists(loaded);
      setMsg(
        `Verbunden als ${me.name}. ${loaded.customers.length} Kunden, ${loaded.projects.length} Projekte, ${loaded.services.length} Leistungen geladen.`,
      );
    } catch (e) {
      setMsg(e instanceof ClockodoError ? e.message : 'Fehler bei der Verbindung.');
    }
  };

  const projectOptions =
    lists && value?.defaultCustomersId != null
      ? lists.projects.filter(
          (p) => p.customersId === value.defaultCustomersId,
        )
      : [];

  return (
    <div className="clockodo-settings">
      <h4 className="sub-head">Clockodo</h4>
      <label className="field row">
        <span>An Clockodo uebertragen</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
      </label>
      {enabled && value && (
        <>
          <label className="field">
            <span>Clockodo-Login (E-Mail)</span>
            <input
              type="email"
              autoComplete="off"
              value={value.apiUser}
              onChange={(e) => patch({ apiUser: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Uebertragen ab</span>
            <input
              type="date"
              value={format(value.syncFrom, 'yyyy-MM-dd')}
              onChange={(e) => {
                const t = fromDateInput(e.target.value);
                if (!Number.isNaN(t)) patch({ syncFrom: t });
              }}
            />
          </label>
          <label className="field">
            <span>API-Schluessel</span>
            <input
              type="password"
              autoComplete="new-password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder={hasKey ? 'Schluessel ist gespeichert' : ''}
            />
          </label>
          <button className="btn" type="button" onClick={() => void saveKey()}>
            Schluessel speichern
          </button>
          {keySavedFlash && (
            <p className="muted small">Schluessel gespeichert</p>
          )}
          {hasKey && !keySavedFlash && (
            <p className="muted small">Ein API-Schluessel ist gespeichert.</p>
          )}
          {native ? (
            <button className="btn" type="button" onClick={() => void testConnection()}>
              Verbindung testen
            </button>
          ) : (
            <p className="muted small">
              Clockodo ist nur in der Android-App erreichbar.
            </p>
          )}
          {msg && <p className="small">{msg}</p>}
          {lists && (
            <>
              <label className="field">
                <span>Standard-Kunde</span>
                <select
                  value={value.defaultCustomersId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    patch({
                      defaultCustomersId: v ? Number(v) : null,
                      defaultProjectsId: null,
                    });
                  }}
                >
                  <option value="">—</option>
                  {lists.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Standard-Projekt</span>
                <select
                  value={value.defaultProjectsId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    patch({
                      defaultProjectsId: v ? Number(v) : null,
                    });
                  }}
                >
                  <option value="">kein Projekt</option>
                  {projectOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Standard-Leistung</span>
                <select
                  value={value.defaultServicesId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    patch({
                      defaultServicesId: v ? Number(v) : null,
                    });
                  }}
                >
                  <option value="">—</option>
                  {lists.services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Abrechenbar</span>
                <select
                  value={
                    value.billable === null
                      ? ''
                      : String(value.billable)
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    patch({
                      billable: v === '' ? null : (Number(v) as 0 | 1),
                    });
                  }}
                >
                  <option value="">nicht mitsenden</option>
                  <option value="0">nicht abrechenbar</option>
                  <option value="1">abrechenbar</option>
                </select>
              </label>
            </>
          )}
        </>
      )}
    </div>
  );
}
