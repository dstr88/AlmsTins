/**
 * AddressDetailsModal: one labeled address from the Wallets page's Address Labels list, opened by
 * clicking its row. Four sections:
 *
 *   1. Details: the label row as stored, the full address, copy, explorer links.
 *   2. Verify (on-chain addresses only): GET /api/verify/lookup, the public read-only lookup.
 *      It answers a grade, a date and, for a Verified hit, the vouching domain; never a name.
 *   3. Your history: GET /api/address-history, only the user's own records with this address.
 *   4. QR code (on-chain addresses only): the bare address, drawn in the browser.
 *
 * Read-only: nothing here writes. Every value the user typed (label, notes, phone number) is
 * rendered as React text only.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getAddressLabels, type AddressLabelsLocale } from '@/i18n/components/addressLabels';
import { addressNetwork, isOnchainAddress, type AddressNetwork } from '@/lib/addressNetwork';
import { evmExplorerLinks, explorerAddressUrl, explorerName } from '@/lib/explorerLinks';
import type { AddressLabel } from './AddressLabels';
import { shortenAddress } from '@/lib/addressDisplay';
import { CopyButton } from '@/components/ui/CopyButton';
import { QrImage } from '@/components/ui/QrImage';
import { Modal } from '@/components/ui/Modal';
import { formatUsd, toFiniteNumber } from '@/lib/format';

type Props = {
	label: AddressLabel;
	onClose: () => void;
};

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** The chain an address of this shape is on when the label names none (EVM has four). */
const CHAIN_FOR_NETWORK: Record<Exclude<AddressNetwork, 'evm'>, string> = {
	btc: 'bitcoin',
	ltc: 'litecoin',
	sol: 'solana',
	sui: 'sui',
};

function categoryLabel(t: AddressLabelsLocale, cat: string | null | undefined): string {
	switch (cat) {
		case 'defi': return t.catBadgeDefi;
		case 'exchange': return t.catBadgeExchange;
		case 'personal':
		case 'own_wallet': return t.catBadgePersonal;
		case 'bridge': return t.catBadgeBridge;
		case 'other': return t.catBadgeOther;
		case 'counterparty':
		case '':
		case null:
		case undefined: return t.catCounterparty;
		default: return cat;
	}
}

/** A stored dollar value as text, or null when there is none (the row then shows no amount). */
function usdText(value: string): string | null {
	return toFiniteNumber(value) === null ? null : formatUsd(value);
}

// ── Small pieces ──────────────────────────────────────────────────────────────

const sectionStyle: React.CSSProperties = {
	display: 'flex',
	flexDirection: 'column',
	gap: '0.55rem',
	paddingTop: '1rem',
	borderTop: '1px solid var(--border-subtle)',
};

const headingStyle: React.CSSProperties = {
	margin: 0,
	fontSize: '0.72rem',
	fontWeight: 700,
	letterSpacing: '0.1em',
	textTransform: 'uppercase',
	color: 'var(--text-muted)',
};

const mutedText: React.CSSProperties = { margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 };
const bodyText: React.CSSProperties = { margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 };
const linkStyle: React.CSSProperties = { color: 'var(--accent)', fontSize: '0.8rem', fontWeight: 600, textDecoration: 'none' };

const smallButton: React.CSSProperties = {
	padding: '0.25rem 0.65rem',
	borderRadius: '7px',
	border: '1px solid var(--border-bright)',
	background: 'transparent',
	color: 'var(--text-secondary)',
	fontSize: '0.75rem',
	fontWeight: 600,
	cursor: 'pointer',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section style={sectionStyle}>
			<h3 style={headingStyle}>{title}</h3>
			{children}
		</section>
	);
}

function Field({ name, children }: { name: string; children: React.ReactNode }) {
	return (
		<div style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
			<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', minWidth: '5.5rem' }}>{name}</span>
			<span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</span>
		</div>
	);
}

// ── 1. Details ────────────────────────────────────────────────────────────────

function ExplorerLinks({ label, network, t }: { label: AddressLabel; network: AddressNetwork | null; t: AddressLabelsLocale['details'] }) {
	const chain = label.chain || (network && network !== 'evm' ? CHAIN_FOR_NETWORK[network] : null);
	const single = chain ? explorerAddressUrl(chain, label.address) : null;
	if (single) {
		return (
			<a href={single} target="_blank" rel="noopener noreferrer" style={linkStyle}>
				{t.openOn(explorerName(chain))} ↗
			</a>
		);
	}
	// An EVM address with no chain (or one we have no explorer for): the user picks.
	const links = network === 'evm' ? evmExplorerLinks(label.address) : [];
	if (links.length === 0) return <p style={mutedText}>{t.noExplorer}</p>;
	return (
		<div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
			<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t.openOnPick}</span>
			{links.map((l) => (
				<a key={l.chain} href={l.url} target="_blank" rel="noopener noreferrer" style={linkStyle}>
					{explorerName(l.chain)} ↗
				</a>
			))}
		</div>
	);
}

// ── 2. Verify ─────────────────────────────────────────────────────────────────

type VerifyState =
	| { kind: 'loading' }
	| { kind: 'verified'; domain: string; since: string | null }
	| { kind: 'claimed'; since: string | null }
	| { kind: 'none' }
	| { kind: 'failed' };

type LookupAnswer = {
	ok?: boolean;
	verified?: boolean;
	level?: string | null;
	since?: string | null;
	domain?: string | null;
	provingDomain?: string | null;
};

function readLookup(data: LookupAnswer): VerifyState {
	if (data.ok !== true) return { kind: 'failed' };
	if (!data.verified) return { kind: 'none' };
	const since = typeof data.since === 'string' && data.since ? data.since : null;
	const domain = data.provingDomain || data.domain;
	if (data.level === 'verified' && domain) return { kind: 'verified', domain, since };
	if (data.level === 'claimed' || data.level === 'verified') return { kind: 'claimed', since };
	return { kind: 'none' };
}

function VerifySection({ address, t }: { address: string; t: AddressLabelsLocale['details'] }) {
	const [state, setState] = useState<VerifyState>({ kind: 'loading' });
	useEffect(() => {
		let alive = true;
		setState({ kind: 'loading' });
		(async () => {
			try {
				const res = await fetch(`/api/verify/lookup?address=${encodeURIComponent(address)}`);
				// A 429 (rate limit) or any other refusal is "couldn't check", never "not claimed".
				const next = res.ok ? readLookup((await res.json()) as LookupAnswer) : ({ kind: 'failed' } as const);
				if (alive) setState(next);
			} catch {
				if (alive) setState({ kind: 'failed' });
			}
		})();
		return () => { alive = false; };
	}, [address]);

	return (
		<Section title={t.secVerify}>
			<p style={mutedText}>{t.verifyIntro}</p>
			<div aria-live="polite">
				{state.kind === 'loading' && <p style={mutedText}>{t.verifyChecking}</p>}
				{state.kind === 'verified' && (
					<div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
						<p style={{ ...bodyText, color: 'var(--gain)', fontWeight: 600 }}>✓ {t.verifyVerified(state.domain, state.since)}</p>
						<a href={`/verify/scan?address=${encodeURIComponent(address)}`} target="_blank" rel="noopener noreferrer" style={linkStyle}>
							{t.verifyCard} ↗
						</a>
					</div>
				)}
				{state.kind === 'claimed' && <p style={{ ...bodyText, fontWeight: 600 }}>{t.verifyClaimed(state.since)}</p>}
				{state.kind === 'none' && <p style={bodyText}>{t.verifyNotClaimed}</p>}
				{state.kind === 'failed' && <p style={mutedText}>{t.verifyFailed}</p>}
			</div>
		</Section>
	);
}

// ── 3. Your history ───────────────────────────────────────────────────────────

type HistoryTotal = {
	asset: string;
	chain: string;
	sent: string;
	received: string;
	count: number;
	sentUsd: string;
	receivedUsd: string;
};

type HistoryRow = {
	date: string;
	direction: 'in' | 'out' | 'lost' | '';
	chain: string;
	asset: string;
	amount: string;
	usdValue: string;
	txHash: string;
	txUrl: string | null;
	failed: boolean;
};

type HistoryAnswer =
	| { supported: false; reason: 'not_onchain' | 'too_many' }
	| {
		supported: true;
		network: string;
		ownWallet: { id: string; label: string | null } | null;
		totals: HistoryTotal[];
		firstDate: string;
		lastDate: string;
		rows: HistoryRow[];
		truncated: boolean;
	};

type HistoryState = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; data: HistoryAnswer };

const day = (date: string) => date.slice(0, 10);

function Amount({ value, asset, usd, t }: { value: string; asset: string; usd: string; t: AddressLabelsLocale['details'] }) {
	const dollars = usdText(usd);
	return (
		<span style={{ fontFamily: MONO, fontSize: '0.8rem', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
			{value === '' ? t.unknownAmount : `${value} ${asset}`}
			{dollars && <span style={{ color: 'var(--text-muted)' }}> · {dollars}</span>}
		</span>
	);
}

/** Bitcoin, Litecoin, Solana and Sui rows keep their counterparty only from syncs since it was added. */
function SyncedOnlyNote({ network, t }: { network: string; t: AddressLabelsLocale['details'] }) {
	if (network !== 'btc' && network !== 'ltc' && network !== 'sol' && network !== 'sui') return null;
	return (
		<p style={mutedText}>
			{t.historySyncedOnly}
			{(network === 'btc' || network === 'ltc') && <> {t.historyBtcFirst}</>}
		</p>
	);
}

function HistoryList({ data, t }: { data: Extract<HistoryAnswer, { supported: true }>; t: AddressLabelsLocale['details'] }) {
	if (data.ownWallet) {
		return (
			<div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
				<p style={bodyText}>{t.ownWallet(data.ownWallet.label)}</p>
				<a href={`/dashboard/transactions?wallet=${encodeURIComponent(data.ownWallet.id)}`} style={linkStyle}>
					{t.openWalletTx} →
				</a>
			</div>
		);
	}
	if (data.rows.length === 0 && data.totals.length === 0) {
		return (
			<div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
				<p style={mutedText}>{t.historyEmpty}</p>
				<SyncedOnlyNote network={data.network} t={t} />
			</div>
		);
	}

	const direction = (d: HistoryRow['direction']) =>
		d === 'out' ? t.youSent : d === 'in' ? t.youReceived : d === 'lost' ? t.dirLost : t.dirOther;

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
			<SyncedOnlyNote network={data.network} t={t} />
			{data.firstDate && <p style={mutedText}>{t.range(day(data.firstDate), day(data.lastDate || data.firstDate))}</p>}

			<ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
				{data.totals.map((tot) => (
					<li
						key={`${tot.chain}:${tot.asset}`}
						style={{ padding: '0.6rem 0.75rem', borderRadius: '9px', background: 'var(--surface-card-2)', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}
					>
						<div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
							<span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
								{tot.asset} <span style={{ fontWeight: 500, color: 'var(--text-muted)', fontSize: '0.75rem' }}>{tot.chain}</span>
							</span>
							<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t.txCount(tot.count)}</span>
						</div>
						<div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
							<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', minWidth: '4.5rem' }}>{t.sent}</span>
							<Amount value={tot.sent} asset={tot.asset} usd={tot.sentUsd} t={t} />
						</div>
						<div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
							<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', minWidth: '4.5rem' }}>{t.received}</span>
							<Amount value={tot.received} asset={tot.asset} usd={tot.receivedUsd} t={t} />
						</div>
					</li>
				))}
			</ul>

			<ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', maxHeight: '320px', overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '9px' }}>
				{data.rows.map((r, i) => (
					<li
						key={`${r.txHash}:${i}`}
						style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'baseline', padding: '0.45rem 0.7rem', borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)' }}
					>
						<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: MONO }}>{day(r.date)}</span>
						<span style={{ fontSize: '0.78rem', fontWeight: 600, color: r.direction === 'in' ? 'var(--gain)' : 'var(--text-secondary)' }}>{direction(r.direction)}</span>
						<Amount value={r.amount} asset={r.asset} usd={r.usdValue} t={t} />
						{r.failed && (
							<span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--loss)', border: '1px solid var(--loss-border)', borderRadius: '999px', padding: '0.05rem 0.4rem' }}>
								{t.failedTx}
							</span>
						)}
						{r.txUrl ? (
							<a href={r.txUrl} target="_blank" rel="noopener noreferrer" style={{ ...linkStyle, marginLeft: 'auto' }}>
								{t.viewTx} ↗
							</a>
						) : r.txHash ? (
							<span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: '0.72rem', color: 'var(--text-muted)' }}>{shortenAddress(r.txHash)}</span>
						) : null}
					</li>
				))}
			</ul>

			{data.truncated && <p style={mutedText}>{t.latest(data.rows.length)}</p>}
		</div>
	);
}

function HistorySection({ address, onchain, notOnchainText, t }: { address: string; onchain: boolean; notOnchainText: string; t: AddressLabelsLocale['details'] }) {
	const [state, setState] = useState<HistoryState>({ kind: 'loading' });
	useEffect(() => {
		if (!onchain) return;
		let alive = true;
		setState({ kind: 'loading' });
		(async () => {
			try {
				const res = await fetch(`/api/address-history?address=${encodeURIComponent(address)}`);
				if (!res.ok) throw new Error('history');
				const data = (await res.json()) as HistoryAnswer;
				if (alive) setState({ kind: 'ready', data });
			} catch {
				if (alive) setState({ kind: 'failed' });
			}
		})();
		return () => { alive = false; };
	}, [address, onchain]);

	let body: React.ReactNode;
	if (!onchain) body = <p style={mutedText}>{notOnchainText}</p>;
	else if (state.kind === 'loading') body = <p style={mutedText}>{t.historyLoading}</p>;
	else if (state.kind === 'failed') body = <p style={mutedText}>{t.historyFailed}</p>;
	else if (!state.data.supported) {
		const reason = state.data.reason;
		body = (
			<p style={mutedText}>
				{reason === 'too_many' ? t.historyTooMany : reason === 'not_onchain' ? notOnchainText : t.historyFailed}
			</p>
		);
	} else body = <HistoryList data={state.data} t={t} />;

	return (
		<Section title={t.secHistory}>
			<p style={mutedText}>{t.historyIntro}</p>
			<div aria-live="polite">{body}</div>
		</Section>
	);
}

// ── 4. QR code ────────────────────────────────────────────────────────────────

function QrSection({ address, network, label, t }: { address: string; network: AddressNetwork; label: string; t: AddressLabelsLocale['details'] }) {
	return (
		<Section title={t.secQr}>
			<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem', textAlign: 'center' }}>
				<QrImage
					// The bare address, the same choice Verify's payment QR makes.
					text={address}
					size={240}
					margin={1}
					alt={t.qrAlt}
					style={{ borderRadius: '8px', maxWidth: '100%', height: 'auto' }}
					placeholder={(state) => (
						<div style={{ width: 240, maxWidth: '100%', aspectRatio: '1', borderRadius: '8px', background: 'var(--surface-card-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
							<span style={mutedText}>{state === 'failed' ? t.qrFailed : t.qrLoading}</span>
						</div>
					)}
					// The label stays out of the file name: it can be a person's name.
					download={{ filename: `almstins-address-${network}.png`, label: t.qrDownload, style: linkStyle }}
				>
					<code style={{ fontFamily: MONO, fontSize: '0.78rem', color: 'var(--text-primary)', overflowWrap: 'anywhere', maxWidth: '100%' }}>{address}</code>
					<p style={mutedText}>{t.qrScanCheck}</p>
					{network === 'evm' && <p style={mutedText}>{t.qrEvmNetworks(label)}</p>}
				</QrImage>
			</div>
		</Section>
	);
}

// ── The modal ─────────────────────────────────────────────────────────────────

export function AddressDetailsModal({ label, onClose }: Props) {
	const all = getAddressLabels(getClientLang());
	const t = all.details;
	const titleId = useId();
	const closeRef = useRef<HTMLButtonElement>(null);

	const network = addressNetwork(label.address);
	const onchain = isOnchainAddress(label.address);
	const notOnchainText = label.address.toLowerCase().startsWith('cex:') ? t.notOnchain : t.notRecognized;

	// <Modal> closes on Escape and a backdrop click, keeps Tab inside, locks the page scroll and
	// gives focus back to the row that opened it. Focus starts on Close.
	return (
		<Modal onClose={onClose} labelledBy={titleId} initialFocus={closeRef}>
			<header style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
				<div style={{ flex: 1, minWidth: 0 }}>
					<p style={{ ...headingStyle, marginBottom: '0.2rem' }}>{t.dialogTitle}</p>
					<h2 id={titleId} style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
						{label.label}
					</h2>
				</div>
				<button ref={closeRef} type="button" onClick={onClose} style={smallButton}>
					{t.close}
				</button>
			</header>

			{/* 1. Details */}
			<section style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
				<h3 style={headingStyle}>{t.secDetails}</h3>
				<Field name={t.fieldLabel}>{label.label}</Field>
				<Field name={t.fieldCategory}>{categoryLabel(all, label.category)}</Field>
				<Field name={t.fieldChain}>{label.chain || t.chainNotSet}</Field>
				<Field name={t.fieldAddress}>
					<code style={{ fontFamily: MONO, fontSize: '0.8rem', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{label.address}</code>
				</Field>
				<div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
					<CopyButton
						value={label.address}
						words={{ idle: t.copy, copied: `✓ ${t.copied}` }}
						style={(state) => ({ ...smallButton, color: state === 'copied' ? 'var(--gain)' : 'var(--text-secondary)' })}
					/>
					{onchain ? <ExplorerLinks label={label} network={network} t={t} /> : <p style={mutedText}>{notOnchainText}</p>}
				</div>
				{label.notes && <Field name={t.fieldNotes}>{label.notes}</Field>}
				{label.phone_number && <Field name={t.fieldPhone}>{label.phone_number}</Field>}
			</section>

			{/* 2. Verify: only a real on-chain address can be claimed. */}
			{onchain && <VerifySection address={label.address} t={t} />}

			{/* 3. Your history */}
			<HistorySection address={label.address} onchain={onchain} notOnchainText={notOnchainText} t={t} />

			{/* 4. QR code: never for an exchange account id or an unrecognized value. */}
			{onchain && network && <QrSection address={label.address} network={network} label={label.label} t={t} />}
		</Modal>
	);
}

export default AddressDetailsModal;
