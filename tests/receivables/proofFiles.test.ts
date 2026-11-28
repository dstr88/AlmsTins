import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PROOF_FILE_HOW_TO_URL, proofFileHref, proofFileRefs, proofFileRows } from '../../src/lib/receivables/proofFileView';
import { proofFilesHtml } from '../../src/components/receivables/ProofFiles/proofFiles';
import * as copy from '../../src/lib/receivables/copy/proofFile';

/**
 * The "Proof files for your records" block: rows only for what the lookup's proofFiles names (the
 * signed-in account's own records), in the order the page shows them, each linking to the
 * owner-only download route. All names and IDs are invented.
 */

const RID = 'ab'.repeat(32);
const rcv = (proofFiles: unknown) => ({
	id: RID,
	proofFiles,
	claims: [
		{ id: 'claim-1', financier: 'Example Lender', statusEvents: [{ id: 'ev-1', kind: 'extended', date: '2026-10-01 09:00:00' }] },
		{ id: 'claim-2', financier: 'Another Lender', statusEvents: [] },
	],
	attestations: [{ id: 'att-1', role: 'buyer', date: '2026-09-20 08:00:00' }],
	reverifications: [{ id: 'rv-1', date: '2026-10-02 11:30:00' }],
});

describe('proofFileRows', () => {
	it('no proofFiles (not signed in, or owns nothing here): no rows', () => {
		expect(proofFileRows(rcv(undefined))).toEqual([]);
		expect(proofFileRows(rcv([]))).toEqual([]);
		expect(proofFileRows(null)).toEqual([]);
	});

	it('names each record and keeps the page order, whatever order proofFiles came in', () => {
		const rows = proofFileRows(rcv([
			{ kind: 'reverification', id: 'rv-1' },
			{ kind: 'claim_discharge', id: 'claim-1' },
			{ kind: 'attestation', id: 'att-1' },
			{ kind: 'status_event', id: 'ev-1' },
			{ kind: 'claim', id: 'claim-1' },
			{ kind: 'settlement', id: RID },
			{ kind: 'receivable', id: RID },
		]));
		expect(rows.map((r) => r.label)).toEqual([
			'The receivable',
			'Marked settled',
			'Claim by Example Lender',
			'Claim by Example Lender, extended on 2026-10-01',
			'Claim by Example Lender, released',
			'Statement by the buyer, 2026-09-20',
			'Verification on 2026-10-02',
		]);
	});

	it('only the records named: a lender sees its own claim, not the other lender\'s', () => {
		const rows = proofFileRows(rcv([{ kind: 'claim', id: 'claim-1' }]));
		expect(rows).toEqual([{ kind: 'claim', id: 'claim-1', label: 'Claim by Example Lender', href: '/api/verify/receivables/proof-file?kind=claim&id=claim-1' }]);
	});

	it('drops malformed entries and keeps a record that is not on screen under its kind', () => {
		expect(proofFileRefs(rcv([{ kind: 'constructor', id: 'x' }, { kind: 'claim' }, null, 'claim:claim-1']))).toEqual([]);
		expect(proofFileRows(rcv([{ kind: 'attestation', id: 'att-gone' }])).map((r) => r.label)).toEqual(['A statement']);
	});

	it('encodes the query', () => {
		expect(proofFileHref('claim', 'a b&c')).toBe('/api/verify/receivables/proof-file?kind=claim&id=a%20b%26c');
	});
});

describe('proofFilesHtml', () => {
	it('is empty when there is nothing of the viewer\'s own to download', () => {
		expect(proofFilesHtml(rcv(undefined))).toBe('');
	});

	it('one download link per row, and the hint links the open-source recipe', () => {
		const html = proofFilesHtml(rcv([{ kind: 'receivable', id: RID }, { kind: 'claim', id: 'claim-1' }]));
		expect(html.match(/class="rcv-proof__dl"/g)).toHaveLength(2);
		expect(html).toContain(`href="/api/verify/receivables/proof-file?kind=receivable&amp;id=${RID}" download`);
		expect(html).toContain('>Download proof file</a>');
		expect(html).toContain(copy.PROOF_FILES_TITLE);
		expect(html).toContain(`href="${PROOF_FILE_HOW_TO_URL}" target="_blank" rel="noopener noreferrer"`);
	});

	it('escapes the self-chosen names', () => {
		const html = proofFilesHtml({ id: RID, proofFiles: [{ kind: 'claim', id: 'c1' }], claims: [{ id: 'c1', financier: '<img src=x onerror=alert(1)>' }] });
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
	});
});

describe('proof file wording', () => {
	it('points only to the script: /verify-record does not read a receivables proof file yet', () => {
		const all = JSON.stringify(copy);
		expect(all).not.toMatch(/verify-record/);
		expect(copy.PROOF_FILES_HINT).toMatch(/open-source script/);
		expect(PROOF_FILE_HOW_TO_URL).toBe('https://github.com/dstr88/AlmsTins/blob/production/docs/verify-without-almstins.md');
	});

	it('the recipe it links to exists in this repository', () => {
		const doc = readFileSync(fileURLToPath(new URL('../../docs/verify-without-almstins.md', import.meta.url)), 'utf8');
		expect(doc).toMatch(/scripts\/verify-record\.mjs/);
	});
});

describe('host pages place the block', () => {
	const page = (p: string) => readFileSync(fileURLToPath(new URL(`../../src/pages/verify/${p}.astro`, import.meta.url)), 'utf8');
	for (const p of ['registry', 'desk', 'client']) {
		it(`${p} imports the shared block and renders it from the looked-up receivable`, () => {
			const src = page(p);
			expect(src).toContain("import { proofFilesHtml } from '@/components/receivables/ProofFiles/proofFiles';");
			expect(src).toMatch(/proofFilesHtml\((rcv|r)\)/);
		});
	}
});
