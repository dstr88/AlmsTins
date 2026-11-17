// Quarantine: user-facing strings (EN · ES · FR).
//
// Phase 4 of the poisoning-warnings plan (src/lib/quarantine.ts). Named by Donnie, Nov 17, 2026.
// The wording says what a pattern suggests, never that a crime happened. `label` and wallet names
// are the user's own text; callers render them as text, never as HTML.

import type { Lang } from '@/lib/i18n/locale';

export interface QuarantineLocale {
	button: string;
	buttonCount: (n: number) => string;
	buttonTitle: string;
	modalTitle: (wallet: string) => string;
	pageTitle: string;
	eyebrow: string;
	heading: string;
	description: string;
	emptyWallet: string;
	emptyAll: string;
	seeAll: string;
	link: (n: number) => string;
	reasonDustOnly: string;
	reasonLookalike: (label: string) => string;
	reasonBoth: (label: string) => string;
	reasonByUser: string;
	firstSeen: (date: string) => string;
	sentIn: (usd: string, n: number) => string;
	releaseBtn: string;
	toQuarantineBtn: string;
	toQuarantineTitle: string;
	releasedBadge: string;
	confirmTitle: string;
	confirmLookalike: (label: string) => string;
	confirmDustOnly: string;
	confirmByUser: string;
	thisAddress: string;
	savedAs: (label: string) => string;
	nameLabel: string;
	namePlaceholder: string;
	keep: string;
	release: string;
	releasing: string;
	releaseFailed: string;
	quarantineFailed: string;
	backToAddresses: string;
	/** Needs Attention: items with quarantined addresses, set aside behind "Show". */
	needsAttentionHidden: (n: number) => string;
	show: string;
	hiddenReason: (signal: string) => string;
}

const en: QuarantineLocale = {
	button: 'Quarantine',
	buttonCount: (n) => `Quarantine · ${n}`,
	buttonTitle: 'Addresses kept apart for this wallet: look-alikes of addresses you saved, senders of tiny amounts, and any you quarantined',
	modalTitle: (wallet) => `Quarantine · ${wallet}`,
	pageTitle: 'Quarantine | Almstins',
	eyebrow: 'Kept apart',
	heading: 'Quarantine',
	description:
		"Addresses that have only ever sent you tiny amounts, or that look like one in your address book but aren't, a common setup for address poisoning, and addresses you quarantined yourself (☠). They are kept apart from your address book. Nothing is deleted, and the transactions stay in your history.",
	emptyWallet: 'Nothing in quarantine for this wallet.',
	emptyAll: 'Nothing in quarantine.',
	seeAll: 'See all wallets',
	link: (n) => (n === 1 ? '1 address in quarantine' : `${n} addresses in quarantine`),
	reasonDustOnly: 'Has only ever sent you tiny amounts',
	reasonLookalike: (label) => `Looks like ${label}, but is a different address`,
	reasonBoth: (label) => `Looks like ${label}, and has only ever sent you tiny amounts`,
	reasonByUser: 'You quarantined it',
	firstSeen: (date) => `First seen ${date}`,
	sentIn: (usd, n) => `${n} ${n === 1 ? 'transfer' : 'transfers'}, ${usd} in`,
	releaseBtn: 'Release to address book',
	toQuarantineBtn: 'To quarantine',
	toQuarantineTitle: 'Move this address to quarantine',
	releasedBadge: 'released from quarantine',
	confirmTitle: 'Are you sure?',
	confirmLookalike: (label) =>
		`This address looks like ${label} but is different in the highlighted characters. Addresses like this are often used in address poisoning. Release it to your address book anyway?`,
	confirmDustOnly:
		'This address has only ever sent you tiny amounts, a common setup for address poisoning. Release it to your address book anyway?',
	confirmByUser: 'You quarantined this address yourself. Release it to your address book?',
	thisAddress: 'This address',
	savedAs: (label) => `Saved as ${label}`,
	nameLabel: 'Give it a name',
	namePlaceholder: 'e.g. Venmo deposit',
	keep: 'Keep it in quarantine',
	release: 'Release it',
	releasing: 'Releasing…',
	releaseFailed: 'Could not release the address. Try again.',
	quarantineFailed: 'Could not quarantine the address. Try again.',
	backToAddresses: 'Back to Addresses',
	needsAttentionHidden: (n) => (n === 1 ? '1 item with a quarantined address is hidden' : `${n} items with quarantined addresses are hidden`),
	show: 'Show',
	hiddenReason: (signal) => (signal === 'quarantined' ? '☠ You quarantined this address' : signal === 'dust-only' ? '⚠ Address only ever sent you tiny amounts' : '⚠ Address looks like one you saved'),
};

const es: QuarantineLocale = {
	button: 'Cuarentena',
	buttonCount: (n) => `Cuarentena · ${n}`,
	buttonTitle: 'Direcciones apartadas para esta billetera: imitaciones de direcciones que guardaste, remitentes de cantidades mínimas y las que pusiste en cuarentena',
	modalTitle: (wallet) => `Cuarentena · ${wallet}`,
	pageTitle: 'Cuarentena | Almstins',
	eyebrow: 'Aparte',
	heading: 'Cuarentena',
	description:
		'Direcciones que solo te han enviado cantidades mínimas, o que se parecen a una de tu Address Book sin serlo, una preparación habitual del envenenamiento de direcciones, y las que pusiste tú en cuarentena (☠). Se guardan aparte de tu Address Book. No se borra nada, y las transacciones siguen en tu historial.',
	emptyWallet: 'No hay nada en cuarentena para esta billetera.',
	emptyAll: 'No hay nada en cuarentena.',
	seeAll: 'Ver todas las billeteras',
	link: (n) => (n === 1 ? '1 dirección en cuarentena' : `${n} direcciones en cuarentena`),
	reasonDustOnly: 'Solo te ha enviado cantidades mínimas',
	reasonLookalike: (label) => `Se parece a ${label}, pero es una dirección distinta`,
	reasonBoth: (label) => `Se parece a ${label} y solo te ha enviado cantidades mínimas`,
	reasonByUser: 'La pusiste tú en cuarentena',
	firstSeen: (date) => `Vista por primera vez el ${date}`,
	sentIn: (usd, n) => `${n} ${n === 1 ? 'transferencia' : 'transferencias'}, ${usd} recibidos`,
	releaseBtn: 'Devolver al Address Book',
	toQuarantineBtn: 'A cuarentena',
	toQuarantineTitle: 'Poner esta dirección en cuarentena',
	releasedBadge: 'salida de cuarentena',
	confirmTitle: '¿Estás seguro?',
	confirmLookalike: (label) =>
		`Esta dirección se parece a ${label}, pero es distinta en los caracteres resaltados. Direcciones así se usan a menudo en el envenenamiento de direcciones. ¿La devuelves a tu Address Book de todos modos?`,
	confirmDustOnly:
		'Esta dirección solo te ha enviado cantidades mínimas, una preparación habitual del envenenamiento de direcciones. ¿La devuelves a tu Address Book de todos modos?',
	confirmByUser: 'Pusiste tú esta dirección en cuarentena. ¿La devuelves a tu Address Book?',
	thisAddress: 'Esta dirección',
	savedAs: (label) => `Guardada como ${label}`,
	nameLabel: 'Ponle un nombre',
	namePlaceholder: 'p. ej. depósito de Venmo',
	keep: 'Dejarla en cuarentena',
	release: 'Devolverla',
	releasing: 'Devolviendo…',
	releaseFailed: 'No se pudo devolver la dirección. Inténtalo de nuevo.',
	quarantineFailed: 'No se pudo poner la dirección en cuarentena. Inténtalo de nuevo.',
	backToAddresses: 'Volver a Direcciones',
	needsAttentionHidden: (n) => (n === 1 ? '1 elemento con una dirección en cuarentena está oculto' : `${n} elementos con direcciones en cuarentena están ocultos`),
	show: 'Mostrar',
	hiddenReason: (signal) => (signal === 'quarantined' ? '☠ Pusiste esta dirección en cuarentena' : signal === 'dust-only' ? '⚠ La dirección solo te ha enviado cantidades mínimas' : '⚠ La dirección se parece a una que guardaste'),
};

const fr: QuarantineLocale = {
	button: 'Quarantaine',
	buttonCount: (n) => `Quarantaine · ${n}`,
	buttonTitle: 'Adresses tenues à l’écart pour ce portefeuille : imitations d’adresses enregistrées, expéditeurs de montants infimes, et celles que vous avez mises en quarantaine',
	modalTitle: (wallet) => `Quarantaine · ${wallet}`,
	pageTitle: 'Quarantaine | Almstins',
	eyebrow: 'À l’écart',
	heading: 'Quarantaine',
	description:
		'Les adresses qui ne vous ont jamais envoyé que des montants infimes, ou qui ressemblent à une adresse de votre Address Book sans l’être, une préparation courante de l’empoisonnement d’adresse, et celles que vous avez mises en quarantaine vous-même (☠). Elles sont tenues à l’écart de votre Address Book. Rien n’est supprimé, et les transactions restent dans votre historique.',
	emptyWallet: 'Rien en quarantaine pour ce portefeuille.',
	emptyAll: 'Rien en quarantaine.',
	seeAll: 'Voir tous les portefeuilles',
	link: (n) => (n === 1 ? '1 adresse en quarantaine' : `${n} adresses en quarantaine`),
	reasonDustOnly: 'Ne vous a jamais envoyé que des montants infimes',
	reasonLookalike: (label) => `Ressemble à ${label}, mais c’est une autre adresse`,
	reasonBoth: (label) => `Ressemble à ${label} et ne vous a jamais envoyé que des montants infimes`,
	reasonByUser: 'Vous l’avez mise en quarantaine',
	firstSeen: (date) => `Vue pour la première fois le ${date}`,
	sentIn: (usd, n) => `${n} ${n === 1 ? 'transfert' : 'transferts'}, ${usd} reçus`,
	releaseBtn: 'Remettre dans l’Address Book',
	toQuarantineBtn: 'En quarantaine',
	toQuarantineTitle: 'Mettre cette adresse en quarantaine',
	releasedBadge: 'sortie de quarantaine',
	confirmTitle: 'Êtes-vous sûr ?',
	confirmLookalike: (label) =>
		`Cette adresse ressemble à ${label} mais diffère par les caractères surlignés. Des adresses de ce type servent souvent à l’empoisonnement d’adresse. La remettre quand même dans votre Address Book ?`,
	confirmDustOnly:
		'Cette adresse ne vous a jamais envoyé que des montants infimes, une préparation courante de l’empoisonnement d’adresse. La remettre quand même dans votre Address Book ?',
	confirmByUser: 'Vous avez mis cette adresse en quarantaine vous-même. La remettre dans votre Address Book ?',
	thisAddress: 'Cette adresse',
	savedAs: (label) => `Enregistrée sous ${label}`,
	nameLabel: 'Donnez-lui un nom',
	namePlaceholder: 'ex. dépôt Venmo',
	keep: 'La laisser en quarantaine',
	release: 'La remettre',
	releasing: 'En cours…',
	releaseFailed: 'Impossible de remettre l’adresse. Réessayez.',
	quarantineFailed: 'Impossible de mettre l’adresse en quarantaine. Réessayez.',
	backToAddresses: 'Retour aux Adresses',
	needsAttentionHidden: (n) => (n === 1 ? '1 élément avec une adresse en quarantaine est masqué' : `${n} éléments avec des adresses en quarantaine sont masqués`),
	show: 'Afficher',
	hiddenReason: (signal) => (signal === 'quarantined' ? '☠ Vous avez mis cette adresse en quarantaine' : signal === 'dust-only' ? '⚠ L’adresse ne vous a jamais envoyé que des montants infimes' : '⚠ L’adresse ressemble à une adresse enregistrée'),
};

const MAP: Record<Lang, QuarantineLocale> = { en, es, fr };

export function getQuarantine(lang: Lang): QuarantineLocale {
	return MAP[lang] ?? en;
}
