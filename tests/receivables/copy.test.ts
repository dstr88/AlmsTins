import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RESERVED_STATEMENT_PREFIXES, hasReservedPrefix } from '../../src/lib/receivables/attestationClass';
import * as attestCopy from '../../src/lib/receivables/copy/attest';
import * as statusPillCopy from '../../src/lib/receivables/copy/statusPill';
import * as anchorCopy from '../../src/lib/receivables/copy/anchor';
import * as clipboardCopy from '../../src/lib/receivables/copy/clipboard';
import * as claimCopy from '../../src/lib/receivables/copy/claim';
import * as withdrawnCopy from '../../src/lib/receivables/copy/withdrawn';
import * as duplicateCopy from '../../src/lib/receivables/copy/duplicate';
import { BRIGHT_LINE_RULES, brightLineViolations } from '../helpers/brightLineWording';
import { TERMS } from '../../src/lib/verifyTerms';

/**
 * Receivables copy (src/lib/receivables/copy/*) against the shared bright-line helper, plus a
 * canary per rule so a broken pattern cannot pass everything silently. Strings nested in objects
 * and arrays (the per-page copy sets, the diligence methods) are walked and checked too.
 */

const COPY_MODULES: Record<string, Record<string, unknown>> = {
	attest: attestCopy,
	statusPill: statusPillCopy,
	anchor: anchorCopy,
	clipboard: clipboardCopy,
	claim: claimCopy,
	withdrawn: withdrawnCopy,
	duplicate: duplicateCopy,
};

/** Every string in a copy value, with its path. null (a "show nothing" slot) is skipped. */
function* copyStrings(path: string, value: unknown): Generator<[string, string]> {
	if (value === null) return;
	if (typeof value === 'string') { yield [path, value]; return; }
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) yield* copyStrings(`${path}[${i}]`, value[i]);
		return;
	}
	if (typeof value === 'object') {
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) yield* copyStrings(`${path}.${k}`, v);
	}
}

function stringsOf(mods: readonly string[]): Array<[string, string]> {
	const out: Array<[string, string]> = [];
	for (const mod of mods) {
		for (const [name, value] of Object.entries(COPY_MODULES[mod])) out.push(...copyStrings(`copy/${mod}.${name}`, value));
	}
	return out;
}

const ALL_STRINGS = stringsOf(Object.keys(COPY_MODULES));

describe('receivables copy keeps to the bright lines', () => {
	for (const [path, value] of ALL_STRINGS) {
		it(path, () => {
			expect(brightLineViolations(value)).toEqual([]);
		});
	}

	it('the walker sees the nested strings', () => {
		const paths = ALL_STRINGS.map(([p]) => p);
		expect(paths).toContain('copy/anchor.ANCHOR_AFTER_WRITE.registry.unreachable');
		expect(paths).toContain('copy/claim.CLAIM_COPY_DESK.sessionEnded.link');
		expect(paths).toContain('copy/claim.DILIGENCE_METHODS[3][1]');
		expect(paths).not.toContain('copy/anchor.ANCHOR_AFTER_WRITE.desk.unreachable');
	});

	it('every copy export is a string, an array or a plain object, down to string or null leaves', () => {
		const isPlain = (v: unknown) => {
			const proto = Object.getPrototypeOf(v);
			return proto === Object.prototype || proto === null;
		};
		const check = (path: string, value: unknown, top: boolean) => {
			if (typeof value === 'string') return;
			if (value === null && !top) return;
			if (Array.isArray(value)) { value.forEach((v, i) => check(`${path}[${i}]`, v, false)); return; }
			expect(typeof value === 'object' && value !== null && isPlain(value), `${path} is ${typeof value}`).toBe(true);
			for (const [k, v] of Object.entries(value as Record<string, unknown>)) check(`${path}.${k}`, v, false);
		};
		for (const [mod, exports] of Object.entries(COPY_MODULES)) {
			for (const [name, value] of Object.entries(exports)) check(`copy/${mod}.${name}`, value, true);
		}
	});

	it('the reserved_prefix message names every reserved word and passes its own check', () => {
		const msg = attestCopy.RESERVED_PREFIX_MESSAGE;
		for (const p of RESERVED_STATEMENT_PREFIXES) expect(msg).toContain(p.split(' ')[0]);
		// The message quotes the words in capitals mid-sentence; it never opens with one.
		expect(hasReservedPrefix(msg)).toBe(false);
	});
});

describe('claim, status pill, withdrawn and duplicate copy never refuses, rejects, blocks or denies', () => {
	// Stricter than the shared lending rule: no form of these words at all in the claim flow or
	// the pill. The anchor module is left out on purpose ("pending a block" is a Bitcoin block).
	const CLAIM_BAN = /\b(refus|reject|block|den(y|ied))\w*/i;

	for (const [path, value] of stringsOf(['claim', 'statusPill', 'withdrawn', 'duplicate'])) {
		it(path, () => {
			expect(value.match(CLAIM_BAN)?.[0] ?? null).toBeNull();
		});
	}

	for (const canary of [
		'Refused. This would be a duplicate.',
		'The write was rejected before any money moved.',
		'a claim over the unencumbered headroom is blocked',
		'the registry refuses it',
	]) {
		it(`canary: ${canary}`, () => {
			expect(CLAIM_BAN.test(canary)).toBe(true);
		});
	}
});

describe('S2 withdrawn copy', () => {
	for (const [path, value] of stringsOf(['withdrawn'])) {
		it(`${path}: no em dash`, () => {
			expect(value).not.toContain('—');
		});
	}
});

describe('S3 duplicate copy', () => {
	// The registry is a voluntary record: "on record at Almstins" and "recorded as financed", never a
	// claim that an invoice is free of other financing.
	const FREE_OF = /\b(unencumbered|clear of|free of|not financed elsewhere|no other financ)/i;
	for (const [path, value] of stringsOf(['duplicate'])) {
		it(`${path}: no em dash, never says free of financing`, () => {
			expect(value).not.toContain('—');
			expect(value.match(FREE_OF)?.[0] ?? null).toBeNull();
		});
	}

	it('the Verify now row and the collision answer read as planned', () => {
		expect(duplicateCopy.DUPLICATE_CHECK_LABEL).toBe('Duplicate check');
		expect(duplicateCopy.DUPLICATE_DETAIL_FINANCED).toContain('recorded as financed');
		expect(duplicateCopy.ID_COLLISION_MESSAGE).toBe('A receivable with these exact details is already on record at Almstins under another account.');
		expect(duplicateCopy.ID_COLLISION_MESSAGE).not.toMatch(/change at least one field/i);
	});

	it('the wording for an account that is not verified says nothing about financing or which details matched', () => {
		// Owner decision 9: whether a match is financed, and its basis, go only to a verified account.
		for (const line of [duplicateCopy.DUPLICATE_DETAIL_ANY_MATCH, duplicateCopy.POSSIBLE_MATCH_MESSAGE]) {
			expect(line).toMatch(/^Another record at Almstins matches this invoice\./);
			expect(line).not.toMatch(/financ|installment|reference|invoice number/i);
		}
	});
});

describe('copy placeholders', () => {
	const ALLOWED = new Set(['available', 'requested', 'claimed', 'code', 'message', 'detail', 'financier', 'signed', 'day']);

	for (const [path, value] of ALL_STRINGS) {
		const names = [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
		if (!names.length) continue;
		it(path, () => {
			expect(names.filter((n) => !ALLOWED.has(n))).toEqual([]);
		});
	}

	it('the known placeholders are where the flow fills them', () => {
		expect(withdrawnCopy.WITHDRAWN_LEAD_DATED).toContain('{day}');
		expect(withdrawnCopy.WITHDRAWN_WRITE_MESSAGE).toContain('{day}');
		expect(claimCopy.HEADROOM_BODY).toContain('{available}');
		expect(claimCopy.HEADROOM_BODY).toContain('{requested}');
		expect(claimCopy.HEADROOM_BODY).toContain('{claimed}');
		expect(anchorCopy.ANCHOR_PILL_CONFIRMED).toContain('{day}');
	});
});

describe('brightLineWording canaries', () => {
	const canaries: Array<[string, string]> = [
		['never stops a payment', 'Do not pay this invoice.'],
		['never stops a payment', 'This blocks the payment.'],
		['active voice', 'Almstins blocks duplicate claims.'],
		['lending', 'The registry rejects the claim.'],
		['collateral', 'Recording it gives you a lien on the invoice.'],
		['collateral', 'Your interest is perfected once recorded.'],
		['collateral', 'The first claim takes priority.'],
		['collateral', 'You are first in line.'],
		['collateral', 'This is a registered security interest.'],
		['American English', 'We recognise the record.'],
		['American English', 'Receivables tokenisation.'],
		['American English', 'Paid by cheque in two instalments.'],
		['American English', 'The colour of the pill.'],
	];
	for (const [rule, text] of canaries) {
		it(`${rule}: ${text}`, () => {
			expect(brightLineViolations(text).some((v) => v.startsWith(`${rule}:`))).toBe(true);
		});
	}

	it('every rule has a canary', () => {
		const ruled = new Set(BRIGHT_LINE_RULES.map((r) => r.rule));
		for (const rule of ruled) expect(canaries.some(([r]) => r === rule), rule).toBe(true);
		// And every pattern catches at least one canary.
		for (const { rule, pattern } of BRIGHT_LINE_RULES) {
			expect(canaries.some(([, t]) => pattern.test(t)), `${rule} ${pattern}`).toBe(true);
		}
	});

	it('leaves the approved phrasing alone', () => {
		for (const t of [
			'On record at Almstins.',
			'Recorded as financed.',
			'It creates no security interest and has no legal effect.',
			'The color of the pill. Your record. Four claims in an hour.',
		]) expect(brightLineViolations(t), t).toEqual([]);
	});
});

// S1: the desk now offers "Record it anyway", so no page may still describe an over-headroom
// claim as refused. These are the exact phrasings that were on the pages before S1.
describe('no page still says an over-headroom claim is refused', () => {
	const PAGES = [
		'src/pages/verify/faq.astro', 'src/pages/verify/guide.astro', 'src/pages/verify/runsheet.astro',
		'src/lib/verifyTerms.ts', 'src/pages/verify/desk.astro', 'src/pages/verify/registry.astro',
	];
	const OLD = /refused, not warned about|headroom is refused|second advance is refused|My claim was refused|won't let two claims|The write was rejected/i;
	it.each(PAGES)('%s', (p) => {
		const src = readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');
		expect(src).not.toMatch(OLD);
	});
});

describe('S4 duplicate UI copy', () => {
	// Almstins warns, never blocks, and never accuses anyone: "possible duplicate", not a verdict.
	const S4_BAN = /\b(fraud\w*|block\w*|accus\w*|scam\w*|fake|forg(ed|ery))\b/i;
	for (const [path, value] of stringsOf(['duplicate'])) {
		it(`${path}: no accusation, no "blocked"`, () => {
			expect(value.match(S4_BAN)?.[0] ?? null).toBeNull();
		});
	}

	it('the live warning reads as Addendum A committed', () => {
		expect(duplicateCopy.PRECHECK_FINANCED).toBe('This invoice may already be financed. Check with the debtor before you advance.');
		expect(duplicateCopy.PRECHECK_PROCEED).toBe('You can still record it. The decision is yours.');
		expect(duplicateCopy.DUPLICATE_FLAG_TITLE).toBe('Possible duplicate.');
		expect(duplicateCopy.TAG_POSSIBLE_DUPLICATE).toBe('possible duplicate');
	});

	it('the Client Portal lines never give a lender\'s advice or the financed detail', () => {
		for (const line of [duplicateCopy.CLIENT_MATCH, duplicateCopy.CLIENT_RECORD_MATCH]) expect(line).not.toMatch(/financed|before you advance/i);
	});

	it('the book tag and the claim notice say only that another record matches', () => {
		for (const line of [duplicateCopy.TAG_POSSIBLE_DUPLICATE_TITLE, duplicateCopy.CLAIM_NOTICE_POSSIBLE_DUPLICATE]) {
			expect(line).toBe('Another record at Almstins matches this invoice.');
		}
	});
});

describe('glossary (verifyTerms) keeps to the bright lines', () => {
	for (const t of TERMS) {
		it(t.term, () => {
			expect(brightLineViolations(`${t.term} ${t.def}`)).toEqual([]);
		});
	}

	it('S4 adds "Debtor reference" after Debtor and "Possible duplicate" after Headroom, with no em dash', () => {
		const terms = TERMS.map((t) => t.term);
		expect(terms.indexOf('Debtor reference')).toBe(terms.indexOf('Debtor') + 1);
		expect(terms.indexOf('Possible duplicate')).toBe(terms.indexOf('Headroom, or available') + 1);
		for (const key of ['debtor-reference', 'possible-duplicate']) {
			const t = TERMS.find((x) => x.key === key)!;
			expect(t.def).not.toContain('—');
			// "Fingerprint" already means a SHA-256 of a document or record in this glossary.
			expect(t.def).not.toMatch(/fingerprint/i);
		}
		expect(TERMS.find((x) => x.key === 'possible-duplicate')!.def).toMatch(/^A warning, not a finding/);
	});
});

// S3 made the duplicate check real, so no page may still say nothing matches two records.
describe('no page still says duplicates go undetected', () => {
	const PAGES = ['src/pages/verify/desk.astro', 'src/pages/verify/guide.astro', 'src/pages/verify/runsheet.astro', 'src/pages/verify/faq.astro', 'src/lib/verifyTerms.ts'];
	const OLD = /Nothing (yet )?(detects|matches) two records|nothing keys off it|near-duplicate|Change any field and you get|only thing we could ever key duplicate detection/i;
	it.each(PAGES)('%s', (p) => {
		const src = readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');
		expect(src).not.toMatch(OLD);
	});
});

// S4 review: the limits named on the desk, in the guide and in the run sheet must be every gap the
// keys leave (fingerprintNormalize.test.ts pins the keys), not just amount and records elsewhere.
describe('the duplicate check\'s stated limits match its keys', () => {
	const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');
	const SOURCES: Array<[string, string]> = [
		['NOT_PROVEN_DUPLICATE_DETAIL', duplicateCopy.NOT_PROVEN_DUPLICATE_DETAIL],
		['guide', read('src/pages/verify/guide.astro')],
		['run sheet', read('src/pages/verify/runsheet.astro')],
		['changelog', read('src/pages/verify/changelog.astro')],
	];
	it.each(SOURCES)('%s names the debtor-name and reference gaps', (_name, text) => {
		expect(text).toContain('or a debtor named differently, does not match');
		expect(text).toMatch(/\ba client named differently, or a different invoice number, matches only through the same debtor reference/i);
		expect(text).not.toContain('A record with a different amount, or one kept outside Almstins, is not compared.');
	});

	it('the glossary says when a claim asks about a match, so it never promises a signature that is not made', () => {
		const def = TERMS.find((x) => x.key === 'possible-duplicate')!.def;
		expect(def).toContain('on the debtor, your client and the invoice number');
		expect(def).toContain('If registering a claim asks you about the match and you go ahead, that choice is signed into your claim.');
		expect(def).toContain('For a verified account it asks only when the match is recorded as financed.');
		expect(def).not.toContain('If you register a claim anyway');
	});
});

describe('the S4 changelog day', () => {
	const src = readFileSync(fileURLToPath(new URL('../../src/pages/verify/changelog.astro', import.meta.url)), 'utf8');
	// S4 ships on the same day as S2 and S3: its entries open the 2026-10-12 day, above S2's.
	const start = src.indexOf("date: '2026-10-12'");
	const day = src.slice(start, src.indexOf('Deleting a receivable now withdraws it'));

	it('is the top day, with the S4 entries first', () => {
		expect(start).toBeGreaterThan(0);
		expect(src.indexOf("date: '")).toBe(start);
		expect(day).toContain('possible duplicate');
	});

	it('keeps to the bright lines, with no em dash and no accusation', () => {
		expect(day).not.toContain('—');
		expect(brightLineViolations(day)).toEqual([]);
		expect(day).not.toMatch(/\b(fraud\w*|blocked|accus\w*)\b/i);
	});
});
