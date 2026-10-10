import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { isPartyDispute } from '../../src/lib/receivables/attestationClass';
import { ragState, type RagState } from '../../src/lib/receivables/status';
import { hostPath } from '../helpers/receivablesHosts';

/**
 * The registry page's status pill, rag() in the inline script of the registry host page.
 *
 * There is no DOM test environment, so this reads rag() out of the page source and runs it.
 * The table below was pinned against the original function before S0a touched the page; the
 * only intended change since is the disputed branch, which used to read rcv.disputed (never set
 * by the server, so the pill could not appear) and now asks isPartyDispute over the record's
 * attestations. S1 replaces rag() with statusPillHtml; this file then pins the new pill instead.
 */

const PAGE = hostPath('registry');

function loadRag(isPartyDispute: (a: any) => boolean): (rcv: any) => { cls: string; label: string } {
	const src = fs.readFileSync(PAGE, 'utf8');
	const m = src.match(/function rag\(rcv: any\) \{[\s\S]*?\n {4}\}\n/);
	if (!m) throw new Error('rag() not found in registry.astro');
	// The page script is TypeScript; its only annotations here are `: any`.
	const js = m[0].replace(/: any\b/g, '');
	// eslint-disable-next-line no-new-func
	return new Function('isPartyDispute', `${js}\nreturn rag;`)(isPartyDispute);
}

// Every attestation counts as a dispute only when the predicate says so, so this table pins
// rag()'s own ordering independent of how disputes are classified.
const neverDisputed = () => false;

describe('registry.astro rag(): pill per record state', () => {
	const rag = loadRag(neverDisputed);
	const base = { isTest: false, settled: false, status: 'unfinanced', attestations: [] };

	const cases: Array<[string, Record<string, unknown>, string, string]> = [
		['open', {}, 'rag-open', 'Available to finance'],
		['partial', { status: 'partially_financed' }, 'rag-partial', 'Partially encumbered'],
		['full', { status: 'fully_financed' }, 'rag-full', 'Fully encumbered'],
		['over reads full', { status: 'over_financed' }, 'rag-full', 'Fully encumbered'],
		['settled beats financing', { settled: true, status: 'fully_financed' }, 'rag-settled', 'Settled / paid'],
		['test beats everything', { isTest: true, settled: true, status: 'over_financed' }, 'rag-test', 'TEST RECORD — not a real receivable'],
	];
	for (const [name, over, cls, label] of cases) {
		it(name, () => {
			expect(rag({ ...base, ...over })).toEqual({ cls, label });
		});
	}
});

describe('registry.astro rag(): the Disputed pill (S0a fix)', () => {
	const rag = loadRag(isPartyDispute);
	const base = { isTest: false, settled: false, status: 'partially_financed' };

	it('shows when a party disputed, classified by the lookup', () => {
		const rcv = { ...base, attestations: [{ class: 'party_dispute', role: 'other', statement: 'DISPUTED — states no money was received.' }] };
		expect(rag(rcv)).toEqual({ cls: 'rag-disputed', label: '⚠ Disputed' });
	});

	it('shows for a legacy dispute from an older lookup answer with no class', () => {
		const rcv = { ...base, attestations: [{ role: 'other', statement: 'DISPUTED — states this invoice is not theirs.' }] };
		expect(rag(rcv).cls).toBe('rag-disputed');
	});

	it('does not show for a typed statement the server classed as a party statement', () => {
		const rcv = { ...base, attestations: [{ class: 'party_statement', role: 'other', statement: 'DISPUTED — typed by hand.' }] };
		expect(rag(rcv).cls).toBe('rag-partial');
	});

	it('a test record still reads TEST first', () => {
		const rcv = { ...base, isTest: true, attestations: [{ class: 'party_dispute' }] };
		expect(rag(rcv).cls).toBe('rag-test');
	});

	it('the page imports isPartyDispute once, from the shared module', () => {
		const src = fs.readFileSync(PAGE, 'utf8');
		expect(src.match(/import \{ isPartyDispute \} from '@\/lib\/receivables\/attestationClass';/g)).toHaveLength(1);
		expect(src).not.toContain('rcv.disputed');
	});
});

describe('ragState (status.ts) matches the page rag() for every state', () => {
	const rag = loadRag(isPartyDispute);
	const CLS: Record<RagState, string> = {
		test: 'rag-test', disputed: 'rag-disputed', settled: 'rag-settled',
		partial: 'rag-partial', full: 'rag-full', open: 'rag-open',
	};
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
						expect(rag(rcv).cls, `test=${isTest} settled=${settled} ${status} attestations#${i}`).toBe(CLS[ragState(rcv)]);
						n++;
					});
				}
			}
		}
		expect(n).toBe(80);
	});
});
