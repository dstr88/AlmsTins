/** A two-letter country code as its English name; the code itself if the name is unknown, Unknown when there is none. */
export const countryName = (code: string | null | undefined): string => {
	if (!code) return 'Unknown';
	try {
		return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
	} catch {
		return code;
	}
};
