import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { useTracker } from '../tracking/useTracker';
import { countEntries } from '../db/entries';
import { restoreBackup } from '../db/backup';
import { readAutoBackup, writeAutoBackup } from '../db/auto-backup';
import { BottomNav, type Tab } from './components/BottomNav';
import { HomeScreen } from './screens/HomeScreen';
import { EntriesScreen } from './screens/EntriesScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import { MoreScreen } from './screens/MoreScreen';

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const tracker = useTracker();
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const restoreChecked = useRef(false);

  // Auto-Backup: beim Verlassen der App den aktuellen Stand in den oeffentlichen
  // Documents-Ordner sichern (ueberlebt eine Deinstallation).
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = CapApp.addListener('appStateChange', (state) => {
      if (!state.isActive) void writeAutoBackup();
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, []);

  // Beim Start mit LEERER Datenbank pruefen, ob ein Auto-Backup vorliegt
  // (z.B. nach Neuinstallation) und dessen Wiederherstellung anbieten.
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || restoreChecked.current) return;
    restoreChecked.current = true;
    void (async () => {
      if ((await countEntries()) > 0) return;
      const data = await readAutoBackup();
      if (!data || data.entries.length === 0) return;
      const stand = new Date(data.exportedAt).toLocaleDateString('de-DE');
      const ok = window.confirm(
        `Auf dem Geraet wurde eine Sicherung gefunden:\n${data.entries.length} Eintraege (Stand ${stand}).\n\nJetzt wiederherstellen?`,
      );
      if (!ok) return;
      await restoreBackup(JSON.stringify(data), 'replace');
      window.location.reload();
    })();
  }, []);

  // Android-Hardware-Zurueck: erst auf Home, dann App verlassen.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    // App ist gerendert -> Splash ausblenden.
    void SplashScreen.hide();
    const handle = CapApp.addListener('backButton', () => {
      if (tabRef.current !== 'home') {
        setTab('home');
      } else {
        void CapApp.exitApp();
      }
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, []);

  return (
    <div className="app">
      <main className="app-main">
        {tab === 'home' && <HomeScreen tracker={tracker} />}
        {tab === 'entries' && <EntriesScreen />}
        {tab === 'reports' && <ReportsScreen />}
        {tab === 'more' && <MoreScreen />}
      </main>
      <BottomNav active={tab} onChange={setTab} />
    </div>
  );
}
