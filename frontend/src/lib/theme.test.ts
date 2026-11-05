import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, readThemeChoice, resolvedTheme, setThemeChoice, THEME_STORAGE_KEY } from './theme';

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.dataset.theme = '';
  setThemeChoice('system');
});

describe('theme choice', () => {
  it('follows the system preference only when the choice is system', () => {
    expect(resolvedTheme('system', true)).toBe('dark');
    expect(resolvedTheme('system', false)).toBe('light');
    expect(resolvedTheme('light', true)).toBe('light');
    expect(resolvedTheme('dark', false)).toBe('dark');
  });

  it('stores the choice and sets the document theme', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(readThemeChoice()).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });
});
