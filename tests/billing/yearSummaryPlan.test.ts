import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The Year Summary PDF and its verification bundle are Unlimited-plan features, as the
 * pricing page says (decided 2026-10-10; the download had been open to any paid plan).
 * The owner always has them. The gain/loss CSV stays on every paid plan.
 */

vi.mock('../../src/lib/owner', () => ({ isOwner: (t: string | null | undefined) => t === 'owner-tenant' }));
import { canDownloadYearSummaryPdf } from '../../src/lib/yearSummaryAccess';

const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

describe('who can download the Year Summary PDF', () => {
	it.each([
		['free', 'tenant-a', false],
		['starter', 'tenant-a', false],
		['pro', 'tenant-a', false],
		['unlimited', 'tenant-a', true],
		['free', 'owner-tenant', true],
	])('%s plan, %s → %s', (plan, tenant, allowed) => {
		expect(canDownloadYearSummaryPdf(plan, tenant)).toBe(allowed);
	});

	it('every gate uses the same rule', () => {
		for (const rel of [
			'src/pages/api/year-summary/report.ts',
			'src/pages/api/year-summary/proof-bundle.ts',
			'src/pages/year-summary.astro',
			'src/pages/dashboard/bookkeeping.astro',
		]) expect(read(rel), rel).toMatch(/canDownloadYearSummaryPdf\(/);
		expect(read('src/pages/api/year-summary/report.ts')).toMatch(/planRequired: 'unlimited'/);
	});

	it('the gain/loss CSV stays on any paid plan', () => {
		expect(read('src/pages/api/yearEnd/breakdown-csv.ts')).toMatch(/plan\.id === 'free'/);
	});
});
