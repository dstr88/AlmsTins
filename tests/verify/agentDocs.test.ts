import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * /agentics/docs is the contract payment agents are built against.
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

const docs = read('src/pages/agentics/docs.astro');
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

describe('/agentics/docs: the safe-reading rule', () => {
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

describe('/agentics/docs: what verified covers today', () => {
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

describe('/agentics/docs: the documented fields match check.ts', () => {
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
    expect(landing).toContain('Proceed only when the answer is proven and verified');
    expect(landing).toContain('Sigue adelante solo si la respuesta es proven y verified');
    expect(landing).toContain('Ne poursuivez que si la réponse est proven et verified');
    expect(landing).not.toMatch(/proven, mismatch,? (or|o|ou) unknown/);
  });
});

// ── Your vault, and the copy-paste kit ──────────────────────────────────────────────────────────

describe('/agentics/docs: your vault', () => {
  const vault = () => section('Your vault (optional)');
  const checkLog = read('src/lib/agentVault/checkLog.ts');
  const events = read('src/lib/agentVault/events.ts');
  const entitlements = read('src/lib/agentVault/entitlements.ts');

  /** The keys of the block recordKeyedCheck adds to a keyed answer: the VaultBlock interface. */
  function vaultBlockKeys(): string[] {
    const m = checkLog.match(/export interface VaultBlock \{([\s\S]*?)\n\}/);
    expect(m, 'VaultBlock not found in checkLog.ts').not.toBeNull();
    return [...m![1].matchAll(/^ {2}(\w+)\??:/gm)].map((k) => k[1]);
  }
  /** The members of an `as const` list in events.ts. */
  const listIn = (name: string): string[] => {
    const m = events.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const`));
    expect(m, `${name} not found in events.ts`).not.toBeNull();
    return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };

  it('is on the page, in the contents, and says the field exists only for a call on a key linked to an agent', () => {
    expect(docs).toContain("['vault', 'Your vault']");
    expect(vault()).toContain('every call that carries that key is also written to the agent');
    expect(vault()).toContain('the answer gains one more field, <code>vault</code>');
  });

  it('explains every key of the block the code builds, and the sample shows all of them but reason', () => {
    const keys = vaultBlockKeys();
    expect(keys).toEqual(['cleared', 'answer', 'registry', 'history', 'eventId', 'logged', 'reason']);
    for (const key of keys) expect(docs, `${key} is not explained`).toContain(`['${key}', `);
    const sample = docs.match(/the vault field, on a call with a linked key[\s\S]*?<pre>\{`\{([\s\S]*?)\}`\}<\/pre>/);
    expect(sample, 'the vault sample was not found').not.toBeNull();
    expect([...sample![1].matchAll(/"(\w+)":/g)].map((k) => k[1])).toEqual(keys.filter((k) => k !== 'reason'));
  });

  it('lists every answer and every registry word the ledger can hold, and the one reason', () => {
    for (const a of listIn('VAULT_ANSWERS')) expect(docs, a).toContain(a);
    expect(listIn('VAULT_ANSWERS')).toEqual(['proven', 'consistent-with-history', 'flagged', 'unknown']);
    for (const w of listIn('REGISTRY_VERDICTS')) expect(vault() + docs, w).toContain(w);
    expect(docs).toContain('"answer": "proven",        // "proven" | "consistent-with-history" | "flagged" | "unknown"');
    expect(docs).toContain('"registry": "trusted",     // "trusted" | "flagged" | "pending" | "none"');
    expect(checkLog).toContain("reason?: 'log_limit';");
    expect(docs).toContain('log_limit');
  });

  it('states the plan numbers and the daily limit the code enforces', () => {
    expect(entitlements).toContain('export const FREE_LOGGED_CHECKS_PER_DAY = 5_000;');
    expect(entitlements).toContain('export const FREE_LIMITS: PlanLimits = { bots: 3, addresses: 15, walletsPerBot: 5 };');
    expect(vault()).toContain('3 agents and 15 addresses');
    expect(docs).toContain('The Free plan records 5,000 checks per agent per UTC day');
  });

  it('keeps the public rule as it is: the vault field does not loosen it, and an address outside the registry never clears', () => {
    expect(vault()).toContain('The rule above does not change.');
    expect(vault()).toContain('it does not loosen the public one');
    expect(vault()).toContain('An address that is not in your registry never clears, whatever the public proof says.');
    expect(vault()).toContain('If any part of the field is null, the vault could not be read: treat it as not cleared.');
    expect(vault()).toContain('Hold and escalate to a person whatever is not cleared');
  });

  it('never calls an address safe, only says what cleared means, and says what is and is not recorded', () => {
    expect(docs).toContain('not a statement that it is safe');
    expect(docs).toContain('It is never a statement that an address is safe or legitimate.');
    expect(vault()).toContain('the caller\'s network address kept only as a salted one-way hash');
    expect(vault()).toContain('Calls with no key, and keys not linked to an agent, are never recorded.');
    expect(vault()).toContain('Rows are never edited or removed.');
  });

  it('says plainly what the vault does not see, and what it reads and how often', () => {
    expect(vault()).toContain('A transfer to an address you did not register is not seen');
    expect(vault()).toContain('Once a day');
    expect(vault()).toContain('Ethereum, Polygon and Avalanche');
    expect(vault()).toContain('A payment routed through a swap or a router contract is a transfer to that contract and is not seen.');
    expect(vault()).not.toMatch(/real[- ]time|live feed|as it happens/i);
  });

  it('check.ts names the field in its own header, and returns it only from the spread that is not on an anonymous call', () => {
    expect(check).toContain('its answer gains one more field, `vault`');
    expect(check).toContain('...(vault ? { vault } : {}),');
    expect(check).toContain('if (keyId && !isQrValue) {');
  });
});

describe('/agentics/docs: the copy-paste kit', () => {
  const kit = () => section('Copy and paste');
  /** The code in the <pre> after an <h3>. */
  const block = (title: string): string => {
    const m = docs.match(new RegExp(`<h3>${title}</h3>\\s*<pre>\\{\`([\\s\\S]*?)\`\\}</pre>`));
    expect(m, `${title} block not found`).not.toBeNull();
    // A template literal turns \\ into \ : this is the text a reader copies.
    return m![1].replace(/\\\\/g, '\\');
  };

  it('is on the page and in the contents, and says what a hold is and where the key lives', () => {
    expect(docs).toContain("['kit', 'Copy and paste']");
    expect(kit()).toContain('A hold means your agent flags the payment and asks a person; none of these');
    expect(kit()).toContain('sends anything or decides for you');
    expect(kit()).toContain("Keep your key in an environment variable on your server, out of");
    expect(kit()).toContain("take the payee's domain from your own records");
    expect(docs).toContain('written out in curl, JavaScript and Python under Copy and paste');
  });

  describe('the JavaScript', () => {
    type Reply = { status?: number; body?: unknown; retryAfter?: string; unreadable?: boolean } | Error;
    /** Runs the snippet against a stand-in for fetch; every wait is recorded and skipped. */
    async function run(replies: Reply[], args: [unknown, unknown, unknown?]) {
      const calls: Array<{ url: string; headers: Record<string, string> }> = [];
      const waits: number[] = [];
      const fetchStub = async (url: string, init?: { headers?: Record<string, string> }) => {
        calls.push({ url, headers: init?.headers ?? {} });
        const r = replies.shift();
        if (!r) throw new Error('no reply left');
        if (r instanceof Error) throw r;
        const status = r.status ?? 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          headers: { get: (n: string) => (n.toLowerCase() === 'retry-after' ? r.retryAfter ?? null : null) },
          json: async () => { if (r.unreadable) throw new SyntaxError('Unexpected token'); return r.body; },
        };
      };
      const setTimeoutStub = (fn: () => void, ms: number) => { waits.push(ms); fn(); return 0; };
      const mayProceed = new Function('fetch', 'setTimeout', `${block('JavaScript')}\nreturn mayProceed;`)(fetchStub, setTimeoutStub) as (...a: unknown[]) => Promise<boolean>;
      return { result: await mayProceed(...args), calls, waits };
    }
    const proven = { status: 'proven', level: 'verified', domain: 'acme.com' };

    it('proceeds when the answer is proven, verified and about the payee, or about a subdomain of the payee', async () => {
      expect((await run([{ body: proven }], ['0xabc', 'acme.com'])).result).toBe(true);
      expect((await run([{ body: { ...proven, domain: 'pay.acme.com' } }], ['0xabc', 'ACME.com '])).result).toBe(true);
    });

    it.each([
      ['a mismatch', { status: 'mismatch', level: 'verified', domain: 'other.com' }],
      ['an answer for another business', { ...proven, domain: 'other.com' }],
      ['a look-alike that only ends the same way', { ...proven, domain: 'notacme.com' }],
      ['unanchored', { status: 'unanchored', level: 'claimed', domain: null }],
      ['unknown', { status: 'unknown', level: null, domain: null }],
      ['proven but not verified', { status: 'proven', level: 'claimed', domain: 'acme.com' }],
      ['a status it does not recognize', { status: 'maybe', level: 'verified', domain: 'acme.com' }],
      ['an empty object', {}],
    ])('holds on %s', async (_name, body) => {
      expect((await run([{ body }], ['0xabc', 'acme.com'])).result).toBe(false);
    });

    it('holds, and asks nothing, when it has no domain to expect', async () => {
      for (const d of ['', '   ', null, undefined]) {
        const r = await run([{ body: proven }], ['0xabc', d]);
        expect(r.result, String(d)).toBe(false);
        expect(r.calls, String(d)).toHaveLength(0);
      }
    });

    it('asks with the address and the domain encoded, and sends the key only when it has one', async () => {
      const a = await run([{ body: proven }], ['0xabc&x=1', 'acme.com', 'avk_key']);
      expect(a.calls[0].url).toBe('https://almstins.com/api/verify/check?value=0xabc%26x%3D1&expect=acme.com');
      expect(a.calls[0].headers).toEqual({ Authorization: 'Bearer avk_key' });
      const b = await run([{ body: proven }], ['0xabc', 'acme.com']);
      expect(b.calls[0].headers).toEqual({});
    });

    it('retries a 429 and a 5xx, waiting what the answer asks for, then proceeds on a good answer', async () => {
      const r = await run([{ status: 429, retryAfter: '7' }, { status: 503 }, { body: proven }], ['0xabc', 'acme.com']);
      expect(r.result).toBe(true);
      expect(r.calls).toHaveLength(3);
      expect(r.waits).toEqual([7000, 2000]);
    });

    it('holds after three tries with no answer, and never reads a 5xx as an answer', async () => {
      const r = await run([{ status: 503, body: proven }, { status: 500, body: proven }, { status: 502, body: proven }], ['0xabc', 'acme.com']);
      expect(r.result).toBe(false);
      expect(r.calls).toHaveLength(3);
    });

    it('tries again after a network failure', async () => {
      const r = await run([new Error('connect ECONNRESET'), { body: proven }], ['0xabc', 'acme.com']);
      expect(r.result).toBe(true);
      expect(r.waits).toEqual([1000]);
    });

    it.each([[400], [401], [404]])('holds at once on a %i, without trying again', async (status) => {
      const r = await run([{ status, body: proven }, { body: proven }], ['0xabc', 'acme.com']);
      expect(r.result).toBe(false);
      expect(r.calls).toHaveLength(1);
    });

    it('holds on an answer it cannot read', async () => {
      expect((await run([{ unreadable: true }], ['0xabc', 'acme.com'])).result).toBe(false);
    });
  });

  describe('the Python', () => {
    const hasPython = spawnSync('python3', ['--version']).status === 0;
    const code = () => block('Python');

    it('has the same rule as the JavaScript, in the same order', () => {
      const py = code();
      expect(py).toContain('if not want:');
      expect(py.indexOf('if not want:')).toBeLessThan(py.indexOf('urlopen'));
      expect(py).toContain('urllib.parse.quote(value, safe="")');
      expect(py).toContain('urllib.parse.quote(want, safe="")');
      expect(py).toContain('e.code >= 500 or e.code == 429');
      expect(py).toContain('body.get("status") == "proven" and body.get("level") == "verified"');
      expect(py).toContain('(got == want or got.endswith("." + want))');
      expect(py.trim().endsWith('return False                              # still no answer: hold')).toBe(true);
    });

    it.skipIf(!hasPython)('is valid Python and holds or proceeds exactly as the JavaScript does, against a stand-in for the network', () => {
      const harness = `
${code()}

import io, json as _json, urllib.error as _err, urllib.request as _req

class _Res(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): return False

def _run(replies, *args):
    seen, waits = [], []
    def fake_urlopen(request, timeout=None):
        seen.append(request.full_url)
        r = replies.pop(0)
        if isinstance(r, Exception): raise r
        if isinstance(r, tuple):
            raise _err.HTTPError(request.full_url, r[0], "x", {"Retry-After": r[1]} if len(r) > 1 and r[1] else {}, None)
        return _Res(_json.dumps(r).encode())
    _req.urlopen = fake_urlopen
    globals()["time"].sleep = lambda s: waits.append(s)
    return may_proceed(*args), seen, waits

proven = {"status": "proven", "level": "verified", "domain": "acme.com"}
out = []
out.append(_run([proven], "0xabc", "acme.com")[0] is True)
out.append(_run([dict(proven, domain="pay.acme.com")], "0xabc", " ACME.com ")[0] is True)
out.append(_run([dict(proven, domain="notacme.com")], "0xabc", "acme.com")[0] is False)
out.append(_run([{"status": "mismatch", "level": "verified", "domain": "other.com"}], "0xabc", "acme.com")[0] is False)
out.append(_run([dict(proven, level="claimed")], "0xabc", "acme.com")[0] is False)
out.append(_run([proven], "0xabc", "")[0] is False and True)
r = _run([(429, "7"), (503,), proven], "0xabc", "acme.com")
out.append(r[0] is True and r[2] == [7, 2] and len(r[1]) == 3)
r = _run([(503,), (500,), (502,)], "0xabc", "acme.com")
out.append(r[0] is False and len(r[1]) == 3)
r = _run([(401,), proven], "0xabc", "acme.com")
out.append(r[0] is False and len(r[1]) == 1)
r = _run([_err.URLError("down"), proven], "0xabc", "acme.com")
out.append(r[0] is True and r[2] == [1])
r = _run([proven], "0xabc&x=1", "acme.com")
out.append(r[1][0].endswith("value=0xabc%26x%3D1&expect=acme.com"))
print(_json.dumps(out))
`;
      // The empty-domain case must not call the network at all: it is checked first.
      const res = spawnSync('python3', ['-I', '-c', harness], { encoding: 'utf8' });
      expect(res.stderr, res.stderr).toBe('');
      expect(JSON.parse(res.stdout.trim())).toEqual(Array(11).fill(true));
    });
  });

  describe('the curl and jq', () => {
    const hasJq = spawnSync('jq', ['--version']).status === 0;
    const code = () => block('curl and jq');
    /** The jq program: the single-quoted line after --arg want. */
    const program = () => {
      const m = code().match(/'(\.status == "proven"[^']*)'/);
      expect(m, 'the jq program was not found').not.toBeNull();
      return m![1];
    };

    it('is valid shell, holds when there is no domain, passes the key and encodes both parameters', () => {
      expect(spawnSync('bash', ['-n', '-c', code()], { encoding: 'utf8' }).status).toBe(0);
      expect(code()).toContain('[ -n "$PAYEE_DOMAIN" ] || { echo "hold: no expect"; exit 1; }');
      expect(code()).toContain('--data-urlencode "value=$VALUE" --data-urlencode "expect=$PAYEE_DOMAIN"');
      expect(code()).toContain('-H "Authorization: Bearer $ALMSTINS_KEY"');
      expect(code()).toContain('echo "hold for a person"; exit 1;');
    });

    it.skipIf(!hasJq)('applies the same rule as the other two, to the same answers', () => {
      const decide = (body: unknown, want = 'acme.com') =>
        spawnSync('jq', ['-e', '--arg', 'want', want, program()], { input: JSON.stringify(body), encoding: 'utf8' }).status === 0;
      const proven = { status: 'proven', level: 'verified', domain: 'acme.com' };
      expect(decide(proven)).toBe(true);
      expect(decide({ ...proven, domain: 'pay.acme.com' })).toBe(true);
      expect(decide({ ...proven, domain: 'notacme.com' })).toBe(false);
      expect(decide({ status: 'mismatch', level: 'verified', domain: 'other.com' })).toBe(false);
      expect(decide({ status: 'unanchored', level: 'claimed', domain: null })).toBe(false);
      expect(decide({ status: 'unknown', level: null, domain: null })).toBe(false);
      expect(decide({ ...proven, level: 'claimed' })).toBe(false);
      expect(decide({ error: 'rate limited' })).toBe(false);
      expect(decide({})).toBe(false);
    });
  });
});
