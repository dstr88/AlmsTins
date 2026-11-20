import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
	ADMIN_ZONE_NOTE_UTC,
	adminTimeIso,
	adminTimeLocalText,
	adminTimeUtcText,
	adminUtcDayText,
	adminZoneNote,
} from '../../src/lib/adminTime';

/**
 * Admin times read in the viewer's own time zone, with the zone named.
 *
 * The admin page used to print every time in UTC without saying so: a Google sign-up at 6:58 PM
 * Central on November 19 read "Nov 20". The server now writes each time as a <time datetime>
 * whose text is UTC and labeled UTC (AdminTime.astro), and a browser script rewrites the text
 * in the viewer's zone (adminTime.client.ts). The rules are in src/lib/adminTime.ts.
 *
 * Pinned here: what the server writes, what the browser shows, that a stored UTC day is never
 * shifted, and that the page uses the component for every time. No server, no browser.
 */
const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
/** Intl puts a narrow no-break space before AM/PM. */
const plain = (text: string | null) => (text ?? '').replace(/[  ]/g, ' ');

/** The sign-up of November 19, 2026, 6:58 PM Central, as the database holds it. */
const STORED = '2026-11-20 00:58:00';

describe('what the server writes, before the script runs', () => {
	it('a machine-readable instant', () => {
		expect(adminTimeIso(STORED)).toBe('2026-11-20T00:58:00.000Z');
		expect(adminTimeIso('2026-11-13T04:49:00.000Z')).toBe('2026-11-13T04:49:00.000Z');
	});

	it('a text that is UTC and says so, so it reads correctly on its own', () => {
		expect(plain(adminTimeUtcText(STORED))).toBe('Nov 20, 2026, 12:58 AM UTC');
		expect(plain(adminTimeUtcText(STORED, 'date'))).toBe('Nov 20, 2026 UTC');
	});

	it('nothing for a value that is not a time', () => {
		for (const v of [null, undefined, '', 'never', {}]) {
			expect(adminTimeIso(v)).toBeNull();
			expect(adminTimeUtcText(v)).toBeNull();
			expect(adminTimeLocalText(v)).toBeNull();
		}
	});
});

describe('what the browser shows', () => {
	it("the viewer's own time, with the zone named in it", () => {
		expect(plain(adminTimeLocalText('2026-11-20T00:58:00.000Z', 'datetime', 'America/Chicago'))).toBe('Nov 19, 2026, 6:58 PM CST');
	});

	it('the zone name follows the date: a summer time reads daylight time', () => {
		expect(plain(adminTimeLocalText('2026-07-04T17:00:00.000Z', 'datetime', 'America/Chicago'))).toBe('Jul 4, 2026, 12:00 PM CDT');
	});

	it('the last sign-in the admin page showed as Nov 13 was Nov 12 in Central time', () => {
		expect(plain(adminTimeLocalText('2026-11-13T04:49:00.000Z', 'datetime', 'America/Chicago'))).toBe('Nov 12, 2026, 10:49 PM CST');
	});

	it('another viewer gets their own zone', () => {
		expect(plain(adminTimeLocalText('2026-11-20T00:58:00.000Z', 'datetime', 'Europe/Paris'))).toMatch(/^Nov 20, 2026, 1:58 AM (GMT\+1|CET)$/);
		expect(plain(adminTimeLocalText('2026-11-20T00:58:00.000Z', 'datetime', 'UTC'))).toBe('Nov 20, 2026, 12:58 AM UTC');
	});

	it('a day alone is the local day', () => {
		expect(adminTimeLocalText('2026-11-20T00:58:00.000Z', 'date', 'America/Chicago')).toBe('Nov 19, 2026');
	});

	it('the page names the zone once, and says UTC until the script has run', () => {
		expect(adminZoneNote('America/Chicago')).toBe('Times in America/Chicago');
		expect(ADMIN_ZONE_NOTE_UTC).toBe('Times in UTC');
	});
});

describe('a stored UTC day is not a time', () => {
	it('reads as that day everywhere, never the day before', () => {
		expect(adminUtcDayText('2026-11-19')).toBe('Nov 19, 2026');
		expect(adminUtcDayText('2026-01-01')).toBe('Jan 1, 2026');
	});

	it('anything else is nothing', () => {
		for (const v of [null, undefined, '', '2026-11-19 00:58:00', 'Nov 19']) expect(adminUtcDayText(v as any)).toBeNull();
	});

	it('the last active day is written without the script touching it', () => {
		const list = read('src/components/admin/NewAccounts.astro');
		expect(list).toContain('<time class="admin-time" datetime={a.lastActiveDay}>{adminUtcDayText(a.lastActiveDay)}</time>');
		expect(read('src/components/admin/adminAccounts.copy.ts')).toContain("colLastActive: 'Last active (UTC day)'");
	});
});

describe('the component and its script', () => {
	const component = read('src/components/admin/AdminTime.astro');
	const script = read('src/components/admin/adminTime.client.ts');

	it('the component writes a <time> the script can find, with the UTC text inside', () => {
		expect(component).toContain('<time class="admin-time" datetime={iso} data-admin-time={mode}>{adminTimeUtcText(value, mode)}</time>');
		expect(component).toContain("import './adminTime.client.ts';");
		expect(component).toContain("import './AdminTime.css';");
		expect(component).not.toMatch(/<style[\s>]/);
	});

	it('the script is its own file, takes its rules from src/lib and writes text only', () => {
		expect(script).toContain("from '@/lib/adminTime'");
		expect(script).toContain("querySelectorAll<HTMLTimeElement>('time[data-admin-time]')");
		expect(script).toContain("querySelectorAll<HTMLElement>('[data-admin-zone]')");
		expect(script).toContain('el.textContent = local;');
		expect(script).not.toContain('innerHTML');
	});
});

describe('the admin page', () => {
	const page = read('src/pages/admin/index.astro');
	const markup = page.slice(page.indexOf('---', 3) + 3);

	it('renders no time on the server in an unlabeled zone', () => {
		expect(page).not.toContain('toUTCString()');
		expect(page).not.toContain('formatDateTime(');
		expect(page).not.toContain('formatDate(');
		expect(page).not.toMatch(/\bfmt(Date)?\(/);
	});

	it('every time goes through the component', () => {
		for (const value of ['now', 'row.last_login', 'u.member_since', 'u.last_login', 'row.visited_at', 'msg.created_at']) {
			expect(markup, value).toContain(`<AdminTime value={${value}}`);
		}
	});

	it('names the zone in the top bar', () => {
		expect(markup).toContain('<span class="admin-zone" data-admin-zone>{ADMIN_ZONE_NOTE_UTC}</span>');
	});

	it('keeps the word Never for an empty last login', () => {
		expect(markup).toContain('<AdminTime value={u.last_login} empty="Never" />');
		expect(page).not.toMatch(/not recorded/i);
	});
});

describe('the formatting is the app\'s one date formatter', () => {
	it('adminTime.ts builds no formatter of its own', () => {
		const source = read('src/lib/adminTime.ts');
		expect(source).toContain("import { formatDate, formatDateTime, localTimeZone, toDate } from './format';");
		expect(source).not.toContain('Intl.');
		expect(read('src/components/admin/adminTime.client.ts')).not.toContain('Intl.');
	});

	it('format.ts can show another zone and name it, and ignores a zone it does not know', async () => {
		const { formatDateTime, formatDate, localTimeZone } = await import('../../src/lib/format');
		const at = '2026-11-20T00:58:00.000Z';
		expect(plain(formatDateTime(at, 'en', { timeZone: 'America/Chicago', zoneName: true }))).toBe('Nov 19, 2026, 6:58 PM CST');
		expect(plain(formatDateTime(at, 'en', { timeZone: 'America/Chicago' }))).toBe('Nov 19, 2026, 6:58 PM');
		expect(formatDate(at, 'en', { timeZone: 'America/Chicago' })).toBe('Nov 19, 2026');
		// The existing UTC behavior is unchanged.
		expect(plain(formatDateTime(at, 'en', { timeZone: 'UTC' }))).toBe('Nov 20, 2026, 12:58 AM');
		expect(() => formatDateTime(at, 'en', { timeZone: 'Not/AZone', zoneName: true })).not.toThrow();
		expect(typeof localTimeZone()).toBe('string');
	});
});
