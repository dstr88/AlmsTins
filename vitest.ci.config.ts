import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * The unit tests CI runs on every pull request: the whole unit suite, minus the explicit
 * exclusions below. Every included file must run green with no database, no network, and no
 * secrets. Any new *.test.ts file under tests/ is picked up automatically, so it must meet that
 * bar too (DB-free suites stub '@/lib/db'; see tests/verify/nameUnique.test.ts).
 *
 * Standalone on purpose: mergeConfig would ADD these include/exclude lists to the base ones
 * instead of replacing them. Keep `resolve.alias` in step with vitest.config.ts.
 *
 * Excluded, and why:
 *   - tests/e2e/**: Playwright specs, run by .github/workflows/playwright.yml.
 *   - tests/pg*.test.ts: opt-in diagnostics against a real Postgres. They run only with
 *     RUN_PG_DIAGNOSTICS=1 and DATABASE_URL set, and some write data or call external APIs.
 *   - tests/tax/pipeline.integration.test.ts: it needs a real Postgres, so it stays out of this
 *     database-free step. CI runs it in its own step, "Tax pipeline integration (Postgres)", in
 *     the same job (.github/workflows/ci.yml), against a throwaway postgres service container.
 *     The test runs only with RUN_TAX_PIPELINE_IT=1 (set on that step) and a DATABASE_URL on
 *     localhost or 127.0.0.1, because its failure-path test drops a table.
 * Remove an exclusion only once that file runs green here without secrets.
 */
export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		exclude: [
			'tests/e2e/**',
			'tests/pg*.test.ts',
			'tests/tax/pipeline.integration.test.ts',
		],
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, 'src'),
		},
	},
});
