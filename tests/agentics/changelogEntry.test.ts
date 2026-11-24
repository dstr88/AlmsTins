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

  it('says what the record now covers, the unmatched mark, the contract case, and that an unmatched payment is now emailed', () => {
    for (const words of [
      "every direct transfer of an agent's own wallet on Ethereum, Polygon and Avalanche, in and out, with the transaction hash and the address on the other side",
      'trusted, pending or flagged for an address you registered, or not on the list',
      'is marked as unmatched',
      'recorded as a transfer to that contract',
      'An unmatched payment is now also emailed to you at once (November 6).',
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
    expect(article.replace(/<[^>]+>/g, ' ')).not.toContain('—');
  });
});

describe('the changelog entry for Privacy Policy and User Agreement 1.4', () => {
  const start = page.indexOf('Privacy Policy version 1.4 and User Agreement version 1.4 are in effect.');
  const article = page.slice(page.lastIndexOf('<article', start), page.indexOf('</article>', start));

  it('is public, dated the day the documents carry, and names the one change', () => {
    expect(start).toBeGreaterThan(-1);
    expect(article).toContain('<time class="entry-date">November 6, 2026</time>');
    const before = page.slice(0, page.lastIndexOf('<article', start));
    expect((before.match(/&& \(<>/g) ?? []).length).toBe((before.match(/<\/>\)\}/g) ?? []).length);
    expect(article).toContain('emails you at once when a transfer out of one of your agents');
    expect(article).toContain("The User Agreement's wording is unchanged");
    const text = article.replace(/<[^>]+>/g, ' ');
    expect(text).not.toContain('—');
    expect(text).not.toMatch(/\b(stops?|stopped|blocks?|blocked|holds?|held)\b/i);
  });
});

describe('the changelog entry for Privacy Policy and User Agreement 1.5', () => {
  const start = page.indexOf('Privacy Policy version 1.5 and User Agreement version 1.5 are in effect.');
  const article = page.slice(page.lastIndexOf('<article', start), page.indexOf('</article>', start));

  it('is public, dated the day the documents carry, and names the one change', () => {
    expect(start).toBeGreaterThan(-1);
    expect(article).toContain('<time class="entry-date">November 17, 2026</time>');
    const before = page.slice(0, page.lastIndexOf('<article', start));
    expect((before.match(/&& \(<>/g) ?? []).length).toBe((before.match(/<\/>\)\}/g) ?? []).length);
    expect(article).toContain('section B.5.4: Almstins Verify has a Free plan, offered at no charge');
    expect(article).toContain("The Privacy Policy's wording is unchanged");
    const text = article.replace(/<[^>]+>/g, ' ');
    expect(text).not.toContain('—');
    expect(text).not.toMatch(/\b(stops?|stopped|blocks?|blocked|holds?|held)\b/i);
  });
});

describe('the changelog entry for Privacy Policy and User Agreement 1.6', () => {
  const start = page.indexOf('Privacy Policy version 1.6 and User Agreement version 1.6 are in effect.');
  const article = page.slice(page.lastIndexOf('<article', start), page.indexOf('</article>', start));

  it('is public, dated the day the documents carry, and names the one change', () => {
    expect(start).toBeGreaterThan(-1);
    expect(article).toContain('<time class="entry-date">November 19, 2026</time>');
    // It sits outside every flag-guarded block: every `{FLAG && (<>` before it is closed before it starts.
    const before = page.slice(0, page.lastIndexOf('<article', start));
    expect((before.match(/&& \(<>/g) ?? []).length).toBe((before.match(/<\/>\)\}/g) ?? []).length);
    expect(article).toContain('the country and the Almstins product of your last sign-in, the product you signed up for, and the last day you used the Service while signed in (the day only)');
    expect(article).toContain('it lists what our admin tools show about an account');
    expect(article).toContain("The User Agreement's wording is unchanged");
    const text = article.replace(/<[^>]+>/g, ' ');
    expect(text).not.toContain('—');
    expect(text).not.toMatch(/\b(stops?|stopped|blocks?|blocked|holds?|held)\b/i);
  });
});

describe('the changelog entry for Privacy Policy and User Agreement 1.7', () => {
  const start = page.indexOf('Privacy Policy version 1.7 and User Agreement version 1.7 are in effect.');
  const article = page.slice(page.lastIndexOf('<article', start), page.indexOf('</article>', start));

  it('is public, dated the day the documents carried, and names the changes', () => {
    expect(start).toBeGreaterThan(-1);
    expect(article).toContain('<time class="entry-date">November 19, 2026</time>');
    // It sits outside every flag-guarded block: every `{FLAG && (<>` before it is closed before it starts.
    const before = page.slice(0, page.lastIndexOf('<article', start));
    expect((before.match(/&& \(<>/g) ?? []).length).toBe((before.match(/<\/>\)\}/g) ?? []).length);
    expect(article).toContain('The changes are in the Privacy Policy, sections 4, 5 and 10.');
    expect(article).toContain('If you signed up through Almstins Verify, we now send you two emails about proving your first address, one on the day you sign up and one three days later, in place of the getting-started series.');
    expect(article).toContain('They end as soon as you register your first Verify Destination, and you get the getting-started series only if you add a wallet.');
    expect(article).toContain('we may write to you personally, on occasion, about your account or to ask how the Service is working for you, and that you can ask us not to');
    expect(article).toContain("The User Agreement's wording is unchanged");
    const text = article.replace(/<[^>]+>/g, ' ');
    expect(text).not.toContain('—');
    expect(text).not.toMatch(/\b(stops?|stopped|blocks?|blocked|holds?|held)\b/i);
  });
});

describe('the changelog entry for Privacy Policy and User Agreement 1.8', () => {
  const start = page.indexOf('Privacy Policy version 1.8 and User Agreement version 1.8 are in effect.');
  const article = page.slice(page.lastIndexOf('<article', start), page.indexOf('</article>', start));
  /** The day both documents carry (tests/privacy/agenticsPolicyV13.test.ts holds the six headers to it). */
  const EFFECTIVE = 'November 20, 2026';

  it('is public, dated the day the documents carry, and names the one change', () => {
    expect(start).toBeGreaterThan(-1);
    expect(article).toContain(`<time class="entry-date">${EFFECTIVE}</time>`);
    // It sits outside every flag-guarded block (1.9, below, is the newest entry and holds the header).
    const before = page.slice(0, page.lastIndexOf('<article', start));
    expect((before.match(/&& \(<>/g) ?? []).length).toBe((before.match(/<\/>\)\}/g) ?? []).length);
    expect(article).toContain('The change is in the Privacy Policy, section 9.');
    expect(article).toContain('The Almstins Verify page now has a field where you can check the address or payment link you ask people to pay, with no account.');
    expect(article).toContain('your browser keeps what you checked in its session storage, for that tab only, so the first screen after you sign in can fill it in');
    expect(article).toContain('It is never put in a web address, keeping it sends nothing to our servers, and your browser removes it as soon as that first screen has read it.');
    expect(article).toContain("The User Agreement's wording is unchanged");
    const text = article.replace(/<[^>]+>/g, ' ');
    expect(text).not.toContain('—');
    expect(text).not.toMatch(/\b(stops?|stopped|blocks?|blocked|holds?|held)\b/i);
  });
});

describe('the changelog entry for Privacy Policy and User Agreement 1.9', () => {
  const start = page.indexOf('Privacy Policy version 1.9 and User Agreement version 1.9 are in effect.');
  const article = page.slice(page.lastIndexOf('<article', start), page.indexOf('</article>', start));
  /** The day both documents carry (tests/privacy/agenticsPolicyV13.test.ts holds the six headers to it). */
  const EFFECTIVE = 'November 24, 2026';

  it('is public, the newest entry, dated the day the documents carry, and names the one change', () => {
    expect(start).toBeGreaterThan(-1);
    expect(article).toContain(`<time class="entry-date">${EFFECTIVE}</time>`);
    expect(page.indexOf('<article')).toBe(page.lastIndexOf('<article', start));
    expect(readFileSync(path.join(ROOT, 'src/i18n/privacyPolicy.ts'), 'utf8')).toContain(`<strong>Effective Date:</strong> ${EFFECTIVE} &nbsp;&middot;&nbsp; <strong>Version:</strong> 1.9`);
    expect(article).toContain('The change is in the Privacy Policy, section 3.');
    expect(article).toContain('keeps a count of its answers per day: the date, whether the call used a key, and the answer it gave');
    expect(article).toContain('Checks made without a key are still not recorded.');
    expect(article).toContain("The User Agreement's wording is unchanged");
    const text = article.replace(/<[^>]+>/g, ' ');
    expect(text).not.toContain('—');
    expect(text).not.toMatch(/\b(stops?|stopped|blocks?|blocked|safe)\b/i);
  });
});
