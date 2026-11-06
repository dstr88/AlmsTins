import { describe, it, expect, beforeAll } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { en, es, fr } from '../../src/i18n/walletChecker';
import type { RecentAddress } from '../../src/lib/recentAddresses';
import { shortenAddress } from '../../src/lib/addressDisplay';

/**
 * The recently checked list under the wallet checker's input. Rendered the way the server renders
 * it, and its buttons pressed by calling their handlers (there is no DOM here). What matters: an
 * address shows shortened with its chain, but picking it hands over the whole address; the Clear
 * button is there and calls clear; a stored value is escaped text, never HTML; nothing renders when
 * the list is empty, which is also what the server sends; and the checker remembers an address only
 * after a successful check, and never runs a check just because one was picked.
 *
 * The unit config compiles JSX with the classic runtime, so React is a global before the component
 * is imported. Every address here is invented.
 */

type Props = {
	items: RecentAddress[];
	onPick: (address: string) => void;
	onClear: () => void;
	disabled?: boolean;
	c: typeof en.checker;
};
let RecentAddresses: (p: Props) => React.ReactElement | null;
let WalletChecker: (p: { prefilledAddress?: string; c: typeof en.checker }) => React.ReactElement;

beforeAll(async () => {
	(globalThis as { React?: typeof React }).React = React;
	const mod = await import('../../src/components/WalletChecker');
	RecentAddresses = mod.RecentAddresses as never;
	WalletChecker = mod.default as never;
});

const EVM = `0x${'12ab'.repeat(10)}`;
const SEGWIT = 'bc1qqpzry9x8gf2tvdw0s3jn54khce6mua7l';
const ITEMS: RecentAddress[] = [
	{ address: EVM, chain: 'evm' },
	{ address: SEGWIT, chain: 'bitcoin' },
	{ address: 'AbCdEfGhJkMnPqRsTuVwXyZ23456789abcdefghijk', chain: null },
];
const noop = () => {};
const render = (p: Partial<Props> = {}) =>
	renderToStaticMarkup(React.createElement(RecentAddresses as never, { items: ITEMS, onPick: noop, onClear: noop, c: en.checker, ...p }));
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

/** Every element in a rendered tree with an onClick, in order. RecentAddresses has no hooks, so it is called directly. */
function clickables(el: React.ReactNode): Array<{ label: string; onClick: () => void; disabled?: boolean }> {
	const out: Array<{ label: string; onClick: () => void; disabled?: boolean }> = [];
	const walk = (n: React.ReactNode) => {
		if (Array.isArray(n)) return n.forEach(walk);
		if (!React.isValidElement(n)) return;
		const props = n.props as { onClick?: () => void; 'aria-label'?: string; disabled?: boolean; children?: React.ReactNode };
		if (props.onClick) out.push({ label: props['aria-label'] ?? '', onClick: props.onClick, disabled: props.disabled });
		walk(props.children);
	};
	walk(el);
	return out;
}

describe('RecentAddresses', () => {
	it('renders nothing when the list is empty', () => {
		expect(render({ items: [] })).toBe('');
	});

	it('shows each address shortened, with its chain when known, newest first', () => {
		const text = textOf(render());
		expect(text).toContain(shortenAddress(EVM));
		expect(text).toContain(shortenAddress(SEGWIT));
		expect(text).not.toContain(` ${EVM} `);
		expect(text.indexOf(shortenAddress(EVM))).toBeLessThan(text.indexOf(shortenAddress(SEGWIT)));
		expect(text).toContain(en.checker.chains.evm);
		expect(text).toContain(en.checker.chains.bitcoin);
		expect(text).not.toContain(en.checker.chains.unknown);
	});

	it('names the whole address in each button label, and says the list stays in this browser', () => {
		const html = render();
		expect(html).toContain(`aria-label="Put ${EVM} in the address box"`);
		expect(html).toContain(`title="${EVM}"`);
		expect(textOf(html)).toContain(en.checker.recentTitle);
		expect(textOf(html)).toContain(en.checker.recentNote);
		expect(html).toContain(`aria-label="${en.checker.recentClearAria}"`);
		expect(textOf(html)).toContain(en.checker.recentClear);
	});

	it('hands the whole address to onPick, and calls onClear from the Clear button', () => {
		const picked: string[] = [];
		let cleared = 0;
		const el = RecentAddresses({ items: ITEMS, onPick: (a) => picked.push(a), onClear: () => { cleared++; }, c: en.checker });
		const buttons = clickables(el);
		expect(buttons).toHaveLength(ITEMS.length + 1);
		const clear = buttons.find((b) => b.label === en.checker.recentClearAria)!;
		clear.onClick();
		expect(cleared).toBe(1);
		buttons.filter((b) => b !== clear).forEach((b) => b.onClick());
		expect(picked).toEqual(ITEMS.map((i) => i.address));
	});

	it('disables picking while a check runs, but never the Clear button', () => {
		const buttons = clickables(RecentAddresses({ items: ITEMS, onPick: noop, onClear: noop, disabled: true, c: en.checker }));
		const clear = buttons.find((b) => b.label === en.checker.recentClearAria)!;
		expect(clear.disabled).toBeFalsy();
		expect(buttons.filter((b) => b !== clear).every((b) => b.disabled)).toBe(true);
	});

	it('renders a hostile stored value as escaped text, never as HTML', () => {
		const hostile = '"><script>alert(1)</script><img src=x onerror=alert(2)>';
		const html = render({ items: [{ address: hostile, chain: null }] });
		expect(html).not.toContain('<script>');
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;script&gt;');
	});

	it('has its words in Spanish and French too', () => {
		for (const c of [es.checker, fr.checker]) {
			const text = textOf(render({ c }));
			expect(text).toContain(c.recentTitle);
			expect(text).toContain(c.recentNote);
			expect(c.recentUse).toContain('{address}');
			for (const s of [c.recentTitle, c.recentNote, c.recentClear, c.recentClearAria, c.recentUse]) {
				expect(s).not.toMatch(/—/);
				expect(s).not.toMatch(/\bsafe\b|segur[oa]\b|sûr/i);
			}
		}
	});
});

describe('the wallet checker and its recent list', () => {
	const src = readFileSync(path.resolve(__dirname, '../../src/components/WalletChecker.tsx'), 'utf8');

	it('server-renders without the list, so the first client render matches before storage is read', () => {
		const html = renderToStaticMarkup(React.createElement(WalletChecker as never, { c: en.checker }));
		expect(html).toContain('id="wallet-input"');
		expect(html).not.toContain(en.checker.recentTitle);
	});

	it('reads the list after mount and remembers an address only once its check succeeded', () => {
		expect(src).toMatch(/useEffect\(\(\) => \{ setRecent\(readRecentAddresses\(\)\); \}, \[\]\);/);
		const success = src.indexOf('setResult(data.result);');
		const failure = src.indexOf('setError(data.error ?? c.checkFailed);');
		const remember = src.indexOf('rememberRecentAddress(addr, data.result.chain)');
		expect(failure).toBeGreaterThan(-1);
		expect(remember).toBeGreaterThan(success);
		expect(src.match(/rememberRecentAddress\(/g)).toHaveLength(1);
	});

	it('fills the input on a pick and does not run a check', () => {
		const pick = src.match(/onPick=\{([^\n]*)\}\n/)?.[1] ?? '';
		expect(pick).toContain('setAddress(picked)');
		expect(pick).not.toMatch(/handleCheck/);
	});

	it('never sends the list anywhere: no fetch or analytics in the cache module', () => {
		const lib = readFileSync(path.resolve(__dirname, '../../src/lib/recentAddresses.ts'), 'utf8');
		expect(lib).not.toMatch(/\bfetch\(|gtag|sendBeacon|XMLHttpRequest/);
		const gtagCall = src.slice(src.indexOf("gtag('event', 'wallet_check_submitted'"), src.indexOf("gtag('event', 'wallet_check_submitted'") + 200);
		expect(gtagCall).not.toMatch(/recent|address/i);
	});
});
