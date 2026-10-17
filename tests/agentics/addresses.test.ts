import { describe, it, expect } from 'vitest';
import {
  VAULT_CHAINS,
  MAX_LABEL_LENGTH,
  MAX_LINE_LENGTH,
  dedupeEntries,
  normalizeAddress,
  parseChain,
  parseDestinationText,
} from '../../src/lib/agentVault/addresses';
import { addr, upper } from '../helpers/agentVault';

/**
 * Per-chain address normalization and the pasted-list parser. Pure, so no mocks. Every address is
 * an invented filler (see tests/helpers/agentVault.ts).
 */

describe('parseChain', () => {
  it('knows the three EVM chains by name, in any case', () => {
    expect([...VAULT_CHAINS]).toEqual(['ethereum', 'polygon', 'avalanche']);
    for (const c of VAULT_CHAINS) expect(parseChain(c)).toBe(c);
    expect(parseChain(' Ethereum ')).toBe('ethereum');
    expect(parseChain('POLYGON')).toBe('polygon');
  });

  it('knows each chain by its ticker', () => {
    expect(parseChain('eth')).toBe('ethereum');
    expect(parseChain('MATIC')).toBe('polygon');
    expect(parseChain('pol')).toBe('polygon');
    expect(parseChain('avax')).toBe('avalanche');
  });

  it('says null for a chain the Vault does not track, and for anything that is not a name', () => {
    for (const bad of ['bitcoin', 'solana', 'litecoin', 'base', '', ' ', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(parseChain(bad), bad).toBeNull();
    }
    for (const bad of [null, undefined, 1, {}, [], ['ethereum']]) expect(parseChain(bad)).toBeNull();
  });
});

describe('normalizeAddress', () => {
  it('lowercases an EVM address, whatever the chain', () => {
    const a = addr(1);
    for (const chain of VAULT_CHAINS) {
      expect(normalizeAddress(chain, a)).toBe(a);
      expect(normalizeAddress(chain, upper(a))).toBe(a);
    }
    expect(normalizeAddress('ethereum', '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01')).toBe('0xabcdef0123456789abcdef0123456789abcdef01');
  });

  it('reads two spellings of one wallet as one address', () => {
    const a = addr(2);
    expect(normalizeAddress('polygon', upper(a))).toBe(normalizeAddress('polygon', a));
  });

  it('ignores surrounding whitespace and accepts a capital X in the prefix', () => {
    const a = addr(3);
    expect(normalizeAddress('ethereum', `  ${a}\n`)).toBe(a);
    expect(normalizeAddress('ethereum', `0X${a.slice(2)}`)).toBe(a);
  });

  it('is idempotent', () => {
    const once = normalizeAddress('avalanche', upper(addr(4)))!;
    expect(normalizeAddress('avalanche', once)).toBe(once);
  });

  it('does not repair anything: a wrong length, a stray character or a missing prefix is null', () => {
    const a = addr(5);
    for (const bad of [
      a.slice(0, -1), `${a}0`, a.slice(2), `0x${a.slice(2, -1)}g`, `0x ${a.slice(2)}`, `${a} ${a}`,
      '', '   ', '0x', `0x${'0'.repeat(64)}`, `0x${'0'.repeat(39)}`,
    ]) {
      expect(normalizeAddress('ethereum', bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('is null for a chain the Vault does not track, and for input that is not text', () => {
    expect(normalizeAddress('bitcoin', addr(6))).toBeNull();
    expect(normalizeAddress('', addr(6))).toBeNull();
    expect(normalizeAddress(undefined, addr(6))).toBeNull();
    expect(normalizeAddress('ethereum', undefined)).toBeNull();
    expect(normalizeAddress('ethereum', 12345)).toBeNull();
    expect(normalizeAddress('ethereum', [addr(6)])).toBeNull();
  });

  it('takes a ticker for the chain', () => {
    expect(normalizeAddress('ETH', addr(7))).toBe(addr(7));
  });
});

describe('parseDestinationText', () => {
  it('reads an address alone, and an address with a label either way round', () => {
    const r = parseDestinationText(`${addr(1)}\n${addr(2)}, Exchange deposit\nPayroll hot wallet, ${addr(3)}`, 'ethereum');
    expect(r.rejected).toEqual([]);
    expect(r.entries).toEqual([
      { line: 1, chain: 'ethereum', address: addr(1), label: null },
      { line: 2, chain: 'ethereum', address: addr(2), label: 'Exchange deposit' },
      { line: 3, chain: 'ethereum', address: addr(3), label: 'Payroll hot wallet' },
    ]);
  });

  it('applies the default chain, and a chain name or ticker in any cell overrides it for that line', () => {
    const text = [`polygon, ${addr(1)}, Payroll`, `${addr(2)}, avax`, `${addr(3)}, Treasury`].join('\n');
    const r = parseDestinationText(text, 'ethereum');
    expect(r.entries.map((e) => [e.chain, e.label])).toEqual([
      ['polygon', 'Payroll'],
      ['avalanche', null],
      ['ethereum', 'Treasury'],
    ]);
    expect(parseDestinationText(addr(4), 'avalanche').entries[0].chain).toBe('avalanche');
  });

  it('splits on commas, tabs, semicolons and pipes, and keeps a double-quoted cell whole', () => {
    const text = [`${addr(1)}\tTabbed`, `${addr(2)};Semi`, `${addr(3)}|Piped`, `${addr(4)},"Kraken, hot wallet"`, `"${addr(5)}","He said ""hi"""`].join('\n');
    const r = parseDestinationText(text, 'ethereum');
    expect(r.rejected).toEqual([]);
    expect(r.entries.map((e) => e.label)).toEqual(['Tabbed', 'Semi', 'Piped', 'Kraken, hot wallet', 'He said "hi"']);
  });

  it('finds an address in free text and keeps the rest as the label', () => {
    const r = parseDestinationText(`Deposit address: ${addr(1)} (main)`, 'ethereum');
    expect(r.entries).toEqual([{ line: 1, chain: 'ethereum', address: addr(1), label: 'Deposit address: (main)' }]);
  });

  it('normalizes what it reads: capitals become lowercase', () => {
    expect(parseDestinationText(upper(addr(1)), 'ethereum').entries[0].address).toBe(addr(1));
  });

  it('skips blank lines, # and // comments, and a header row, and counts lines from 1', () => {
    const text = ['address,label', '', '# the treasury list', '// ours', addr(1), '   ', addr(2)].join('\n');
    const r = parseDestinationText(text, 'ethereum');
    expect(r.rejected).toEqual([]);
    expect(r.entries.map((e) => e.line)).toEqual([5, 7]);
  });

  it('only skips a header when it is the first line of content', () => {
    const r = parseDestinationText(`${addr(1)}\naddress,label`, 'ethereum');
    expect(r.entries).toHaveLength(1);
    expect(r.rejected).toEqual([{ line: 2, reason: 'no_address', text: 'address,label' }]);
  });

  it('handles Windows and old Mac line endings', () => {
    const r = parseDestinationText(`${addr(1)}\r\n${addr(2)}\r${addr(3)}`, 'ethereum');
    expect(r.entries.map((e) => e.line)).toEqual([1, 2, 3]);
  });

  it('reports every line it cannot use, with a reason, and never drops one silently', () => {
    const a = addr(1);
    const text = [
      a,                                  // 1 ok
      'just some words',                  // 2 no address
      a.slice(0, -2),                     // 3 an address with a typo
      `${addr(2)} ${addr(3)}`,            // 4 two addresses on a line
      `0x${'ab'.repeat(32)}`,             // 5 a 32-byte value, not an address
      `bc1q${'a'.repeat(38)}`,            // 6 an address-shaped word from a chain the Vault does not track
      'x'.repeat(MAX_LINE_LENGTH + 1),    // 7 too long
    ].join('\n');
    const r = parseDestinationText(text, 'ethereum');
    expect(r.entries.map((e) => e.line)).toEqual([1]);
    expect(r.rejected.map((x) => [x.line, x.reason])).toEqual([
      [2, 'no_address'],
      [3, 'bad_address'],
      [4, 'several_addresses'],
      [5, 'bad_address'],
      [6, 'unsupported_chain'],
      [7, 'line_too_long'],
    ]);
    for (const x of r.rejected) expect(x.text.length).toBeLessThanOrEqual(80);
  });

  it('never reads the first 40 digits of a longer hex value as an address', () => {
    expect(parseDestinationText(`0x${'ab'.repeat(32)}`, 'ethereum').entries).toEqual([]);
    expect(parseDestinationText(`${addr(1)}beef`, 'ethereum').entries).toEqual([]);
  });

  it('cleans a label: control characters and extra spaces out, loose separators trimmed, 80 characters at most', () => {
    const long = 'L'.repeat(200);
    const r = parseDestinationText([`${addr(1)}, - Kraken \u0007  deposit :`, `${addr(2)}, ${long}`].join('\n'), 'ethereum');
    expect(r.entries[0].label).toBe('Kraken deposit');
    expect(r.entries[1].label).toHaveLength(MAX_LABEL_LENGTH);
  });

  it('gives a label of only separators as no label', () => {
    expect(parseDestinationText(`${addr(1)}, ---`, 'ethereum').entries[0].label).toBeNull();
  });

  it('accounts for every content line: parsed or rejected, nothing else', () => {
    const lines = [addr(1), 'oops', `${addr(2)}, a`, '', '# c', addr(1).slice(1), `${addr(3)}|b`];
    const r = parseDestinationText(lines.join('\n'), 'polygon');
    const content = lines.filter((l) => l.trim() && !l.startsWith('#')).length;
    expect(r.entries.length + r.rejected.length).toBe(content);
  });

  it('copes with empty and odd input', () => {
    expect(parseDestinationText('', 'ethereum')).toEqual({ entries: [], rejected: [] });
    expect(parseDestinationText('\n\n  \n', 'ethereum')).toEqual({ entries: [], rejected: [] });
    expect(parseDestinationText(undefined as never, 'ethereum')).toEqual({ entries: [], rejected: [] });
  });
});

describe('dedupeEntries', () => {
  const entry = (line: number, chain: 'ethereum' | 'polygon', address: string, label: string | null = null) => ({ line, chain, address, label });

  it('keeps the first line of a repeated address and reports the later ones', () => {
    const { unique, repeated } = dedupeEntries([entry(1, 'ethereum', addr(1), 'First'), entry(2, 'ethereum', addr(1), 'Second'), entry(3, 'ethereum', addr(2))]);
    expect(unique.map((e) => [e.line, e.label])).toEqual([[1, 'First'], [3, null]]);
    expect(repeated).toEqual([{ line: 2, chain: 'ethereum', address: addr(1) }]);
  });

  it('lets a later line supply the label the first one lacked', () => {
    const { unique } = dedupeEntries([entry(1, 'ethereum', addr(1)), entry(2, 'ethereum', addr(1), 'Late label')]);
    expect(unique[0].label).toBe('Late label');
  });

  it('treats the same address on two chains as two destinations', () => {
    const { unique, repeated } = dedupeEntries([entry(1, 'ethereum', addr(1)), entry(2, 'polygon', addr(1))]);
    expect(unique).toHaveLength(2);
    expect(repeated).toEqual([]);
  });

  it('does not change its input', () => {
    const input = [entry(1, 'ethereum', addr(1)), entry(2, 'ethereum', addr(1), 'x')];
    dedupeEntries(input);
    expect(input[0].label).toBeNull();
  });
});
