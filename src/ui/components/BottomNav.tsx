import type { ReactNode } from 'react';
import { IconChart, IconClock, IconList, IconUser } from './Icons';

export type Tab = 'home' | 'entries' | 'reports' | 'more';

const TABS: { key: Tab; label: string; icon: ReactNode }[] = [
  { key: 'home', label: 'Erfassung', icon: <IconClock /> },
  { key: 'entries', label: 'Eintraege', icon: <IconList /> },
  { key: 'reports', label: 'Reports', icon: <IconChart /> },
  { key: 'more', label: 'Mehr', icon: <IconUser /> },
];

interface Props {
  active: Tab;
  onChange: (tab: Tab) => void;
}

export function BottomNav({ active, onChange }: Props) {
  return (
    <nav className="bottom-nav">
      {TABS.map((t) => (
        <button
          key={t.key}
          className={`nav-item${active === t.key ? ' active' : ''}`}
          onClick={() => onChange(t.key)}
          aria-current={active === t.key ? 'page' : undefined}
        >
          <span className="nav-icon">{t.icon}</span>
          <span className="nav-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
