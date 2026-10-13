import { describe, it, expect, beforeAll } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WalletCheckResult } from '../../src/lib/walletChecker';
import { en, es, fr } from '../../src/i18n/walletChecker';
import { verifyScanCopy } from '../../src/i18n/verifyScan';

/**
 * What a person sees on the address checker and /verify/scan (code review 2026-10-11):
 *   - Chainabuse is named only when it actually ran (production has no key: 'skipped');
 *   - a failed sanctions lookup shows "Unavailable" on the sanctions row, never "Clear";
 *   - the Funding tab says it shows the mixer flag only, and no funding tracing;
 *   - a clean Verify-scan safety screen carries the "clean is not safe" note.
 *
 * The unit config compiles JSX with the classic runtime, so React is a global before the
 * components are imported. No DOM, no network.
 */

type Components = {
	TabContent: (p: { tab: string; result: WalletCheckResult; activityLoad: null; c: typeof en.checker }) => React.ReactElement;
	CoverageNotice: (p: { result: WalletCheckResult; c: typeof en.checker }) => React.ReactElement | null;
	SafetyCard: (p: { safety: string; text: string; isUrl: boolean; goplus: boolean; t: (typeof verifyScanCopy)['en'] }) => React.ReactElement;
};
let C: Components;

beforeAll(async () => {
	(globalThis as any).React = React;
	const wc = await import('../../src/components/WalletChecker');
	const scan = await import('../../src/components/verify/VerifyScan');
	C = { TabContent: wc.TabContent as any, CoverageNotice: wc.CoverageNotice as any, SafetyCard: scan.SafetyCard as any };
});

const NO_FLAGS: WalletCheckResult['flags'] = {
	blacklisted: false, phishing: false, honeypotRelated: false, stealingAttack: false,
	darkwebTransactions: false, cybercrime: false, moneyLaundering: false,
	financialCrime: false, blackmail: false, mixer: false, sanctioned: false,
};

function result(over: Omit<Partial<WalletCheckResult>, 'coverage'> & { coverage?: Partial<WalletCheckResult['coverage']> } = {}): WalletCheckResult {
	const { coverage, ...rest } = over;
	return {
		address: '0x2222222222222222222222222222222222222222',
		chain: 'evm',
		checkedAt: '2026-10-11T00:00:00Z',
		scamScore: 0,
		scamLevel: 'clean',
		flags: NO_FLAGS,
		ensName: null,
		multiSig: null,
		chainabuseReports: null,
		holdings: [],
		activity: {} as WalletCheckResult['activity'],
		honeypot: { checked: true, isHoneypot: null, reason: null, notAToken: true },
		fundingSource: { fromMixer: null, fromExchange: null, label: null },
		entityLabel: null,
		errors: [],
		partialCoverage: false,
		...rest,
		coverage: { goplus: 'ran', honeypot: 'ran', chainabuse: 'skipped', sanctions: 'ran', chainalysis: 'skipped', ...coverage },
	};
}

const tab = (tabName: string, r: WalletCheckResult, c = en.checker) =>
	renderToStaticMarkup(React.createElement(C.TabContent, { tab: tabName, result: r, activityLoad: null, c }));
const notice = (r: WalletCheckResult, c = en.checker) =>
	renderToStaticMarkup(React.createElement(C.CoverageNotice, { result: r, c }) ?? React.createElement('div'));
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Safety tab sources line', () => {
	it('Chainabuse switched off (no key): not named as a source, not listed as unavailable', () => {
		const html = tab('safety', result());
		expect(html).not.toContain('Chainabuse');
		expect(textOf(html)).toContain('Checked: OFAC SDN, GoPlus, honeypot.is');
	});

	it('Chainabuse ran: named', () => {
		const html = tab('safety', result({ coverage: { chainabuse: 'ran' }, chainabuseReports: 0 }));
		expect(textOf(html)).toMatch(/Checked: .*Chainabuse/);
	});

	it('Chainabuse asked and failed: listed as unavailable', () => {
		expect(textOf(tab('safety', result({ coverage: { chainabuse: 'error' } })))).toMatch(/Unavailable: .*Chainabuse/);
	});

	it('the fallback source line (no coverage) no longer names Chainabuse', () => {
		for (const l of [en, es, fr]) expect(l.checker.safetySource).not.toContain('Chainabuse');
	});
});

describe('sanctions row', () => {
	const sanctionsRow = (html: string, c = en.checker) => {
		const label = c.flags.sanctioned.replace(/[()/]/g, (m) => `\\${m}`);
		return html.match(new RegExp(`${label}</span><span[^>]*>([^<]+)</span>`))?.[1];
	};

	it('lookup ran, no match → Clear', () => {
		expect(sanctionsRow(tab('safety', result()))).toBe(en.checker.clear);
	});

	it.each([['en', en], ['es', es], ['fr', fr]] as const)('%s: lookup failed → Unavailable, never Clear', (_lang, l) => {
		const html = tab('safety', result({ coverage: { sanctions: 'error' }, partialCoverage: true }), l.checker);
		expect(sanctionsRow(html, l.checker)).toBe(l.checker.checksUnavailable);
	});

	it('a match still reads Reported', () => {
		expect(sanctionsRow(tab('safety', result({ flags: { ...NO_FLAGS, sanctioned: true }, scamLevel: 'danger' })))).toBe(en.checker.reported);
	});
});

describe('Limited check notice', () => {
	it('EVM, every main database ran, sanctions list unreadable: the sanctions body, not "could not run the main databases"', () => {
		const t = textOf(notice(result({ coverage: { sanctions: 'error' }, partialCoverage: true })));
		expect(t).toContain(en.checker.limitedSanctionsBody);
		expect(t).not.toContain('We could not run the main scam databases');
		expect(t).toContain('Unavailable: OFAC SDN');
	});

	it('Solana (no main database), sanctions list fine: the main-databases body only', () => {
		const t = textOf(notice(result({ chain: 'solana', coverage: { goplus: 'skipped', honeypot: 'skipped' }, partialCoverage: true })));
		expect(t).toContain('We could not run the main scam databases for Solana');
		expect(t).not.toContain(en.checker.limitedSanctionsBody);
		expect(t).not.toContain('Chainabuse');
	});

	it('both down: both bodies', () => {
		const t = textOf(notice(result({ coverage: { goplus: 'error', sanctions: 'error' }, partialCoverage: true })));
		expect(t).toContain('We could not run the main scam databases');
		expect(t).toContain(en.checker.limitedSanctionsBody);
	});

	it('Chainalysis failed: listed as unavailable', () => {
		const t = textOf(notice(result({ chain: 'solana', coverage: { goplus: 'skipped', honeypot: 'skipped', chainalysis: 'error' }, partialCoverage: true })));
		expect(t).toContain('Unavailable: GoPlus, Chainalysis');
	});
});

describe('Funding tab', () => {
	it.each([['en', en], ['es', es], ['fr', fr]] as const)('%s: says it shows the mixer flag only, never "tracing"', (_lang, l) => {
		const t = textOf(tab('funding', result(), l.checker));
		expect(t).toContain(l.checker.fundingNone);
		expect(t).toContain(l.checker.fundingScope);
		expect(t).not.toMatch(/tracing|rastreo detallado|traçage détaillé/i);
	});

	it('EVM with GoPlus unavailable: says only our mixer list was checked', () => {
		const t = textOf(tab('funding', result({ coverage: { goplus: 'error' }, partialCoverage: true })));
		expect(t).toContain(en.checker.fundingUnavailable);
		expect(t).not.toContain(en.checker.fundingNone);
	});

	it('non-EVM: says the mixer flag was not checked', () => {
		const t = textOf(tab('funding', result({ chain: 'bitcoin', coverage: { goplus: 'skipped', honeypot: 'skipped' }, partialCoverage: true })));
		expect(t).toContain(en.checker.fundingEvmOnly);
		expect(t).not.toContain(en.checker.fundingNone);
	});

	it('a mixer hit is still shown', () => {
		const t = textOf(tab('funding', result({ fundingSource: { fromMixer: true, fromExchange: null, label: 'Known mixer contract' } })));
		expect(t).toContain('Known mixer contract');
	});
});

describe('/verify/scan safety screen', () => {
	const card = (safety: string, isUrl: boolean, lang: 'en' | 'es' | 'fr' = 'en') =>
		textOf(renderToStaticMarkup(React.createElement(C.SafetyCard, { safety, text: 'x', isUrl, goplus: false, t: verifyScanCopy[lang] })));

	it.each(['en', 'es', 'fr'] as const)('%s: a clean address or link carries the clean-is-not-safe note', (lang) => {
		expect(card('clean', false, lang)).toContain(verifyScanCopy[lang].safetyCleanNote.address);
		expect(card('clean', true, lang)).toContain(verifyScanCopy[lang].safetyCleanNote.link);
	});

	it.each(['caution', 'danger', 'unclear', 'error'])('%s: no clean note', (safety) => {
		expect(card(safety, false)).not.toContain(verifyScanCopy.en.safetyCleanNote.address);
	});
});
