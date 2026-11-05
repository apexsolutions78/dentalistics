import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function contrast(foreground: string, background: string): number {
  const lum = (hex: string): number => {
    const n = Number.parseInt(hex.slice(1), 16);
    const r = channel((n >> 16) & 255);
    const g = channel((n >> 8) & 255);
    const b = channel(n & 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const lighter = Math.max(lum(foreground), lum(background));
  const darker = Math.min(lum(foreground), lum(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`missing ${selector}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        const body = css.slice(open + 1, i);
        const vars: Record<string, string> = {};
        for (const line of body.split('\n')) {
          const match = line.match(/^\s*(--[a-z0-9-]+|background|color-scheme|color):\s*([^;]+);/);
          const name = match?.[1];
          const value = match?.[2];
          if (name !== undefined && value !== undefined) vars[name] = value.trim();
        }
        return vars;
      }
    }
  }
  throw new Error(`unclosed ${selector}`);
}

const tokens = readFileSync(path.resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const globalCss = readFileSync(path.resolve(process.cwd(), 'src/styles/global.css'), 'utf8');
const light = block(tokens, ':root');
const dark = { ...light, ...block(tokens, "html[data-theme='dark']") };

const textPairs = [
  ['--color-text', '--color-bg'],
  ['--color-text', '--color-surface'],
  ['--color-text-secondary', '--color-bg'],
  ['--color-text-secondary', '--color-surface'],
  ['--color-on-primary', '--color-primary'],
  ['--color-accent-contrast', '--color-accent'],
  ['--color-danger-text', '--color-surface'],
  ['--color-on-danger', '--color-danger'],
  ['--color-success', '--color-surface'],
  ['--color-warning', '--color-surface'],
  ['--color-sidebar-text', '--color-sidebar-bg'],
  ['--color-sidebar-text-dim', '--color-sidebar-bg'],
  ['--color-sidebar-active-text', '--color-sidebar-active-bg'],
  ['--badge-new-text', '--badge-new-bg'],
  ['--badge-active-text', '--badge-active-bg'],
  ['--badge-muted-text', '--badge-muted-bg'],
  ['--badge-warn-text', '--badge-warn-bg'],
  ['--badge-danger-text', '--badge-danger-bg'],
] as const;

function expectPairs(theme: Record<string, string>, minimum: number): void {
  for (const [foreground, background] of textPairs) {
    const ratio = contrast(theme[foreground] ?? '', theme[background] ?? '');
    expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(minimum);
  }
}

describe('theme contrast', () => {
  it('meets WCAG AA for text in light and dark', () => {
    expectPairs(light, 4.5);
    expectPairs(dark, 4.5);
  });

  it('keeps dark controls visible against the surface', () => {
    expect(contrast(dark['--color-border-control'] ?? '', dark['--color-surface'] ?? '')).toBeGreaterThanOrEqual(3);
    expect(contrast(dark['--color-focus'] ?? '', dark['--color-surface'] ?? '')).toBeGreaterThanOrEqual(3);
  });

  it('pins the public landing page to the light palette', () => {
    const marketing = block(globalCss, '.marketing-page');
    expect(marketing['background']).toBe('#f7f4ef');
    expect(marketing['color']).toBe('#2c0438');
    expect(marketing['--color-text']).toBe('#2c0438');
    expect(marketing['--color-surface']).toBe('#ffffff');
    expect(marketing['color-scheme']).toBe('light');
  });
});
