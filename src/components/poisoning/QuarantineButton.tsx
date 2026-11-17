/**
 * The quiet Quarantine button on a wallet card (Donnie, Nov 17, 2026: "helpful, not overbearing").
 * Grey and plain when nothing found touches this wallet; a red count only for look-alikes of
 * addresses the user saved, since those are the dangerous kind. Dust-only senders never add to
 * the count; they are listed inside. Opens this wallet's quarantine in the shared Modal, with a
 * link to the account-wide page.
 */

import React, { useId, useState } from 'react';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getQuarantine } from '@/i18n/components/quarantine';
import { countsOnButton, type QuarantineEntry } from '@/lib/quarantineEntry';
import { Modal } from '@/components/ui/Modal';
import { QuarantineList } from './QuarantineList';
import './quarantine.css';

export function QuarantineButton({
	walletId,
	walletName,
	all,
}: {
	walletId: string;
	walletName: string;
	all: QuarantineEntry[];
}) {
	const t = getQuarantine(getClientLang());
	const [open, setOpen] = useState(false);
	const titleId = useId();
	const mine = all.filter((e) => e.wallets.includes(walletId));
	const count = mine.filter(countsOnButton).length;

	return (
		<>
			<button
				type="button"
				className={`q-button${count > 0 ? ' q-button--alert' : ''}`}
				title={t.buttonTitle}
				onClick={() => setOpen(true)}
			>
				{count > 0 ? t.buttonCount(count) : t.button}
			</button>
			{open && (
				<Modal labelledBy={titleId} onClose={() => setOpen(false)} maxWidth="640px">
					<div className="q-modal">
						<h2 id={titleId} className="q-modal__title">{t.modalTitle(walletName)}</h2>
						<p className="q-modal__description">{t.description}</p>
						<QuarantineList entries={mine} all={all} emptyText={t.emptyWallet} />
						<a className="q-modal__all" href="/dashboard/quarantine">{t.seeAll} →</a>
					</div>
				</Modal>
			)}
		</>
	);
}
