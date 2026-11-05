import { useSyncExternalStore } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  getThemeChoice,
  setThemeChoice,
  subscribeTheme,
  type ThemeChoice,
} from '../lib/theme';

const OPTIONS: Array<{ value: ThemeChoice; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function ThemePicker() {
  const choice = useSyncExternalStore(subscribeTheme, getThemeChoice, () => 'system' as const);
  const { user, refreshSession } = useAuth();

  const onChange = (next: ThemeChoice): void => {
    const previous = getThemeChoice();
    setThemeChoice(next);
    if (user === null) return;
    apiFetch('/api/profile', { method: 'PATCH', body: { theme: next } })
      .then(() => refreshSession())
      .catch(() => {
        setThemeChoice(previous);
      });
  };

  return (
    <label className="theme-picker-label">
      <span className="sr-only">Theme</span>
      <select
        className="theme-picker"
        aria-label="Theme"
        value={choice}
        onChange={(event) => {
          const next = event.target.value;
          if (next === 'light' || next === 'dark' || next === 'system') onChange(next);
        }}
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
