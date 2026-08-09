import { Preferences } from '@capacitor/preferences';
import { useCallback, useEffect, useState } from 'react';
import type { Profile } from '../domain/types';

const KEY = 'profile';

export const emptyProfile: Profile = {
  vorname: '',
  nachname: '',
  personalnummer: '',
  arbeitgeber: '',
  abteilung: '',
};

export async function getProfile(): Promise<Profile> {
  const { value } = await Preferences.get({ key: KEY });
  if (!value) return emptyProfile;
  try {
    return { ...emptyProfile, ...(JSON.parse(value) as Partial<Profile>) };
  } catch {
    return emptyProfile;
  }
}

export async function saveProfile(profile: Profile): Promise<void> {
  await Preferences.set({ key: KEY, value: JSON.stringify(profile) });
}

/** Vollstaendiger Anzeigename ("Vorname Nachname"), Fallback falls leer. */
export function displayName(p: Profile): string {
  const name = `${p.vorname} ${p.nachname}`.trim();
  return name || '(kein Name hinterlegt)';
}

export function useProfile(): {
  profile: Profile;
  loading: boolean;
  save: (p: Profile) => Promise<void>;
} {
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getProfile().then((p) => {
      if (active) {
        setProfile(p);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const save = useCallback(async (p: Profile) => {
    await saveProfile(p);
    setProfile(p);
  }, []);

  return { profile, loading, save };
}
