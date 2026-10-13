import { describe, it, expect, afterEach, vi } from 'vitest';
import { anchorAfterWrite } from '../../src/lib/receivables/client/anchorAfterWrite';
import { ANCHOR_AFTER_WRITE, type AnchorAfterWriteCopy } from '../../src/lib/receivables/copy/anchor';

/**
 * src/lib/receivables/client/anchorAfterWrite.ts: the one copy of "timestamp the record I just
 * wrote" that replaced four inline copies on the desk, the registry page and the client portal.
 * The request must stay byte for byte what those copies sent, and the status line must be looked
 * up only once the answer is in (the note it lives in may have been replaced meanwhile).
 */

const COPY: AnchorAfterWriteCopy = { submitted: 'SUBMITTED', notSubmitted: 'NOT SUBMITTED', unreachable: 'UNREACHABLE' };

interface Harness {
	fetch: ReturnType<typeof vi.fn>;
	getElementById: ReturnType<typeof vi.fn>;
	el: { textContent: string } | null;
	log: string[];
}

/** body: what .json() resolves to; 'reject' rejects fetch; 'json-reject' rejects .json(). */
function stub(body: unknown, opts: { el?: boolean } = {}): Harness {
	const log: string[] = [];
	const el = opts.el === false ? null : { textContent: 'BEFORE' };
	const fetch = vi.fn(async () => {
		log.push('fetch');
		if (body === 'reject') throw new TypeError('network down');
		return {
			json: async () => {
				log.push('json');
				if (body === 'json-reject') throw new SyntaxError('bad json');
				return body;
			},
		};
	});
	const getElementById = vi.fn((id: string) => { log.push(`getElementById:${id}`); return el; });
	vi.stubGlobal('fetch', fetch);
	vi.stubGlobal('document', { getElementById });
	return { fetch, getElementById, el, log };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('the request', () => {
	it('posts exactly what the four inline copies posted', async () => {
		const h = stub({ ok: true });
		await anchorAfterWrite('claim', 'x', 'k-anchor', COPY);
		expect(h.fetch).toHaveBeenCalledTimes(1);
		const [url, init] = h.fetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/verify/receivables/anchor');
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
		expect(init.body).toBe('{"kind":"claim","id":"x"}');
		expect(Object.keys(init).sort()).toEqual(['body', 'headers', 'method']);
	});

	it('never asks for an upgrade, for every page kind', async () => {
		for (const kind of ['receivable', 'claim', 'attestation'] as const) {
			const h = stub({ ok: true });
			await anchorAfterWrite(kind, 'id1', 's', COPY);
			expect((h.fetch.mock.calls[0] as [string, RequestInit])[1].body).toBe(JSON.stringify({ kind, id: 'id1' }));
			vi.unstubAllGlobals();
		}
	});

	it('the fetch is issued synchronously, before the returned promise is awaited', () => {
		const h = stub({ ok: true });
		const p = anchorAfterWrite('claim', 'x', 'k-anchor', COPY);
		expect(h.fetch).toHaveBeenCalledTimes(1);
		expect(h.getElementById).not.toHaveBeenCalled();
		return p;
	});
});

describe('what the status line says', () => {
	it('ok: submitted', async () => {
		const h = stub({ ok: true });
		await expect(anchorAfterWrite('claim', 'x', 'k-anchor', COPY)).resolves.toBe('submitted');
		expect(h.getElementById).toHaveBeenCalledWith('k-anchor');
		expect(h.el!.textContent).toBe('SUBMITTED');
	});

	it('ok:false, an empty body or null: not submitted', async () => {
		for (const body of [{ ok: false, error: 'x' }, {}, null]) {
			const h = stub(body);
			await expect(anchorAfterWrite('claim', 'x', 's', COPY)).resolves.toBe('not_submitted');
			expect(h.el!.textContent).toBe('NOT SUBMITTED');
			vi.unstubAllGlobals();
		}
	});

	it('fetch rejects: unreachable', async () => {
		const h = stub('reject');
		await expect(anchorAfterWrite('claim', 'x', 's', COPY)).resolves.toBe('unreachable');
		expect(h.el!.textContent).toBe('UNREACHABLE');
	});

	it('.json() rejects: unreachable', async () => {
		const h = stub('json-reject');
		await expect(anchorAfterWrite('claim', 'x', 's', COPY)).resolves.toBe('unreachable');
		expect(h.el!.textContent).toBe('UNREACHABLE');
	});

	it('unreachable: null leaves the line as it was (the desk)', async () => {
		const h = stub('reject');
		await expect(anchorAfterWrite('claim', 'x', 'k-anchor', ANCHOR_AFTER_WRITE.desk)).resolves.toBe('unreachable');
		expect(h.el!.textContent).toBe('BEFORE');
	});

	it('a missing element: no throw, and the outcome is still returned', async () => {
		for (const [body, outcome] of [[{ ok: true }, 'submitted'], [{ ok: false }, 'not_submitted'], ['reject', 'unreachable']] as const) {
			const h = stub(body, { el: false });
			await expect(anchorAfterWrite('claim', 'x', 'gone', COPY)).resolves.toBe(outcome);
			expect(h.getElementById).toHaveBeenCalledWith('gone');
			vi.unstubAllGlobals();
		}
	});

	it('each page keeps its own words', async () => {
		const cases = [
			['desk', { ok: true }, '⏳ Timestamp submitted to Bitcoin, pending a block (~1-2h). Its date can no longer be forged or backdated.'],
			['desk', { ok: false }, 'Signed. The Bitcoin timestamp did not submit; you can anchor it from the workbench.'],
			['registry', { ok: true }, '⏳ Timestamp submitted to Bitcoin, pending a block (~1-2h). Its date can no longer be forged or backdated.'],
			['registry', { ok: false }, 'Signed. The Bitcoin timestamp did not submit; you can anchor it from the status view.'],
			['registry', 'reject', 'Signed. Anchor to Bitcoin from the status view when ready.'],
			['client', { ok: true }, '⏳ Timestamp submitted to Bitcoin, pending a block (~1-2h). From now on this promise date cannot be forged or backdated.'],
			['client', { ok: false }, 'Signed and recorded. The Bitcoin timestamp did not submit; it can be anchored later.'],
			['client', 'reject', 'Signed and recorded. The Bitcoin timestamp can be added later.'],
		] as const;
		for (const [page, body, text] of cases) {
			const h = stub(body);
			await anchorAfterWrite('receivable', 'x', 's', ANCHOR_AFTER_WRITE[page]);
			expect(h.el!.textContent, `${page} ${JSON.stringify(body)}`).toBe(text);
			vi.unstubAllGlobals();
		}
	});
});

describe('ordering', () => {
	it('looks up the status element only after the answer arrived', async () => {
		let release!: (v: unknown) => void;
		const gate = new Promise((r) => { release = r; });
		const log: string[] = [];
		const el = { textContent: 'BEFORE' };
		const fetch = vi.fn(() => { log.push('fetch'); return gate.then(() => { log.push('fetch resolved'); return { json: async () => { log.push('json'); return { ok: true } } }; }); });
		const getElementById = vi.fn(() => { log.push('getElementById'); return el; });
		vi.stubGlobal('fetch', fetch);
		vi.stubGlobal('document', { getElementById });

		const p = anchorAfterWrite('claim', 'x', 's', COPY);
		await Promise.resolve();
		await Promise.resolve();
		expect(getElementById).not.toHaveBeenCalled();
		expect(el.textContent).toBe('BEFORE');

		release(undefined);
		await expect(p).resolves.toBe('submitted');
		expect(log).toEqual(['fetch', 'fetch resolved', 'json', 'getElementById']);
		expect(el.textContent).toBe('SUBMITTED');
	});

	it('on failure too, the lookup comes after the request settled', async () => {
		const h = stub('json-reject');
		await anchorAfterWrite('claim', 'x', 's', COPY);
		expect(h.log).toEqual(['fetch', 'json', 'getElementById:s']);
	});
});
