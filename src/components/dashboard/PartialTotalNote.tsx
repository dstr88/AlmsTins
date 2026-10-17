import React from 'react';
import { getClientLang } from '@/lib/i18n/clientLang';
import { partialTotalMessage } from '@/i18n/components/partialTotalNote';

type Props = {
	/** True when the total may leave something out (see AaveCoverage). */
	partial?: boolean;
	/** Aave positions no price source could value, left out of the total. */
	unpricedCount?: number;
};

/**
 * Says so, under a total, when the total may leave something out. Renders nothing for a complete total,
 * so a partial total can never pass as a clean one.
 */
export default function PartialTotalNote({ partial, unpricedCount }: Props) {
	const message = partialTotalMessage(getClientLang(), partial, unpricedCount);
	if (!message) return null;
	return (
		<p role="note" className="partial-total-note" style={noteStyle}>
			{message}
		</p>
	);
}

const noteStyle: React.CSSProperties = {
	margin: 0,
	padding: '0.3rem 0.6rem',
	borderRadius: '8px',
	border: '1px solid var(--warning-border)',
	background: 'var(--warning-bg)',
	color: 'var(--warning)',
	fontSize: '0.78rem',
	lineHeight: 1.35,
};
