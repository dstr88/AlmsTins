import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The changelog entry for the Wallet Watcher follow-ups: Sync now says which wallets and chains
 * failed (src/lib/sync/syncReport.ts), custom wallets are not sent to the explorers, one format for
 * the last sync time (src/lib/sync/syncRunAt.ts), and the weekly sync rebuilds the cost basis
 * (src/lib/lifecycleRebuild.ts). The newest entry, and it claims only what the code does.
 */

const page = readFileSync(path.resolve(__dirname, '../../src/pages/changelog.astro'), 'utf8');
const start = page.indexOf('The Sync now button on the Bookkeeping page now tells you when a wallet could not be synced.');
const article = page.slice(page.lastIndexOf('<article', start), page.indexOf('</article>', start));
const text = article.replace(/<[^>]+>/g, ' ');

describe('the changelog entry for the sync follow-ups', () => {
  it('is public and the newest entry', () => {
    expect(start).toBeGreaterThan(-1);
    expect(page.indexOf('<article')).toBe(page.lastIndexOf('<article', start));
    expect(article).toMatch(/<time class="entry-date">[A-Z][a-z]+ \d{1,2}, 2026<\/time>/);
  });

  it('says what each change does, in plain words', () => {
    expect(text).toContain('It says how many wallets failed and on which chains, and it still rebuilds your cost basis with whatever did sync');
    expect(text).toContain('Wallets that hold only entries you added by hand are no longer sent to the block explorers');
    expect(text).toContain('Every chain now saves that time the same way.');
    expect(text).toContain('When the weekly sync adds records to your account, it now rebuilds your cost basis too');
  });

  it('keeps to the copy rules: no em dash, records wording rather than tax advice', () => {
    expect(text).not.toContain('—');
    expect(text).not.toMatch(/\btax (advice|return|filing)\b/i);
  });
});
