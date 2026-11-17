/**
 * "Did you mean …?" (phase 3 of the poisoning plan): shown when the user saves an address that
 * starts and ends like one already in their address book. The two addresses are stacked with the
 * differing characters highlighted, so the user sees the difference instead of being asked to
 * trust it. Cancel is the default; saving anyway resends with confirmLookalike: true.
 * The label is the user's own text and is rendered as text only.
 */

import React, { useEffect, useRef } from 'react';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getPoisonWarning } from '@/i18n/components/poisonWarning';
import { differingPositions } from '@/lib/addressPoisoning';
import './poisonWarning.css';

export interface LookalikeMatch {
	address: string;
	label: string;
}

/** One address with the characters at `marks` highlighted. Shared with the Danger Zone prompt. */
export function DiffLine({ value, marks }: { value: string; marks: Set<number> }) {
	return (
		<code className="addr-diff__line">
			{[...value].map((ch, i) =>
				marks.has(i) ? (
					<mark key={i} className="addr-diff__mark">{ch}</mark>
				) : (
					<React.Fragment key={i}>{ch}</React.Fragment>
				),
			)}
		</code>
	);
}

export function LookalikePrompt({
	entered,
	match,
	busy,
	onCancel,
	onSaveAnyway,
}: {
	entered: string;
	match: LookalikeMatch;
	busy?: boolean;
	onCancel: () => void;
	onSaveAnyway: () => void;
}) {
	const t = getPoisonWarning(getClientLang());
	const marks = differingPositions(entered, match.address);
	const cancelRef = useRef<HTMLButtonElement>(null);
	useEffect(() => cancelRef.current?.focus(), []);

	return (
		<div className="poison-warning poison-warning--red lookalike-prompt" role="alert">
			<p className="lookalike-prompt__title">
				<span className="poison-warning__lead">⚠ </span>
				{t.didYouMean(match.label)}
			</p>
			<p className="lookalike-prompt__text">{t.lookalikeExplain(match.label)}</p>
			<div className="addr-diff">
				<span className="addr-diff__caption">{t.youEntered}</span>
				<DiffLine value={entered} marks={marks} />
				<span className="addr-diff__caption">{t.savedAs(match.label)}</span>
				<DiffLine value={match.address} marks={marks} />
			</div>
			<div className="lookalike-prompt__actions">
				<button ref={cancelRef} type="button" className="lookalike-prompt__cancel" onClick={onCancel} disabled={busy}>
					{t.cancel}
				</button>
				<button type="button" className="lookalike-prompt__anyway" onClick={onSaveAnyway} disabled={busy}>
					{t.saveAnyway}
				</button>
			</div>
		</div>
	);
}
