/**
 * The keyed hash behind the duplicate check (S3): HMAC-SHA256 of fingerprintNormalize.ts's tuples
 * under RECEIVABLES_FINGERPRINT_KEY. Only these hashes are stored (receivables.fingerprint_ref,
 * fingerprint_inv); the plaintext tuples are never stored, logged or returned. Without the key a
 * stored hash cannot be tested against a guessed invoice, so the columns are not an oracle.
 *
 * The key is 32 random bytes, as 64 hex characters or base64, parsed the way verifyCrypto.ts
 * parses VERIFY_ENTITY_SECRET. Missing or malformed: every function here answers null, the
 * duplicate check reads "unavailable", and nothing is ever refused because of it.
 *
 * kid ("fp1-" + 12 hex of the key's SHA-256) is stored beside each row's hashes. "fp1" is the
 * scheme: a change to the normalizer's output must bump it to "fp2". Either a new key or a new
 * scheme gives a new kid, which marks every stored row stale until the backfill recomputes it.
 *
 * (A later slice keys token references with the same key under its own domain prefix,
 * "almstins-token-v1:". Not built: tokenization is deferred.)
 *
 * Nothing here logs the key, the kid or a tuple.
 */
import { createHash, createHmac } from 'node:crypto';
import { fingerprintTuples, type FingerprintInput } from '@/lib/receivables/fingerprintNormalize';

const KID_SCHEME = 'fp1';

export interface Fingerprints {
	/** HMAC of the strong key (debtor + debtor reference + currency + face), or null without a reference. */
	ref: string | null;
	/** HMAC of the fallback key (debtor + supplier + invoice number + currency + face), or null. */
	inv: string | null;
	/** Which key and scheme made them. */
	kid: string;
}

function getFingerprintKey(): Buffer | null {
	const raw = (process.env.RECEIVABLES_FINGERPRINT_KEY ?? '').trim();
	if (!raw) return null;
	const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
	return buf.length === 32 ? buf : null;
}

/** True when a valid 32-byte key is configured. */
export function fingerprintKeyAvailable(): boolean {
	return getFingerprintKey() !== null;
}

/** Whether RECEIVABLES_FINGERPRINT_KEY is set at all (valid or not). For the env status line. */
export function fingerprintKeyPresent(): boolean {
	return (process.env.RECEIVABLES_FINGERPRINT_KEY ?? '').trim() !== '';
}

function kidOf(key: Buffer): string {
	return `${KID_SCHEME}-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
}

/** The current key's kid, or null without a key. */
export function fingerprintKid(): string | null {
	const key = getFingerprintKey();
	return key ? kidOf(key) : null;
}

/** The keyed fingerprints of a record, or null when unavailable (no key). Never throws. */
export function computeFingerprints(input: FingerprintInput): Fingerprints | null {
	try {
		const key = getFingerprintKey();
		if (!key) return null;
		const tuples = fingerprintTuples(input);
		const mac = (text: string | null) => (text === null ? null : createHmac('sha256', key).update(text, 'utf8').digest('hex'));
		return { ref: mac(tuples.ref), inv: mac(tuples.inv), kid: kidOf(key) };
	} catch {
		return null;
	}
}
