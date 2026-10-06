import { describe, it, expect, beforeAll } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SplitsTin } from '../../src/components/petro-tins/types';

/**
 * The shared-expenses tile (the "housingCost" sheet) has to offer two controls that can be
 * found without hunting: a "＋ Add person" button, and a labeled Delete on each person's
 * sheet. Both went missing before. The Sep 4 redesign swapped the button for a spare grid
 * that you name to create a person, and the only delete left was a small muted ✕.
 *
 * Renders the real component to markup. The unit config compiles JSX with the classic
 * runtime (React.createElement), so React is provided as a global before the component is
 * imported, as in tests/verify/publicCardRender.test.ts. No DOM or network needed.
 */
let SharedSheet: (p: any) => React.ReactElement;

beforeAll(async () => {
  (globalThis as any).React = React;
  SharedSheet = (await import('../../src/components/petro-tins/SharedSheet')).default as any;
});

const tin = (names: string[]): SplitsTin => ({
  id: 's1',
  tenantId: 't1',
  name: 'housingCost',
  interestRate: 0,
  budgetTinId: null,
  people: names.map((name, i) => ({ id: `p${i}`, splitsId: 's1', name, isOwner: false, sortOrder: i })),
  bills: [],
  payments: [],
  carriedBalances: {},
});

const render = (names: string[]) =>
  renderToStaticMarkup(
    React.createElement(SharedSheet, { tin: tin(names), budgetEntries: [], onRefresh() {}, onDelete() {} }),
  );

describe('housingCost sheet: Add person', () => {
  it('has one "＋ Add person" button, under the grids', () => {
    const html = render(['Caleb', 'Lucas']);
    expect(html.match(/class="sh__addbtn"/g)).toHaveLength(1);
    expect(html).toContain('＋ Add person</button>');
    expect(html.indexOf('sh__addbtn')).toBeGreaterThan(html.lastIndexOf('</table>'));
  });

  it('keeps the spare "New person" field the button takes you to', () => {
    // The button focuses input.xg__name--start; if that field changes, the button goes dead.
    const html = render(['Caleb']);
    expect(html).toContain('placeholder="New person"');
    expect(html).toContain('xg__name--start');
  });

  it('is there even before anyone has been added', () => {
    expect(render([])).toContain('＋ Add person</button>');
  });
});

describe('housingCost sheet: the spare field looks like a field', () => {
  // ".xg input" sets "border: none" and a plain text color. A bare ".xg__name--start" rule
  // has lower specificity and silently loses to it, which left the spare on the live page
  // as a gray caption with no box. The highlight rules must carry the element to outrank it.
  const css = readFileSync(
    path.resolve(__dirname, '../../src/components/petro-tins/ExpenseGrid.css'),
    'utf8',
  );

  it('styles the spare with selectors that outrank ".xg input"', () => {
    expect(css).toMatch(/^\.xg input\.xg__name--start \{/m);
    expect(css).toMatch(/^\.xg input\.xg__name--start::placeholder \{/m);
  });

  it('has no bare .xg__name--start rule left to lose that fight', () => {
    expect(css).not.toMatch(/^\.xg__name--start(::placeholder)? \{/m);
  });
});

describe('housingCost sheet: Delete', () => {
  it('puts a labeled Delete on each person\'s sheet', () => {
    const html = render(['Caleb', 'Lucas']);
    const deletes = html.match(/<button type="button" class="xg__del"[^>]*>Delete<\/button>/g) ?? [];
    expect(deletes).toHaveLength(2);
  });

  it('puts none on the spare, which is not a person yet', () => {
    expect(render([])).not.toContain('xg__del');
  });

  it('no longer relies on the small muted ✕ for deleting a person', () => {
    expect(render(['Caleb'])).not.toContain('title="Remove"');
  });
});
