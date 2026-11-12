import React, { useState } from 'react';
import './WalletChainPicker.css';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getWalletChainPicker } from '@/i18n/components/walletChainPicker';
import { chainChoices, chainsAfterToggle, type ChainChoice } from '@/lib/walletChainPicker';

interface Props {
	walletId: string;
	chains: string[];
	/** Called with the chain list the server stored, after a successful save. */
	onSaved: (chains: string[]) => void;
}

export default function WalletChainPicker({ walletId, chains, onSaved }: Props) {
	const t = getWalletChainPicker(getClientLang());
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	async function toggle(chain: string) {
		const next = chainsAfterToggle(chains, chain);
		if (!next) {
			setMessage(t.keepOne);
			return;
		}
		setSaving(true);
		setMessage(t.saving);
		try {
			const res = await fetch(`/api/wallets/${walletId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ chains: next }),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			setMessage(t.saved);
			onSaved(Array.isArray(data?.chains) ? data.chains : next);
		} catch {
			setMessage(t.saveError);
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="wallet-chain-picker">
			<span className="wallet-chain-picker__label">{t.label}</span>
			<div className="wallet-chain-picker__options">
				{chainChoices(chains).map((choice) => (
					<ChainCheckbox key={choice.chain} choice={choice} disabled={saving} onToggle={toggle} />
				))}
			</div>
			<p className="wallet-chain-picker__status">{message ?? t.hint}</p>
		</div>
	);
}

function ChainCheckbox({
	choice,
	disabled,
	onToggle,
}: {
	choice: ChainChoice;
	disabled: boolean;
	onToggle: (chain: string) => void;
}) {
	return (
		<label className="wallet-chain-picker__option">
			<input
				type="checkbox"
				checked={choice.checked}
				disabled={disabled}
				onChange={() => onToggle(choice.chain)}
			/>
			{choice.name}
		</label>
	);
}
