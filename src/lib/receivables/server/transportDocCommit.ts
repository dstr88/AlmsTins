/**
 * The transport document number as a keyed commitment. A receivable never carries its transport
 * document number in readable form: the signed details hold { answer: 'number', type, commitment:
 * { kid, mac } }, where mac is HMAC-SHA256, under RECEIVABLES_FINGERPRINT_KEY, of the record's own
 * invoice fields and the normalized number, behind the domain prefix "almstins-transport-doc-v1".
 *
 * Why keyed, and why bound to the record:
 *   - bill of lading and air waybill numbers are short and follow patterns (a carrier code and a
 *     run of digits), so a plain SHA-256 could be reversed by trying numbers. Without the server's
 *     key a commitment cannot be tested against a guess;
 *   - the invoice fields go into the MAC, so two invoices against the same shipment carry different
 *     commitments, and two record IDs never show by their details alone that they share a shipment.
 *     The duplicate check's shipment key (fingerprint_doc) is the one place that compares shipments,
 *     under its own tiers.
 *
 * Another lender holding a number checks it against a record with a yes or no
 * (checkTransportDocNumber); nothing ever returns the number to anyone but the record's owner, who
 * keeps a private copy, encrypted at rest (AES-256-GCM, verifyCrypto.ts), never in the manifest.
 *
 * Key rotation: kid is "tdc1-" + 12 hex of the key's SHA-256. Old keys stay checkable by listing
 * them in RECEIVABLES_FINGERPRINT_RETIRED_KEYS (comma-separated, hex or base64), so a commitment
 * made under a retired key can still be checked. Without a valid current key, no commitment is
 * made and a create with a number is refused (fail closed); nothing is ever stored in the clear.
 *
 * Nothing here logs a key, a kid, a number or a field.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { clampCurrency, faceMinor, normDocRef, normInvoiceNo, normParty } from '@/lib/receivables/fingerprintNormalize';
import { decryptSecret, encryptSecret } from '@/lib/verifyCrypto';

export const TRANSPORT_DOC_COMMIT_DOMAIN = 'almstins-transport-doc-v1';
const KID_PREFIX = 'tdc1';

/** The record fields a commitment is bound to (as the create clamps them). */
export interface CommitFields {
	supplier: string;
	buyer: string;
	invoiceNo: string;
	face: number;
	currency: string;
	isTest: boolean;
}

export interface TransportDocCommitment {
	kid: string;
	mac: string;
}

function parseKey(raw: string): Buffer | null {
	const s = raw.trim();
	if (!s) return null;
	const buf = /^[0-9a-fA-F]{64}$/.test(s) ? Buffer.from(s, 'hex') : Buffer.from(s, 'base64');
	return buf.length === 32 ? buf : null;
}

const kidOf = (key: Buffer) => `${KID_PREFIX}-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;

function currentKey(): Buffer | null {
	return parseKey(process.env.RECEIVABLES_FINGERPRINT_KEY ?? '');
}

/** The current key and every retired one that parses, by kid. */
function keysByKid(): Map<string, Buffer> {
	const out = new Map<string, Buffer>();
	const cur = currentKey();
	if (cur) out.set(kidOf(cur), cur);
	for (const part of String(process.env.RECEIVABLES_FINGERPRINT_RETIRED_KEYS ?? '').split(',')) {
		const k = parseKey(part);
		if (k && !out.has(kidOf(k))) out.set(kidOf(k), k);
	}
	return out;
}

/** The text a commitment is the MAC of. Null when the number normalizes to nothing. */
export function commitmentText(f: CommitFields, number: string): string | null {
	const doc = normDocRef(String(number ?? '').trim().slice(0, 60));
	if (!doc) return null;
	return [
		TRANSPORT_DOC_COMMIT_DOMAIN, f.isTest ? 't' : 'r', normParty(f.buyer), normParty(f.supplier), normInvoiceNo(f.invoiceNo),
		clampCurrency(f.currency).replace(/[^\p{L}\p{N}\p{M}]+/gu, ''), faceMinor(f.face), doc,
	].join('|');
}

/** True when a commitment can be made now (a valid current key). */
export function transportDocCommitAvailable(): boolean {
	return currentKey() !== null && ownerCopyAvailable();
}

/** The owner's private copy can be encrypted (VERIFY_ENTITY_SECRET). */
export function ownerCopyAvailable(): boolean {
	return encryptSecret('probe') !== null;
}

/** The commitment for a number on a record, or null (no key, or nothing left of the number). */
export function commitTransportDocNumber(f: CommitFields, number: string): TransportDocCommitment | null {
	const key = currentKey();
	const text = commitmentText(f, number);
	if (!key || !text) return null;
	return { kid: kidOf(key), mac: createHmac('sha256', key).update(text, 'utf8').digest('hex') };
}

/**
 * Whether `number` is the one committed in `commitment` for this record: true or false, or null
 * when the check cannot answer (the commitment's key is neither current nor retired, or the
 * commitment is malformed). Constant-time on the MAC.
 */
export function checkTransportDocNumber(f: CommitFields, commitment: unknown, number: string): boolean | null {
	const c = commitment as Partial<TransportDocCommitment> | null | undefined;
	if (!c || typeof c.kid !== 'string' || typeof c.mac !== 'string' || !/^[0-9a-f]{64}$/.test(c.mac)) return null;
	const key = keysByKid().get(c.kid);
	if (!key) return null;
	const text = commitmentText(f, number);
	if (!text) return false;
	const mac = createHmac('sha256', key).update(text, 'utf8').digest();
	return timingSafeEqual(mac, Buffer.from(c.mac, 'hex'));
}

/** The owner's private copy, encrypted, or null when encryption is unavailable. */
export function sealOwnerCopy(number: string): string | null {
	return encryptSecret(String(number));
}

/** The owner's private copy, decrypted, or null. */
export function openOwnerCopy(blob: unknown): string | null {
	return typeof blob === 'string' && blob ? decryptSecret(blob) : null;
}
