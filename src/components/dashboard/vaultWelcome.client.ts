/**
 * vaultWelcome.client.ts: behaviour for the Vault's welcome card (VaultWelcome.astro).
 *
 * Shows the card unless this browser has already answered it, wires "Yes, show me" to the shared
 * tour engine and "Not now" to closing the card, and ends the tour with the cursor in the wallet
 * address field. Either answer is kept in this browser's local storage only; nothing is sent.
 *
 * Local storage can be missing or throw (a private window, blocked site data). Then the card shows
 * on every visit until the account has a wallet or a CSV, and both buttons still work.
 */

interface TourStep {
	selector: string;
	title: string;
	body: string;
}

interface WelcomeConfig {
	tourId: string;
	seenKey: string;
	addressField: string;
	steps: TourStep[];
	labels: Record<string, string>;
}

interface TourEngineApi {
	register: (tourId: string, steps: TourStep[], labels: Record<string, string>, options: { onFinish?: () => void }) => void;
	start: (tourId: string, idx?: number) => void;
}

function hasSeen(key: string): boolean {
	try {
		return window.localStorage.getItem(key) === '1';
	} catch {
		return false;
	}
}

function markSeen(key: string): void {
	try {
		window.localStorage.setItem(key, '1');
	} catch {
		// Not kept: the card comes back next visit, which is harmless.
	}
}

function readConfig(card: HTMLElement): WelcomeConfig | null {
	try {
		const config = JSON.parse(card.dataset.vaultWelcome ?? '') as WelcomeConfig;
		return Array.isArray(config.steps) ? config : null;
	} catch {
		return null;
	}
}

/** Put the cursor in the wallet address field, on the Wallet tab, and bring it into view. */
function focusAddressField(selector: string): void {
	const walletTab = document.querySelector<HTMLButtonElement>('[data-add-tab="wallet"]');
	if (walletTab && walletTab.getAttribute('aria-selected') !== 'true') walletTab.click();
	const field = document.querySelector<HTMLInputElement>(selector);
	if (!field) return;
	field.scrollIntoView({ behavior: 'smooth', block: 'center' });
	field.focus({ preventScroll: true });
}

export function initVaultWelcome(): void {
	const card = document.getElementById('vault-welcome');
	if (!card) return;
	const config = readConfig(card);
	if (!config || hasSeen(config.seenKey)) return;
	card.hidden = false;

	const engine = (window as unknown as { TourEngine?: TourEngineApi }).TourEngine;
	const focus = () => focusAddressField(config.addressField);
	// The engine calls onFinish when the tour ends in any way (last step, close or backdrop).
	engine?.register(config.tourId, config.steps, config.labels, { onFinish: focus });

	const close = () => {
		markSeen(config.seenKey);
		card.hidden = true;
	};

	card.querySelector('[data-vault-welcome-yes]')?.addEventListener('click', () => {
		close();
		if (engine) engine.start(config.tourId);
		else focus();
	});
	card.querySelector('[data-vault-welcome-no]')?.addEventListener('click', close);

	// Smart Import does not reload the page, so the card leaves on its own once a CSV has landed.
	// The server rule keeps it away from then on (the account is no longer empty).
	const results = document.getElementById('smart-import-results');
	if (results) {
		const observer = new MutationObserver(() => {
			if (results.querySelector('.si-result--success')) {
				card.hidden = true;
				observer.disconnect();
			}
		});
		observer.observe(results, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
	}
}
