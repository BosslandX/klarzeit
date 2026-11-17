import { useState } from 'react';
import { checkForUpdate, downloadAndInstall, type UpdateInfo } from '../../update/updater';

/** App-Update: nach einer neueren Version suchen und sie installieren (aus MoreScreen ausgelagert). */
export function UpdateSection() {
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMsg, setUpdateMsg] = useState('');
  const [available, setAvailable] = useState<UpdateInfo | null>(null);

  const onCheckUpdate = async () => {
    setUpdateBusy(true);
    setUpdateMsg('');
    setAvailable(null);
    try {
      const info = await checkForUpdate();
      if (info) {
        setAvailable(info);
        setUpdateMsg(
          `Neue Version ${info.versionName} verfuegbar (installiert: ${info.currentVersionName}).`,
        );
      } else {
        setUpdateMsg('Du hast bereits die neueste Version.');
      }
    } catch (e) {
      setUpdateMsg(`Update-Pruefung fehlgeschlagen: ${msg(e)}`);
    } finally {
      setUpdateBusy(false);
    }
  };

  const onInstallUpdate = async () => {
    if (!available) return;
    setUpdateBusy(true);
    setUpdateMsg('Lade Update herunter …');
    try {
      await downloadAndInstall(available);
      setUpdateMsg('Installation gestartet – bitte den System-Dialog bestaetigen.');
    } catch (e) {
      setUpdateMsg(`Update fehlgeschlagen: ${msg(e)}`);
    } finally {
      setUpdateBusy(false);
    }
  };

  return (
    <section className="card-section">
      <h2>App-Update</h2>
      <p className="muted small">
        Sucht auf dem Server nach einer neueren Version und installiert sie.
      </p>
      <button className="btn" onClick={onCheckUpdate} disabled={updateBusy}>
        Nach Update suchen
      </button>
      {available && (
        <button
          className="btn btn-primary"
          onClick={onInstallUpdate}
          disabled={updateBusy}
        >
          Update {available.versionName} installieren
        </button>
      )}
      {updateMsg && <p className="muted small">{updateMsg}</p>}
      {available?.notes && <p className="muted small">{available.notes}</p>}
    </section>
  );
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
