import { describe, it, expect, beforeAll } from 'vitest';
import * as React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Clicking into a formula box to read it, and clicking away, must not change the row.
 *
 * It used to. The formula cell's blur handler read the draft as "" when nothing had been typed,
 * saw that "" differs from the formula on the row, and saved an empty formula: the working was
 * erased and the old figure kept. The amount cell did the same thing in a different way: focusing
 * it fills in the computed figure, and leaving it compared that to the formula text, so a bare
 * click-through replaced the formula with its own result. On the live sheets one boy's electric
 * row lost its formula this way.
 *
 * The component file is JSX, so React is provided as a global before it is imported, as in
 * tests/verify/publicCardRender.test.ts. The decisions are pure functions and need no DOM.
 */
let formulaCommit: (typed: string | undefined, raw: string) => string | null;
let amountCommit: (typed: string | undefined, seed: string | undefined) => string | null;

beforeAll(async () => {
  (globalThis as any).React = React;
  const mod = await import('../../src/components/petro-tins/ExpenseGrid');
  formulaCommit = mod.formulaCommit as any;
  amountCommit = mod.amountCommit as any;
});

describe('formula cell: leaving it without typing is not an edit', () => {
  it('saves nothing when the cell was only clicked into', () => {
    expect(formulaCommit(undefined, '=[electric]/2')).toBeNull();
  });

  it('saves nothing when what was typed matches what is there', () => {
    expect(formulaCommit('=[electric]/2', '=[electric]/2')).toBeNull();
    expect(formulaCommit('  =[electric]/2  ', '=[electric]/2')).toBeNull();
  });

  it('still saves a changed formula', () => {
    expect(formulaCommit('=[electric]/3', '=[electric]/2')).toBe('=[electric]/3');
  });

  it('still saves a formula that was deliberately emptied', () => {
    // Selecting the text and deleting it leaves a typed draft of "", not undefined.
    expect(formulaCommit('', '=[electric]/2')).toBe('');
  });

  it('still lets a formula be added to a row that holds a plain number', () => {
    expect(formulaCommit('=[rent]/4', '350')).toBe('=[rent]/4');
  });

  it('saves nothing for a plain-number row that was only clicked into', () => {
    expect(formulaCommit(undefined, '350')).toBeNull();
  });
});

describe('amount cell: leaving it as focusing left it is not an edit', () => {
  it('saves nothing when a formula row\'s figure was not touched', () => {
    // Focusing fills in the computed figure; leaving it alone must not flatten the formula.
    expect(amountCommit('214.995', '214.995')).toBeNull();
  });

  it('saves nothing for a plain row that was not touched', () => {
    expect(amountCommit('20', '20')).toBeNull();
  });

  it('saves a number typed over a formula row, which replaces the working', () => {
    expect(amountCommit('250', '214.995')).toBe('250');
  });

  it('saves nothing for an emptied cell', () => {
    expect(amountCommit('', '214.995')).toBeNull();
  });

  it('saves nothing when the draft never arrived', () => {
    expect(amountCommit(undefined, undefined)).toBeNull();
  });
});

describe('the cells go through those decisions', () => {
  const src = readFileSync(
    path.resolve(__dirname, '../../src/components/petro-tins/ExpenseGrid.tsx'),
    'utf8',
  );

  it('routes both blur handlers through the helpers', () => {
    expect(src).toContain('formulaCommit(draft[fKey], row.raw)');
    expect(src).toContain('amountCommit(draft[aKey], seeds.current[aKey])');
  });

  it('no longer saves an empty draft when the formula cell is left', () => {
    expect(src).not.toContain("const v = (draft[fKey] ?? '').trim();");
  });
});
