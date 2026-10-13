/**
 * Fills {name} placeholders in a receivables copy string. Pure and import-free.
 * A single pass: a filled value is never scanned again, so a value that itself contains
 * "{x}" stays as typed. An unknown placeholder is left as written.
 */
export function fillCopy(template: string, vars: Readonly<Record<string, string>>): string {
	return template.replace(/\{(\w+)\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m));
}
