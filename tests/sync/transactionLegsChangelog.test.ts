import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The changelog entry for Wallet Watcher keeping each movement of an EVM transaction
 * (src/lib/sync/evmSyncRows.ts): the newest entry, and it claims only what the sync does.
 */

const page = readFileSync(path.resolve(__dirname, '../../src/pages/changelog.astro'), 'utf8');
const start = page.indexOf('Wallet Watcher now keeps each movement in a transaction on Ethereum, Polygon and Avalanche');
const article = page.slice(page.lastIndexOf('<article', start), page.indexOf('</article>', start));
const text = article.replace(/<[^>]+>/g, ' ');

describe('the changelog entry for transaction legs', () => {
  it('is public and the newest entry', () => {
    expect(start).toBeGreaterThan(-1);
    expect(page.indexOf('<article')).toBe(page.lastIndexOf('<article', start));
    expect(article).toContain('<time class="entry-date">November 25, 2026</time>');
  });

  it('names the chains the sync reads, the fee, the internal coin, and says old records are not yet corrected', () => {
    expect(text).toContain('Ethereum, Polygon and Avalanche');
    expect(text).toContain('A swap now records the coin that left and the coin that arrived.');
    expect(text).toContain('including approvals and transactions that failed');
    expect(text).toContain('such as the ETH you receive when you swap USDC for ETH');
    expect(text).toContain('records synced before this change are not yet corrected');
  });

  it('keeps to the copy rules: no em dash, records wording rather than tax advice', () => {
    expect(text).not.toContain('—');
    expect(text).not.toMatch(/\btax (advice|return|filing)\b/i);
  });
});
