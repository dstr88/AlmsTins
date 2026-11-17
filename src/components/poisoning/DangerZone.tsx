/**
 * The Danger Zone section of the Addresses page (phase 4 of the poisoning-warnings plan;
 * src/lib/dangerZone.ts). Flagged addresses sit here, apart from the address book (the "safe
 * zone"). Moving one into the book is a button or a drag onto the book, and either way the
 * "Are you sure?" prompt comes first: for a look-alike it stacks the two addresses with the
 * differing characters highlighted, it asks for a name (decision 5), and "Keep it in the Danger
 * Zone" is the default. Address book rows can be dragged here, or sent with their own button,
 * with no prompt.
 *
 * Addresses here have no copy button: this is the list not to copy from. Labels are the user's
 * own text and are rendered as text only. State lives in AddressLabels, which owns both lists.
 */

import React, { useEffect, useRef, useState } from 'react';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getDangerZone } from '@/i18n/components/dangerZone';
import { formatDate, formatUsd } from '@/lib/format';
import { differingPositions } from '@/lib/addressPoisoning';
import type { DangerEntry } from '@/lib/dangerZone';
import { DiffLine } from './LookalikePrompt';
import './poisonWarning.css';
import './dangerZone.css';

/** dataTransfer types for dragging between the two lists. */
export const DRAG_DANGER = 'application/x-almstins-danger-address';
export const DRAG_LABEL = 'application/x-almstins-label-id';

function reasonOf(t: ReturnType<typeof getDangerZone>, e: DangerEntry): string {
	if (e.signal === 'both' && e.imitates) return t.reasonBoth(e.imitates.label);
	if (e.signal === 'lookalike' && e.imitates) return t.reasonLookalike(e.imitates.label);
	if (e.signal === 'dust-only') return t.reasonDustOnly;
	return t.reasonMarked;
}

/** "Are you sure?" before an address leaves the Danger Zone. */
export function DangerMovePrompt({
	entry,
	busy,
	error,
	onKeep,
	onMove,
}: {
	entry: DangerEntry;
	busy: boolean;
	error: string | null;
	onKeep: () => void;
	onMove: (name: string) => void;
}) {
	const t = getDangerZone(getClientLang());
	const [name, setName] = useState('');
	const keepRef = useRef<HTMLButtonElement>(null);
	useEffect(() => keepRef.current?.focus(), []);
	const marks = entry.imitates ? differingPositions(entry.address, entry.imitates.address) : null;
	const text = entry.imitates
		? t.confirmLookalike(entry.imitates.label)
		: entry.signal === 'dust-only'
			? t.confirmDustOnly
			: t.confirmMarked;

	return (
		<div className={`poison-warning${entry.signal ? ' poison-warning--red' : ''} lookalike-prompt danger-prompt`} role="alert">
			<p className="lookalike-prompt__title">
				<span className="poison-warning__lead">⚠ </span>
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
			<label className="danger-prompt__name">
				<span>{t.nameLabel}</span>
				<input
					type="text"
					value={name}
					placeholder={t.namePlaceholder}
					onChange={(e) => setName(e.target.value)}
					onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && !busy) onMove(name.trim()); }}
				/>
			</label>
			{error && <p className="danger-prompt__error">{error}</p>}
			<div className="lookalike-prompt__actions">
				<button ref={keepRef} type="button" className="lookalike-prompt__cancel" onClick={onKeep} disabled={busy}>
					{t.keep}
				</button>
				<button
					type="button"
					className="lookalike-prompt__anyway"
					onClick={() => onMove(name.trim())}
					disabled={busy || !name.trim()}
				>
					{busy ? t.moving : t.move}
				</button>
			</div>
		</div>
	);
}

export function DangerZone({
	entries,
	pending,
	busy,
	error,
	onRequestMove,
	onKeep,
	onMove,
	onDropLabel,
}: {
	entries: DangerEntry[];
	/** The entry whose "Are you sure?" prompt is open. */
	pending: DangerEntry | null;
	busy: boolean;
	error: string | null;
	onRequestMove: (entry: DangerEntry) => void;
	onKeep: () => void;
	onMove: (entry: DangerEntry, name: string) => void;
	/** An address book row was dropped here. */
	onDropLabel: (labelId: string) => void;
}) {
	const lang = getClientLang();
	const t = getDangerZone(lang);
	const [dropActive, setDropActive] = useState(false);

	return (
		<section
			className={`danger-zone${dropActive ? ' danger-zone--drop' : ''}`}
			aria-labelledby="danger-zone-heading"
			onDragOver={(e) => {
				if (e.dataTransfer.types.includes(DRAG_LABEL)) { e.preventDefault(); setDropActive(true); }
			}}
			onDragLeave={() => setDropActive(false)}
			onDrop={(e) => {
				setDropActive(false);
				const id = e.dataTransfer.getData(DRAG_LABEL);
				if (id) { e.preventDefault(); onDropLabel(id); }
			}}
		>
			<header>
				<p className="danger-zone__eyebrow">{t.eyebrow}</p>
				<h2 id="danger-zone-heading" className="danger-zone__heading">⚠ {t.heading}</h2>
				<p className="danger-zone__description">{t.description}</p>
			</header>

			{dropActive && <p className="danger-zone__drop-hint">{t.dropHint}</p>}

			{entries.length === 0 ? (
				<p className="danger-zone__empty">{t.empty}</p>
			) : (
				<ul className="danger-zone__list">
					{entries.map((e) => {
						const red = e.signal === 'lookalike' || e.signal === 'both';
						return (
							<li
								key={e.address}
								className={`danger-zone__row${red ? ' danger-zone__row--red' : ''}`}
								draggable
								onDragStart={(ev) => {
									ev.dataTransfer.setData(DRAG_DANGER, e.address);
									ev.dataTransfer.effectAllowed = 'move';
								}}
							>
								<code className="danger-zone__address">{e.address}</code>
								<span className="danger-zone__reason">{reasonOf(t, e)}</span>
								<span className="danger-zone__meta">
									{e.firstAt ? t.firstSeen(formatDate(e.firstAt, lang)) : null}
									{e.transfers > 0 ? ` · ${t.sentIn(formatUsd(e.usdIn), e.transfers)}` : null}
								</span>
								{pending?.address === e.address ? (
									<DangerMovePrompt
										entry={e}
										busy={busy}
										error={error}
										onKeep={onKeep}
										onMove={(name) => onMove(e, name)}
									/>
								) : (
									<button type="button" className="danger-zone__move" onClick={() => onRequestMove(e)}>
										{t.moveBtn}
									</button>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}
