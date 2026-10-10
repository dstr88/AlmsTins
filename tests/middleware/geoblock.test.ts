import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Sanctions geo-block: either country signal blocks. The bundled geoip-lite data ages
 * between releases; on 2026-10-10 Google Analytics showed a visitor from Iran whom the
 * block, relying on geoip-lite alone, had let through. Cloudflare's cf-ipcountry, set on
 * every request by the network in front of Render, is now checked too.
 */

const geo = vi.hoisted(() => ({ answer: null as null | { country: string; region: string } }));
vi.mock('geoip-lite', () => ({ default: { lookup: () => geo.answer } }));

import { getGeoblockResponse, isBlockedRequest } from '../../src/middleware/geoblock';

function req(headers: Record<string, string>): Request {
	return new Request('https://almstins.com/', { headers });
}

beforeEach(() => { geo.answer = null; });

describe('sanctions geo-block', () => {
	it.each(['IR', 'CU', 'KP', 'SY'])('blocks when Cloudflare says %s, even if the bundled data disagrees', async (cc) => {
		geo.answer = { country: 'DE', region: '' };
		const res = await getGeoblockResponse(req({ 'cf-ipcountry': cc, 'cf-connecting-ip': '203.0.113.7' }));
		expect(res?.status).toBe(451);
	});

	it('blocks when Cloudflare says sanctioned and there is no client IP at all', () => {
		expect(isBlockedRequest(req({ 'cf-ipcountry': 'ir' }))).toBe(true);
	});

	it('still blocks on the bundled data when Cloudflare places the visitor elsewhere', async () => {
		geo.answer = { country: 'IR', region: '' };
		const res = await getGeoblockResponse(req({ 'cf-ipcountry': 'DE', 'cf-connecting-ip': '203.0.113.7' }));
		expect(res?.status).toBe(451);
	});

	it('still blocks the sanctioned regions of Ukraine from the bundled data', () => {
		geo.answer = { country: 'UA', region: '43' };
		expect(isBlockedRequest(req({ 'cf-ipcountry': 'UA', 'cf-connecting-ip': '203.0.113.7' }))).toBe(true);
	});

	it('lets an ordinary visitor through', async () => {
		geo.answer = { country: 'US', region: 'TN' };
		expect(await getGeoblockResponse(req({ 'cf-ipcountry': 'US', 'cf-connecting-ip': '203.0.113.7' }))).toBeNull();
	});

	it('treats unknown and Tor country codes as unknown, not as a block', () => {
		expect(isBlockedRequest(req({ 'cf-ipcountry': 'XX' }))).toBe(false);
		expect(isBlockedRequest(req({ 'cf-ipcountry': 'T1' }))).toBe(false);
		expect(isBlockedRequest(req({}))).toBe(false);
	});

	it('serves no analytics on the block page', async () => {
		const res = await getGeoblockResponse(req({ 'cf-ipcountry': 'IR' }));
		expect(await res!.text()).not.toMatch(/googletagmanager|gtag/);
	});
});
