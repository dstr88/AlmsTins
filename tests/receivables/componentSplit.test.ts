import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECEIVABLES_HOSTS, RECEIVABLES_LANDING, entryModule, type ReceivablesHost } from '../helpers/receivablesHosts';

/**
 * Source pins for the receivables UI split (plan conventions 1-8; S1 sets the baselines).
 * Reads files only. Excluded from its own private-product scan, like s0a/s0bSourcePins.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const abs = (r: string) => path.join(ROOT, r);
const exists = (r: string) => fs.existsSync(abs(r));
const read = (r: string) => fs.readFileSync(abs(r), 'utf8');
const walk = (r: string): string[] => (!exists(r) ? [] : fs.readdirSync(abs(r), { withFileTypes: true })
	.flatMap((e) => (e.isDirectory() ? walk(`${r}/${e.name}`) : [`${r}/${e.name}`])));
const HOSTS = Object.keys(RECEIVABLES_HOSTS) as ReceivablesHost[];
const frontmatter = (src: string) => /^---\r?\n([\s\S]*?)\r?\n---/.exec(src)?.[1] ?? '';
const lcFirst = (s: string) => s[0].toLowerCase() + s.slice(1);

const COMPONENT_FILES = walk('src/components/receivables');
const LIB_FILES = walk('src/lib/receivables');
const CLIENT_LIB_FILES = LIB_FILES.filter((f) => f.startsWith('src/lib/receivables/client/'));
const COPY_FILES = LIB_FILES.filter((f) => f.startsWith('src/lib/receivables/copy/'));
const UI_FILES = [...COMPONENT_FILES, ...CLIENT_LIB_FILES];
const UI_CODE = UI_FILES.filter((f) => /\.(ts|tsx|astro)$/.test(f));

// Imports: side-effect, value, re-export, dynamic; both quotes. Type-only imports are erased at
// build time and skipped (hostBridge imports registry TYPES only).
const SPEC_RE = /^\s*(?:import|export)\s+(?!type\s)(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm;
const importsOf = (src: string) => [...src.matchAll(SPEC_RE)].map((m) => m[1] ?? m[2]);
function resolveSpec(from: string, spec: string): string | null {
	const base = spec.startsWith('@/') ? `src/${spec.slice(2)}`
		: spec.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(from), spec))
		: null;
	if (!base) return null;
	return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((c) => exists(c) && fs.statSync(abs(c)).isFile()) ?? null;
}
function reach(start: string): { files: string[]; bare: string[] } {
	const seen = new Set<string>([start]);
	const bare = new Set<string>();
	const queue = [start];
	while (queue.length) {
		const f = queue.shift()!;
		if (!/\.(ts|tsx)$/.test(f)) continue;
		for (const spec of importsOf(read(f))) {
			const r = resolveSpec(f, spec);
			if (r) { if (!seen.has(r)) { seen.add(r); queue.push(r); } } else bare.add(spec);
		}
	}
	return { files: [...seen], bare: [...bare] };
}
const SERVER_ONLY = (f: string) => /\/server\//.test(f) || f === 'src/lib/db.ts' || f === 'src/lib/receivablesRegistry.ts';

// Host scripts
const ENTRY_TAG = (h: ReceivablesHost) => `<script>import '@/lib/receivables/client/pages/${h}';</script>`;
const SCRIPT_TAGS: Record<ReceivablesHost, string[]> = {
	desk: ['<script type="application/json" id="terms-data" set:html={JSON.stringify(TERMS)}>', '<script>', '<script>'],
	registry: ['<script>', '<script>'],
	client: ['<script>', '<script>'],
};
function inlineScriptLines(src: string): string[] {
	const blocks = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].filter((m) => m[1].includes('\n'));
	if (blocks.length !== 1) throw new Error(`expected one multi-line <script>, found ${blocks.length}`);
	return blocks[0][1].split('\n').slice(1, -1);
}
const isImportLine = (l: string) => /^\s*import\s/.test(l);
const isEmitLine = (l: string) => /^\s*hostBridge\.emit[A-Z]\w*\([^;]*\);\s*$/.test(l);
const budgetOf = (src: string) => inlineScriptLines(src).filter((l) => !isImportLine(l) && !isEmitLine(l)).length;
/** Pre-S1 (61ae9634): desk 1376, registry 548, client 180. S1 records its post-move numbers
 *  here (section 5.2 of the S1 spec). Later slices may only lower them.
 *  Aging A2 moves the desk's claim-status mechanics into claimAging.client: 1280 → 1261. */
const INLINE_BUDGET: Record<ReceivablesHost, number> = { desk: 1261, registry: 461, client: 163 };
const STYLE_BUDGET: Record<ReceivablesHost, number> = { desk: 382, registry: 146, client: 96 };
const EMITS: Record<ReceivablesHost, { record: number; book: number; created: number }> = {
	desk: { record: 2, book: 1, created: 1 }, registry: { record: 2, book: 1, created: 1 }, client: { record: 1, book: 1, created: 1 },
};
/** S4: each host places one create-form flag and one record flag, and the debtor reference field once. */
const S4_TAGS: Record<ReceivablesHost, readonly string[]> = {
	desk: ['<DuplicateFlag variant="desk" name="create" />', '<DuplicateFlag variant="desk" name="record" />', '<BuyerRefField variant="desk" id="n-ref" />'],
	registry: ['<DuplicateFlag variant="registry" name="create" />', '<DuplicateFlag variant="registry" name="record" />', '<BuyerRefField variant="registry" id="c-buyerref" />'],
	client: ['<DuplicateFlag variant="client" name="create" />', '<DuplicateFlag variant="client" name="record" />', '<BuyerRefField variant="client" id="f-ref" />'],
};
/** Components with no behavior of their own: markup and CSS only, no .client.ts. */
const MARKUP_ONLY = new Set(['BuyerRefField']);
const ACK_ROOTS: Record<ReceivablesHost, string | null> = {
	desk: '<AckPrompt variant="desk" name="claim" returnFocus="c-go" />', registry: '<AckPrompt variant="registry" name="claim" returnFocus="k-btn" />', client: null,
};

// Tokens
const stripCss = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const definedProps = (css: string) => new Set([...stripCss(css).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
const usedProps = (css: string) => [...stripCss(css).matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
const TOKENS = definedProps(read('src/styles/tokens.css'));
const TONES = 'src/components/receivables/ui/tones.css';

// Private-product pin. The allowlisted lines are compared untrimmed.
const PRIVATE = /cairn|milestone/i;
const PRIVATE_ALLOWED_LINES: Record<string, readonly string[]> = {
	[RECEIVABLES_HOSTS.desk]: ["// Currency default follows the visitor (same as the cairn desk): Render's Cloudflare"],
	[RECEIVABLES_HOSTS.registry]: ['            <option value="contract">Contract receivable</option><option value="milestone">Milestone receivable</option>'],
	[RECEIVABLES_HOSTS.client]: [],
	[RECEIVABLES_LANDING]: [
		'// The milestone desk (construction/tranche financing — "cairn") is a separate product',
		'// page" apart from "page exists but you\'re not allowed"). Link to /verify/cairn',
		'const milestoneDesk = {',
		"  href: '/verify/cairn',",
		"  title: 'Milestone Desk',",
		"  body: 'A sealed, signed milestone schedule. An independent inspector answers each one from the site, reached, not reached, or disputed, stamped to Bitcoin. It proves the milestone; the lender still decides the tranche.',",
		'    <!-- The tools: three invoice-financing tools in one tile, plus the milestone desk',
		'        <a class="rtile rtile--milestone" href={milestoneDesk.href}>',
		'          <span class="rtile__badge">Milestones</span>',
		'          <span class="rtile__milestone-title">{milestoneDesk.title}<span class="rtool__arrow" aria-hidden="true">→</span></span>',
		'          <span class="rtile__milestone-body">{milestoneDesk.body}</span>',
		'  .rtile--milestone {',
		'  .rtile--milestone:hover { background: var(--surface-hover); border-color: var(--border-bright); }',
		'  .rtile__milestone-title { display: flex; align-items: center; gap: 0.5rem; font-size: 1.1rem; font-weight: 800; color: var(--text-primary); }',
		'  .rtile__milestone-body { font-size: 0.88rem; color: var(--text-muted); line-height: 1.6; }',
	],
};
const PRIVATE_SCAN = [
	...COMPONENT_FILES, ...LIB_FILES,
	...walk('src/components/docs'), ...walk('src/components/proofKit'),
	...walk('src/pages/receivables'),
	...walk('src/layouts').filter((f) => /\/(ApiDocsLayout|ReceivablesTokenLayout)\./.test(f)),
	...['src/lib/http/publicApi.ts'].filter(exists),
	...walk('tests/helpers'),
	...walk('tests/receivables').filter((f) => !/\/(s0aSourcePins|s0bSourcePins|componentSplit)\.test\.ts$/.test(f)),
];
const privateLines = (f: string) => read(f).split('\n').filter((l) => PRIVATE.test(l));

describe('private-product pin', () => {
	it('host pages and the landing match the exact allowlist', () => {
		for (const f of [...Object.values(RECEIVABLES_HOSTS), RECEIVABLES_LANDING]) expect(privateLines(f), f).toEqual(PRIVATE_ALLOWED_LINES[f]);
	});
	it('every new file is clean', () => {
		for (const f of PRIVATE_SCAN) expect(privateLines(f), f).toEqual(PRIVATE_ALLOWED_LINES[f] ?? []);
	});
});

describe('tokens', () => {
	it('the parser sees the 22 tokens, the --warning trio included', () => {
		expect(TOKENS.size).toBe(22);
		for (const t of ['--warning', '--warning-bg', '--warning-border']) expect(TOKENS.has(t)).toBe(true);
	});
	it('canary: the undefined --warn-* pair on desk L89 is caught', () => {
		const line = '.verdict.partial { background: var(--warn-bg, var(--accent-soft)); border-color: var(--warn-border, var(--accent-glow)); }';
		expect(usedProps(line).filter((v) => !TOKENS.has(v))).toEqual(['--warn-bg', '--warn-border']);
	});
	it('tones.css defines only --rcv-* aliases, each over a real token', () => {
		const css = read(TONES);
		for (const d of definedProps(css)) expect(d).toMatch(/^--rcv-/);
		for (const u of usedProps(css)) expect(TOKENS.has(u), u).toBe(true);
	});
	it('each tone alias reads its own family (caution = warning, gain = gain, loss = loss)', () => {
		// The pills looked this way before S1 (registry .rag-*): a swap such as
		// --rcv-caution: var(--loss) would still pass the "real token" check above.
		const decls = Object.fromEntries([...read(TONES).matchAll(/(--rcv-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
		expect(decls).toEqual({
			'--rcv-caution': 'var(--warning)', '--rcv-caution-bg': 'var(--warning-bg)', '--rcv-caution-border': 'var(--warning-border)',
			'--rcv-gain': 'var(--gain)', '--rcv-gain-bg': 'var(--gain-bg)', '--rcv-gain-border': 'var(--gain-border)',
			'--rcv-loss': 'var(--loss)', '--rcv-loss-bg': 'var(--loss-bg)', '--rcv-loss-border': 'var(--loss-border)',
		});
	});
	it('every var() in receivables CSS is defined; no raw colors; tones only through tones.css', () => {
		const tones = definedProps(read(TONES));
		for (const f of COMPONENT_FILES.filter((x) => x.endsWith('.css'))) {
			const css = read(f);
			const own = definedProps(css);
			expect(usedProps(css).filter((v) => !TOKENS.has(v) && !tones.has(v) && !own.has(v)), f).toEqual([]);
			expect(stripCss(css), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|color-mix)\(/);
			if (f !== TONES) expect(stripCss(css), f).not.toMatch(/var\(\s*--(?:warning|gain|loss)\b/);
		}
	});
});

describe('host pages', () => {
	for (const h of HOSTS) {
		const src = () => read(RECEIVABLES_HOSTS[h]);
		it(`${h}: script tags are exactly the expected set`, () => {
			expect([...src().matchAll(/<script\b[^>]*>/g)].map((m) => m[0])).toEqual(SCRIPT_TAGS[h]);
		});
		it(`${h}: exactly one entry-module <script> line, and the module exists`, () => {
			expect(src().split('\n').filter((l) => l.trim() === ENTRY_TAG(h))).toHaveLength(1);
			expect(exists(entryModule(h)), entryModule(h)).toBe(true);
		});
		it(`${h}: inline script within its budget`, () => {
			expect(budgetOf(src())).toBeLessThanOrEqual(INLINE_BUDGET[h]);
		});
		it(`${h}: one <style> block, within its budget`, () => {
			const blocks = [...src().matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)];
			expect(blocks).toHaveLength(1);
			expect(blocks[0][1].split('\n').length - 2).toBeLessThanOrEqual(STYLE_BUDGET[h]);
		});
		it(`${h}: inline-script imports come only from receivables modules, one per line`, () => {
			for (const l of inlineScriptLines(src()).filter(isImportLine)) {
				expect(l).toMatch(/^\s*import (?:\{[^}]*\}|\* as \w+) from '@\/(?:lib|components)\/receivables\/[^']+';$/);
			}
		});
		it(`${h}: one hostBridge namespace import and the pinned emits`, () => {
			const lines = inlineScriptLines(src());
			expect(lines.filter((l) => l.trim() === "import * as hostBridge from '@/lib/receivables/client/hostBridge';")).toHaveLength(1);
			expect(lines.filter((l) => /hostBridge\.emitRecordLoaded\(/.test(l))).toHaveLength(EMITS[h].record);
			expect(lines.filter((l) => /hostBridge\.emitBookLoaded\(/.test(l))).toHaveLength(EMITS[h].book);
			expect(lines.filter((l) => /hostBridge\.emitCreateResult\(/.test(l))).toHaveLength(EMITS[h].created);
		});
		it(`${h}: one create-form flag, one record flag and one debtor reference field (S4)`, () => {
			const s = src();
			for (const tag of S4_TAGS[h]) expect(s.split(tag).length - 1, tag).toBe(1);
			expect((s.match(/<DuplicateFlag\b/g) ?? []).length).toBe(2);
			expect((s.match(/<BuyerRefField\b/g) ?? []).length).toBe(1);
		});
		it(`${h}: the create form is one root, and its fields are marked for the live check (S4)`, () => {
			const s = src();
			expect(s.split('data-rcv-root="create-form"').length - 1).toBe(1);
			for (const f of ['supplier', 'buyer', 'invoiceNo', 'face', 'currency']) expect(s.split(`data-rcv-field="${f}"`).length - 1, f).toBe(1);
			// The debtor reference is marked inside BuyerRefField, never on the host.
			expect(s).not.toContain('data-rcv-field="buyerRef"');
		});
		it(`${h}: imports fragments.css once in frontmatter`, () => {
			expect(frontmatter(src()).match(/^import '@\/components\/receivables\/fragments\.css';$/gm)).toHaveLength(1);
		});
		it(`${h}: the claim prompt root appears once (or not at all)`, () => {
			const tag = ACK_ROOTS[h];
			const n = (src().match(/<AckPrompt\b/g) ?? []).length;
			if (tag) { expect(n).toBe(1); expect(src()).toContain(tag); } else expect(n).toBe(0);
		});
		it(`${h}: no claim-warning handling outside claimFlow`, () => {
			expect(src()).not.toMatch(/['"`](?:possible_duplicate|tokenized_receivable|exceeds_headroom|diligence_required)['"`]/);
			expect(src()).not.toContain('/api/verify/receivables/diligence-accept');
			expect(src()).not.toContain('/api/verify/receivables/claim');
		});
		it(`${h}: the migrated duplicates are gone`, () => {
			const s = src();
			for (const gone of ['Timestamp submitted to Bitcoin', 'navigator.clipboard', 'function rag(', 'function anchorPill(',
				'acceptDiligencePrompt', 'Refused. This would be a duplicate.', 'The write was rejected', 'rcv.disputed',
				'tpill', 'class="rag', 'No debtor confirmation is on record', 'Record it anyway',
				// S4: the claimed-only mark reads relation and comes from the StatusPill helper.
				'mine === false', 'claimed only</span>', 'near-duplicate']) {
				expect(s, `${h}: ${gone}`).not.toContain(gone);
			}
		});
	}
	it('the anchor route is called from hosts only by the registry watch and anchorReq', () => {
		const lines = (f: string) => read(f).split('\n').filter((l) => l.includes('/api/verify/receivables/anchor'));
		expect(lines(RECEIVABLES_HOSTS.desk)).toEqual([]);
		expect(lines(RECEIVABLES_HOSTS.client)).toEqual([]);
		expect(lines(RECEIVABLES_HOSTS.registry).map((l) => l.trim().slice(0, 40))).toEqual([
			"try { await fetch('/api/verify/receivabl",
			"const j = await authedPost('/api/verify/",
		]);
	});
});

describe('new UI files', () => {
	it('no .ts under src/components/receivables or src/lib/receivables imports CSS', () => {
		for (const f of [...COMPONENT_FILES, ...LIB_FILES].filter((x) => x.endsWith('.ts'))) {
			expect(importsOf(read(f)).filter((s) => /\.css(\?|$)/.test(s)), f).toEqual([]);
		}
	});
	it('copy modules are import-free', () => {
		for (const f of COPY_FILES) expect(importsOf(read(f)), f).toEqual([]);
	});
	it('no style writes and no style strings', () => {
		for (const f of UI_CODE) expect(read(f), f).not.toMatch(/\.style\b|\bstyle\s*=|setAttribute\(\s*['"]style['"]|\bcssText\b|<style\b/);
	});
	it('innerHTML only from an allowlisted fragment helper', () => {
		// The whole right-hand side must be one helper call: nothing concatenated after it.
		const HELPER = /^(?:statusPillHtml|anchorPillHtml|agingPillHtml)\s*\([^+`;]*\)$/; // later slices add publicationBadgeHtml, publicPreviewHtml
		expect('statusPillHtml(recordPill(rcv))').toMatch(HELPER);
		expect('agingPillHtml(c.aging)').toMatch(HELPER);
		expect('statusPillHtml(view) + raw').not.toMatch(HELPER);
		expect('anchorPillHtml(kind, rec) + `<b>${x}</b>`').not.toMatch(HELPER);
		expect('agingPillHtml(state) + extra').not.toMatch(HELPER);
		for (const f of UI_CODE) {
			const s = read(f);
			expect(s, f).not.toMatch(/\binsertAdjacentHTML\s*\(|\bdocument\.write\s*\(|\.outerHTML\s*\+?=/);
			for (const m of s.matchAll(/\.innerHTML\s*(\+?=)\s*([^;\n]*)/g)) {
				expect(m[1], `${f}: innerHTML +=`).toBe('=');
				expect(m[2].trim(), f).toMatch(HELPER);
			}
		}
	});
	it('component .astro: markup only, imports its sibling .css', () => {
		for (const f of COMPONENT_FILES.filter((x) => x.endsWith('.astro'))) {
			const s = read(f);
			expect(s, f).not.toMatch(/<script\b|<style\b|\bstyle\s*=/);
			const name = path.posix.basename(f, '.astro');
			expect(frontmatter(s), f).toMatch(new RegExp(`^import '\\./${name}\\.css';$`, 'm'));
		}
	});
	it('mounted widgets come as .astro + .css + .client.ts (markup-only components: no .client.ts)', () => {
		for (const f of COMPONENT_FILES.filter((x) => x.endsWith('.astro'))) {
			const dir = path.posix.dirname(f);
			const name = path.posix.basename(f, '.astro');
			expect(exists(`${dir}/${name}.css`), `${dir}/${name}.css`).toBe(true);
			expect(exists(`${dir}/${lcFirst(name)}.client.ts`), `${dir}/${lcFirst(name)}.client.ts`).toBe(!MARKUP_ONLY.has(name));
		}
	});
	it('a markup-only component renders no data-rcv-root (nothing mounts it)', () => {
		for (const name of MARKUP_ONLY) expect(read(`src/components/receivables/${name}/${name}.astro`)).not.toContain('data-rcv-root');
	});
	it('every receivables .css is imported by its .astro, its .tsx, or fragments.css', () => {
		const fragments = read('src/components/receivables/fragments.css');
		const viaFragments = new Set([...fragments.matchAll(/@import\s+(?:url\()?\s*['"]([^'"]+)['"]/g)]
			.map((m) => path.posix.normalize(path.posix.join('src/components/receivables', m[1]))));
		for (const f of COMPONENT_FILES.filter((x) => x.endsWith('.css') && !x.endsWith('/fragments.css'))) {
			const dir = path.posix.dirname(f);
			const base = path.posix.basename(f);
			const siblings = fs.readdirSync(abs(dir)).filter((x) => /\.(astro|tsx)$/.test(x)).map((x) => read(`${dir}/${x}`));
			expect(siblings.some((s) => s.includes(`'./${base}'`)) || viaFragments.has(f), f).toBe(true);
		}
	});
	it('every receivables .css opens with the presentation-only header', () => {
		for (const f of COMPONENT_FILES.filter((x) => x.endsWith('.css'))) expect(read(f), f).toMatch(/^\/\* [\w.]+ — presentation only\./);
	});
	it('client-side modules never reach server code or the database', () => {
		const roots = [...COMPONENT_FILES, ...LIB_FILES].filter((x) => /\.tsx?$/.test(x) && !x.includes('/server/'));
		for (const r of roots) {
			const { files, bare } = reach(r);
			expect(files.filter(SERVER_ONLY), r).toEqual([]);
			expect(bare.filter((b) => /^(node:|crypto$|fs$|path$)/.test(b) || b === '@/lib/db'), r).toEqual([]);
		}
	});
	it('importing a non-entry module has no top-level side effects', () => {
		for (const f of UI_CODE.filter((x) => x.endsWith('.ts') && !x.includes('/client/pages/'))) {
			expect(read(f).split('\n').filter((l) => /^(?:document|window|globalThis)\b|^[A-Za-z_$][\w$.]*\s*\(/.test(l)), f).toEqual([]);
		}
	});
	it('entry modules select roots by data-rcv-root only, never document-wide ids', () => {
		for (const h of HOSTS) expect(read(entryModule(h)), h).not.toMatch(/getElementById\(|querySelector(All)?\(\s*['"`]#/);
	});
	it('hostBridge touches no DOM, globals or network', () => {
		expect(read('src/lib/receivables/client/hostBridge.ts')).not.toMatch(/\b(document|window|globalThis|localStorage|fetch)\b/);
	});
});
