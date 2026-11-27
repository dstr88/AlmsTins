/**
 * Small readers for the host pages' create forms, moved out of their inline scripts so each
 * page stays within its inline-script budget (tests/receivables/componentSplit.test.ts).
 * Logic only: no CSS, no style writes, nothing runs on import.
 */

const value = (id: string): string => ((document.getElementById(id) as HTMLInputElement | null)?.value ?? '').trim();

/** A select that may be set to "__other": its free-text companion's value then. Trimmed; '' when missing. */
export function pickOther(selectId: string, otherId: string): string {
	const v = value(selectId);
	return v === '__other' ? value(otherId) : v;
}

/** The desk intake's added fields: each .xrow's label and value, trimmed, with half-filled rows left out. */
export function readExtras(box: ParentNode | null): Array<{ label: string; value: string }> {
	return Array.from(box?.querySelectorAll('.xrow') ?? []).map((r) => {
		const [l, v] = Array.from(r.querySelectorAll('input'));
		return { label: (l?.value ?? '').trim(), value: (v?.value ?? '').trim() };
	}).filter((e) => e.label && e.value);
}
