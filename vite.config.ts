import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

// base: './' ist zwingend, damit Capacitor die Assets ueber file:// laedt.
export default defineConfig({
  plugins: [react()],
  base: './',
  // Versionsanzeige kommt aus package.json, damit sie beim Bump nicht
  // haendisch nachgezogen werden muss (stand in 1.4 faelschlich auf "1.3").
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    // Arbeitsorte der Auftragskette ausschliessen. GEMESSEN am 2026-09-22: mit einem
    // stehenden Worktree unter .wt/ meldete 'npm test' im Hauptbaum 3 Testdateien und
    // 101 Tests statt 1 und 50 -- die Kopie des Baums wurde mitgezaehlt UND die
    // Probedatei des Ausfuehrenden gleich mit. Ein Testlauf, der die Arbeit eines
    // anderen Baums mitzaehlt, misst nicht diesen Baum.
    // auftraege/** ist der zweite Ausschluss und hat denselben Grund: dort liegen die
    // Proben der Ausfuehrenden, und eine Negativkontrolle ist dort ABSICHTLICH rot.
    // GEMESSEN am 2026-09-22: eine Probedatei aus AUF-003 stand nach einem Abnahmelauf
    // ohne --basis im Hauptbaum und faerbte 'npm test' rot, obwohl alle 58 echten Tests
    // gruen waren. Ein roter Lauf aus fremder Ursache verdeckt echte Fehler.
    exclude: [...configDefaults.exclude, '.wt/**', 'auftraege/**'],
  },
});
