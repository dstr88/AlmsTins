import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * /api/yearEnd/1099/upload answered every request (anonymous GET and POST included) with an
 * empty 500 on production. The route imported pdf-parse at module scope as a default export,
 * which pdf-parse 2.x does not have (it exports a PDFParse class), so the built route module
 * failed to link and Astro gave up before the middleware's 401 could run. Vite and Vitest
 * interop hid it; plain Node ESM did not.
 *
 * pdf-parse now loads lazily, on the PDF path only, through the 2.x PDFParse API:
 *   - the route module loads without pdf-parse, so the CSV path always works;
 *   - a PDF upload when pdf-parse cannot load is a clear 503, not a 500;
 *   - a real 1099-DA PDF parses through the real pdf-parse (built in memory below).
 *
 * Hermetic: the session, the database and the annual breakdown are stubs. No file, network or
 * database access.
 */

const state = vi.hoisted(() => ({ session: null as null | { tenantId: string } }));
const data = vi.hoisted(() => ({
	dbExecute: vi.fn(async (_stmt: { sql: string; args: unknown[] }) => ({ rows: [], rowsAffected: 1 })),
	buildAnnualBreakdown: vi.fn(async () => ({ shortTerm: [], longTerm: [] })),
}));

vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => state.session }));
vi.mock('@/lib/authSession', () => ({
	getAuthSession: async () => (state.session ? { user: { id: 'user-1' }, tenantId: state.session.tenantId } : null),
}));
vi.mock('@/lib/db', () => ({ db: { execute: data.dbExecute } }));
vi.mock('@/lib/annualBreakdown', () => ({ buildAnnualBreakdown: data.buildAnnualBreakdown }));

import { OWNER_TENANT_ID } from '../../src/lib/owner';
import { getYearEndErrors } from '../../src/i18n/apiErrors/yearEnd';

const ROOT = path.resolve(__dirname, '../..');
const ROUTE = '../../src/pages/api/yearEnd/1099/upload';

type RouteModule = { POST: (ctx: unknown) => Promise<Response> };

/** A one-page PDF with the given text lines (Helvetica, valid xref), built in memory. */
function minimalPdf(lines: string[]): Uint8Array<ArrayBuffer> {
	const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
	const ops = ['BT', '/F1 10 Tf', '14 TL', '40 750 Td', ...lines.map((l) => `(${esc(l)}) Tj T*`), 'ET'].join('\n');
	const objs = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
		`<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
	];
	let out = '%PDF-1.4\n';
	const offsets: number[] = [];
	objs.forEach((body, i) => {
		offsets.push(Buffer.byteLength(out, 'latin1'));
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = Buffer.byteLength(out, 'latin1');
	out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
	out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
	out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Uint8Array.from(Buffer.from(out, 'latin1'));
}

// The PayPal-style 1099-DA layout parse1099DAPdf reads: an asset header, then a row of
// units, acquired, sold, proceeds, basis.
const PDF_1099DA = minimalPdf(['ETHEREUM (ETH) - X9J9K872S', '0.03303256 10/7/2025 12/22/2025 98.00 95.00']);

async function post(mod: RouteModule, file: File): Promise<Response> {
	const fd = new FormData();
	fd.set('file', file);
	fd.set('taxYear', '2025');
	const url = new URL('https://almstins.com/api/yearEnd/1099/upload');
	return mod.POST({ request: new Request(url, { method: 'POST', body: fd }), url, params: {} });
}

const csvFile = () => new File(['asset,proceeds,cost_basis\nETH,98.00,95.00\n'], '1099.csv', { type: 'text/csv' });
const pdfFile = () => new File([PDF_1099DA], '1099-da.pdf', { type: 'application/pdf' });

/** parsed_json of the tax_1099_uploads insert. */
const storedRows = () => {
	const insert = data.dbExecute.mock.calls.map(([stmt]) => stmt).find((s) => /INSERT INTO tax_1099_uploads/.test(s.sql));
	return insert ? JSON.parse(String(insert.args[9])) : null;
};

beforeEach(() => {
	state.session = { tenantId: OWNER_TENANT_ID };
	data.dbExecute.mockClear();
	data.buildAnnualBreakdown.mockClear();
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.resetModules();
});

afterEach(() => {
	vi.doUnmock('pdf-parse');
	vi.restoreAllMocks();
});

describe('the 1099 upload route loads without pdf-parse', () => {
	beforeEach(() => {
		// Any load of pdf-parse fails, the way a broken PDF stack would on the server.
		vi.doMock('pdf-parse', () => {
			throw new Error('pdf-parse must not load at module scope');
		});
	});

	it('the route module imports and exposes POST', async () => {
		const mod = (await import(ROUTE)) as RouteModule;
		expect(typeof mod.POST).toBe('function');
	});

	it('a CSV upload still works for the owner', async () => {
		const mod = (await import(ROUTE)) as RouteModule;
		const res = await post(mod, csvFile());
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true, rowCount: 1 });
		expect(storedRows()).toEqual([expect.objectContaining({ asset: 'ETH', proceeds: 98, costBasis: 95 })]);
	});

	it('a PDF upload answers 503 with a message pointing to CSV, not an empty 500', async () => {
		const mod = (await import(ROUTE)) as RouteModule;
		const res = await post(mod, pdfFile());
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ ok: false, error: getYearEndErrors('en').pdfReaderUnavailable });
		expect(data.dbExecute).not.toHaveBeenCalled();
	});
});

describe('a real 1099-DA PDF parses through the pdf-parse 2.x API', () => {
	it('extracts the ETH row and stores it', async () => {
		const mod = (await import(ROUTE)) as RouteModule;
		const res = await post(mod, pdfFile());
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true, rowCount: 1 });
		expect(storedRows()).toEqual([
			expect.objectContaining({ asset: 'ETH', proceeds: 98, costBasis: 95, acquiredAt: '10/7/2025', disposedAt: '12/22/2025' }),
		]);
	});
});

describe('source pin: pdf-parse is never imported at module scope', () => {
	function listFiles(rel: string): string[] {
		return readdirSync(path.join(ROOT, rel)).flatMap((name) => {
			const childRel = `${rel}/${name}`;
			return statSync(path.join(ROOT, childRel)).isDirectory() ? listFiles(childRel) : [childRel];
		});
	}

	it('no file under src has a static import of pdf-parse', () => {
		const offenders = listFiles('src')
			.filter((f) => /\.(ts|tsx|js|mjs|astro)$/.test(f))
			.filter((f) => /^\s*import\s[^;]*?from\s*['"]pdf-parse(\/[^'"]*)?['"]/m.test(readFileSync(path.join(ROOT, f), 'utf8')));
		expect(offenders).toEqual([]);
	});

	it('the upload route loads it inside the PDF path through the PDFParse class', () => {
		const src = readFileSync(path.join(ROOT, 'src/pages/api/yearEnd/1099/upload.ts'), 'utf8');
		expect(src).toMatch(/\(\{ PDFParse \} = await import\('pdf-parse'\)\)/);
		expect(src).not.toMatch(/\bpdfParse\(/);
	});
});
