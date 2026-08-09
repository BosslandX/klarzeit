import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import './ui/styles.css';

// Dauerhafte Speicherung anfordern (best-effort), damit die IndexedDB nicht
// unter Speicherdruck automatisch geraeumt wird.
void navigator.storage?.persist?.().catch(() => {});

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root-Element #root nicht gefunden');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
