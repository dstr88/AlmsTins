import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// The rules here are pure; the database is never touched.
vi.mock('../../src/lib/db', () => ({
	db: {
		execute: async () => {
			throw new Error('the share rules must not touch the database');
		},
	},
}));

import {
	MAX_SIZE_BYTES,
	expiryFrom,
	hashToken,
	newToken,
	shareLink,
	shareStatus,
	uploadRefusal,
} from '../../src/lib/fileShares';

/**
 * The share folder: one curated file, one link. The rules that keep a link from being a leak are
 * pinned here: the token is never stored in clear, a share ends by expiry, use or revoke, a file
 * that a mail scanner or a browser could run is refused, and only POST counts a download.
 */
const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const NOW = new Date('2026-10-27T12:00:00Z');

describe('tokens', () => {
	it('are long and random, and only their hash is stored', () => {
		const a = newToken();
		const b = newToken();
		expect(a).not.toBe(b);
		expect(a.length).toBe(43);
		expect(hashToken(a)).not.toBe(a);
		expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
		expect(hashToken(a)).toBe(hashToken(a));
	});

	it('the link is built from the origin and the token', () => {
		expect(shareLink('https://almstins.com', 'tok')).toBe('https://almstins.com/shares/tok');
	});
});

describe('when a share can still be downloaded', () => {
	const base = {
		expires_at: expiryFrom(NOW, 7),
		max_downloads: 3,
		downloads: 0,
		revoked_at: null,
	};

	it('is active before expiry, with downloads left', () => {
		expect(shareStatus(base, NOW)).toBe('active');
	});

	it('is expired once the expiry time has passed', () => {
		expect(shareStatus({ ...base, expires_at: expiryFrom(NOW, -1) }, NOW)).toBe('expired');
	});

	it('is used up at the download cap', () => {
		expect(shareStatus({ ...base, downloads: 3 }, NOW)).toBe('exhausted');
	});

	it('is revoked as soon as the owner turns it off, whatever else is true', () => {
		expect(shareStatus({ ...base, revoked_at: NOW.toISOString() }, NOW)).toBe('revoked');
	});

	it('lasts seven days by default', () => {
		expect(expiryFrom(NOW)).toBe('2026-11-03T12:00:00.000Z');
	});
});

describe('what may be shared', () => {
	const ok = { filename: 'records.csv', mimeType: 'text/csv', size: 1000 };

	it('accepts a CSV, PDF, JSON, text or Markdown file within the size limit', () => {
		expect(uploadRefusal(ok)).toBeNull();
		expect(uploadRefusal({ filename: 'summary.pdf', mimeType: 'application/pdf', size: 1000 })).toBeNull();
		expect(uploadRefusal({ filename: 'notes.md', mimeType: 'text/markdown', size: 10 })).toBeNull();
	});

	it('refuses an archive, by type or by name', () => {
		expect(uploadRefusal({ filename: 'bundle.zip', mimeType: 'application/zip', size: 1000 })).not.toBeNull();
		expect(uploadRefusal({ filename: 'bundle.csv', mimeType: 'application/zip', size: 1000 })).not.toBeNull();
	});

	it('refuses scripts and pages that a browser could run', () => {
		for (const filename of ['verify.mjs', 'run.js', 'page.html', 'icon.svg']) {
			expect(uploadRefusal({ filename, mimeType: 'text/plain', size: 10 })).not.toBeNull();
		}
	});

	it('refuses other types, empty files and files over the limit', () => {
		expect(uploadRefusal({ filename: 'photo.png', mimeType: 'image/png', size: 1000 })).not.toBeNull();
		expect(uploadRefusal({ ...ok, size: 0 })).not.toBeNull();
		expect(uploadRefusal({ ...ok, size: MAX_SIZE_BYTES + 1 })).not.toBeNull();
	});
});

describe('the routes keep the rules', () => {
	it('a download is POST only, so a mail scanner opening the link cannot use it up', () => {
		const src = read('src/pages/api/shares/download/[token].ts');
		expect(src).toMatch(/export const POST/);
		expect(src).not.toMatch(/export const GET/);
	});

	it('the landing page only reads the share and never counts a download', () => {
		const page = read('src/pages/shares/[token].astro');
		expect(page).not.toMatch(/UPDATE|takeDownload|logShareEvent/);
		expect(page).toMatch(/X-Robots-Tag/);
		expect(page).toMatch(/Referrer-Policy/);
	});

	it('a download is counted only while the share is still usable, in one update', () => {
		const lib = read('src/lib/fileShares.ts');
		expect(lib).toMatch(/WHERE id = \? AND revoked_at IS NULL AND expires_at > \? AND downloads < max_downloads/);
	});

	it('the owner can only see and revoke their own shares', () => {
		expect(read('src/pages/api/shares/index.ts')).toMatch(/WHERE tenant_id = \?/);
		expect(read('src/pages/api/shares/[id].ts')).toMatch(/AND tenant_id = \?/);
	});

	it('the owner routes refuse the demo and free accounts', () => {
		const index = read('src/pages/api/shares/index.ts');
		expect(index).toMatch(/session\.isDemo/);
		expect(index).toMatch(/canDownloadHistoryByWallet/);
	});

	it('the emailed link carries no file', () => {
		expect(read('src/pages/api/shares/index.ts')).not.toMatch(/attachments/);
	});
});
