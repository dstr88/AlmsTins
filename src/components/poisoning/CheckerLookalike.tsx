/**
 * The public checker, for a signed-in user (Donnie, Nov 17, 2026): does the address being checked
 * look like one in their own address book? Compared here in the browser. The page loads the user's
 * own address book once, in a request of its own that never carries the checked address, and the
 * check itself (/api/wallet-check) still sends only the address, never who is asking: the
 * checker's privacy line stays true. Signed out, the address book request answers 401 and nothing
 * is shown. Only entries the user saved count (decision 3a), as everywhere else.
 */

import React, { useEffect, useState } from 'react';
import { findLookalike, differingPositions, type AddressBookEntry } from '@/lib/addressPoisoning';
import { getPoisonWarning } from '@/i18n/components/poisonWarning';
import type { Lang } from '@/lib/i18n/locale';
import { DiffLine } from './LookalikePrompt';
import './poisonWarning.css';

let bookPromise: Promise<AddressBookEntry[] | null> | null = null;

/** The signed-in user's own address book, loaded once per page; null when signed out. */
function loadOwnBook(): Promise<AddressBookEntry[] | null> {
	if (!bookPromise) {
		bookPromise = fetch('/api/address-labels', { credentials: 'same-origin' })
			.then((r) => (r.ok ? r.json() : null))
			.then((rows) =>
				Array.isArray(rows)
					? rows.map((r: Record<string, unknown>) => ({
							address: String(r.address ?? ''),
							label: String(r.label ?? ''),
							source: r.source == null ? null : String(r.source),
						}))
					: null,
			)
			.catch(() => null);
	}
	return bookPromise;
}

export function CheckerLookalike({ address, lang }: { address: string; lang: Lang }) {
	const [book, setBook] = useState<AddressBookEntry[] | null>(null);
	useEffect(() => {
		let live = true;
		void loadOwnBook().then((b) => { if (live) setBook(b); });
		return () => { live = false; };
	}, []);

	const match = book && address ? findLookalike(address.trim(), book) : null;
	if (!match) return null;
	const t = getPoisonWarning(lang);
	const marks = differingPositions(address.trim(), match.address);

	return (
		<div className="poison-warning poison-warning--red lookalike-prompt checker-lookalike" role="alert">
			<p className="lookalike-prompt__title">
				<span className="poison-warning__lead">⚠ </span>
				{t.checkerLookalike(match.label)}
			</p>
			<div className="addr-diff">
				<span className="addr-diff__caption">{t.youEntered}</span>
				<DiffLine value={address.trim()} marks={marks} />
				<span className="addr-diff__caption">{t.savedAs(match.label)}</span>
				<DiffLine value={match.address} marks={marks} />
			</div>
			<p className="checker-lookalike__note">{t.checkerNote}</p>
		</div>
	);
}
