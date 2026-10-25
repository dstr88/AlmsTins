import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as copy from '../../src/i18n/components/addressLabels';

/**
 * The address details modal on the Wallets page's Address Labels list
 * (src/components/dashboard/AddressDetailsModal.tsx), the row that opens it, and the
 * Transactions page link it uses.
 *
 *   - The copy is EN/ES/FR with the same keys and no em dash; the Verify texts never call an
 *     address safe or unsafe.
 *   - The modal is an accessible dialog (role, aria-modal, a title, Escape, a focus trap, a
 *     scroll lock, focus back to the opener) and renders user-typed text as React text only.
 *   - It calls /api/verify/lookup and /api/address-history and nothing else; Verify and the QR
 *     code sit behind isOnchainAddress, and the QR encodes the bare address.
 *   - Each Address Labels row opens it from a button; copy and Remove stay their own buttons.
 *   - /dashboard/transactions honors ?wallet= only for one of the tenant's own wallets.
 *
 * React and Astro cannot run hermetically here, so this pins the source.
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const LANGS = ['en', 'es', 'fr'] as const;

const modal = read('src/components/dashboard/AddressDetailsModal.tsx');
const labels = read('src/components/dashboard/AddressLabels.tsx');
const transactions = read('src/pages/dashboard/transactions.astro');

/** Every string a locale's details copy can produce, functions called with sample values. */
function allText(d: copy.AddressDetailsLocale): string[] {
	return Object.values(d).flatMap((v) => {
		if (typeof v === 'string') return [v];
		const fn = v as (...args: unknown[]) => string;
		return [
			fn('Sample', '2026-01-02'),
			fn('Sample', null),
			fn(null),
			fn(1),
			fn(500),
		].filter((s): s is string => typeof s === 'string');
	});
}

describe('the copy', () => {
	it.each(LANGS)('%s: the same details keys as English', (lang) => {
		expect(Object.keys(copy[lang].details).sort()).toEqual(Object.keys(copy.en.details).sort());
	});

	it.each(LANGS)('%s: no em dash, nothing empty, never safe or unsafe', (lang) => {
		const text = allText(copy[lang].details);
		expect(text.length).toBeGreaterThan(Object.keys(copy.en.details).length);
		for (const s of text) {
			expect(s.trim()).not.toBe('');
			expect(s).not.toMatch(/—/);
		}
		const verify = [copy[lang].details.verifyIntro, copy[lang].details.verifyNotClaimed, copy[lang].details.verifyFailed].join(' ');
		expect(verify).not.toMatch(/\b(un)?safe\b|segur|sûr|danger|peligr|risk|riesgo|risque/i);
	});

	it.each(LANGS)('%s: Verify and the date are interpolated, with and without a date', (lang) => {
		const d = copy[lang].details;
		expect(d.verifyVerified('shop.example', '2026-01-02')).toContain('shop.example');
		expect(d.verifyVerified('shop.example', '2026-01-02')).toContain('2026-01-02');
		expect(d.verifyVerified('shop.example', null)).not.toContain('null');
		expect(d.verifyClaimed('2026-01-02')).toContain('2026-01-02');
		expect(d.verifyClaimed(null)).not.toContain('null');
		expect(d.ownWallet(null)).not.toContain('null');
		expect(d.latest(500)).toContain('500');
	});
});

describe('the modal', () => {
	it('is an accessible dialog', () => {
		expect(modal).toMatch(/role="dialog"/);
		expect(modal).toMatch(/aria-modal="true"/);
		expect(modal).toMatch(/aria-labelledby=\{titleId\}/);
		expect(modal).toMatch(/<h2 id=\{titleId\}/);
		expect(modal).toMatch(/e\.key === 'Escape'/);
		expect(modal).toMatch(/e\.key !== 'Tab'/);
		expect(modal).toMatch(/closeRef\.current\?\.focus\(\)/);
		expect(modal).toMatch(/opener\?\.focus\(\)/);
		expect(modal).toMatch(/document\.body\.style\.overflow = 'hidden'/);
		expect(modal).toMatch(/max-width: 639px/);
	});

	it('closes on a backdrop click that also started on the backdrop', () => {
		expect(modal).toMatch(/downOnBackdrop\.current = e\.target === e\.currentTarget/);
		expect(modal).toMatch(/if \(downOnBackdrop\.current && e\.target === e\.currentTarget\) onClose\(\)/);
	});

	it('renders user text as React text only', () => {
		expect(modal).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
		expect(modal).toMatch(/\{label\.label\}/);
		expect(modal).toMatch(/\{label\.notes\}/);
		expect(modal).toMatch(/\{label\.phone_number\}/);
	});

	it('calls the Verify lookup and the history endpoint, and nothing else', () => {
		const calls = [...modal.matchAll(/fetch\(\s*`([^`]*)`/g)].map((m) => m[1]);
		expect(calls).toEqual([
			'/api/verify/lookup?address=${encodeURIComponent(address)}',
			'/api/address-history?address=${encodeURIComponent(address)}',
		]);
		expect(modal.match(/fetch\(/g)).toHaveLength(2);
		expect(modal).not.toMatch(/XMLHttpRequest|sendBeacon|method:\s*'(POST|PUT|PATCH|DELETE)'/);
	});

	it('shows Verify and the QR code only for an on-chain address', () => {
		expect(modal).toMatch(/const onchain = isOnchainAddress\(label\.address\)/);
		expect(modal).toMatch(/\{onchain && <VerifySection /);
		expect(modal).toMatch(/\{onchain && network && <QrSection /);
		expect(modal).toMatch(/if \(!onchain\) return;/);
	});

	it('a failed or refused lookup reads as "couldn\'t check", never as not claimed', () => {
		expect(modal).toMatch(/res\.ok \? readLookup\(/);
		expect(modal).toMatch(/: \(\{ kind: 'failed' \} as const\)/);
		expect(modal).toMatch(/if \(data\.ok !== true\) return \{ kind: 'failed' \}/);
	});

	it('says, for Bitcoin, Solana and Sui, that only rows synced since the counterparty was kept show up', () => {
		expect(modal).toMatch(/if \(network !== 'btc' && network !== 'sol' && network !== 'sui'\) return null;/);
		expect(modal).toMatch(/\{network === 'btc' && <> \{t\.historyBtcFirst\}<\/>\}/);
		expect(modal.match(/<SyncedOnlyNote network=\{data\.network\} t=\{t\} \/>/g)).toHaveLength(2); // with rows, and when empty
		for (const lang of LANGS) {
			const d = copy[lang].details;
			expect(d.historyNotKept).toMatch(/Litecoin/);
			expect(d.historyNotKept).not.toMatch(/Bitcoin|Solana|Sui/);
			expect(d.historySyncedOnly).toMatch(/Bitcoin.*Solana.*Sui/);
			expect(d.historySyncedOnly).toMatch(/2026/);
		}
	});

	it('renders every history reason', () => {
		for (const reason of ['not_kept_yet', 'too_many', 'not_onchain']) expect(modal).toContain(`reason === '${reason}'`);
		expect(modal).toMatch(/\/dashboard\/transactions\?wallet=\$\{encodeURIComponent\(data\.ownWallet\.id\)\}/);
		expect(modal).toMatch(/data\.truncated && /);
	});

	it('the QR code is the bare address, drawn in the browser, saved without the label', () => {
		expect(modal).toMatch(/await import\('qrcode'\)/);
		expect(modal).toMatch(/toDataURL\(address, \{ width: 240, margin: 1 \}\)/);
		expect(modal).toMatch(/download=\{`almstins-address-\$\{network\}\.png`\}/);
		expect(modal).not.toMatch(/download=\{`[^`]*label/);
	});

	it('an EVM address with no chain gets one link per EVM explorer', () => {
		expect(modal).toMatch(/network === 'evm' \? evmExplorerLinks\(label\.address\)/);
		expect(modal).toMatch(/explorerAddressUrl\(chain, label\.address\)/);
	});

	it('external links open without an opener', () => {
		const blanks = modal.match(/target="_blank"/g) ?? [];
		const safe = modal.match(/target="_blank" rel="noopener noreferrer"/g) ?? [];
		expect(blanks.length).toBeGreaterThan(0);
		expect(safe.length).toBe(blanks.length);
	});
});

describe('the Address Labels row', () => {
	it('uses the shared address recognizer, with no local copy left', () => {
		expect(labels).toMatch(/import \{ addressNetwork \} from '@\/lib\/addressNetwork'/);
		expect(labels).not.toMatch(/function detectNetwork/);
	});

	it('opens the modal from a button named for the label', () => {
		expect(labels).toMatch(/import \{ AddressDetailsModal \} from '\.\/AddressDetailsModal'/);
		expect(labels).toMatch(/aria-label=\{t\.details\.openDetails\(l\.label\)\}/);
		expect(labels).toMatch(/onClick=\{e => \{ e\.currentTarget\.focus\(\); setSelected\(l\); \}\}/);
		expect(labels).toMatch(/\{selected && <AddressDetailsModal label=\{selected\} onClose=\{\(\) => setSelected\(null\)\} \/>\}/);
	});

	it('keeps copy and Remove outside the button that opens the modal', () => {
		const start = labels.indexOf('aria-label={t.details.openDetails(l.label)}');
		const button = labels.slice(start, labels.indexOf('</button>', start));
		expect(button).toContain('{truncateAddress(l.address)}');
		expect(button).toContain('{l.label}');
		expect(button).not.toContain('<CopyButton');
		expect(button).not.toContain('handleDelete');
		expect(labels).toMatch(/onClick=\{\(\) => handleDelete\(l\.id\)\}/);
	});
});

describe('the Transactions page', () => {
	it('preselects ?wallet= only when it is one of the tenant\'s wallets', () => {
		expect(transactions).toMatch(/const wallets = await getAllActiveWallets\(tenantId\)/);
		expect(transactions).toMatch(/Astro\.url\.searchParams\.get\('wallet'\)/);
		expect(transactions).toMatch(/wallets\.find\(\(w\) => String\(w\.id\) === requestedWalletId\)/);
		expect(transactions).toMatch(/const defaultWalletId = requestedWallet\?\.id \?\? wallets\[0\]\?\.id \?\? ''/);
	});
});
