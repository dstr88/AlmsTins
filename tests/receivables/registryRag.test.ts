import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ragState, type RagState } from '../../src/lib/receivables/status';
import { recordPill, statusPillHtml } from '../../src/components/receivables/StatusPill/statusPill';
import { hostPath } from '../helpers/receivablesHosts';

/**
 * The registry status pill, now statusPillHtml(recordPill(rcv)). The frozen table below is the
 * old page rag() output, pinned before S1 removed it; the pill must keep every label and tone.
 *
 * Before S1 this file read rag() out of the registry page source and ran it. S1 moved the pill to
 * components/receivables/StatusPill, so the old function's output now lives here as a frozen
 * oracle, and every state the old function could reach is checked against the new markup.
 */

/** rag() as it stood on the registry page before S1 (registry.astro, base 61ae9634). Frozen. */
const OLD: Record<RagState, { cls: string; label: string }> = {
	test: { cls: 'rag-test', label: 'TEST RECORD — not a real receivable' },
	disputed: { cls: 'rag-disputed', label: '⚠ Disputed' },
	settled: { cls: 'rag-settled', label: 'Settled / paid' },
	partial: { cls: 'rag-partial', label: 'Partially encumbered' },
	full: { cls: 'rag-full', label: 'Fully encumbered' },
	open: { cls: 'rag-open', label: 'Available to finance' },
};

/** The tone each old .rag-* class read (registry.astro L106-119 before S1). Frozen. */
const TONE: Record<RagState, 'gain' | 'caution' | 'loss' | 'accent'> = {
	open: 'gain', partial: 'caution', full: 'loss', settled: 'accent', disputed: 'caution', test: 'caution',
};

const golden = (s: RagState) =>
	'<span class="rcv-pill rcv-pill--record rcv-pill--' + s + '"><span class="rcv-pill__dot"></span>' + OLD[s].label + '</span>';

const pill = (rcv: Parameters<typeof recordPill>[0]) => statusPillHtml(recordPill(rcv));

describe('the frozen oracle', () => {
	it('names every state once, each with the old class for that state', () => {
		const states = Object.keys(OLD).sort();
		expect(states).toEqual(['disputed', 'full', 'open', 'partial', 'settled', 'test']);
		expect(Object.keys(TONE).sort()).toEqual(states);
		for (const s of states as RagState[]) expect(OLD[s].cls).toBe(`rag-${s}`);
	});
});

describe('registry status pill: pill per record state', () => {
	const base = { isTest: false, settled: false, status: 'unfinanced', attestations: [] };

	const cases: Array<[string, Record<string, unknown>, RagState]> = [
		['open', {}, 'open'],
		['partial', { status: 'partially_financed' }, 'partial'],
		['full', { status: 'fully_financed' }, 'full'],
		['over reads full', { status: 'over_financed' }, 'full'],
		['settled beats financing', { settled: true, status: 'fully_financed' }, 'settled'],
		['test beats everything', { isTest: true, settled: true, status: 'over_financed' }, 'test'],
	];
	for (const [name, over, state] of cases) {
		it(name, () => {
			expect(pill({ ...base, ...over })).toBe(golden(state));
		});
	}
});

describe('registry status pill: the Disputed pill', () => {
	const base = { isTest: false, settled: false, status: 'partially_financed' };

	it('shows when a party disputed, classified by the lookup', () => {
		const rcv = { ...base, attestations: [{ class: 'party_dispute', role: 'other', statement: 'DISPUTED — states no money was received.' }] };
		expect(pill(rcv)).toBe(golden('disputed'));
	});

	it('shows for a legacy dispute from an older lookup answer with no class', () => {
		const rcv = { ...base, attestations: [{ role: 'other', statement: 'DISPUTED — states this invoice is not theirs.' }] };
		expect(pill(rcv)).toBe(golden('disputed'));
	});

	it('does not show for a typed statement the server classed as a party statement', () => {
		const rcv = { ...base, attestations: [{ class: 'party_statement', role: 'other', statement: 'DISPUTED — typed by hand.' }] };
		expect(pill(rcv)).toBe(golden('partial'));
	});

	it('a test record still reads TEST first', () => {
		const rcv = { ...base, isTest: true, attestations: [{ class: 'party_dispute' }] };
		expect(pill(rcv)).toBe(golden('test'));
	});
});

// S2: the lookup's additive withdrawn key never changes the record pill. A withdrawn record that is
// disputed or fully financed is the one a second financier must see as such at a glance, so the pill
// keeps the old rag() answer and the "withdrawn" tag shows beside it (WithdrawnNote).
describe('registry status pill on a withdrawn record (S2)', () => {
	const withdrawn = { withdrawn: true, withdrawnAt: '2026-10-12 09:30:00' };
	const base = { isTest: false, settled: false, status: 'partially_financed', attestations: [] as Array<{ class?: string }> };

	it('fully financed still reads the red Fully financed pill', () => {
		expect(pill({ ...base, ...withdrawn, status: 'fully_financed' })).toBe(golden('full'));
		expect(pill({ ...base, ...withdrawn, status: 'over_financed' })).toBe(golden('full'));
	});

	it('a dispute still reads Disputed, even when settled', () => {
		expect(pill({ ...base, ...withdrawn, settled: true, attestations: [{ class: 'party_dispute' }] })).toBe(golden('disputed'));
	});

	it('partly financed, settled and open read as they did', () => {
		expect(pill({ ...base, ...withdrawn })).toBe(golden('partial'));
		expect(pill({ ...base, ...withdrawn, settled: true })).toBe(golden('settled'));
		expect(pill({ ...base, ...withdrawn, status: 'unfinanced' })).toBe(golden('open'));
	});

	it('a test record still reads TEST first', () => {
		expect(pill({ ...base, ...withdrawn, isTest: true })).toBe(golden('test'));
	});

	it('no record pill is ever the withdrawn one', () => {
		expect(pill({ ...base, ...withdrawn })).not.toContain('withdrawn');
	});
});

describe('registry status pill matches the old rag() for every state', () => {
	const statuses = ['unfinanced', 'partially_financed', 'fully_financed', 'over_financed'];
	const attestationSets = [
		[],
		[{ class: 'party_dispute' }],
		[{ class: 'consent', role: 'buyer' }],
		[{ role: 'other', statement: 'DISPUTED — legacy.' }],
		[{ class: 'party_statement', statement: 'DISPUTED — forged.' }],
	];
	it('across test, settled, every financing status and dispute shape', () => {
		let n = 0;
		for (const isTest of [false, true]) {
			for (const settled of [false, true]) {
				for (const status of statuses) {
					attestationSets.forEach((attestations, i) => {
						const rcv = { isTest, settled, status, attestations };
						expect(pill(rcv), `test=${isTest} settled=${settled} ${status} attestations#${i}`).toBe(golden(ragState(rcv)));
						n++;
					});
				}
			}
		}
		expect(n).toBe(80);
	});
});

describe('source pins: the hosts render the shared pill', () => {
	const read = (p: string) => fs.readFileSync(p, 'utf8');
	const count = (s: string, needle: string) => s.split(needle).length - 1;

	it('registry.astro: rag() and its CSS are gone; the pill comes from statusPillHtml once', () => {
		const src = read(hostPath('registry'));
		expect(src).not.toContain('function rag(');
		expect(src).not.toContain('class="rag');
		expect(src).not.toMatch(/\.rag[ -]/);
		expect(src).not.toContain('rcv.disputed');
		expect(src).not.toContain('isPartyDispute');
		expect(count(src, 'statusPillHtml(recordPill(rcv))')).toBe(1);
	});

	it('client.astro: no tpill; the test tag comes from statusPillHtml once', () => {
		const src = read(hostPath('client'));
		expect(src).not.toContain('tpill');
		expect(count(src, "statusPillHtml({ kind: 'tag'")).toBe(1);
	});

	it('desk.astro: no tpill; the test and claimed-only tags come from statusPillHtml twice', () => {
		const src = read(hostPath('desk'));
		expect(src).not.toContain('tpill');
		expect(count(src, "statusPillHtml({ kind: 'tag'")).toBe(2);
		expect(src).toContain("statusPillHtml({ kind: 'tag', tag: 'test' })");
		expect(src).toContain("statusPillHtml({ kind: 'tag', tag: 'claimed_only' })");
	});
});

describe('StatusPill.css keeps each state on its old tone', () => {
	const css = fs.readFileSync(fileURLToPath(new URL('../../src/components/receivables/StatusPill/StatusPill.css', import.meta.url)), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '');
	const VARS: Record<(typeof TONE)[RagState], { fg: string; bg: string; border: string }> = {
		gain: { fg: '--rcv-gain', bg: '--rcv-gain-bg', border: '--rcv-gain-border' },
		caution: { fg: '--rcv-caution', bg: '--rcv-caution-bg', border: '--rcv-caution-border' },
		loss: { fg: '--rcv-loss', bg: '--rcv-loss-bg', border: '--rcv-loss-border' },
		accent: { fg: '--accent', bg: '--accent-soft', border: '--accent-glow' },
	};
	const decls = (selector: string): Record<string, string> | null => {
		const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
		const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`).exec(css);
		if (!m) return null;
		return Object.fromEntries(m[1].split(';').map((d) => d.trim()).filter(Boolean)
			.map((d) => { const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; }));
	};

	for (const s of Object.keys(TONE) as RagState[]) {
		it(`${s} reads the ${TONE[s]} tone`, () => {
			const v = VARS[TONE[s]];
			expect(decls(`.rcv-pill.rcv-pill--record.rcv-pill--${s}`)).toEqual({
				color: `var(${v.fg})`, background: `var(${v.bg})`, 'border-color': `var(${v.border})`,
			});
			const dot = decls(`.rcv-pill--${s} .rcv-pill__dot`);
			if (s === 'test') expect(dot).toBeNull();
			else expect(dot).toEqual({ background: `var(${v.fg})`, 'box-shadow': `0 0 0 3px var(${v.bg})` });
		});
	}

	it('has no withdrawn record pill rule (S2 shows withdrawn as a tag)', () => {
		expect(css).not.toMatch(/rcv-pill--withdrawn/);
	});

	it('has no .rcv-pill--test .rcv-pill__dot rule (the test pill keeps an empty dot slot)', () => {
		expect(css).not.toMatch(/\.rcv-pill--test\s+\.rcv-pill__dot/);
	});
});
