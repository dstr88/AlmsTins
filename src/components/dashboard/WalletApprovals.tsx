/**
 * The Approvals section on an Ethereum-family wallet card (Wallets page). A "Check approvals" button
 * reads the wallet's standing approvals on Ethereum, Polygon, Avalanche and Arbitrum through
 * GET /api/wallets/[id]/approvals (public chain data by address, no wallet connection), and the list
 * opens in the shared Modal with a "How it works" tab beside it.
 *
 * Donnie's rule (Nov 28, 2026): no approval is shown as fine. Groups only set the order: "Revoke
 * first", then "Still a risk", then "Couldn't check". Canceling happens in the user's own wallet,
 * through revoke.cash or the explorer's checker; Almstins never asks for a signature.
 */

import React, { useEffect, useId, useState } from 'react';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getWalletApprovals, type WalletApprovalsLocale } from '@/i18n/dashboard/walletApprovals';
import { Modal } from '@/components/ui/Modal';
import { CopyButton } from '@/components/ui/CopyButton';
import PoweredByGoPlus from '@/components/PoweredByGoPlus';
import { shortenAddress } from '@/lib/addressDisplay';
import { formatDate, formatDateTime } from '@/lib/format';
import { amountText, reasonText, spenderText, whatText } from '@/lib/approvals/describe';
import { approvalCheckerName } from '@/lib/approvals/links';
import type { ApprovalGroup, ApprovalsReport, StandingApproval } from '@/lib/approvals/types';
import type { Lang } from '@/lib/i18n/locale';
import './walletApprovals.css';

type Status = 'idle' | 'checking' | 'error' | 'rate_limited';
type Tab = 'list' | 'how';

const GROUPS: ApprovalGroup[] = ['revoke_first', 'still_a_risk', 'unknown'];

export function WalletApprovals({ walletId, walletName }: { walletId: string; walletName: string }) {
	const lang = getClientLang();
	const t = getWalletApprovals(lang);
	const [report, setReport] = useState<ApprovalsReport | null>(null);
	const [status, setStatus] = useState<Status>('idle');
	const [open, setOpen] = useState(false);
	const [tab, setTab] = useState<Tab>('list');
	const titleId = useId();
	const tabsId = useId();

	// The last check, if one is still cached: shows the count without starting a new read.
	useEffect(() => {
		let gone = false;
		fetch(`/api/wallets/${encodeURIComponent(walletId)}/approvals?cached=1`)
			.then((r) => (r.ok ? r.json() : null))
			.then((data) => {
				if (!gone && data?.ok && Array.isArray(data.approvals)) setReport(data as ApprovalsReport);
			})
			.catch(() => {});
		return () => {
			gone = true;
		};
	}, [walletId]);

	async function check(refresh: boolean) {
		setStatus('checking');
		try {
			const res = await fetch(`/api/wallets/${encodeURIComponent(walletId)}/approvals${refresh ? '?refresh=1' : ''}`);
			if (res.status === 429) {
				setStatus('rate_limited');
				return;
			}
			const data = await res.json().catch(() => null);
			if (!res.ok || !data?.ok) {
				setStatus('error');
				return;
			}
			setReport(data as ApprovalsReport);
			setStatus('idle');
			setTab('list');
			setOpen(true);
		} catch {
			setStatus('error');
		}
	}

	const checking = status === 'checking';
	const revokeFirst = report?.counts.revokeFirst ?? 0;

	return (
		<section className="wa" aria-label={t.sectionTitle}>
			<div className="wa__head">
				<span className="wa__title">{t.sectionTitle}</span>
				{report && (
					<span className="wa__summary">
						{t.summary(report.counts.revokeFirst + report.counts.stillARisk)}
						{revokeFirst > 0 && <span className="wa__alert">{t.revokeFirstCount(revokeFirst)}</span>}
						{report.counts.unknown > 0 && <span className="wa__unknown">{t.unknownCount(report.counts.unknown)}</span>}
					</span>
				)}
			</div>
			{!report && <p className="wa__hint">{t.notChecked}</p>}
			{status === 'error' && <p className="wa__error">{t.failed}</p>}
			{status === 'rate_limited' && <p className="wa__error">{t.rateLimited}</p>}
			<div className="wa__actions">
				{report && (
					<button type="button" className="wa__button" onClick={() => { setTab('list'); setOpen(true); }}>
						{t.open}
					</button>
				)}
				<button type="button" className="wa__button wa__button--primary" onClick={() => check(Boolean(report))} disabled={checking}>
					{checking ? t.checking : report ? t.checkAgain : t.checkButton}
				</button>
			</div>

			{open && report && (
				<Modal labelledBy={titleId} onClose={() => setOpen(false)} maxWidth="860px">
					<div className="wa-modal">
						<h2 id={titleId} className="wa-modal__title">
							{t.sectionTitle}: {walletName}
						</h2>
						<div className="wa-tabs" role="tablist" aria-label={t.sectionTitle}>
							<TabButton id={`${tabsId}-list`} panel={`${tabsId}-list-panel`} active={tab === 'list'} onClick={() => setTab('list')}>
								{t.tabList}
							</TabButton>
							<TabButton id={`${tabsId}-how`} panel={`${tabsId}-how-panel`} active={tab === 'how'} onClick={() => setTab('how')}>
								{t.tabHowItWorks}
							</TabButton>
						</div>
						{tab === 'list' ? (
							<div role="tabpanel" id={`${tabsId}-list-panel`} aria-labelledby={`${tabsId}-list`}>
								<ApprovalList report={report} t={t} lang={lang} />
							</div>
						) : (
							<div role="tabpanel" id={`${tabsId}-how-panel`} aria-labelledby={`${tabsId}-how`}>
								<HowItWorks t={t} />
							</div>
						)}
						<div className="wa-modal__footer">
							<button type="button" className="wa__button" onClick={() => check(true)} disabled={checking}>
								{checking ? t.checking : t.checkAgain}
							</button>
							<button type="button" className="wa__button" onClick={() => setOpen(false)}>
								{t.close}
							</button>
						</div>
					</div>
				</Modal>
			)}
		</section>
	);
}

function TabButton({ id, panel, active, onClick, children }: { id: string; panel: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			role="tab"
			id={id}
			aria-controls={panel}
			aria-selected={active}
			className={`wa-tabs__tab${active ? ' wa-tabs__tab--active' : ''}`}
			onClick={onClick}
		>
			{children}
		</button>
	);
}

function ApprovalList({ report, t, lang }: { report: ApprovalsReport; t: WalletApprovalsLocale; lang: Lang }) {
	const notes = report.chains.filter((c) => c.status !== 'read');
	return (
		<div className="wa-list">
			<p className="wa-list__lead">{t.lead}</p>
			<p className="wa-list__asof">{t.asOf(formatDateTime(report.checkedAt, lang))}</p>
			{notes.map((c) => (
				<p key={c.chain} className="wa-list__chain-note">
					{c.status === 'partial' ? t.chainPartial(c.chain) : t.chainUnavailable(c.chain)}{' '}
					<a href={c.revoke} target="_blank" rel="noopener noreferrer">{t.revokeLink}</a>
				</p>
			))}
			{report.approvals.length === 0 ? (
				<p className="wa-list__empty">{t.empty}</p>
			) : (
				GROUPS.map((g) => {
					const items = report.approvals.filter((a) => a.group === g);
					if (items.length === 0) return null;
					return (
						<section key={g} className={`wa-group wa-group--${g}`}>
							<h3 className="wa-group__title">
								{g === 'revoke_first' ? t.groupRevokeFirst : g === 'still_a_risk' ? t.groupStillARisk : t.groupUnknown}
								<span className="wa-group__count">{items.length}</span>
							</h3>
							{g === 'still_a_risk' && <p className="wa-group__note">{t.groupStillARiskNote}</p>}
							{g === 'unknown' && <p className="wa-group__note">{t.groupUnknownNote}</p>}
							<ul className="wa-items">
								{items.map((a) => (
									<ApprovalItem key={a.id} a={a} t={t} lang={lang} />
								))}
							</ul>
						</section>
					);
				})
			)}
			<p className="wa-list__cancel">{t.cancelNote}</p>
			{report.approvals.some((a) => a.spender.checker?.goplus) && <PoweredByGoPlus label={t.poweredByGoPlus} />}
		</div>
	);
}

function ApprovalItem({ a, t, lang }: { a: StandingApproval; t: WalletApprovalsLocale; lang: Lang }) {
	const spenderName = spenderText(a);
	const lastActive = !a.spender.lastActiveRead
		? t.lastActiveUnread
		: a.spender.lastActiveAt
			? formatDate(a.spender.lastActiveAt, lang)
			: t.lastActiveNone;
	return (
		<li className={`wa-item wa-item--${a.group}`}>
			<div className="wa-item__head">
				<div className="wa-item__spender">
					<span className="wa-item__label">{t.colSpender}</span>
					<span className="wa-item__name">{spenderName}</span>
					<span className="wa-item__address">
						{shortenAddress(a.spender.address)}
						<CopyButton value={a.spender.address} variant="icon" />
					</span>
				</div>
				<span className="wa-item__chain">{t.chainName(a.chain)}</span>
			</div>
			<dl className="wa-item__facts">
				<div>
					<dt>{t.colWhat}</dt>
					<dd>{whatText(a, t)}</dd>
				</div>
				<div>
					<dt>{t.colAmount}</dt>
					<dd>
						{amountText(a, t)}
						{a.kind === 'permit2' && a.group !== 'unknown' && (
							<span className="wa-item__sub">{a.expiresAt ? t.expiresOn(formatDate(a.expiresAt, lang)) : t.noEndDate}</span>
						)}
					</dd>
				</div>
				<div>
					<dt>{t.colGiven}</dt>
					<dd>{a.givenAt ? formatDate(a.givenAt, lang) : t.dateUnknown}</dd>
				</div>
				<div>
					<dt>{t.colLastActive}</dt>
					<dd>{lastActive}</dd>
				</div>
				<div className="wa-item__why">
					<dt>{t.colWhy}</dt>
					<dd>
						{a.group === 'unknown' ? (
							t.unknownRow
						) : a.reasons.length > 0 ? (
							<ul className="wa-item__reasons">
								{a.reasons.map((r) => (
									<li key={r.code}>{reasonText(r, a, t)}</li>
								))}
							</ul>
						) : (
							t.noFlag
						)}
						{a.group !== 'unknown' && a.spender.checker && !a.spender.checker.complete && (
							<span className="wa-item__sub">{t.checkerIncomplete}</span>
						)}
					</dd>
				</div>
				<div className="wa-item__cancel">
					<dt>{t.colCancel}</dt>
					<dd>
						<a href={a.links.revoke} target="_blank" rel="noopener noreferrer">{t.revokeLink}</a>
						{a.links.checker && (
							<>
								{' · '}
								<a href={a.links.checker} target="_blank" rel="noopener noreferrer">{t.checkerLink(approvalCheckerName(a.chain))}</a>
							</>
						)}
					</dd>
				</div>
			</dl>
		</li>
	);
}

function HowItWorks({ t }: { t: WalletApprovalsLocale }) {
	return (
		<div className="wa-how">
			{t.howItWorks.map((item) => (
				<section key={item.title} className="wa-how__item">
					<h3 className="wa-how__title">{item.title}</h3>
					<p className="wa-how__body">{item.body}</p>
				</section>
			))}
		</div>
	);
}

export default WalletApprovals;
