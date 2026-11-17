/**
 * The address-poisoning warning under an address in the transaction drawer. Amber for an address
 * that has only ever sent the user dust; red for a look-alike of an address they saved, or both;
 * ☠ with a dark border for an address the user quarantined themselves.
 * The flag comes from the history API (src/lib/poisoningFlags.ts); the label it names is the
 * user's own text and is rendered as text only.
 */

import React from 'react';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getPoisonWarning, poisonSentence } from '@/i18n/components/poisonWarning';
import type { PoisonFlag } from '@/lib/poisoningFlags';
import './poisonWarning.css';

export function PoisonWarning({ flag }: { flag: PoisonFlag | null | undefined }) {
	if (!flag) return null;
	const t = getPoisonWarning(getClientLang());
	const skull = flag.signal === 'quarantined';
	const red = !skull && flag.signal !== 'dust-only';
	return (
		<div className={`poison-warning${red ? ' poison-warning--red' : ''}${skull ? ' poison-warning--skull' : ''}`} role="note">
			<span className="poison-warning__lead">{skull ? '☠ ' : '⚠ '}</span>
			{poisonSentence(t, flag.signal, flag.imitates)}
		</div>
	);
}
