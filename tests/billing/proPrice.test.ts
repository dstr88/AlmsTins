import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { en, es, fr } from '../../src/i18n/prices';

/**
 * Stripe charges $20/month for Pro (confirmed in the Stripe dashboard 2026-10-10). The
 * public prices page and the plan config said $19 while the billing page, where people
 * subscribe, said $20. Every place that shows the Pro price must show what is charged.
 */

const billing = readFileSync(path.resolve(__dirname, '../../src/pages/dashboard/billing.astro'), 'utf8');
const subs = readFileSync(path.resolve(__dirname, '../../src/lib/subscriptions.ts'), 'utf8');

describe('Pro is $20/month everywhere', () => {
	it('on the public prices page, in all three languages', () => {
		expect((en as any).paid?.pro?.price ?? JSON.stringify(en)).toMatch(/\$20/);
		expect(JSON.stringify(en)).not.toMatch(/'?\$19'?/);
		expect(JSON.stringify(es)).toMatch(/"\$20"/);
		expect(JSON.stringify(fr)).toMatch(/"20 \$"/);
	});

	it('on the billing page and in the plan config', () => {
		expect(billing).toMatch(/data-monthly="\$20"/);
		expect(subs).toMatch(/monthlyPrice: 20,/);
		expect(subs).not.toMatch(/monthlyPrice: 19,/);
	});
});
