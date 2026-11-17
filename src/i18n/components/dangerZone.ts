// The Danger Zone on the Addresses page: user-facing strings (EN · ES · FR).
//
// Phase 4 of the poisoning-warnings plan (src/lib/dangerZone.ts). The wording says what a pattern
// suggests, never that a crime happened. `label` is the user's own name for an address; callers
// render it as text, never as HTML.

import type { Lang } from '@/lib/i18n/locale';

export interface DangerZoneLocale {
	eyebrow: string;
	heading: string;
	description: string;
	empty: string;
	dropHint: string;
	reasonDustOnly: string;
	reasonLookalike: (label: string) => string;
	reasonBoth: (label: string) => string;
	reasonMarked: string;
	firstSeen: (date: string) => string;
	sentIn: (usd: string, n: number) => string;
	moveBtn: string;
	sendBtn: string;
	sendBtnTitle: string;
	movedBadge: string;
	// The "Are you sure?" prompt
	confirmTitle: string;
	confirmLookalike: (label: string) => string;
	confirmDustOnly: string;
	confirmMarked: string;
	thisAddress: string;
	savedAs: (label: string) => string;
	nameLabel: string;
	namePlaceholder: string;
	keep: string;
	move: string;
	moving: string;
	moveFailed: string;
	sendFailed: string;
}

const en: DangerZoneLocale = {
	eyebrow: 'Kept apart',
	heading: 'Danger Zone',
	description:
		"Addresses that have only ever sent you tiny amounts, or that look like one in your address book but aren't, a common setup for address poisoning. They are kept apart from your address book. Nothing here is deleted, and the transactions stay in your history.",
	empty: 'Nothing here. No address in your history has only sent you dust or looks like one you saved.',
	dropHint: 'Drop here to move it to the Danger Zone',
	reasonDustOnly: 'Has only ever sent you tiny amounts',
	reasonLookalike: (label) => `Looks like ${label}, but is a different address`,
	reasonBoth: (label) => `Looks like ${label}, and has only ever sent you tiny amounts`,
	reasonMarked: 'You moved it here from your address book',
	firstSeen: (date) => `First seen ${date}`,
	sentIn: (usd, n) => `${n} ${n === 1 ? 'transfer' : 'transfers'}, ${usd} in`,
	moveBtn: 'Move to address book',
	sendBtn: 'To Danger Zone',
	sendBtnTitle: 'Move this address to the Danger Zone',
	movedBadge: 'moved from Danger Zone',
	confirmTitle: 'Are you sure?',
	confirmLookalike: (label) =>
		`This address looks like ${label} but is different in the highlighted characters. Addresses like this are often used in address poisoning. Move it to your address book anyway?`,
	confirmDustOnly:
		'This address has only ever sent you tiny amounts, a common setup for address poisoning. Move it to your address book anyway?',
	confirmMarked: 'You moved this address to the Danger Zone. Move it back to your address book?',
	thisAddress: 'This address',
	savedAs: (label) => `Saved as ${label}`,
	nameLabel: 'Give it a name',
	namePlaceholder: 'e.g. Venmo deposit',
	keep: 'Keep it in the Danger Zone',
	move: 'Move it',
	moving: 'Moving…',
	moveFailed: 'Could not move the address. Try again.',
	sendFailed: 'Could not move the address to the Danger Zone. Try again.',
};

const es: DangerZoneLocale = {
	eyebrow: 'Aparte',
	heading: 'Zona de peligro',
	description:
		'Direcciones que solo te han enviado cantidades mínimas, o que se parecen a una de tu Address Book sin serlo, una preparación habitual del envenenamiento de direcciones. Se guardan aparte de tu Address Book. Aquí no se borra nada, y las transacciones siguen en tu historial.',
	empty: 'No hay nada. Ninguna dirección de tu historial solo te ha enviado cantidades mínimas ni se parece a una que guardaste.',
	dropHint: 'Suéltala aquí para moverla a la Zona de peligro',
	reasonDustOnly: 'Solo te ha enviado cantidades mínimas',
	reasonLookalike: (label) => `Se parece a ${label}, pero es una dirección distinta`,
	reasonBoth: (label) => `Se parece a ${label} y solo te ha enviado cantidades mínimas`,
	reasonMarked: 'La moviste aquí desde tu Address Book',
	firstSeen: (date) => `Vista por primera vez el ${date}`,
	sentIn: (usd, n) => `${n} ${n === 1 ? 'transferencia' : 'transferencias'}, ${usd} recibidos`,
	moveBtn: 'Mover al Address Book',
	sendBtn: 'A la Zona de peligro',
	sendBtnTitle: 'Mover esta dirección a la Zona de peligro',
	movedBadge: 'movida desde la Zona de peligro',
	confirmTitle: '¿Estás seguro?',
	confirmLookalike: (label) =>
		`Esta dirección se parece a ${label}, pero es distinta en los caracteres resaltados. Direcciones así se usan a menudo en el envenenamiento de direcciones. ¿La mueves a tu Address Book de todos modos?`,
	confirmDustOnly:
		'Esta dirección solo te ha enviado cantidades mínimas, una preparación habitual del envenenamiento de direcciones. ¿La mueves a tu Address Book de todos modos?',
	confirmMarked: 'Moviste esta dirección a la Zona de peligro. ¿La devuelves a tu Address Book?',
	thisAddress: 'Esta dirección',
	savedAs: (label) => `Guardada como ${label}`,
	nameLabel: 'Ponle un nombre',
	namePlaceholder: 'p. ej. depósito de Venmo',
	keep: 'Dejarla en la Zona de peligro',
	move: 'Moverla',
	moving: 'Moviendo…',
	moveFailed: 'No se pudo mover la dirección. Inténtalo de nuevo.',
	sendFailed: 'No se pudo mover la dirección a la Zona de peligro. Inténtalo de nuevo.',
};

const fr: DangerZoneLocale = {
	eyebrow: 'À l’écart',
	heading: 'Zone de danger',
	description:
		'Les adresses qui ne vous ont jamais envoyé que des montants infimes, ou qui ressemblent à une adresse de votre Address Book sans l’être, une préparation courante de l’empoisonnement d’adresse. Elles sont tenues à l’écart de votre Address Book. Rien n’est supprimé ici, et les transactions restent dans votre historique.',
	empty: 'Rien ici. Aucune adresse de votre historique ne vous a envoyé que des montants infimes ni ne ressemble à une adresse enregistrée.',
	dropHint: 'Déposez-la ici pour la placer dans la Zone de danger',
	reasonDustOnly: 'Ne vous a jamais envoyé que des montants infimes',
	reasonLookalike: (label) => `Ressemble à ${label}, mais c’est une autre adresse`,
	reasonBoth: (label) => `Ressemble à ${label} et ne vous a jamais envoyé que des montants infimes`,
	reasonMarked: 'Vous l’avez placée ici depuis votre Address Book',
	firstSeen: (date) => `Vue pour la première fois le ${date}`,
	sentIn: (usd, n) => `${n} ${n === 1 ? 'transfert' : 'transferts'}, ${usd} reçus`,
	moveBtn: 'Déplacer vers l’Address Book',
	sendBtn: 'Vers la Zone de danger',
	sendBtnTitle: 'Placer cette adresse dans la Zone de danger',
	movedBadge: 'sortie de la Zone de danger',
	confirmTitle: 'Êtes-vous sûr ?',
	confirmLookalike: (label) =>
		`Cette adresse ressemble à ${label} mais diffère par les caractères surlignés. Des adresses de ce type servent souvent à l’empoisonnement d’adresse. La déplacer quand même vers votre Address Book ?`,
	confirmDustOnly:
		'Cette adresse ne vous a jamais envoyé que des montants infimes, une préparation courante de l’empoisonnement d’adresse. La déplacer quand même vers votre Address Book ?',
	confirmMarked: 'Vous avez placé cette adresse dans la Zone de danger. La remettre dans votre Address Book ?',
	thisAddress: 'Cette adresse',
	savedAs: (label) => `Enregistrée sous ${label}`,
	nameLabel: 'Donnez-lui un nom',
	namePlaceholder: 'ex. dépôt Venmo',
	keep: 'La laisser dans la Zone de danger',
	move: 'La déplacer',
	moving: 'Déplacement…',
	moveFailed: 'Impossible de déplacer l’adresse. Réessayez.',
	sendFailed: 'Impossible de placer l’adresse dans la Zone de danger. Réessayez.',
};

const MAP: Record<Lang, DangerZoneLocale> = { en, es, fr };

export function getDangerZone(lang: Lang): DangerZoneLocale {
	return MAP[lang] ?? en;
}
