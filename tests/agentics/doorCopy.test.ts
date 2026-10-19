import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { brightLineViolations } from '../helpers/brightLineWording';
import { agenticsCopy, en, enOpen, FREE_ADDRESSES, FREE_BOTS, FREE_CHECKS_PER_DAY, opening } from '../../src/i18n/agentics';
import { renderAgenticsOpening, renderAgenticsWelcome, renderAgenticsWelcomeFor } from '../../src/i18n/emails/agenticsWelcome';

/**
 * The words of the Agentics door (landing, sign-in, welcome page, welcome letter) are held to the
 * product's wording rules, say only what is true today, and show the same letter on the page and in
 * the email. Everything here is read from src/i18n/agentics.ts, the one place the copy lives.
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Every string in a copy tree, with where it was found. */
function strings(node: unknown, at = 'en'): Array<[string, string]> {
  if (typeof node === 'string') return [[at, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => strings(v, `${at}[${i}]`));
  if (node && typeof node === 'object') return Object.entries(node).flatMap(([k, v]) => strings(v, `${at}.${k}`));
  return [];
}
const ALL = strings(en);

describe('the words keep the product wording', () => {
  it('reads every string of the door (sanity)', () => {
    expect(ALL.length).toBeGreaterThan(40);
  });

  it.each(ALL)('%s: verifies, warns and flags, never stops anything, American English', (_where, text) => {
    expect(brightLineViolations(text)).toEqual([]);
  });

  it('never calls anything safe, trustless, guaranteed or insured', () => {
    for (const [where, text] of ALL) {
      expect(text, where).not.toMatch(/\b(safe|safely|safety|trustless|guarantee[sd]?|insur(ed|ance)|risk[- ]free)\b/i);
    }
  });

  it('keeps clear of tax, attribution and custody wording', () => {
    for (const [where, text] of ALL) {
      expect(text, where).not.toMatch(/cost[ -]basis|capital gain|realized|profit|\bP\/L\b|8949|\bkyc\b|who owns|cluster/i);
    }
  });

  it('states the bright lines: read-only, no keys, never in the transaction, the agent that skips the check is outside', () => {
    const landing = strings(en.landing).map(([, s]) => s).join(' ');
    expect(landing).toMatch(/Read-only/);
    expect(landing).toMatch(/never holds keys/);
    expect(landing).toMatch(/never in the transaction path/);
    expect(landing).toMatch(/skips the check is outside what Agentics can see/);
    expect(landing).toMatch(/An outage is never a pass/);
  });
});

describe('it says only what is true today', () => {
  it('names no price: nobody can buy a paid plan yet', () => {
    for (const [where, text] of ALL) expect(text, where).not.toMatch(/\$\s?\d|\d+\s?(USD|dollars)|per month|\/mo\b|per year/i);
  });

  it('paid plans are coming later, with nothing to buy', () => {
    const paid = en.landing.plans.find((p) => p.name === 'Paid plans');
    expect(paid).toEqual({ name: 'Paid plans', status: 'Coming later', body: 'Nothing to buy today.' });
  });

  it('the free plan is described as what it will cover when the vault opens', () => {
    expect(en.landing.plans[0]).toEqual({ name: 'Free', status: 'Open now', body: `${FREE_BOTS} bots and ${FREE_ADDRESSES} addresses when the vault opens.` });
    expect([FREE_BOTS, FREE_ADDRESSES]).toEqual([3, 15]);
  });

  it('only the pre-send check is marked live; the vault steps are marked opening soon', () => {
    expect(en.landing.steps.map((s) => [s.live, s.tag])).toEqual([[false, 'Opening soon'], [true, 'Live'], [false, 'Opening soon']]);
    expect(en.landing.status.liveText).toMatch(/pre-send check/);
    expect(en.landing.status.soonText).toMatch(/your vault/);
  });

  it('promises exactly one more email, and no newsletter', () => {
    const text = en.letter.paragraphs.join(' ');
    expect(text).toMatch(/I will write once, when your vault opens\. No newsletter\./);
    expect(en.landing.finePrint).toMatch(/email you once/);
    expect(en.letter.why).toMatch(/only email we will send until your vault opens/);
  });

  it('points at pages that exist: the docs, key creation and the free checker', () => {
    expect(en.welcome.today.map((t) => t.href)).toEqual(['/agentics/docs', '/verify/agent-keys', '/wallet-checker', '/agentics/account']);
  });
});

describe('the letter is the same on the page and in the email', () => {
  const mail = renderAgenticsWelcome('https://almstins.com');

  it('the subject and every paragraph of the letter are in the email text, in order', () => {
    expect(mail.subject).toBe(en.letter.subject);
    let at = 0;
    for (const line of [en.letter.greeting, ...en.letter.paragraphs, ...en.letter.signoff, en.letter.why]) {
      const found = mail.text.indexOf(line, at);
      expect(found, line).toBeGreaterThanOrEqual(at);
      at = found + line.length;
    }
  });

  it('the html carries the same paragraphs, escaped, and the docs button', () => {
    for (const p of en.letter.paragraphs) {
      expect(mail.html).toContain(p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
    }
    expect(mail.html).toContain('href="https://almstins.com/agentics/docs"');
    expect(mail.text).toContain('API docs: https://almstins.com/agentics/docs');
  });

  it('links only to almstins.com, and puts the address nowhere in the body but the docs link', () => {
    const links = [...mail.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(links).toEqual(['https://almstins.com/agentics/docs']);
  });

  it('the email passes the wording rules too', () => {
    expect(brightLineViolations(mail.text)).toEqual([]);
    expect(brightLineViolations(mail.subject)).toEqual([]);
  });

  it('escapes the site address it is given', () => {
    const odd = renderAgenticsWelcome('https://x.example"><script>');
    expect(odd.html).not.toContain('<script>');
  });
});

describe('the copy follows the state of the vault', () => {
  it('is the private vault\'s words until the flag opens it, and the open vault\'s words after', () => {
    expect(agenticsCopy(false)).toBe(en);
    expect(agenticsCopy(true)).toBe(enOpen);
  });

  it('differs only where "opening soon" stops being true: the same bright-line text, the same docs and footer, the same sign-out', () => {
    expect(enOpen.landing.title).toBe(en.landing.title);
    expect(enOpen.landing.h1).toBe(en.landing.h1);
    expect(enOpen.landing.stays).toEqual(en.landing.stays);
    expect(enOpen.landing.footerLinks).toEqual(en.landing.footerLinks);
    expect(enOpen.welcome).toEqual(en.welcome);
    expect(enOpen.brand).toBe(en.brand);
  });
});

describe('the open vault keeps the same wording rules', () => {
  const ALL_OPEN = [...strings(enOpen, 'enOpen'), ...strings(opening, 'opening')];
  const joined = (node: unknown) => strings(node).map(([, t]) => t).join(' ');

  it('reads every string of the open door and of the opening email (sanity)', () => {
    expect(ALL_OPEN.length).toBeGreaterThan(60);
  });

  it('verifies, warns and flags, never stops anything, and is American English', () => {
    for (const [where, text] of ALL_OPEN) expect(brightLineViolations(text), where).toEqual([]);
  });

  it('never calls anything safe, trustless, guaranteed or insured', () => {
    for (const [where, text] of ALL_OPEN) {
      expect(text, where).not.toMatch(/\b(safe|safely|safety|trustless|guarantee[sd]?|insur(ed|ance)|risk[- ]free)\b/i);
    }
  });

  it('keeps clear of tax, attribution and custody wording', () => {
    for (const [where, text] of ALL_OPEN) {
      expect(text, where).not.toMatch(/cost[ -]basis|capital gain|realized|profit|\bP\/L\b|8949|\bkyc\b|who owns|cluster/i);
    }
  });

  it('names no price, and says paid plans are coming later with nothing to buy', () => {
    for (const [where, text] of ALL_OPEN) expect(text, where).not.toMatch(/\$\s?\d|\d+\s?(USD|dollars)|per month|\/mo\b|per year/i);
    expect(enOpen.landing.plans.find((x) => x.name === 'Paid plans')).toEqual({ name: 'Paid plans', status: 'Coming later', body: 'Nothing to buy today.' });
  });

  it('still states the bright lines: read-only, no keys, never in the transaction, the agent that skips the check is outside', () => {
    const landing = joined(enOpen.landing);
    expect(landing).toMatch(/Read-only/);
    expect(landing).toMatch(/never holds keys/);
    expect(landing).toMatch(/never in the transaction path/);
    expect(landing).toMatch(/skips the check is outside what Agentics can see/);
    expect(landing).toMatch(/An outage is never a pass/);
  });

  it('says the free plan is open now, with its numbers, and that every step is live', () => {
    expect(enOpen.landing.plans[0]).toEqual({ name: 'Free', status: 'Open now', body: `${FREE_BOTS} bots and ${FREE_ADDRESSES} addresses.` });
    expect(enOpen.landing.steps.map((x) => [x.live, x.tag])).toEqual([[true, 'Live'], [true, 'Live'], [true, 'Live']]);
    expect(enOpen.landing.status.liveText).toMatch(/your vault/);
    expect(enOpen.landing.status.soonLabel).toBe('Coming later');
  });

  it('names the chains the record is read from and says it is read once a day, so nothing promises more than is built', () => {
    expect(enOpen.landing.steps[2].body).toContain('Once a day');
    expect(enOpen.landing.steps[2].body).toContain('Ethereum, Polygon and Avalanche');
    expect(opening.letter.paragraphs.join(' ')).toContain('Once a day');
    expect(opening.letter.paragraphs.join(' ')).toContain('Ethereum, Polygon and Avalanche');
    for (const [where, text] of ALL_OPEN) expect(text, where).not.toMatch(/real[- ]time|live feed|as it happens|instant(ly)?|every second/i);
  });

  it('says what a check needs to be recorded, that only trusted addresses are read, and the daily number: no promise of "every check" or "every address"', () => {
    const step = enOpen.landing.steps[2].body;
    expect(step).toContain(`Each check your bot asks with its key becomes a dated entry on your bot’s page (up to ${FREE_CHECKS_PER_DAY.toLocaleString('en-US')} a day on the free plan).`);
    expect(step).toContain('the addresses you trusted');
    const welcome = enOpen.letter.paragraphs.join(' ');
    expect(welcome).toContain('link a key to it (you make a key by proving a domain)');
    expect(welcome).toContain('Each check your bot asks with its key appears on its page.');
    expect(welcome).toContain('Transfers to the addresses you trusted appear once a day');
    const opened = opening.letter.paragraphs.join(' ');
    expect(opened).toContain('link a key to it (you make a key by proving a domain)');
    expect(opened).toContain('Each check it asks with the key becomes a dated entry');
    expect(opened).toContain('the addresses you trusted are read from Ethereum, Polygon and Avalanche');
    for (const [where, text] of ALL_OPEN) expect(text, where).not.toMatch(/\bevery check\b|\ball your addresses\b|\bwatches? (the )?(receiv|every)/i);
  });

  it('no longer says the vault is opening soon, or that one more email is coming', () => {
    for (const [where, text] of ALL_OPEN) {
      expect(text, where).not.toMatch(/opening soon|when your vault opens|until your vault opens|when it opens/i);
    }
  });

  it('promises no email beyond the welcome and reports the account turns on', () => {
    expect(enOpen.letter.why).toMatch(/We send a welcome like this once, and reports only if you turn them on/);
    expect(opening.letter.why).toMatch(/the one email we said we would send when it did, and we will not email you about it again/);
  });
});

describe('the letters in the open state', () => {
  const welcome = renderAgenticsWelcome('https://almstins.com', enOpen);
  const mail = renderAgenticsOpening('https://almstins.com');
  const inOrder = (text: string, lines: readonly string[]) => {
    let at = 0;
    for (const line of lines) {
      const found = text.indexOf(line, at);
      expect(found, line).toBeGreaterThanOrEqual(at);
      at = found + line.length;
    }
  };

  it('the welcome letter of an open vault is the one renderAgenticsWelcomeFor gives, and differs from the private one', () => {
    expect(renderAgenticsWelcomeFor('https://almstins.com', true)).toEqual(welcome);
    expect(renderAgenticsWelcomeFor('https://almstins.com', false)).toEqual(renderAgenticsWelcome('https://almstins.com'));
    expect(welcome.subject).toBe('Your vault is open: Almstins Agentics');
    expect(welcome.subject).not.toBe(en.letter.subject);
  });

  it('carries every line of the letter, in order, then a link for each button', () => {
    inOrder(welcome.text, [enOpen.letter.greeting, ...enOpen.letter.paragraphs, 'Your vault: https://almstins.com/dashboard/agentics', 'API docs: https://almstins.com/agentics/docs', ...enOpen.letter.signoff, enOpen.letter.why]);
    inOrder(mail.text, [opening.letter.greeting, ...opening.letter.paragraphs, 'Your vault: https://almstins.com/dashboard/agentics', 'API docs: https://almstins.com/agentics/docs', ...opening.letter.signoff, opening.letter.why]);
    expect(mail.subject).toBe(opening.subject);
  });

  it('the html is the same lines, escaped, with two buttons that go to this site and nowhere else', () => {
    for (const rendered of [welcome, mail]) {
      const links = [...rendered.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      expect(links).toEqual(['https://almstins.com/dashboard/agentics', 'https://almstins.com/agentics/docs']);
      expect(rendered.html).toContain('Open your vault');
      expect(rendered.html).toContain('Read the API docs');
    }
    expect(mail.html).toContain(opening.heading);
  });

  it('puts the account\'s address nowhere in the body, and escapes the site address it is given', () => {
    const odd = renderAgenticsOpening('https://x.example"><script>');
    expect(odd.html).not.toContain('<script>');
    expect(odd.text).not.toMatch(/@/);
  });

  it('both pass the wording rules', () => {
    for (const rendered of [welcome, mail]) {
      expect(brightLineViolations(rendered.text)).toEqual([]);
      expect(brightLineViolations(rendered.subject)).toEqual([]);
    }
  });
});

describe('the door pages use only the design tokens', () => {
  /** The CSS of a page: every <style> body and every style="" attribute. */
  const cssOf = (src: string): string =>
    [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n') +
    '\n' + [...src.matchAll(/\sstyle="([^"]*)"/g)].map((m) => m[1]).join('\n');

  it('reads the CSS of a page (sanity: a hex color would be found)', () => {
    expect(cssOf('<style>a{color:#fff}</style><p style="color:red">')).toContain('#fff');
    expect(cssOf('<style>a{color:#fff}</style><p style="color:red">')).toContain('color:red');
  });

  for (const file of ['src/pages/agentics/index.astro', 'src/pages/agentics/login.astro', 'src/pages/dashboard/agentics/index.astro']) {
    it(`${file}: no hard-coded color, every color is a token`, () => {
      const css = cssOf(read(file));
      expect(css.length).toBeGreaterThan(200);
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css).not.toMatch(/\b(rgba?|hsla?)\(/i);
      for (const m of css.matchAll(/\bvar\(\s*(--[a-z0-9-]+)/gi)) {
        expect(TOKENS, `${file} uses ${m[1]}`).toContain(m[1]);
      }
    });
  }
});

/** The names the design token file defines (src/styles/tokens.css). */
const TOKENS = [...read('src/styles/tokens.css').matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]);
