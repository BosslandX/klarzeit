import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' ist zwingend, damit Capacitor die Assets ueber file:// laedt.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
