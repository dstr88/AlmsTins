/**
 * A quarantine list (src/lib/quarantine.ts), used in a wallet's Quarantine modal and on the
 * account-wide Quarantine page. Each row shows the address (no copy button: this is the list not
 * to copy from), the reason, when it first appeared and what it sent. "Release to address book"
 * opens "Are you sure?" first: a look-alike is stacked against the saved address with the
 * differing characters highlighted, a name is required (decision 5), and "Keep it in quarantine"
 * is focused. The released entry is saved with source 'user-override' and stays trusted.
 *
 * Labels are the user's own text and are rendered as text only.
 */

import React, { useEffect, useRef, useState } from 'react';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getQuarantine, type QuarantineLocale } from '@/i18n/components/quarantine';
import { formatDate, formatUsd } from '@/lib/format';
import { differingPositions } from '@/lib/addressPoisoning';
import type { QuarantineEntry } from '@/lib/quarantineEntry';
import { DiffLine } from './LookalikePrompt';
import { emitQuarantine, emitReleased } from './quarantineEvents';
import './poisonWarning.css';
import './quarantine.css';

function reasonOf(t: QuarantineLocale, e: QuarantineEntry): string {
	if (e.byUser) return t.reasonByUser;
	if (e.signal === 'both' && e.imitates) return t.reasonBoth(e.imitates.label);
	if (e.signal === 'lookalike' && e.imitates) return t.reasonLookalike(e.imitates.label);
	return t.reasonDustOnly;
}

function ReleasePrompt({
	entry,
	busy,
	error,
	onKeep,
	onRelease,
}: {
	entry: QuarantineEntry;
	busy: boolean;
	error: string | null;
	onKeep: () => void;
	onRelease: (name: string) => void;
}) {
	const t = getQuarantine(getClientLang());
	const [name, setName] = useState('');
	const keepRef = useRef<HTMLButtonElement>(null);
	useEffect(() => keepRef.current?.focus(), []);
	const marks = entry.imitates ? differingPositions(entry.address, entry.imitates.address) : null;
	const text = entry.imitates ? t.confirmLookalike(entry.imitates.label) : entry.byUser ? t.confirmByUser : t.confirmDustOnly;
	const tone = entry.byUser ? ' poison-warning--skull' : entry.signal === 'dust-only' ? '' : ' poison-warning--red';

	return (
		<div className={`poison-warning${tone} lookalike-prompt`} role="alert">
			<p className="lookalike-prompt__title">
				<span className="poison-warning__lead">{entry.byUser ? '☠ ' : '⚠ '}</span>
				{t.confirmTitle}
			</p>
			<p className="lookalike-prompt__text">{text}</p>
			{marks && entry.imitates && (
				<div className="addr-diff">
					<span className="addr-diff__caption">{t.thisAddress}</span>
					<DiffLine value={entry.address} marks={marks} />
					<span className="addr-diff__caption">{t.savedAs(entry.imitates.label)}</span>
					<DiffLine value={entry.imitates.address} marks={marks} />
				</div>
			)}
			<label className="q-prompt__name">
				<span>{t.nameLabel}</span>
				<input
					type="text"
					value={name}
					placeholder={t.namePlaceholder}
					onChange={(e) => setName(e.target.value)}
					onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && !busy) onRelease(name.trim()); }}
				/>
			</label>
			{error && <p className="q-prompt__error">{error}</p>}
			<div className="lookalike-prompt__actions">
				<button ref={keepRef} type="button" className="lookalike-prompt__cancel" onClick={onKeep} disabled={busy}>
					{t.keep}
				</button>
				<button type="button" className="lookalike-prompt__anyway" onClick={() => onRelease(name.trim())} disabled={busy || !name.trim()}>
					{busy ? t.releasing : t.release}
				</button>
			</div>
		</div>
	);
}

export function QuarantineList({
	entries,
	all,
	emptyText,
}: {
	/** The entries to show (one wallet's, or all). */
	entries: QuarantineEntry[];
	/** The whole quarantine, so a release can publish the list as it now stands. */
	all: QuarantineEntry[];
	emptyText: string;
}) {
	const lang = getClientLang();
	const t = getQuarantine(lang);
	const [pending, setPending] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function release(entry: QuarantineEntry, name: string) {
		if (!name) return;
		setBusy(true);
		setError(null);
		try {
			const res = await fetch('/api/address-labels', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ address: entry.address, label: name, category: 'counterparty', fromQuarantine: true }),
			});
			const data = await res.json().catch(() => null);
			if (!res.ok || !data) { setError(t.releaseFailed); return; }
			setPending(null);
			emitReleased(data);
			emitQuarantine(all.filter((e) => e.address !== entry.address));
		} catch {
			setError(t.releaseFailed);
		} finally {
			setBusy(false);
		}
	}

	if (entries.length === 0) return <p className="q-list__empty">{emptyText}</p>;

	return (
		<ul className="q-list">
			{entries.map((e) => {
				const tone = e.byUser ? ' q-row--skull' : e.signal === 'dust-only' ? '' : ' q-row--red';
				return (
					<li key={e.address} className={`q-row${tone}`}>
						<code className="q-row__address">{e.address}</code>
						<span className="q-row__reason">{e.byUser ? '☠ ' : '⚠ '}{reasonOf(t, e)}</span>
						<span className="q-row__meta">
							{e.firstAt ? t.firstSeen(formatDate(e.firstAt, lang)) : null}
							{e.transfers > 0 ? ` · ${t.sentIn(formatUsd(e.usdIn), e.transfers)}` : null}
						</span>
						{pending === e.address ? (
							<ReleasePrompt
								entry={e}
								busy={busy}
								error={error}
								onKeep={() => { setPending(null); setError(null); }}
								onRelease={(name) => void release(e, name)}
							/>
						) : (
							<button type="button" className="q-row__release" onClick={() => { setError(null); setPending(e.address); }}>
								{t.releaseBtn}
							</button>
						)}
					</li>
				);
			})}
		</ul>
	);
}
