import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import {
	TRANSPORT_DOC_COMMIT_DOMAIN, checkTransportDocNumber, commitTransportDocNumber, commitmentText, openOwnerCopy, sealOwnerCopy,
} from '../../src/lib/receivables/server/transportDocCommit';
import { normalizeTransportDoc, readStoredTransportDoc, transportDocAnswerOf, transportDocNumberOf } from '../../src/lib/receivables/transportDoc';
import { hasCheckableTransportDoc, transportDocFact } from '../../src/lib/receivables/transportDocView';

/**
 * The transport document number as a keyed commitment (server/transportDocCommit.ts): never
 * readable in a record, bound to the invoice, checkable with a yes or no, and still checkable
 * under a retired key.
 */

const F = { supplier: 'Kano Grains Ltd', buyer: 'The Lagos Mills PLC', invoiceNo: 'INV-0042', face: 1234.5, currency: 'ngn', isTest: false };
const key = () => randomBytes(32).toString('hex');
afterEach(() => vi.unstubAllEnvs());

describe('commitmentText', () => {
	it('binds the record\'s invoice fields and the normalized number behind the domain prefix', () => {
		expect(commitmentText(F, 'B/L No. MAEU 0123-456')).toBe(`${TRANSPORT_DOC_COMMIT_DOMAIN}|r|lagosmills|kanograins|42|NGN|123450|MAEU0123456`);
		expect(commitmentText({ ...F, isTest: true }, 'X1')!.split('|')[1]).toBe('t');
		expect(commitmentText(F, '  --  ')).toBeNull();
	});
});

describe('commit and check', () => {
	it('is HMAC-SHA256 of the text under the current key, with a tdc1 kid', () => {
		const k = key();
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', k);
		const c = commitTransportDocNumber(F, 'MAEU0123456')!;
		expect(c.kid).toMatch(/^tdc1-[0-9a-f]{12}$/);
		expect(c.mac).toBe(createHmac('sha256', Buffer.from(k, 'hex')).update(commitmentText(F, 'MAEU0123456')!, 'utf8').digest('hex'));
	});

	it('typing differences check true, another number false, another invoice false', () => {
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', key());
		const c = commitTransportDocNumber(F, 'B/L No. MAEU 0123-456');
		expect(checkTransportDocNumber(F, c, 'maeu0123456')).toBe(true);
		expect(checkTransportDocNumber(F, c, 'MAEU0123457')).toBe(false);
		expect(checkTransportDocNumber({ ...F, invoiceNo: 'INV-43' }, c, 'MAEU0123456')).toBe(false);
	});

	it('no key: no commitment; an unknown kid or a malformed commitment: null, never false', () => {
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
		expect(commitTransportDocNumber(F, 'MAEU0123456')).toBeNull();
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', key());
		expect(checkTransportDocNumber(F, { kid: 'tdc1-000000000000', mac: 'a'.repeat(64) }, 'X1')).toBeNull();
		expect(checkTransportDocNumber(F, { kid: 'x' }, 'X1')).toBeNull();
		expect(checkTransportDocNumber(F, null, 'X1')).toBeNull();
	});

	it('a commitment under a retired key stays checkable once that key is listed', () => {
		const old = key();
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', old);
		const c = commitTransportDocNumber(F, 'MAEU0123456');
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', key());
		expect(checkTransportDocNumber(F, c, 'MAEU0123456')).toBeNull();
		vi.stubEnv('RECEIVABLES_FINGERPRINT_RETIRED_KEYS', `${key()}, ${old}`);
		expect(checkTransportDocNumber(F, c, 'MAEU0123456')).toBe(true);
	});
});

describe('the owner\'s copy', () => {
	it('round-trips under VERIFY_ENTITY_SECRET and is null without it', () => {
		vi.stubEnv('VERIFY_ENTITY_SECRET', key());
		const blob = sealOwnerCopy('MAEU 0123-456')!;
		expect(blob).not.toContain('MAEU');
		expect(openOwnerCopy(blob)).toBe('MAEU 0123-456');
		vi.stubEnv('VERIFY_ENTITY_SECRET', '');
		expect(sealOwnerCopy('X')).toBeNull();
		expect(openOwnerCopy(blob)).toBeNull();
	});
});

describe('answers: as sent and as stored', () => {
	const STORED = { answer: 'number', type: 'cmr', commitment: { kid: 'tdc1-abcdefabcdef', mac: 'b'.repeat(64) } };

	it('a stored answer has no readable number; a sent one does', () => {
		expect(readStoredTransportDoc(STORED)).toEqual(STORED);
		expect(transportDocNumberOf({ transportDoc: STORED })).toBeNull();
		expect(transportDocAnswerOf({ transportDoc: STORED })).toBe('number');
		expect(normalizeTransportDoc({ answer: 'number', type: 'cmr', number: ' X1 ' })).toEqual({ answer: 'number', type: 'cmr', number: 'X1' });
		expect(normalizeTransportDoc({ answer: 'none', number: 'X1' })).toEqual({ answer: 'none' });
		expect(transportDocAnswerOf(null)).toBeNull();
	});

	it('the record shows the owner\'s copy only when sent, and the keyed-hash line otherwise', () => {
		expect(transportDocFact({ transportDoc: STORED }, 'X1')).toEqual({ label: 'Transport document', value: 'CMR road consignment note: X1' });
		expect(transportDocFact({ transportDoc: STORED }).value).toBe('CMR road consignment note: number kept as a keyed hash (check one you hold below)');
		expect(transportDocFact({ transportDoc: { answer: 'none' } }).value).toBe('None (no transport document)');
		expect(transportDocFact({}).value).toBe('Recorded before this question was asked');
		expect(hasCheckableTransportDoc({ transportDoc: STORED })).toBe(true);
		expect(hasCheckableTransportDoc({ transportDoc: { answer: 'not_known' } })).toBe(false);
	});
});
