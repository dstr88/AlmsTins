/**
 * tests/tax/cryptoComSource.test.ts
 *
 * Crypto.com rows must be stored with source 'crypto_com'. pass1 keys the
 * Crypto.com kind map and the card-rebate intercept on that exact value
 * (61e4521). A row stored as 'crypto-com' falls through to keyword guesses:
 * 'crypto_earn_program_withdrawn' reads as income ("earn") and
 * 'crypto_to_exchange_transfer' as a swap ("exchange"). It also gets a second
 * exchange account, because the account lookup matches on source.
 *
 * Both AI screenshot parsers used to write the hyphen. These tests drive the
 * real route handlers with the db, the session and the Anthropic SDK stubbed,
 * so they need no database, no network and no secrets.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────
const { mockExecute, mockCreate } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockCreate:  vi.fn(),
}));

vi.mock('../../src/lib/db', () => ({
  db: { execute: mockExecute, batch: vi.fn() },
}));

vi.mock('../../src/lib/requireTenantSession', () => ({
  requireTenantSession: vi.fn(async () => ({ tenantId: 'tenant-a' })),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

import { POST as parseScreenshot } from '../../src/pages/api/transactions/screenshots/parse';
import { POST as importScreenshot } from '../../src/pages/api/portfolio/import-screenshot';
import { GET as listBatches, DELETE as deleteBatch } from '../../src/pages/api/import/batches';
import { canonicalImportSource, importSourceDisplayName } from '../../src/lib/importSource';
import { classifyImportTxPass1 } from '../../src/lib/yearEnd/pass1';
import type { RawImportTx } from '../../src/lib/yearEnd/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

type Call = { sql: string; args: unknown[] };

function dbCalls(): Call[] {
  return mockExecute.mock.calls.map(([q]) => ({ sql: String(q.sql), args: q.args ?? [] }));
}

function dbCall(fragment: string): Call {
  const call = dbCalls().find((c) => c.sql.includes(fragment));
  if (!call) throw new Error(`no db call containing "${fragment}"`);
  return call;
}

/** Existing exchange_accounts rows, by stored source, that the account lookup can find. */
let existingAccounts: Record<string, Array<{ id: string }>> = {};

beforeEach(() => {
  existingAccounts = {};
  mockExecute.mockReset();
  mockCreate.mockReset();
  mockExecute.mockImplementation(async ({ sql, args }: { sql: string; args: unknown[] }) => {
    if (sql.includes('FROM transaction_screenshots')) {
      return { rows: [{ id: 'shot-1', mime_type: 'image/png', data: 'iVBORw0KGgo=' }], rowsAffected: 0 };
    }
    // Lookup args: [tenant_id, source].
    if (sql.includes('FROM exchange_accounts')) return { rows: existingAccounts[String(args[1])] ?? [], rowsAffected: 0 };
    return { rows: [], rowsAffected: 1 };
  });
});

/** What the vision model answers. It is asked for "crypto_com" but may still say "crypto-com". */
function modelAnswers(fields: Record<string, unknown>) {
  mockCreate.mockResolvedValue({
    content: [{
      type: 'text',
      text: JSON.stringify({
        source:       'crypto-com',
        timestampUtc: '2024-03-15T10:00:00Z',
        description:  'Crypto Earn withdrawal',
        currency:     'USDC',
        amount:       100,
        direction:    'in',
        kind:         'crypto_earn_program_withdrawn',
        nativeUsd:    100,
        feeUsd:       null,
        txHash:       null,
        ...fields,
      }),
    }],
  });
}

// Both screenshot writers, driven through their real handlers.
const WRITERS = [
  {
    name: 'transactions/screenshots/parse',
    run: () => parseScreenshot({
      request: new Request('http://localhost/api/transactions/screenshots/parse', {
        method: 'POST',
        body: JSON.stringify({ screenshotId: 'shot-1' }),
      }),
    } as never),
  },
  {
    name: 'portfolio/import-screenshot',
    run: () => {
      const form = new FormData();
      form.append('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'shot.png', { type: 'image/png' }));
      return importScreenshot({
        request: new Request('http://localhost/api/portfolio/import-screenshot', { method: 'POST', body: form }),
      } as never);
    },
  },
];

/** The import_transactions row a writer inserted, in the shape pass1 reads. */
function insertedImportRow(): RawImportTx {
  // Column order of both INSERTs: id, tenant_id, source, account_id, import_batch_id,
  // timestamp_utc, description, currency, amount, native_usd, kind, tx_hash, direction,
  // asset_symbol, row_hash, fee_usd.
  const a = dbCall('INSERT INTO import_transactions').args;
  return {
    id:            String(a[0]),
    source:        String(a[2]),
    timestamp_utc: String(a[5]),
    description:   a[6] as string | null,
    amount:        a[8] as number | null,
    native_usd:    a[9] as number | null,
    kind:          a[10] as string | null,
    tx_hash:       a[11] as string | null,
    direction:     a[12] as string | null,
    asset_symbol:  a[13] as string | null,
    to_amount:     null,
    notes:         null,
    category:      null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. CANONICAL SOURCE VALUES
// ─────────────────────────────────────────────────────────────────────────────

describe('canonicalImportSource', () => {
  it('maps every spelling of Crypto.com to the stored value', () => {
    for (const raw of ['crypto-com', 'Crypto.com', 'CRYPTO_COM', ' crypto com ', 'cryptocom', 'crypto_com']) {
      expect(canonicalImportSource(raw), raw).toBe('crypto_com');
    }
  });

  it('maps other known exchanges to their stored values', () => {
    expect(canonicalImportSource('Coinbase')).toBe('coinbase');
    expect(canonicalImportSource('Cash App')).toBe('cashapp');
  });

  it('passes unknown names through, lowercased and trimmed, as before', () => {
    expect(canonicalImportSource(' Chase ')).toBe('chase');
    expect(canonicalImportSource('wells-fargo')).toBe('wells-fargo');
  });

  it('falls back to "unknown" for a missing or blank source', () => {
    expect(canonicalImportSource(null)).toBe('unknown');
    expect(canonicalImportSource(42)).toBe('unknown');
    expect(canonicalImportSource('  ')).toBe('unknown');
  });

  it('names accounts for display', () => {
    expect(importSourceDisplayName('crypto_com')).toBe('Crypto.com');
    expect(importSourceDisplayName('chase')).toBe('Chase');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. SCREENSHOT WRITERS STORE 'crypto_com'
// ─────────────────────────────────────────────────────────────────────────────

describe.each(WRITERS)('$name', ({ run }) => {
  it('asks the model for "crypto_com", not "crypto-com"', async () => {
    modelAnswers({});
    await run();
    const content: Array<{ type: string; text?: string }> = mockCreate.mock.calls[0][0].messages[0].content;
    const prompt = content.find((part) => part.type === 'text')?.text ?? '';
    expect(prompt).toContain('"crypto_com"');
    expect(prompt).not.toContain('crypto-com');
  });

  it('stores "crypto_com" when the model answers "crypto-com"', async () => {
    modelAnswers({ source: 'crypto-com' });
    const res = await run();

    expect(res.status).toBe(200);
    expect((await res.json()).source).toBe('crypto_com');
    expect(dbCall('FROM exchange_accounts').args).toEqual(['tenant-a', 'crypto_com']);
    expect(dbCall('INSERT INTO exchange_accounts').args.slice(1)).toEqual(['tenant-a', 'crypto_com', 'Crypto.com']);
    expect(insertedImportRow().source).toBe('crypto_com');
    // Nothing the writer sends to the database carries the hyphen.
    expect(JSON.stringify(dbCalls().map((c) => c.args))).not.toContain('crypto-com');
  });

  it('files the row under the existing Crypto.com account instead of creating a second one', async () => {
    existingAccounts = { crypto_com: [{ id: 'acct-csv' }] };
    modelAnswers({ source: 'Crypto.com' });
    await run();

    expect(dbCalls().some((c) => c.sql.includes('INSERT INTO exchange_accounts'))).toBe(false);
    const a = dbCall('INSERT INTO import_transactions').args;
    expect(a[2]).toBe('crypto_com');
    expect(a[3]).toBe('acct-csv');
  });

  it('leaves unknown sources as the model named them', async () => {
    modelAnswers({ source: 'Chase' });
    await run();
    expect(insertedImportRow().source).toBe('chase');
    expect(dbCall('INSERT INTO exchange_accounts').args.slice(1)).toEqual(['tenant-a', 'chase', 'Chase']);
  });

  // ── The stored row, run through pass1 ──────────────────────────────────────

  it('earn withdrawal → transfer via the Crypto.com map (keyword fallback said income)', async () => {
    modelAnswers({ kind: 'crypto_earn_program_withdrawn' });
    await run();
    expect(classifyImportTxPass1(insertedImportRow())?.category).toBe('transfer');
  });

  it('app → exchange transfer → transfer via the Crypto.com map (keyword fallback said swap)', async () => {
    modelAnswers({ kind: 'crypto_to_exchange_transfer', description: 'Transfer to Exchange' });
    await run();
    expect(classifyImportTxPass1(insertedImportRow())?.category).toBe('transfer');
  });

  it('card rebate → card-rebate, not income', async () => {
    modelAnswers({ kind: 'referral_card_cashback', description: 'Card Rebate: Spotify', currency: 'CRO', nativeUsd: 1.2 });
    await run();
    expect(classifyImportTxPass1(insertedImportRow())?.category).toBe('card-rebate');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. BATCH LIST / DELETE READ THE STORED VALUE
// ─────────────────────────────────────────────────────────────────────────────

describe('import/batches', () => {
  // The Crypto.com account card sends its route slug, 'crypto-com'.
  it('lists Crypto.com batches under "crypto_com"', async () => {
    await listBatches({
      request: new Request('http://localhost/api/import/batches?accountId=acct-1&source=crypto-com'),
    } as never);
    expect(dbCall('FROM import_transactions').args).toEqual(['tenant-a', 'crypto_com', 'acct-1']);
  });

  it('deletes Crypto.com batches under "crypto_com"', async () => {
    await deleteBatch({
      request: new Request('http://localhost/api/import/batches?batchId=b-1&source=crypto-com', { method: 'DELETE' }),
    } as never);
    expect(dbCall('SELECT id FROM import_transactions').args).toEqual(['b-1', 'tenant-a', 'crypto_com']);
    expect(dbCall('DELETE FROM import_transactions').args).toEqual(['b-1', 'tenant-a', 'crypto_com']);
    expect(dbCall('DELETE FROM import_raw_rows').args).toEqual(['b-1', 'tenant-a', 'crypto_com']);
  });

  it('leaves other sources unchanged', async () => {
    await listBatches({
      request: new Request('http://localhost/api/import/batches?accountId=acct-2&source=coinbase'),
    } as never);
    expect(dbCall('FROM import_transactions').args).toEqual(['tenant-a', 'coinbase', 'acct-2']);
  });
});
