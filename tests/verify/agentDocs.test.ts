import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * /verify/agents is the contract payment agents are built against. Today
 * /api/verify/check derives `status` from the domain match alone and does not look at
 * `level`: `proven` can come back for a lapsed anchor or an unanchored self-send wallet
 * (level `claimed`), and `mismatch` also fires with `domain: null` when no domain vouches
 * for the destination at all. Until the code narrows `proven`, the docs must teach the
 * safe reading: proceed only on status proven + level verified + expect passed, and hold
 * everything else. These source checks pin that rule, the hold/flag/escalate wording, the
 * caveats about what `verified` covers today, and the documented fields against what
 * check.ts actually returns.
 *
 * The caveat assertions describe today's behavior on purpose. When check.ts returns only
 * the fresh listing domain, or payment links need a domain proof before they count, update
 * the page and these assertions in the same change.
 */
const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const docs = read('src/pages/verify/agents.astro');
const check = read('src/pages/api/verify/check.ts');
const landing = read('src/i18n/verify.ts');
const docsText = docs.replace(/\s+/g, ' ');

/** The keys of check.ts's success response: the `return json({ v: 1, ... })` object. */
function responseKeys(): string[] {
  const m = check.match(/return json\(\{\s*v: 1,([\s\S]*?)\}\);/);
  expect(m, 'check.ts success response not found').not.toBeNull();
  return ['v', ...[...m![1].matchAll(/^\s*(\w+)\s*[:,]/gm)].map((k) => k[1])];
}

/** The keys of the sample JSON answer shown on the page. */
function documentedSampleKeys(): string[] {
  const m = docs.match(/<pre>\{`\{([\s\S]*?)\}`\}<\/pre>/);
  expect(m, 'sample JSON answer not found on the page').not.toBeNull();
  return [...m![1].matchAll(/"(\w+)":/g)].map((k) => k[1]);
}

/** The sample agent code: the `<pre>` block that builds mayProceed. */
function snippet(): string {
  const m = docs.match(/<pre>\{`(\/\/ payeeDomain[\s\S]*?)`\}<\/pre>/);
  expect(m, 'sample agent code not found on the page').not.toBeNull();
  return m![1];
}

/** The whitespace-collapsed text of one <section>, found by its <h2>. */
function section(heading: string): string {
  const start = docsText.indexOf(`<h2>${heading}</h2>`);
  expect(start, `section "${heading}" not found`).toBeGreaterThan(-1);
  const end = docsText.indexOf('</section>', start);
  return docsText.slice(start, end);
}

/** The text of one "Reading the fields" entry. */
function field(name: string): string {
  const m = docs.match(new RegExp(`\\['${name}', '((?:[^'\\\\]|\\\\.)*)'\\]`));
  expect(m, `field ${name} not found`).not.toBeNull();
  return m![1];
}

describe('/verify/agents: the safe-reading rule', () => {
  it('the sample code proceeds only on status proven AND level verified, with expect passed', () => {
    const code = snippet();
    expect(code).toContain("body.status === 'proven' && body.level === 'verified'");
    expect(code).toContain("'&expect=' + encodeURIComponent(want)");
    expect(code).toMatch(/if \(!mayProceed\) return holdForReview\(body\);/);
  });

  it('the sample code holds when there is no expect, since the API ignores an empty one', () => {
    const code = snippet();
    expect(code).toMatch(/const want = String\(payeeDomain \?\? ''\)\.trim\(\)\.toLowerCase\(\);/);
    const guard = code.indexOf("if (!want) return holdForReview(");
    expect(guard, 'empty-expect guard missing').toBeGreaterThan(-1);
    expect(guard, 'the guard must run before the fetch').toBeLessThan(code.indexOf('fetch('));
    // Belt and braces: the answer's domain must be the one the agent expects.
    expect(code).toContain("(got === want || got.endsWith('.' + want))");
    expect(docsText).toContain('The API ignores an empty expect');
  });

  it('the sample code retries every 5xx and 429, and holds on an unreadable answer', () => {
    const code = snippet();
    expect(code).toContain("if (res.status >= 500 || res.status === 429) return retryWithBackoff(res.headers.get('Retry-After'));");
    expect(code).toMatch(/try \{ body = await res\.json\(\); \} catch \{ return holdForReview\(/);
  });

  it('states the three-part rule in the lede, the meta description, the sample answer and its own section', () => {
    expect(docsText).toContain('Proceed only when <b>status is proven</b>, <b>level is verified</b>, and you passed <b>expect</b>.');
    expect(docsText).toMatch(/<meta name="description" content="[^"]*Proceed only when status is proven, level is verified, and you passed expect\./);
    expect(docs).toContain('// proceed only if status is "proven" AND level is "verified" AND you passed expect');
    expect(docsText).toContain('The rule: proceed only when all three hold');
    expect(docsText).toContain('Status alone is not enough today.');
  });

  it('defines expect as coming from your own records, never from the invoice', () => {
    const call = section('The call');
    expect(call).toContain('never from the invoice, message or page that supplied the address');
    expect(call).not.toMatch(/taken from[^.]*\binvoice you were expecting/);
    expect(call).toContain('expect also matches any subdomain of it');
    expect(call).toMatch(/never pass a processor, hosting or platform domain/);
  });

  it('reads mismatch with domain null as "hold and ask the payee", not fraud', () => {
    expect(docsText).toMatch(/If domain is null, [^"]*That is not fraud[^"]*Hold and ask the payee/);
  });

  it('treats level claimed as not verified for payments', () => {
    expect(docsText).toContain("code: 'proven + claimed'");
    expect(docsText).toContain('Treat it as not verified for payments');
  });

  it('holds and escalates a verified mismatch as a discrepancy, without calling it confirmed fraud', () => {
    expect(docsText).toMatch(/code: 'mismatch \+ verified'[^\]]*consistent with a swapped invoice[^\]]*hold the payment, flag it, and escalate to a human\./);
    expect(docsText).toMatch(/code: 'mismatch \+ verified'[^\]]*not as confirmed fraud/);
    expect(docs).not.toMatch(/is the swapped-invoice attack/i);
  });

  it('points payees at Level 2 through the address file, and says what DNS alone does not do', () => {
    const payee = section('If you are the one being paid');
    expect(payee).toContain('Level 2, domain-verified');
    expect(payee).toContain('The file is what makes an address verified.');
    expect(payee).toMatch(/DNS record also proves your domain[^.]*but it lists no addresses/);
    expect(payee).toMatch(/already proved by a self-send is not yet upgraded/);
  });

  it('says the check is proof-only and screens nothing', () => {
    expect(docsText).toContain('does not screen for sanctions or scams');
  });

  it('never tells an agent not to pay: Verify warns and flags, it never stops a payment', () => {
    const forbidden = [
      /\b(do not|don't|never|must not)\s+(pay|send)\b/i,
      /\b(stop|block|halt|reject|refuse|abort|cancel)s?\s+(the |this |a )?(payment|transaction|transfer)/i,
    ];
    for (const re of forbidden) expect(docs).not.toMatch(re);
  });
});

describe('/verify/agents: what verified covers today', () => {
  it('discloses that domain can be the account business-name domain, not re-checked', () => {
    const domain = field('domain');
    expect(domain).toContain("(the account\\'s first), which can differ from the domain that lists the destination");
    expect(domain).toContain('Business-name domains are not re-checked today');
    expect(domain).not.toContain('It vouches for the destination only when level is verified');
    const covers = section('What verified covers today');
    expect(covers).toContain('business-name domains are not re-checked today');
  });

  it('discloses that a payment link is proven on registration, with no ownership proof', () => {
    const covers = section('What verified covers today');
    expect(covers).toContain('registered to an account first, not that the account proved it owns it');
    expect(covers).toContain('not re-checked unless the link is monitored');
    expect(field('level')).toContain('no ownership proof, and no freshness check unless the link is monitored');
    expect(docsText).toMatch(/code: 'proven \+ claimed'[^\]]*for a payment link, it was registered to an account/);
  });

  it('says which lapses read claimed and which read unknown', () => {
    expect(field('level')).toMatch(/A platform listing that goes stale, or an address withdrawn from a listing, reads unknown/);
    expect(docsText).toMatch(/code: 'unknown'[^\]]*never proven, or its listing lapsed or was withdrawn/);
  });
});

describe('/verify/agents: the documented fields match check.ts', () => {
  it('the sample answer shows exactly the keys check.ts returns, in order', () => {
    expect(documentedSampleKeys()).toEqual(responseKeys());
  });

  it('every returned field except v is explained under "Reading the fields"', () => {
    for (const key of responseKeys().filter((k) => k !== 'v')) {
      expect(docs, `field ${key} is not documented`).toContain(`['${key}', `);
    }
  });

  it('documents every status check.ts can return, and both levels', () => {
    const statusExpr = check.match(/const status = ([\s\S]*?);/);
    expect(statusExpr, 'status expression not found in check.ts').not.toBeNull();
    const statuses = [...new Set([...statusExpr![1].matchAll(/'(\w+)'/g)].map((s) => s[1]))];
    expect(statuses.sort()).toEqual(['mismatch', 'proven', 'unknown']);
    for (const s of statuses) expect(docs).toContain(`code: '${s}`);
    for (const level of ['verified', 'claimed']) expect(docs).toContain(`+ ${level}'`);
  });

  it('documents the subdomain rule check.ts applies to expect', () => {
    expect(check).toContain("proving === expect || proving.endsWith('.' + expect)");
    expect(docsText).toContain('expect also matches any subdomain of it');
  });
});

describe('/verify landing: the Agents card reads status with level in every language', () => {
  it('en, es and fr all say an agent proceeds only on proven and verified', () => {
    expect(landing).toContain('one GET returns a status and a level, and an agent proceeds only when the answer is proven and verified.');
    expect(landing).toContain('devuelve un estado y un nivel, y un agente solo sigue adelante si la respuesta es proven y verified.');
    expect(landing).toContain('renvoie un statut et un niveau, et un agent ne poursuit que si la réponse est proven et verified.');
    expect(landing).not.toMatch(/proven, mismatch,? (or|o|ou) unknown/);
  });
});
