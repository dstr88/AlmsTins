import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Outside its own pages, PetroTins shows up only for the owner while it is owner-only: the nav
 * links, the admin stats and traffic rows, and the changelog entries. The rules live in
 * petroTinsVisibility / withoutPetroTinsRows (tested here), and the source checks below make
 * sure the pages use them, so a link that reappears for everyone fails CI.
 */
vi.mock('../../src/lib/petroTinsFlag.mjs', () => ({ PETRO_TINS_PUBLIC: false }));

import { petroTinsVisibility, withoutPetroTinsRows } from '../../src/lib/petroTinsAccess';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('petroTinsVisibility while owner-only', () => {
	it('shows nothing to anyone but the owner, admins included', () => {
		for (const viewer of [
			{ isOwner: false },
			{ isOwner: false, isAdmin: true },
			{ isOwner: false, isTradfiDomain: true },
			{ isOwner: false, isAdmin: true, isTradfiDomain: true },
		]) {
			expect(petroTinsVisibility(viewer), JSON.stringify(viewer)).toEqual({
				tradfiNav: false,
				navLink: false,
				adminStats: false,
				changelog: false,
			});
		}
	});

	it('the owner gets the nav link (or the PetroTins nav on tradifitins.com) and the admin stats', () => {
		expect(petroTinsVisibility({ isOwner: true, isAdmin: true })).toEqual({
			tradfiNav: false,
			navLink: true,
			adminStats: true,
			changelog: false,
		});
		expect(petroTinsVisibility({ isOwner: true, isTradfiDomain: true })).toMatchObject({ tradfiNav: true, navLink: false });
	});
});

describe('withoutPetroTinsRows', () => {
	const rows = [
		{ route: '/petro-tins' },
		{ route: '/dashboard/petro-tins/upgrade' },
		{ route: '/api/petro-tins/receipts' },
		{ route: '/dashboard/vault' },
		{ route: '/petro' },
		{ route: null },
	];

	it('drops PetroTins paths for anyone but the owner, and keeps every row for the owner', () => {
		expect(withoutPetroTinsRows(rows, (r) => r.route, false).map((r) => r.route)).toEqual(['/dashboard/vault', '/petro', null]);
		expect(withoutPetroTinsRows(rows, (r) => r.route, true)).toEqual(rows);
	});
});

/** The source with every `{guard && (...)}` or `{guard ? (...) :` block removed. */
const stripGuarded = (source: string, open: string, close: string) => {
	let out = source;
	for (;;) {
		const start = out.indexOf(open);
		if (start < 0) return out;
		const end = out.indexOf(close, start + open.length);
		expect(end, `unclosed ${open}`).toBeGreaterThan(start);
		out = out.slice(0, start) + out.slice(end + close.length);
	}
};

describe('the pages use the rules (source checks)', () => {
	it('Layout.astro: every PetroTins link sits behind petroNav', () => {
		const src = read('src/layouts/Layout.astro');
		expect(src).toContain('petroTinsVisibility(');
		expect(src).toContain('isPetroTinsOwnerSession(Astro.request, session)');
		const rest = stripGuarded(stripGuarded(src, '{petroNav.tradfiNav ? (', ') : ('), '{petroNav.navLink && (', ')}');
		expect(rest).not.toMatch(/href="\/(dashboard\/|api\/)?petro-tins/);
	});

	it('changelog.astro: every PetroTins entry sits behind PETRO_TINS_PUBLIC', () => {
		const src = read('src/pages/changelog.astro');
		const markup = src.slice(src.indexOf('---', 3) + 3);
		const rest = stripGuarded(markup, '{PETRO_TINS_PUBLIC && (<>', '</>)}');
		expect(rest).not.toMatch(/petro-?tins|tradfi-?tins|tradifitins/i);
	});

	it('admin/index.astro and dashboard/analytics.astro: stats and traffic rows are filtered for anyone but the owner', () => {
		const admin = read('src/pages/admin/index.astro');
		expect(admin).toContain('isPetroTinsOwnerSession(');
		expect(admin).not.toMatch(/\{(ga4\.topPages|topRoutes)\.map/);
		const adminMarkup = admin.slice(admin.indexOf('---', 3) + 3);
		expect(adminMarkup).toContain('PetroTins — visitor sessions');
		expect(stripGuarded(adminMarkup, '{showPetroTins && (', '\n\t)}')).not.toContain('PetroTins — visitor sessions');

		const analytics = read('src/pages/dashboard/analytics.astro');
		expect(analytics).toContain('isPetroTinsOwnerSession(');
		expect(analytics).not.toMatch(/\{(ga4\.topPages|byRoute|recentLogs)\.map/);
	});

	it('no other page, component or layout links to PetroTins', () => {
		// PetroTins' own files, plus the files that gate their references (checked above or by
		// the gate, sitemap, sign-in and cron tests).
		const allowed = [
			/^src\/pages\/petro-tins\//,
			/^src\/pages\/dashboard\/petro-tins/,
			/^src\/pages\/api\/petro-tins\//,
			/^src\/components\/petro-tins\//,
			/^src\/layouts\/PetroTins/,
			/^src\/layouts\/Layout\.astro$/,
			/^src\/lib\/petroTinsAccess\.ts$/,
			/^src\/lib\/authErrorRedirect\.ts$/,
			/^src\/lib\/seo\/sitemapFilter\.mjs$/,
			/^src\/middleware\/(app|auth)\.ts$/,
			/^src\/pages\/api\/cron\/petro-tins-reminder\.ts$/,
		];
		const offenders: string[] = [];
		const walk = (dir: string) => {
			for (const name of readdirSync(path.join(ROOT, dir))) {
				const rel = `${dir}/${name}`;
				if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel);
				else if (/\.(astro|tsx?|m?js)$/.test(name) && !allowed.some((re) => re.test(rel))) {
					// A PetroTins path in a string or an href (comments that name it are fine).
					if (/["'`=]\s*(https?:\/\/[^"'`\s]*)?\/(dashboard\/|api\/)?petro-tins\b/.test(read(rel))) offenders.push(rel);
				}
			}
		};
		walk('src');
		expect(offenders).toEqual([]);
	});
});
