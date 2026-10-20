import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Pins on the register's source. The component needs a browser to run, and the unit suite runs
 * in node, so these hold the rules in place the way tests/petroTins/gridClickThrough.test.ts does.
 *
 * Why: a save the server refused used to close the edit box and reload the old figure, with no
 * message, so "it returns to 800" was all anyone could see. And a half-width card of about 414px
 * pushed the Income column off the right edge, hiding a deposit's digits while the total stayed
 * visible.
 */
const root = path.resolve(__dirname, '../..');
const tsx = readFileSync(path.join(root, 'src/components/petro-tins/BudgetTin.tsx'), 'utf8');
const gridCss = readFileSync(path.join(root, 'src/components/petro-tins/PetroTinsGrid.css'), 'utf8');

const between = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  expect(a, `missing "${from}"`).toBeGreaterThan(-1);
  expect(b, `missing "${to}"`).toBeGreaterThan(a);
  return src.slice(a, b);
};

describe('BudgetTin saves', () => {
  it('sends no request of its own: every write goes through writeToApi, which reports a refusal', () => {
    expect(tsx).not.toMatch(/\bfetch\(/);
    expect(tsx).toContain("from './saveResult'");
  });

  it('an edit the server refuses leaves the box open with what was typed', () => {
    const body = between(tsx, 'const saveEditEntry', '}, [write, editingEntry');
    expect(body).toContain('if (!saved) return;');
    expect(body.indexOf('if (!saved) return;')).toBeLessThan(body.indexOf('setEditingEntry(null)'));
  });

  it('a new line the server refuses stays in its row instead of clearing', () => {
    const body = between(tsx, 'const trySave', '}, [write, rows');
    expect(body).toContain('if (!saved) return;');
    expect(body.indexOf('if (!saved) return;')).toBeLessThan(body.indexOf('setRows('));
  });

  it('a line is sent once even when Enter and leaving the field both ask for the save', () => {
    const body = between(tsx, 'const trySave', '}, [write, rows');
    const guard = body.indexOf('if (savingRows.current[i]) return;');
    expect(guard).toBeGreaterThan(-1);
    // checked before anything is sent, set before the request, cleared when the answer is in
    expect(guard).toBeLessThan(body.indexOf('write('));
    expect(body.indexOf('savingRows.current[i] = true;')).toBeLessThan(body.indexOf('write('));
    expect(body.indexOf('savingRows.current[i] = false;')).toBeGreaterThan(body.indexOf('write('));
    expect(body.indexOf('savingRows.current[i] = false;')).toBeLessThan(body.indexOf('if (!saved) return;'));
  });

  it('an edit is sent once even when Enter and leaving the box both ask', () => {
    const body = between(tsx, 'const saveEditEntry', '}, [write, editingEntry');
    expect(body).toContain('if (!editingEntry || savingEdit.current) return;');
    expect(body.indexOf('savingEdit.current = true;')).toBeLessThan(body.indexOf('write('));
    expect(body.indexOf('savingEdit.current = false;')).toBeLessThan(body.indexOf('if (!saved) return;'));
  });

  it('an amount that is not a number is reported, not ignored', () => {
    const body = between(tsx, 'const saveEditEntry', '}, [write, editingEntry');
    expect(body).toMatch(/isNaN\(amount\) \|\| amount < 0\) \{\s*setError\(/);
  });

  it('Enter on any field of a new line reports an unfinished line; leaving a field does not', () => {
    expect((tsx.match(/trySave\(i, true\)/g) ?? []).length).toBe(4);
    expect(tsx).toMatch(/onBlur=\{\(\) => setTimeout\(\(\) => trySave\(i\), 120\)\}/);
  });

  it('shows the message as an alert above the register', () => {
    expect(tsx).toContain('role="alert"');
    expect(tsx.indexOf('role="alert"')).toBeLessThan(tsx.indexOf('className="pt-budget-tin__register"'));
  });
});

describe('PetroTinsGrid layout', () => {
  it('gives the register at least the width its table needs, or stacks the summary under it', () => {
    expect(gridCss).toContain('minmax(min(100%, 36.5rem), 1fr)');
    // The fixed 900px breakpoint made a card of about 414px, narrower than the table.
    expect(gridCss).not.toMatch(/@media \(min-width: 900px\)\s*\{\s*\.pt-grid__top/);
  });
});
