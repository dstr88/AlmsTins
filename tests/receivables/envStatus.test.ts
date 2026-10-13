import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';

/**
 * src/lib/envStatus.ts and the receivables fingerprint key (S3): the startup log says whether the
 * key is set and whether it parses, as a boolean and one word. Never the value.
 */

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	delete (globalThis as Record<string, unknown>).__ledgerlense_env_status_logged__;
});

async function logged(key: string): Promise<string> {
	vi.resetModules();
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', key);
	delete (globalThis as Record<string, unknown>).__ledgerlense_env_status_logged__;
	const lines: unknown[][] = [];
	vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a); });
	const { logEnvStatus } = await import('../../src/lib/envStatus');
	logEnvStatus();
	return JSON.stringify(lines);
}

describe('receivables fingerprint key status', () => {
	it('valid: presence true and one status line, never the key', async () => {
		const key = randomBytes(32).toString('hex');
		const text = await logged(key);
		expect(text).toContain('"RECEIVABLES_FINGERPRINT_KEY":true');
		expect(text).toContain('[env] receivables fingerprint key valid');
		expect(text).not.toContain(key);
	});

	it('invalid: set but not 32 bytes', async () => {
		const key = randomBytes(16).toString('hex');
		const text = await logged(key);
		expect(text).toContain('[env] receivables fingerprint key invalid');
		expect(text).not.toContain(key);
	});

	it('missing', async () => {
		const text = await logged('');
		expect(text).toContain('"RECEIVABLES_FINGERPRINT_KEY":false');
		expect(text).toContain('[env] receivables fingerprint key missing');
	});
});
