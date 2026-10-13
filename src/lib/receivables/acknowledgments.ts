/**
 * Warnings a person can read and go ahead past, and how the server signs that they did.
 *
 * A write that raises one of these codes answers 409 with the facts. The caller resubmits
 * acknowledging it, and the server signs sorted(raised ∩ requested) into the manifest of the
 * record it writes, as `acknowledged`. The key is left out when nothing was acknowledged, so
 * every manifest written before this existed keeps its exact bytes and digest.
 *
 * Codes: exceeds_headroom (S1; on the claim route force:true acknowledges it too) and
 * possible_duplicate (S3; the receivable matches another record that is recorded as financed).
 * A new code answers 409 only to a caller that declares acceptsWarnings: true (shouldRaise). Any
 * other caller keeps today's answer: the write goes ahead, and its 200 carries an informational
 * notices list (NOTICE_CODES) instead. Pure and import-free.
 */
export const ACK_CODES = ['exceeds_headroom', 'possible_duplicate'] as const;
export type AckCode = (typeof ACK_CODES)[number];

/**
 * Informational codes in a 200's notices list. They never need acknowledging:
 *   - possible_duplicate: the warning above was raised for a caller that does not accept warnings,
 *     and the write went ahead without its acknowledgment;
 *   - duplicate_check_unavailable: the duplicate check could not run, so it is unproven.
 */
export const NOTICE_CODES = ['duplicate_check_unavailable', 'possible_duplicate'] as const;
export type NoticeCode = (typeof NOTICE_CODES)[number];

/** Whether a request body opted in to 409 answers for the codes after exceeds_headroom. */
export function shouldRaise(body: unknown): boolean {
	return !!body && typeof body === 'object' && (body as { acceptsWarnings?: unknown }).acceptsWarnings === true;
}

export function isAckCode(code: unknown): code is AckCode {
	return typeof code === 'string' && (ACK_CODES as readonly string[]).includes(code);
}

export interface AckResolution {
	/** Raised and acknowledged: signed into the manifest (sorted, unique). */
	acknowledged: AckCode[];
	/** Raised and not acknowledged: the write answers 409 (sorted, unique). */
	outstanding: AckCode[];
	/** Requested codes this build does not know (a later route answers 400). */
	unknown: string[];
}

const sortedUnique = <T extends string>(xs: Iterable<T>): T[] => [...new Set(xs)].sort();

export function resolveAcknowledged(raised: readonly AckCode[], requested: readonly unknown[]): AckResolution {
	const asked = new Set<AckCode>(requested.filter(isAckCode));
	return {
		acknowledged: sortedUnique(raised.filter((c) => asked.has(c))),
		outstanding: sortedUnique(raised.filter((c) => !asked.has(c))),
		unknown: sortedUnique(requested.filter((c) => !isAckCode(c)).map((c) => String(c))),
	};
}

/** The manifest with `acknowledged` as its last key, or the same object when the list is empty. */
export function withAcknowledged<M extends object>(manifest: M, acknowledged: readonly AckCode[]): M & { acknowledged?: AckCode[] } {
	return acknowledged.length ? { ...manifest, acknowledged: [...acknowledged] } : manifest;
}
