/**
 * Almstins Verify: the one registration call a browser makes, and what it says when refused.
 *
 * POST /api/verify/destinations registers a destination for the signed-in account. The
 * dashboard's two add forms and the first-run card (Verify first run, Part C) all go through
 * registerDestination, so a refusal reads the same wherever it happens:
 *   - limit_reached      the plan's limit, in the caller's own words (it knows the plan);
 *   - duplicate          the account already holds this destination;
 *   - invalid            no usable value;
 *   - claimed_elsewhere  another account has this payment link verified;
 *   - name_taken         the label is another business's verified name;
 *   - anything else      the server's message, or the plain "could not add".
 * A request that never reaches the server reads as the plain "could not add".
 *
 * Browser-side and import-free: no database, no server module.
 */

export interface RegisterInput {
	kind: 'address' | 'qr';
	rail: string;
	value: string;
	label: string | null;
}

/** The dashboard locale's refusal sentences (src/i18n/dashboard/verify.ts). */
export interface RegisterWords {
	addError: string;
	addErrDuplicate: string;
	addErrInvalid: string;
	addErrClaimed: string;
	addErrNameTaken: string;
}

export type RegisterResult<D = unknown> = { ok: true; destination: D } | { ok: false; text: string };

/** The sentence for a refused registration. `limitText` is the caller's sentence for its plan's limit. */
export function registerErrorText(
	data: { error?: unknown; message?: unknown } | null | undefined,
	words: RegisterWords,
	limitText: string,
): string {
	switch (data?.error) {
		case 'limit_reached': return limitText;
		case 'duplicate': return words.addErrDuplicate;
		case 'invalid': return words.addErrInvalid;
		case 'claimed_elsewhere': return words.addErrClaimed;
		case 'name_taken': return words.addErrNameTaken;
		default: return typeof data?.message === 'string' && data.message ? data.message : words.addError;
	}
}

/** Register one destination. Never throws: a refusal or a failed request comes back as text. */
export async function registerDestination<D = unknown>(
	input: RegisterInput,
	words: RegisterWords,
	limitText: string,
): Promise<RegisterResult<D>> {
	try {
		const res = await fetch('/api/verify/destinations', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ kind: input.kind, rail: input.rail, value: input.value, label: input.label }),
		});
		const data = await res.json();
		if (data?.ok) return { ok: true, destination: data.destination as D };
		return { ok: false, text: registerErrorText(data, words, limitText) };
	} catch {
		return { ok: false, text: words.addError };
	}
}
