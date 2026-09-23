import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * The unit tests CI runs on every pull request: the ones that need no database, no network,
 * and no secrets. `npx vitest run` (vitest.config.ts) still runs everything locally.
 *
 * Standalone on purpose: mergeConfig would ADD this include list to the base one instead of
 * replacing it. Keep `resolve.alias` in step with vitest.config.ts.
 *
 * Not here yet, and why:
 *   - tests that import src/lib/db and need DATABASE_URL (tests/verify/{nameUnique,paymentQr,
 *     publishedSource,qrClaimNormalize}, tests/transferLink, tests/walletChecker/mixerAndCoverage)
 *   - tests that call a live third-party API (tests/aaveApi)
 *   - tests/tax/{pass1,pass2,pass5,deduplication,annualBreakdown,pipeline.integration}, which fail
 *     today and are being diagnosed
 *   - tests/pg*.test.ts, which skip unless pointed at a real Postgres
 * Move a file into the list below once it runs green without secrets.
 */
export default defineConfig({
	test: {
		environment: 'node',
		include: [
			'tests/auth/**/*.test.ts',
			'tests/seo/**/*.test.ts',
			'tests/recordProof/**/*.test.ts',
			'tests/rwaProof/**/*.test.ts',
			'tests/tax/fifo.test.ts',
			'tests/tax/lotSelection.test.ts',
			'tests/tax/pass3.test.ts',
			'tests/tax/pass3b.test.ts',
			'tests/verify/dnsTxt.test.ts',
			'tests/verify/loginMode.test.ts',
		],
		exclude: ['tests/e2e/**'],
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, 'src'),
		},
	},
});
