import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chainNames, syncFailureMessage, syncFailures } from '../../src/lib/sync/syncReport';
import { en, es, fr } from '../../src/i18n/dashboard/bookkeeping';

/**
 * The Bookkeeping page's Sync now button reads the answer of /api/wallets/sync-all. It once looked
 * only at the HTTP status, so a sync where every Ethereum wallet failed reloaded the page as if
 * all went well. Now a failed wallet or chain is counted and named, the lifecycle is still rebuilt
 * for what did sync, and a skipped custom wallet is not a failure.
 *
 * Every id here is invented. No database, no network.
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const chain = (c: string, ok: boolean, error?: string) => ({ walletId: 'w', chain: c, fetched: 0, inserted: 0, ok, ...(error ? { error } : {}) });

const answer = {
  totalWallets: 4,
  totalInserted: 3,
  totalSkipped: 0,
  perWallet: [
    { walletId: 'w-1', totalInserted: 3, totalSkipped: 0, chains: [chain('ethereum', false, 'Scan API error'), chain('polygon', true), chain('avalanche', true)] },
    { walletId: 'w-2', totalInserted: 0, totalSkipped: 0, chains: [chain('ethereum', false, 'duplicate key'), chain('avalanche', false, 'NOTOK'), chain('polygon', true)] },
    { walletId: 'w-custom', totalInserted: 0, totalSkipped: 0, chains: [], skippedReason: 'not_evm_address' },
    { walletId: 'w-3', totalInserted: 0, totalSkipped: 0, chains: [chain('polygon', true)] },
  ],
};

describe('syncFailures', () => {
  it('counts each wallet with a failed chain once and names each failed chain once', () => {
    expect(syncFailures(answer)).toEqual({ failedWallets: 2, failedChains: ['ethereum', 'avalanche'], anySynced: true });
  });

  it('counts nothing when every chain synced, and a skipped custom wallet is not a failure', () => {
    const ok = { perWallet: [answer.perWallet[2], answer.perWallet[3]] };
    expect(syncFailures(ok)).toEqual({ failedWallets: 0, failedChains: [], anySynced: true });
  });

  it('counts a wallet that failed before any chain was read', () => {
    expect(syncFailures({ perWallet: [{ walletId: 'w', chains: [], error: 'boom' }] })).toEqual({ failedWallets: 1, failedChains: [], anySynced: false });
  });

  it('reads an unreadable answer as nothing failed', () => {
    for (const bad of [null, 'x', {}, { perWallet: 'x' }, { perWallet: [null, 3] }]) {
      expect(syncFailures(bad).failedWallets).toBe(0);
    }
  });
});

describe('the message under Sync now', () => {
  it('says how many and on which chains, in each language', () => {
    const f = syncFailures(answer);
    expect(syncFailureMessage(f, en, 'en')).toBe('2 wallets could not be synced on Ethereum and Avalanche. The rest synced and cost basis was rebuilt. Reload the page to see the new records.');
    expect(syncFailureMessage(f, es, 'es')).toBe('2 billeteras no se pudieron sincronizar en Ethereum y Avalanche. El resto se sincronizó y el cost basis se recalculó. Recarga la página para ver los registros nuevos.');
    expect(syncFailureMessage(f, fr, 'fr')).toBe("2 portefeuilles n'ont pas pu être synchronisés sur Ethereum et Avalanche. Le reste a été synchronisé et le cost basis a été recalculé. Rechargez la page pour voir les nouveaux enregistrements.");
  });

  it('says one wallet, and says when nothing synced', () => {
    expect(syncFailureMessage({ failedWallets: 1, failedChains: ['ethereum'], anySynced: false }, en, 'en')).toBe('1 wallet could not be synced on Ethereum. Nothing was synced. Please try again later.');
    expect(syncFailureMessage({ failedWallets: 1, failedChains: [], anySynced: true }, en, 'en')).toBe('1 wallet could not be synced. The rest synced and cost basis was rebuilt. Reload the page to see the new records.');
  });

  it('is null when nothing failed', () => {
    expect(syncFailureMessage({ failedWallets: 0, failedChains: [], anySynced: true }, en, 'en')).toBeNull();
  });

  it('names chains by their names', () => {
    expect(chainNames(['ethereum', 'polygon', 'avalanche'], 'en')).toBe('Ethereum, Polygon, and Avalanche');
  });

  it('has every string in every language, with no em dash', () => {
    for (const t of [en, es, fr]) {
      for (const key of ['syncFailedOne', 'syncFailedMany', 'syncFailedWhere', 'syncFailedRest', 'syncFailedNone'] as const) {
        expect(t[key], `${t.lang} ${key}`).toBeTruthy();
        expect(t[key]).not.toContain('—');
      }
      expect(t.syncFailedOne).toContain('{where}');
      expect(t.syncFailedMany).toContain('{count}');
      expect(t.syncFailedMany).toContain('{where}');
      expect(t.syncFailedWhere).toContain('{chains}');
    }
  });
});

describe('the Sync now button', () => {
  const page = read('src/pages/dashboard/bookkeeping.astro');
  const script = page.slice(page.indexOf("const btn = document.getElementById('bk-sync-now')"), page.indexOf('<!-- ══ Tax Readiness Bar'));

  it('reads the sync answer, still rebuilds the lifecycle, and shows the failures instead of reloading', () => {
    expect(page).toContain("import { syncFailures, syncFailureMessage } from '@/lib/sync/syncReport';");
    expect(script).toContain('syncFailures(await sync.json()');
    expect(script.indexOf('syncFailures(')).toBeLessThan(script.indexOf("fetch('/api/lifecycle/rebuild'"));
    expect(script.indexOf("fetch('/api/lifecycle/rebuild'")).toBeLessThan(script.indexOf('syncFailureMessage('));
    expect(script).toMatch(/if \(!message\) \{\s*location\.reload\(\);/);
    expect(page).toContain('id="bk-sync-result" role="status"');
  });

  it('hands the page script every string it needs', () => {
    for (const key of ['syncFailedOne', 'syncFailedMany', 'syncFailedWhere', 'syncFailedRest', 'syncFailedNone']) {
      expect(page).toContain(`${key}: t.${key},`);
    }
  });
});

describe('syncAllWallets', () => {
  it('keeps a wallet that failed before any chain in the answer, so the button can count it', () => {
    const src = read('src/lib/sync/syncTransactions.ts');
    const all = src.slice(src.indexOf('export async function syncAllWallets'));
    expect(all).toMatch(/catch \(error\) \{[\s\S]*?perWallet\.push\(\{[\s\S]*?error:/);
  });
});
