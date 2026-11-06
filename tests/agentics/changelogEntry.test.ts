import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The public changelog's Agent Vault entry (slice 8, every outflow). The Vault is owner-only until
 * AGENTICS_VAULT_PUBLIC is true, so the entry sits behind that flag, the way the PetroTins entries
 * sit behind theirs: until the Vault opens, the public page says nothing about a record nobody else
 * can have. Pure source checks: no server, no database.
 */
const ROOT = path.resolve(__dirname, '../..');
const page = readFileSync(path.join(ROOT, 'src/pages/changelog.astro'), 'utf8');

const entry = (() => {
  const start = page.indexOf('· Agent Vault</time>');
  expect(start, 'the Agent Vault entry').toBeGreaterThan(-1);
  return page.slice(page.lastIndexOf('{AGENTICS_VAULT_PUBLIC && (<>', start), page.indexOf('</>)}', start));
})();

describe('the changelog entry for every outflow', () => {
  it('shows only once the Agent Vault is open, using the flag the Vault itself reads', () => {
    expect(page).toContain("import { AGENTICS_VAULT_PUBLIC } from '@/lib/agenticsAccess';");
    expect(entry.startsWith('{AGENTICS_VAULT_PUBLIC && (<>')).toBe(true);
    expect(readFileSync(path.join(ROOT, 'src/lib/agenticsFlag.mjs'), 'utf8')).toMatch(/export const AGENTICS_VAULT_PUBLIC = (true|false);/);
  });

  it('says what the record now covers, the unmatched mark, the contract case, and that no email is sent', () => {
    for (const words of [
      "every direct transfer of an agent's own wallet on Ethereum, Polygon and Avalanche, in and out, with the transaction hash and the address on the other side",
      'trusted, pending or flagged for an address you registered, or not on the list',
      'is marked as unmatched',
      'recorded as a transfer to that contract',
      'No email is sent for an unmatched payment.',
      'every file signed before this change still checks out',
    ]) {
      expect(entry, words).toContain(words);
    }
  });

  it('keeps the product wording: no em dash, nothing stopped or blocked, nothing called safe', () => {
    const text = entry.replace(/<[^>]+>/g, ' ');
    expect(text).not.toContain('—');
    expect(text).not.toMatch(/\b(stops?|stopped|blocks?|blocked|holds?|held)\b/i);
    expect(text).not.toMatch(/\bsafe\b/i);
  });
});

describe('the changelog entry for Privacy Policy and User Agreement 1.3', () => {
  const start = page.indexOf('Privacy Policy version 1.3 and User Agreement version 1.3 are in effect.');
  const article = page.slice(page.lastIndexOf('<article', start), page.indexOf('</article>', start));

  it('is public, not behind the Vault flag: the policy pages are public', () => {
    expect(start).toBeGreaterThan(-1);
    expect(article).toContain('<time class="entry-date">November 5, 2026</time>');
    const before = page.slice(0, page.lastIndexOf('<article', start));
    // No flag block is open around it: every `{FLAG && (<>` before it is closed before it starts.
    expect((before.match(/&& \(<>/g) ?? []).length).toBe((before.match(/<\/>\)\}/g) ?? []).length);
  });

  it('states the Free plan as entitlements.ts enforces it, and the date the documents carry', () => {
    const entitlements = readFileSync(path.join(ROOT, 'src/lib/agentVault/entitlements.ts'), 'utf8');
    expect(entitlements).toContain('export const FREE_LIMITS: PlanLimits = { bots: 3, addresses: 15, walletsPerBot: 5 };');
    expect(entitlements).toContain('export const FREE_LOGGED_CHECKS_PER_DAY = 5_000;');
    expect(article).toContain('3 agents, 15 addresses shared across them, 5 wallets per agent, and 5,000 recorded checks per agent per day');
    expect(readFileSync(path.join(ROOT, 'src/i18n/privacyPolicy.ts'), 'utf8')).toContain('<strong>Effective Date:</strong> November 5, 2026');
    expect(article.replace(/<[^>]+>/g, ' ')).not.toContain('—');
  });
});
