import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRAWER_QUERY } from './breakpoints';

describe('drawer breakpoint', () => {
  it('uses one width for the drawer, phone cards, and stacked calendar', () => {
    const css = readFileSync(path.resolve('src/styles/global.css'), 'utf8');
    expect(css).toContain(`@media ${DRAWER_QUERY}`);
    expect(css).toMatch(/\.btn \{[^}]*white-space:\s*nowrap/);
    const calendarRule = css.indexOf('.calendar-week,');
    const mediaBeforeCalendar = css.lastIndexOf('@media', calendarRule);
    expect(css.slice(mediaBeforeCalendar, calendarRule)).toContain(DRAWER_QUERY);
    expect(css).not.toMatch(/@media \(max-width: 640px\)[\s\S]{0,120}\.table-cards/);
  });
});