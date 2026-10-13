import { describe, it, expect } from 'vitest';
import { SAFETY_CHECK_I18N, addressVerdict, urlVerdict } from '../../src/lib/safetyCheckText';
import { en, es, fr } from '../../src/i18n/walletChecker';

/**
 * The <safety-check> element (src/lib/safetyCheck.ts) says what the wallet checker says
 * (code review 2026-10-11): a clean result is "no flags found" with the "clean is not safe"
 * note, never "looks clear" or "safe"; an address scan that could not run every check is a
 * limited check, never green; a reply without a verdict is a failed check, never a pass.
 */

const LOCALES = [['en', en], ['es', es], ['fr', fr]] as const;

describe.each(LOCALES)('%s', (lang, checker) => {
	const t = SAFETY_CHECK_I18N[lang];

	it('a clean link reads "no flags found" and carries the wallet checker\'s own clean note', () => {
		const v = urlVerdict({ verdict: 'green', limited: false }, t)!;
		expect(v.tone).toBe('ok');
		expect(v.title).not.toMatch(/clear|safe|segur|sûr/i);
		expect(v.note).toBe(checker.js.cleanNotSafe);
	});

	it('a clean address carries the clean-is-not-safe note', () => {
		const v = addressVerdict({ scamLevel: 'clean', partialCoverage: false }, t);
		expect(v.tone).toBe('ok');
		expect(v.title).not.toMatch(/clear|safe|segur|sûr/i);
		expect(v.note).toBe(t.cleanNote.address);
		expect(v.note).toMatch(/not that it is safe|no que sea segura|pas qu’elle est sûre/);
	});

	it('a clean address scan that could not run every check is limited, not green', () => {
		const v = addressVerdict({ scamLevel: 'clean', partialCoverage: true }, t);
		expect(v.tone).toBe('warn');
		expect(v.title).toBe(t.addr.limited);
		expect(v.note).toBe(t.limitedNote);
	});

	it('flagged and limited results carry no clean note', () => {
		expect(addressVerdict({ scamLevel: 'danger' }, t)).toEqual({ tone: 'bad', title: t.addr.danger, note: null });
		expect(addressVerdict({ scamLevel: 'caution' }, t)).toEqual({ tone: 'warn', title: t.addr.caution, note: null });
		expect(urlVerdict({ verdict: 'red' }, t)).toEqual({ tone: 'bad', title: t.url.red, note: null });
		expect(urlVerdict({ verdict: 'yellow', limited: true }, t)).toEqual({ tone: 'warn', title: t.url.limited, note: null });
		expect(urlVerdict({ verdict: 'yellow', limited: false }, t)).toEqual({ tone: 'warn', title: t.url.yellow, note: null });
	});

	it('no verdict is a failed check, never a pass', () => {
		expect(urlVerdict({}, t)).toBeNull();
		expect(urlVerdict(null, t)).toBeNull();
		expect(addressVerdict({}, t).tone).toBe('warn');
		expect(addressVerdict({ scamLevel: 'unknown' }, t).title).toBe(t.failed);
	});

	it('the new strings carry no em dashes', () => {
		for (const s of [t.addr.clean, t.addr.limited, t.url.green, t.url.limited, t.cleanNote.address, t.cleanNote.link, t.limitedNote]) {
			expect(s, s).not.toContain('—');
		}
	});
});
