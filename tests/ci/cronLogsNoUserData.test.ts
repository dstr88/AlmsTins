import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * This repository is public, so its GitHub Actions logs are public too. The cron jobs used
 * to print each endpoint's full JSON response, and the wallet syncs' responses list every
 * synced wallet's account ID, wallet ID and user-chosen label. Every job that calls
 * /api/cron/ must now write the response to a file (or discard it) and print at most the
 * HTTP status and the response's numeric and true/false fields.
 */

const DIR = path.resolve(__dirname, '../../.github/workflows');
const cronJobs = readdirSync(DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ file: f, text: readFileSync(path.join(DIR, f), 'utf8') }))
  .filter(({ text }) => text.includes('/api/cron/'));

describe('cron workflows never print the response body', () => {
  it('finds the cron workflows', () => {
    expect(cronJobs.length).toBeGreaterThanOrEqual(15);
  });

  it.each(cronJobs.map((j) => [j.file, j.text]))('%s sends curl output to a file or /dev/null', (_file, text) => {
    expect(text).toMatch(/curl[^\n]*(\\\n[^\n]*)*-o\s+("\$RUNNER_TEMP\/cron-response\.json"|\/dev\/null)/);
  });

  it.each(cronJobs.map((j) => [j.file, j.text]))('%s prints only numbers and true/false fields, if anything', (_file, text) => {
    if (text.includes('cron-response.json')) {
      expect(text).toContain(`jq -c 'with_entries(select(.value | type == "number" or type == "boolean"))'`);
      expect(text).not.toMatch(/cat\s+"?\$RUNNER_TEMP\/cron-response\.json/);
    }
  });
});
