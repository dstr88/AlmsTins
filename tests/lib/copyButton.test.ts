import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { copyText } from '../../src/lib/clipboard';
import * as words from '../../src/i18n/components/copyButton';

/**
 * The shared copy button and address (Area 4), rendered the way the server renders them, and the
 * one clipboard write behind them. The unit config compiles JSX with the classic runtime
 * (React.createElement), so React is provided as a global before the components are imported.
 */
let CopyButton: typeof import('../../src/components/ui/CopyButton').CopyButton;
let Address: typeof import('../../src/components/ui/Address').Address;
beforeAll(async () => {
	(globalThis as { React?: typeof React }).React = React;
	CopyButton = (await import('../../src/components/ui/CopyButton')).CopyButton;
	Address = (await import('../../src/components/ui/Address')).Address;
});

const EVM = '0x5e1f0a2b3c4d5e6f708192a3b4c5d6e7f8091a2b';
const SHORT = '0x5e1f0a…091a2b';
const render = (el: React.ReactElement) => renderToStaticMarkup(el);
const LANGS = ['en', 'es', 'fr'] as const;

describe('copyText', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('puts the text on the clipboard, whole, and says it worked', async () => {
		const writeText = vi.fn(async () => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		expect(await copyText(EVM)).toBe(true);
		expect(writeText).toHaveBeenCalledWith(EVM);
	});

	it('says it did not work when the browser refuses, and when there is no clipboard to ask (a page that is not served securely)', async () => {
		vi.stubGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('denied'); } } });
		expect(await copyText(EVM)).toBe(false);
		vi.stubGlobal('navigator', {});
		expect(await copyText(EVM)).toBe(false);
		vi.stubGlobal('navigator', undefined);
		expect(await copyText(EVM)).toBe(false);
	});
});

describe('the words', () => {
	it('has the same keys in English, Spanish and French, and no em dash', () => {
		for (const lang of LANGS) {
			const t = words.getCopyButton(lang);
			expect(Object.keys(t).sort()).toEqual(Object.keys(words.getCopyButton('en')).sort());
			const text = [t.copy, t.copied, t.copyFailed, t.copyAddress(SHORT), t.copyValue(SHORT)].join(' ');
			expect(text).not.toContain('—');
			expect(t.copyAddress(SHORT)).toContain(SHORT);
		}
		expect(words.getCopyButton('fr').copy).toBe('Copier');
		expect(words.getCopyButton('es').copy).toBe('Copiar');
	});
});

describe('<CopyButton>', () => {
	it('is a button named for what it copies, with the address shortened, and an empty live region beside it', () => {
		const html = render(React.createElement(CopyButton, { value: EVM, lang: 'en' }));
		expect(html).toContain('type="button"');
		expect(html).toContain(`aria-label="Copy address ${SHORT}"`);
		expect(html).toMatch(/>Copy<\/button>/);
		expect(html).toMatch(/<span style="[^"]*clip[^"]*" role="status" aria-live="polite"><\/span>/);
	});

	it('speaks the reader\'s language', () => {
		expect(render(React.createElement(CopyButton, { value: EVM, lang: 'fr' }))).toContain(`aria-label="Copier l&#x27;adresse ${SHORT}"`);
		expect(render(React.createElement(CopyButton, { value: EVM, lang: 'es' }))).toMatch(/>Copiar<\/button>/);
	});

	it('names a value that is not an address plainly', () => {
		const hash = `0x${'ab'.repeat(32)}`;
		expect(render(React.createElement(CopyButton, { value: hash, kind: 'value', lang: 'en' }))).toContain('aria-label="Copy 0xababab…ababab"');
	});

	it('as an icon, carries its name as hover text too, and takes the caller\'s icon and class in place of its own look', () => {
		const icon = render(React.createElement(CopyButton, { value: EVM, variant: 'icon', lang: 'en' }));
		expect(icon).toContain(`title="Copy address ${SHORT}"`);
		expect(icon).toContain('⧉');
		const own = render(React.createElement(CopyButton, { value: EVM, variant: 'icon', className: 'x-copy', icon: React.createElement('svg'), lang: 'en' }));
		expect(own).toContain('class="x-copy"');
		expect(own).not.toContain('⧉');
		expect(own).not.toMatch(/<button[^>]*style=/);
	});

	it('takes the caller\'s words and live-region class', () => {
		const html = render(React.createElement(CopyButton, { value: EVM, words: { idle: 'Copy the code' }, srClassName: 'ag-sr', lang: 'en' }));
		expect(html).toMatch(/>Copy the code<\/button>/);
		expect(html).toContain('<span class="ag-sr" role="status" aria-live="polite"></span>');
	});
});

describe('<Address>', () => {
	it('shows a shortened address linked to its explorer, with the whole address as hover text, and a copy button', () => {
		const html = render(React.createElement(Address, { value: EVM, chain: 'ethereum', lang: 'en' }));
		expect(html).toContain(`href="https://etherscan.io/address/${EVM}"`);
		expect(html).toContain('rel="noopener noreferrer"');
		expect(html).toContain(`title="${EVM}"`);
		expect(html).toContain(`${SHORT} ↗`);
		expect(html).toContain(`aria-label="Copy address ${SHORT}"`);
	});

	it('shows plain text when there is no chain to link to, and no button when asked not to', () => {
		const html = render(React.createElement(Address, { value: EVM, copy: false, lang: 'en' }));
		expect(html).not.toContain('href=');
		expect(html).toContain(SHORT);
		expect(html).not.toContain('<button');
	});

	it('shows the whole address when short is off (where someone might send money to it), never cut', () => {
		const html = render(React.createElement(Address, { value: EVM, chain: 'ethereum', short: false, lang: 'en' }));
		expect(html).toContain(`>${EVM} ↗</a>`);
		expect(html).not.toContain('…</a>');
		expect(html).toContain('overflow-wrap:anywhere');
	});

	it('links a transaction hash to its transaction page', () => {
		const hash = `0x${'ab'.repeat(32)}`;
		const html = render(React.createElement(Address, { value: hash, chain: 'ethereum', kind: 'tx', lang: 'en' }));
		expect(html).toContain(`href="https://etherscan.io/tx/${hash}"`);
		expect(html).toContain('aria-label="Copy 0xababab…ababab"');
	});
});
