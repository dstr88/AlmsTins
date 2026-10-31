import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		exclude: ['tests/e2e/**'],
		// Pins Date (only Date — real timers keep running) so no fixture ages against the wall
		// clock. See tests/setup/pinnedClock.ts.
		setupFiles: ['tests/setup/pinnedClock.ts'],
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, 'src'),
		},
	},
});
