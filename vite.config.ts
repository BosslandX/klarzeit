import { defineConfig } from 'vite';
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
});
