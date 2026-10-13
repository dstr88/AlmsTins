import { describe, it, expect, beforeAll } from 'vitest';
import * as React from 'react';

/**
 * "[Electric]" in a shared-sheet formula means the budget register's Electric bill. The
 * register keeps every month and the entries arrive oldest first, so a plain name match
 * found June's bill: both boys were charged half of June's figure while the bill being split
 * was October's, and the two halves did not add up to it. These pin which entry a bracketed
 * name resolves to.
 *
 * The component file is JSX, so React is provided as a global before it is imported, as in
 * tests/verify/publicCardRender.test.ts. The functions under test need no DOM.
 */
let evalFormula: (input: string, rows?: any[], entries?: any[], month?: string) => number;
let budgetEntryFor: (name: string, entries: any[] | undefined, month?: string) => any;

beforeAll(async () => {
  (globalThis as any).React = React;
  const mod = await import('../../src/components/petro-tins/ExpenseGrid');
  evalFormula = mod.evalFormula as any;
  budgetEntryFor = mod.budgetEntryFor as any;
});

// Entries as /api/petro-tins returns them: every month, oldest first.
const register = [
  { description: 'Electric', amount: 373.17, entryDate: '2026-06-02' },
  { description: 'Electric', amount: 392.94, entryDate: '2026-07-01' },
  { description: 'Electric', amount: 526.59, entryDate: '2026-08-01' },
  { description: 'Electric', amount: 413.31, entryDate: '2026-09-01' },
  { description: 'Electric', amount: 429.99, entryDate: '2026-10-01' },
  { description: 'Rent', amount: 1400, entryDate: '2026-09-01' },
  { description: 'Storage', amount: 80, entryDate: '2026-12-01' },
];

describe('[Name] resolves to this month\'s budget entry', () => {
  it('splits October\'s Electric bill, not June\'s', () => {
    const half = evalFormula('=[electric]/2', [], register, '2026-10');
    expect(half).toBeCloseTo(429.99 / 2, 6);
    expect(half).not.toBeCloseTo(373.17 / 2, 2);
  });

  it('gives two halves that add back up to the bill', () => {
    const a = evalFormula('=[electric]/2', [], register, '2026-10');
    const b = evalFormula('=[Electric]/2', [], register, '2026-10');
    expect(a + b).toBeCloseTo(429.99, 6);
  });

  it('follows the month: the same formula in September reads September', () => {
    expect(evalFormula('=[electric]/2', [], register, '2026-09')).toBeCloseTo(413.31 / 2, 6);
  });

  it('uses the most recent earlier month when this month has no entry yet', () => {
    // Rent was last entered in September.
    expect(evalFormula('=[rent]/4', [], register, '2026-10')).toBe(350);
  });

  it('only reaches into a later month when nothing earlier exists', () => {
    expect(budgetEntryFor('storage', register, '2026-10')?.amount).toBe(80); // only a December entry
    expect(budgetEntryFor('electric', register, '2026-05')?.entryDate).toBe('2026-06-02'); // nearest later
  });

  it('keeps the first match when entries carry no dates', () => {
    const undated = [{ description: 'Electric', amount: 1 }, { description: 'Electric', amount: 2 }];
    expect(budgetEntryFor('electric', undated)?.amount).toBe(1);
  });

  it('still lets a row on the same grid win over the register', () => {
    expect(evalFormula('=[electric]/2', [{ name: 'Electric', amount: 100 }], register, '2026-10')).toBe(50);
  });

  it('leaves a name that is nowhere unresolved', () => {
    expect(evalFormula('=[water]/2', [], register, '2026-10')).toBeNaN();
    expect(budgetEntryFor('water', register, '2026-10')).toBeUndefined();
  });
});
