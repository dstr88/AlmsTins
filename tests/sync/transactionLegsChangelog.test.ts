import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The changelog entry for Wallet Watcher keeping each movement of an EVM transaction
 * (src/lib/sync/evmSyncRows.ts): public, dated Nov 25, 2026, and it claims only what the sync does.
 * Records synced before the change were read again that day (the only accounts with records on
 * those chains), so the entry no longer says they are not yet corrected.
 */

const page = readFileSync(path.resolve(__dirname, '../../src/pages/changelog.astro'), 'utf8');
const start = page.indexOf('Wallet Watcher now keeps each movement in a transaction on Ethereum, Polygon and Avalanche');
const article = page.slice(page.lastIndexOf('<article', start), page.indexOf('</article>', start));
const text = article.replace(/<[^>]+>/g, ' ');

describe('the changelog entry for transaction legs', () => {
  it('is public and dated November 25, 2026', () => {
    expect(start).toBeGreaterThan(-1);
    expect(article).toContain('<time class="entry-date">November 25, 2026</time>');
  });

  it('names the chains the sync reads, the fee, the internal coin, and says old records were read again', () => {
    expect(text).toContain('Ethereum, Polygon and Avalanche');
    expect(text).toContain('A swap now records the coin that left and the coin that arrived.');
    expect(text).toContain('including approvals and transactions that failed');
    expect(text).toContain('such as the ETH you receive when you swap USDC for ETH');
    expect(text).toContain('Records synced before this change were read again on November 25');
    expect(text).not.toContain('not yet corrected');
  });

  it('keeps to the copy rules: no em dash, records wording rather than tax advice', () => {
    expect(text).not.toContain('—');
    expect(text).not.toMatch(/\btax (advice|return|filing)\b/i);
  });
});
