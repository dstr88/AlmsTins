#!/usr/bin/env node
/**
 * One-off codemod (Area 7 of the shared pieces refactor): replace each file's local json()
 * response helper with `import { json } from '@/lib/http'`, keeping that file's exact behavior.
 *
 *   node scripts/codemods/http-json.mjs [--dry] <file>...
 *
 * For every file it:
 *   1. finds the one top-level `function json(` / `const json = (...) =>` helper;
 *   2. matches the helper's text (whitespace, parameter name, return type and trailing commas
 *      ignored) against the known variants below, and stops on anything else;
 *   3. finds every reference to that helper with the TypeScript checker (so an inner
 *      `const json = await res.json()` is left alone), stops unless each one is a plain call,
 *      and adds the variant's options to each call (`json(b)` -> `json(b, 200, OPTS)`);
 *   4. deletes the helper and imports the shared one.
 * Anything it cannot do safely is reported and the file is left untouched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require(path.resolve('node_modules/typescript'));

const CT = `'Content-Type': 'application/json'`;
const NS = `'Cache-Control': 'no-store'`;

// Normalized helper text -> how each call carries the same behavior.
//   opts:  the options object every call gets (null: none)
//   extra: for helpers with a third `extra` headers argument, how a given third argument becomes
//          the options object
const VARIANTS = [
	{ name: 'plain', body: `new Response(JSON.stringify(body), { status, headers: { ${CT} } })`, opts: null },
	{ name: 'pretty', body: `new Response(JSON.stringify(body, null, 2), { status, headers: { ${CT} } })`, opts: '{ pretty: true }' },
	{ name: 'noStore', body: `new Response(JSON.stringify(body), { status, headers: { ${CT}, ${NS} } })`, opts: '{ noStore: true }' },
	{
		// aave-rates.ts: its corsHeaders() already carries the content type.
		name: 'cors',
		body: `new Response(JSON.stringify(body), { status, headers: corsHeaders() })`,
		opts: '{ headers: corsHeaders() }',
	},
	{
		// verify/check.ts: HEADERS = content type + no-store + open CORS, then per-call extras.
		name: 'checkHeaders',
		params: 'extra',
		body: `new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } })`,
		opts: '{ headers: HEADERS }',
		extra: (x) => `{ headers: { ...HEADERS, ...${x} } }`,
		extraLiteral: (inner) => `{ headers: { ...HEADERS, ${inner} } }`,
	},
	{
		// year-summary/proof-bundle.ts: pretty, then per-call extras.
		name: 'prettyExtra',
		params: 'extra',
		body: `new Response(JSON.stringify(body, null, 2), { status, headers: { ${CT}, ...extra } })`,
		opts: '{ pretty: true }',
		extra: (x) => `{ pretty: true, headers: ${x} }`,
	},
];

function normalize(text) {
	return text
		.replace(/\s+/g, ' ')
		.replace(/,\s*([}\])])/g, ' $1')
		.replace(/\s+/g, ' ')
		.trim();
}

/** The helper's parameters and returned expression, normalized, or null if it is not a single return. */
function describeHelper(fn, sf) {
	const params = fn.parameters.map((p) => p.name.getText(sf));
	if (params.length < 2 || params.length > 3) return null;
	let expr;
	if (ts.isBlock(fn.body)) {
		if (fn.body.statements.length !== 1 || !ts.isReturnStatement(fn.body.statements[0])) return null;
		expr = fn.body.statements[0].expression;
	} else expr = fn.body;
	while (ts.isParenthesizedExpression(expr)) expr = expr.expression;
	let body = normalize(expr.getText(sf));
	// The first parameter is called body or data; read it as body.
	if (params[0] !== 'body') body = body.replace(new RegExp(`JSON\\.stringify\\(${params[0]}\\b`), 'JSON.stringify(body');
	if (params[1] !== 'status') return null;
	// `status: number` (required) and `status = 200` behave the same for callers that pass it.
	const status = fn.parameters[1];
	if (status.initializer && status.initializer.getText(sf) !== '200') return null;
	if (params.length === 3 && params[2] !== 'extra') return null;
	return { body, third: params[2] ?? null };
}

function findHelper(sf) {
	const found = [];
	for (const st of sf.statements) {
		if (ts.isFunctionDeclaration(st) && st.name?.text === 'json') found.push({ stmt: st, fn: st, id: st.name });
		if (ts.isVariableStatement(st)) {
			for (const d of st.declarationList.declarations) {
				if (ts.isIdentifier(d.name) && d.name.text === 'json' && d.initializer &&
					(ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
					if (st.declarationList.declarations.length !== 1) return { error: 'json declared with other bindings' };
					found.push({ stmt: st, fn: d.initializer, id: d.name });
				}
			}
		}
	}
	if (found.length !== 1) return { error: `expected one top-level json helper, found ${found.length}` };
	const [h] = found;
	if (h.stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return { error: 'helper is exported' };
	return h;
}

function transform(file) {
	const src = fs.readFileSync(file, 'utf8');
	const program = ts.createProgram([file], { noResolve: true, noLib: true, allowJs: true, target: ts.ScriptTarget.Latest });
	const sf = program.getSourceFile(file);
	const checker = program.getTypeChecker();

	const h = findHelper(sf);
	if (h.error) return { error: h.error };
	const desc = describeHelper(h.fn, sf);
	if (!desc) return { error: 'helper shape not recognized' };
	const variant = VARIANTS.find((v) => v.body === desc.body && (v.params ?? null) === desc.third);
	if (!variant) return { error: `unknown variant: ${desc.body}` };

	const helperSym = checker.getSymbolAtLocation(h.id);
	const edits = []; // { start, end, text }
	const problems = [];
	let calls = 0;
	const visit = (n) => {
		if (ts.isIdentifier(n) && n.text === 'json' && n !== h.id && checker.getSymbolAtLocation(n) === helperSym) {
			const call = n.parent;
			if (!ts.isCallExpression(call) || call.expression !== n) {
				problems.push(`line ${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: used as a value`);
			} else if (call.arguments.some((a) => ts.isSpreadElement(a))) {
				problems.push(`line ${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: spread arguments`);
			} else {
				calls++;
				const args = call.arguments;
				if (args.length === 0 || args.length > 3) problems.push(`line ${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: ${args.length} arguments`);
				else if (args.length === 3) {
					if (!variant.extra) problems.push(`line ${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: third argument to a two-argument helper`);
					else {
						const a = args[2];
						let text;
						if (ts.isObjectLiteralExpression(a) && variant.extraLiteral) {
							const inner = a.properties.map((p) => p.getText(sf)).join(', ');
							text = variant.extraLiteral(inner);
						} else text = variant.extra(a.getText(sf));
						edits.push({ start: a.getStart(sf), end: a.end, text });
					}
				} else if (variant.opts) {
					const last = args[args.length - 1];
					const added = args.length === 1 ? ['200', variant.opts] : [variant.opts];
					// A call written one argument per line gets the new arguments on lines of their own.
					const lastLine = src.slice(src.lastIndexOf('\n', last.getStart(sf)) + 1, last.getStart(sf));
					const onOwnLine = args.length > 1 && /^\s*$/.test(lastLine) && /\n/.test(src.slice(last.end, call.end));
					const text = onOwnLine
						? added.map((a) => `,\n${lastLine}${a}`).join('')
						: added.map((a) => `, ${a}`).join('');
					edits.push({ start: last.end, end: last.end, text });
				}
			}
		}
		ts.forEachChild(n, visit);
	};
	visit(sf);
	if (problems.length) return { error: problems.join('; ') };
	if (calls === 0) return { error: 'helper is never called' };

	// Remove the helper (not its leading comments; those are reported for review) and the line break after it.
	// Only the whitespace touching the helper changes: a blank line on both sides becomes one, and
	// a helper at the end of the file takes the blank line above it along.
	let start = h.stmt.getStart(sf);
	let end = h.stmt.end;
	if (src[end] === '\n') end++;
	const blankBefore = src.slice(0, start).endsWith('\n\n');
	if (blankBefore && src[end] === '\n') end++;
	else if (blankBefore && /^\s*$/.test(src.slice(end))) { start--; end = src.length; }
	edits.push({ start, end, text: '' });
	const leading = ts.getLeadingCommentRanges(src, h.stmt.getFullStart()) ?? [];
	const comments = leading.map((r) => src.slice(r.pos, r.end));

	// Import the shared helper.
	const imports = sf.statements.filter((s) => ts.isImportDeclaration(s));
	const existing = imports.find((s) => s.moduleSpecifier.text === '@/lib/http');
	if (existing) return { error: 'already imports @/lib/http' };
	const line = `import { json } from '@/lib/http';`;
	if (imports.length) {
		const lastImport = imports[imports.length - 1];
		edits.push({ start: lastImport.end, end: lastImport.end, text: `\n${line}` });
	} else {
		const first = sf.statements[0];
		edits.push({ start: first.getStart(sf), end: first.getStart(sf), text: `${line}\n\n` });
	}

	edits.sort((a, b) => b.start - a.start || b.end - a.end);
	let out = src;
	for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
	return { out, variant: variant.name, calls, comments };
}

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const files = args.filter((a) => a !== '--dry');
let failed = 0;
for (const file of files) {
	const r = transform(file);
	if (r.error) {
		failed++;
		console.log(`SKIP ${file}: ${r.error}`);
		continue;
	}
	if (!dry) fs.writeFileSync(file, r.out);
	const note = r.comments.length ? `  comment above helper: ${JSON.stringify(r.comments)}` : '';
	console.log(`ok   ${file}  [${r.variant}, ${r.calls} calls]${note}`);
}
if (failed) process.exitCode = 1;
