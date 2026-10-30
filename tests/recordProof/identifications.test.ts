/**
 * The lot identifications that travel with a signed Year-Summary record
 * (src/lib/recordProof/identifications.ts, buildProof.ts).
 *
 *   - A record made with no identifications is exactly what it was: no new manifest field.
 *   - With identifications, the signed manifest carries a root over their references and a count, and the
 *     bundle carries the references and each batch's Bitcoin timestamp.
 *   - References are PII-free: no wallet key, address, note or tenant id.
 *   - Changing any reference changes the signed root; the bundle still verifies as a whole.
 *   - A reference's inclusion path reproduces its batch root.
 *
 * Invented ids and wallet keys.
 */

import { describe, expect, it } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
ed.hashes.sha512 = sha512;

import { buildRecordProof, type ProofBundle } from '../../src/lib/recordProof/buildProof';
import { buildIdentificationSection, walletTag, type YearIdentifications } from '../../src/lib/recordProof/identifications';
import { verifyBundle } from '../../src/lib/recordProof/verify';
import { getPublicKeyHex, getSigningKeyId } from '../../src/lib/recordProof/signing';
import { verifyInclusionProof } from '../../src/lib/recordProof/merkle';
import type { AnnualBreakdown } from '../../src/lib/annualBreakdown';
import type { LotIdentification } from '../../src/lib/tax/lotIdentification';
import type { StampRow } from '../../src/lib/lotIdentificationStamp';

const GEN = '2026-02-01T00:00:00.000Z';
const WALLET = 'ethereum:0x' + 'c'.repeat(40);

const bd = (): AnnualBreakdown => ({
	year: 2025, availableYears: [2025],
	needsAttention: [], stillHolding: [], income: [], cardRebates: [], nftHoldings: [],
	shortTerm: [{ asset: 'ETH', amount: 1, buyDate: '2025-01-10', sellDate: '2025-04-10', costUsd: 1000, proceedsUsd: 2000, gainLossUsd: 1000, daysHeld: 90, basisSource: 'recorded' }],
	longTerm: [],
	totals: { unsettledProceeds: 0, shortTermGain: 1000, longTermGain: 0, totalIncome: 0, heldCostBasis: 0 },
	dataSource: 'lifecycle',
});

const entry = (id: string, walletKey: string, note: string | null = null): LotIdentification => ({
	id, walletKey, method: 'highest_basis', effectiveAt: '2025-03-01T10:00:00.000Z', createdAt: '2025-03-01T10:00:00.000Z', note, batchId: 'batch-1',
});

const stamp = (over: Partial<StampRow> = {}): StampRow => ({
	batchId: 'batch-1', entryIds: [], rootHex: '', status: 'pending', otsBase64: 'cGVuZGluZw==', calendar: 'https://a.pool.opentimestamps.org',
	blockHeight: null, blockTime: null, attempts: 1, lastAttemptAt: null, createdAt: GEN, ...over,
});

const ids = (entries: LotIdentification[]): YearIdentifications => ({ entries, stamps: [stamp()], covered: 1, total: 2 });

describe('the manifest and bundle', () => {
	it('adds nothing when no identification was recorded', () => {
		const plain = buildRecordProof('tenant-1', 2025, bd(), null, GEN);
		const empty = buildRecordProof('tenant-1', 2025, bd(), null, GEN, { entries: [], stamps: [], covered: 0, total: 1 });
		for (const p of [plain, empty]) {
			expect(p.identifications).toBeUndefined();
			expect(Object.keys(p.manifest)).not.toContain('identifications_root');
			expect(Object.keys(p.manifest)).not.toContain('identification_count');
		}
		expect(empty.manifest.merkle_root).toBe(plain.manifest.merkle_root);
	});

	it('commits to the references in the manifest and carries them in the bundle', () => {
		const p = buildRecordProof('tenant-1', 2025, bd(), null, GEN, ids([entry('e1', WALLET, 'standing order'), entry('e2', 'cex:coinbase:acct-a')]));
		expect(p.manifest.identification_count).toBe(2);
		expect(p.manifest.identification_sales).toEqual({ covered: 1, total: 2 });
		expect(p.manifest.identifications_root).toMatch(/^[0-9a-f]{64}$/);
		expect(p.identifications?.refs).toHaveLength(2);
		expect(p.identifications?.batches).toEqual([expect.objectContaining({ batch_id: 'batch-1', status: 'pending', ots_base64: 'cGVuZGluZw==' })]);
	});

	it('is PII-free: no wallet key, address, note or tenant id anywhere in the manifest or the references', () => {
		const p = buildRecordProof('tenant-secret-9', 2025, bd(), null, GEN, ids([entry('e1', WALLET, 'call the exchange on Monday')]));
		const text = JSON.stringify({ m: p.manifest, i: p.identifications });
		expect(text).not.toContain('0x' + 'c'.repeat(40));
		expect(text).not.toContain(WALLET);
		expect(text).not.toContain('call the exchange');
		expect(text).not.toContain('tenant-secret-9');
		expect(p.identifications!.refs[0].wallet_tag).toBe(walletTag('tenant-secret-9', WALLET));
		expect(p.identifications!.refs[0].wallet_tag).toMatch(/^wt-[0-9a-f]{24}$/);
	});

	it('the wallet tag differs by tenant and by wallet', () => {
		expect(walletTag('a', WALLET)).not.toBe(walletTag('b', WALLET));
		expect(walletTag('a', WALLET)).not.toBe(walletTag('a', 'ethereum:0x' + 'd'.repeat(40)));
	});

	it('the root is the same whatever order the entries arrive in, and changes if a reference changes', () => {
		const a = entry('e1', WALLET);
		const b = entry('e2', 'cex:coinbase:acct-a');
		const r1 = buildIdentificationSection('t', ids([a, b]))!;
		const r2 = buildIdentificationSection('t', ids([b, a]))!;
		expect(r1.root).toBe(r2.root);
		const r3 = buildIdentificationSection('t', ids([{ ...a, method: 'latest' }, b]))!;
		expect(r3.root).not.toBe(r1.root);
		// a change of timestamp status alone is not part of the signed root
		const r4 = buildIdentificationSection('t', { ...ids([a, b]), stamps: [stamp({ status: 'confirmed', blockHeight: 850_000 })] })!;
		expect(r4.root).toBe(r1.root);
	});

	it('each reference\'s path reproduces its batch root', () => {
		const section = buildIdentificationSection('t', ids([entry('e1', WALLET), entry('e2', 'cex:coinbase:acct-a'), entry('e3', 'polygon:0x' + 'c'.repeat(40))]))!.section;
		const root = section.batches[0].batch_root;
		expect(section.refs).toHaveLength(3);
		for (const ref of section.refs) expect(verifyInclusionProof(Buffer.from(ref.entry_leaf_hash, 'hex'), ref.inclusion, root)).toBe(true);
	});

	it('returns nothing for no entries', () => {
		expect(buildIdentificationSection('t', ids([]))).toBeNull();
	});
});

describe('a signed record with identifications', () => {
	const seedB64 = Buffer.from(ed.utils.randomSecretKey()).toString('base64');

	it('verifies as a whole, and the signature covers the identification root', () => {
		process.env.ALMSTINS_SIGNING_KEY = seedB64;
		try {
			const p: ProofBundle = buildRecordProof('tenant-1', 2025, bd(), null, GEN, ids([entry('e1', WALLET)]));
			const keys = [{ key_id: getSigningKeyId()!, public_key_hex: getPublicKeyHex()! }];
			expect(verifyBundle(p, keys).verdict).toBe('verified');
			const tampered = { ...p, manifest: { ...p.manifest, identifications_root: 'f'.repeat(64) } };
			expect(verifyBundle(tampered, keys).verdict).toBe('tampered');
		} finally {
			delete process.env.ALMSTINS_SIGNING_KEY;
		}
	});
});
