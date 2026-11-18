import { useState } from 'react';
import type { Profile } from '../../domain/types';

const FIELDS: { key: keyof Profile; label: string; placeholder: string }[] = [
  { key: 'vorname', label: 'Vorname', placeholder: 'Max' },
  { key: 'nachname', label: 'Nachname', placeholder: 'Mustermann' },
];

/** Persoenliche Daten fuer den Report-Kopf (aus MoreScreen ausgelagert, AUF-043). */
export function ProfileSection({
  profile,
  save,
}: {
  profile: Profile;
  save: (p: Profile) => Promise<void>;
}) {
  const [form, setForm] = useState<Profile | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Lokaler Formularzustand, initialisiert aus dem geladenen Profil.
  const current = form ?? profile;
  const setField = (key: keyof Profile, value: string) =>
    setForm({ ...(form ?? profile), [key]: value });

  const handleSaveProfile = async () => {
    await save(current);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  };

  return (
    <section className="card-section">
      <h2>Persoenliche Daten</h2>
      <p className="muted small">
        Wird im Report-Kopf ausgegeben, damit die Zeiterfassung der Person
        zugeordnet werden kann.
      </p>
      {FIELDS.map((f) => (
        <label key={f.key} className="field">
          <span>{f.label}</span>
          <input
            type="text"
            placeholder={f.placeholder}
            value={current[f.key]}
            onChange={(e) => setField(f.key, e.target.value)}
          />
        </label>
      ))}
      <button className="btn btn-primary" onClick={() => void handleSaveProfile()}>
        {savedFlash ? '✓ Gespeichert' : 'Profil speichern'}
      </button>
    </section>
  );
}
