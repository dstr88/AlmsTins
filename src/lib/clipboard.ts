/**
 * The one place the app writes to the clipboard. React screens use <CopyButton>
 * (src/components/ui/CopyButton.tsx), which calls this; bundled Astro scripts import it directly.
 * Pure (no React), so a page script that imports it does not pull React into its bundle.
 */

/**
 * Puts text on the clipboard with the page's clipboard API, and says whether it worked. Where the API
 * is missing (a page that is not served securely) or the browser refuses, it says no: the caller then
 * says "Copy failed", and the text stays on the page to select by hand. Never throws.
 */
export async function copyText(value: string): Promise<boolean> {
	try {
		if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
		await navigator.clipboard.writeText(value);
		return true;
	} catch {
		return false;
	}
}
