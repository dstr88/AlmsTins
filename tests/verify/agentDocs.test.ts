import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * /verify/agents is the contract payment agents are built against.
 *
 * C5/S7b: /api/verify/check now derives `status` from `level` first — `proven` and
 * `mismatch` only ever come back with level `verified`, `unanchored` always comes with
 * level `claimed`, `unknown` always with level `null` — and `domain` is always the domain
 * that actually anchors the destination (or null), never the account's business name on
 * its own. `unanchored` replaces the old compound "proven + claimed" / "mismatch +
 * claimed" answers a stale anchor or a self-send-only wallet used to produce. These
 * source checks pin the rule, the hold/flag/escalate wording, the status/level pairing,
 * and the documented fields against what check.ts actually returns.
 *
 * The remaining caveat — a payment link's `domain` is the account's business name, not a
 * proof specific to that link — describes real, current behavior (verifyEntities.ts
 * lookupVerifiedUrl). Update it and this file together when links get their own anchor.
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
  const m = docs.match(new RegExp(`\\['${name}', '((?:[^'\\\\]|\\\\.)*)'\\]`))
    ?? docs.match(new RegExp(`\\['${name}', "((?:[^"\\\\]|\\\\.)*)"\\]`));
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
  });

  it('explains that status already implies level, and checking level is belt-and-suspenders, not a hedge', () => {
    expect(docsText).toContain('proven and mismatch already only ever');
    expect(docsText).toMatch(/come back with level <b>verified<\/b>[^.]*protects your\s*agent against a future bug/);
  });

  it('defines expect as coming from your own records, never from the invoice', () => {
    const call = section('The call');
    expect(call).toContain('never from the invoice, message or page that supplied the address');
    expect(call).not.toMatch(/taken from[^.]*\binvoice you were expecting/);
    expect(call).toContain('expect also matches any subdomain of it');
    expect(call).toMatch(/never pass a processor, hosting or platform domain/);
  });

  it('treats unanchored as not verified for payments, distinct from mismatch', () => {
    expect(docsText).toContain("code: 'unanchored'");
    expect(docsText).toMatch(/unanchored[\s\S]{0,20}Something is on record, but no domain currently vouches for it/);
    expect(docsText).toContain('Not fraud: a payee who has not reached Level 2');
  });

  it('holds and escalates a verified mismatch as a discrepancy, without calling it confirmed fraud', () => {
    expect(docsText).toMatch(/code: 'mismatch'[\s\S]*?Hold the payment, flag it, and escalate to a human as a discrepancy/);
    expect(docsText).toMatch(/code: 'mismatch'[\s\S]*?not as confirmed fraud/);
    expect(docs).not.toMatch(/is the swapped-invoice attack/i);
  });

  it('points payees at Level 2 through the address file, and says what DNS alone does not do', () => {
    const payee = section('If you are the one being paid');
    expect(payee).toContain('Level 2, domain-verified');
    expect(payee).toContain('The file is what makes an address verified.');
    expect(payee).toMatch(/DNS record also proves your domain[^.]*but it lists no addresses/);
    // A self-send-proven address listed in the file is anchored to the domain (verified), and
    // drops back to claimed, keeping its self-send, when the file stops listing it.
    expect(payee).toContain('already proved by a self-send becomes verified once you list it in the file and verify the domain, and goes back to claimed if the file stops listing it.');
    expect(payee).toContain('it answers <b>unanchored</b>');
    expect(payee).not.toMatch(/it answers <b>claimed<\/b>/);
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
  it('domain is always what actually anchors the destination, never the business name alone', () => {
    const domain = field('domain');
    expect(domain).toContain('The domain that actually vouches for this destination right now');
    expect(domain).toContain("Never the payee's business name on its own");
    expect(domain).not.toContain('can differ from the domain that lists the destination');
    expect(domain).not.toContain('not re-checked today');
    const covers = section('What verified covers today');
    expect(covers).toContain('Always the domain that actually anchors the destination');
  });

  it('discloses that a payment link is proven on registration, weaker than an address, no link-specific ownership proof', () => {
    const covers = section('What verified covers today');
    expect(covers).toContain('Weaker today');
    expect(covers).toContain('not a proof that this exact link belongs to them');
    expect(field('level')).toContain('no ownership proof specific to the link, and no freshness check unless the link is monitored');
  });

  it('says which lapses read unanchored and which read unknown', () => {
    // An address removed from its listing keeps a self-send proof (unanchored) if it had
    // one; if the listing was its only proof, it lapses (unknown). decideAnchorLoss.
    const covers = section('What verified covers today');
    expect(covers).toContain('reads unanchored if a self-send also proved it, and unknown if the file was its only proof');
    expect(covers).toContain('A list that goes stale reads unknown, not unanchored.');
    expect(docsText).toMatch(/code: 'unknown'[\s\S]*?never proven, or the listing that was its only proof lapsed or was withdrawn/);
  });

  it('says since follows level: a verified address dates from its listing, not an older self-send', () => {
    // merchantAddressAssurance: verified → domain_anchored_at; claimed → proven_at.
    const since = field('since');
    expect(since).toContain('For a verified crypto address, the date its listing on a proven domain was first confirmed, never an older self-send date; for a claimed one, the date control was proven.');
    expect(since).toContain('It follows level');
    expect(field('proofAgeDays')).toContain('proofAgeDays can jump when level changes');
    expect(since).not.toMatch(/^The date the destination was proven/);
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

  it('documents every status check.ts can return, and both levels, with the pairing stated', () => {
    const statusExpr = check.match(/const status =([\s\S]*?);/);
    expect(statusExpr, 'status expression not found in check.ts').not.toBeNull();
    // 'verified' also appears in this expression (a level comparison, not a status), so
    // it and its 'claimed' counterpart are excluded from the status set on purpose.
    const statuses = [...new Set([...statusExpr![1].matchAll(/'(\w+)'/g)].map((s) => s[1]))]
      .filter((s) => s !== 'verified' && s !== 'claimed');
    expect(statuses.sort()).toEqual(['mismatch', 'proven', 'unanchored', 'unknown']);
    for (const s of statuses) expect(docs).toContain(`code: '${s}'`);
    for (const level of ['verified', 'claimed']) expect(docs).toContain(`level ${level}`);
    // The pairing itself, not just that both words appear somewhere.
    expect(field('status')).toContain('proven and mismatch always come with level verified');
    expect(field('status')).toContain('unanchored always comes with level claimed');
    expect(field('status')).toContain('unknown always with level null');
  });

  it('documents the subdomain rule check.ts applies to expect', () => {
    expect(check).toContain("proving === expect || proving.endsWith('.' + expect)");
    expect(docsText).toContain('expect also matches any subdomain of it');
  });

  it('check.ts gates status on level before matching domain — the actual C5 fix', () => {
    // Guards against the exact bug this rewrite closed: status coming from the domain
    // match alone, so a stale/claimed hit could still read 'proven'.
    expect(check).toMatch(/hit\.level !== 'verified' \? 'unanchored'/);
    expect(check).toContain("domain: anchored ? provingDomain : null");
  });

  it('label is only ever returned alongside proven or mismatch, and only when it derives from domain', () => {
    expect(check).toMatch(/const label = anchored && provingDomain \? displayableName\(/);
    expect(field('label')).toContain('shown only alongside a proven or mismatch answer');
    expect(field('label')).toContain('only when it derives from domain');
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
