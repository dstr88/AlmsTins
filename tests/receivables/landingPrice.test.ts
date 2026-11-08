import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACT_DEFINITION, LANDING_PRICE } from '../../src/lib/receivables/copy/plan';

/**
 * The landing page's price (tier T3): it reads the plan copy, so the page and the claim write can
 * never say different things about what Free holds. Source pins only; the landing is not a host
 * page and has no script or style budget.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (r: string) => fs.readFileSync(path.join(ROOT, r), 'utf8');
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe('the landing price line', () => {
	const landing = read('src/pages/receivables.astro');

	it('renders the price and the contract definition from copy/plan, once each', () => {
		expect(landing).toMatch(/import \{ LANDING_PRICE, CONTRACT_DEFINITION \} from '\.\.\/lib\/receivables\/copy\/plan';/);
		expect(count(landing, '{LANDING_PRICE}')).toBe(1);
		expect(count(landing, '{CONTRACT_DEFINITION}')).toBe(1);
	});

	it('no longer promises a pilot', () => {
		expect(landing).not.toContain('Free during the pilot');
		expect(landing).not.toContain("name: 'Pilot'");
		expect(landing).not.toContain('10 contracts');
	});

	it('the structured data carries a Free offer and a Standard offer at $95 a month', () => {
		expect(landing).toContain("{ '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD', description: 'Free: one contract at a time.' }");
		expect(count(landing, "name: 'Standard'")).toBe(1);
		expect(landing).toContain("price: '95'");
		expect(landing).toContain("unitText: 'MONTH'");
	});

	it('the copy says what the code enforces', () => {
		expect(LANDING_PRICE).toBe('Free: one contract at a time. $95 a month for ten.');
		expect(CONTRACT_DEFINITION).toMatch(/^A contract is one open record: /);
		expect(CONTRACT_DEFINITION).toContain('not yet released');
		expect(CONTRACT_DEFINITION).toContain('not yet closed');
	});
});

describe('the desk plan line', () => {
	it('is placed once, under the lede, and worded from the same copy', () => {
		const desk = read('src/pages/verify/desk.astro');
		expect(count(desk, '<PlanLine />')).toBe(1);
		expect(desk.indexOf('<PlanLine />')).toBeGreaterThan(desk.indexOf('class="lede"'));
		expect(desk.indexOf('<PlanLine />')).toBeLessThan(desk.indexOf('<NoticeInbox />'));
		const client = read('src/components/receivables/PlanLine/planLine.client.ts');
		expect(client).toContain("from '@/lib/receivables/copy/plan'");
		expect(client).toContain("'/api/verify/receivables/plan'");
	});
});
