// Address-poisoning warnings: user-facing strings (EN · ES · FR).
//
// Shown wherever the history shows an address the poisoning rules flagged
// (src/lib/addressPoisoning.ts): the transaction drawer and the Transactions page. The wording
// says what the pattern suggests, never that a crime happened: an innocent airdrop can be
// dust-only. `label` is the user's own name for the address it imitates; callers render it as
// text, never as HTML.

import type { Lang } from '@/lib/i18n/locale';

export interface PoisonWarningLocale {
	/** Signal A: only ever sent the user dust. */
	dustOnly: string;
	/** Signal B: shares its ends with an address the user saved. */
	lookalike: (label: string) => string;
	/** Signal C: both. */
	both: (label: string) => string;
	/** Short tags for a table cell; the full sentence goes in the tooltip. */
	tagDustOnly: string;
	tagLookalike: string;
	tagBoth: string;
	/** The user quarantined this address themselves (shown with ☠). */
	quarantined: string;
	tagQuarantined: string;
	/** The public checker, signed in: compared in the browser with the user's own address book. */
	checkerLookalike: (label: string) => string;
	checkerNote: string;
	/** Saving an address that looks like a saved one (phase 3). */
	didYouMean: (label: string) => string;
	lookalikeExplain: (label: string) => string;
	youEntered: string;
	savedAs: (label: string) => string;
	saveAnyway: string;
	cancel: string;
}

const en: PoisonWarningLocale = {
	dustOnly:
		"This address has only ever sent you tiny amounts. That is a common setup for address poisoning. Don't copy it from here.",
	lookalike: (label) =>
		`Looks like ${label}, but it is a different address. Possible address poisoning: check every character before you send.`,
	both: (label) =>
		`Looks like ${label}, but it is a different address, and it has only ever sent you tiny amounts. That is the usual pattern of address poisoning. Don't copy it from here.`,
	tagDustOnly: 'Only sent you dust',
	tagLookalike: 'Look-alike',
	tagBoth: 'Possible poisoning',
	quarantined: 'You quarantined this address yourself.',
	tagQuarantined: 'Quarantined',
	checkerLookalike: (label) =>
		`Looks like ${label} in your address book, but it is a different address. Possible address poisoning: check every character before you send.`,
	checkerNote: 'Compared in your browser with your own address book. Nothing about you was sent with the check.',
	didYouMean: (label) => `Did you mean ${label}?`,
	lookalikeExplain: (label) =>
		`This address starts and ends like ${label}, but the highlighted characters are different. Addresses like this are often used in address poisoning. Save it only if you are sure it is right.`,
	youEntered: 'You entered',
	savedAs: (label) => `Saved as ${label}`,
	saveAnyway: 'Save it anyway',
	cancel: 'Cancel',
};

const es: PoisonWarningLocale = {
	dustOnly:
		'Esta dirección solo te ha enviado cantidades mínimas. Es una preparación habitual del envenenamiento de direcciones. No la copies desde aquí.',
	lookalike: (label) =>
		`Se parece a ${label}, pero es una dirección distinta. Posible envenenamiento de direcciones: revisa cada carácter antes de enviar.`,
	both: (label) =>
		`Se parece a ${label}, pero es una dirección distinta, y solo te ha enviado cantidades mínimas. Es el patrón habitual del envenenamiento de direcciones. No la copies desde aquí.`,
	tagDustOnly: 'Solo cantidades mínimas',
	tagLookalike: 'Imitación',
	tagBoth: 'Posible envenenamiento',
	quarantined: 'Pusiste tú esta dirección en cuarentena.',
	tagQuarantined: 'En cuarentena',
	checkerLookalike: (label) =>
		`Se parece a ${label} de tu Address Book, pero es una dirección distinta. Posible envenenamiento de direcciones: revisa cada carácter antes de enviar.`,
	checkerNote: 'Comparada en tu navegador con tu propio Address Book. No se envió nada sobre ti con la comprobación.',
	didYouMean: (label) => `¿Querías decir ${label}?`,
	lookalikeExplain: (label) =>
		`Esta dirección empieza y termina como ${label}, pero los caracteres resaltados son distintos. Direcciones así se usan a menudo en el envenenamiento de direcciones. Guárdala solo si estás seguro de que es correcta.`,
	youEntered: 'Has introducido',
	savedAs: (label) => `Guardada como ${label}`,
	saveAnyway: 'Guardarla de todos modos',
	cancel: 'Cancelar',
};

const fr: PoisonWarningLocale = {
	dustOnly:
		"Cette adresse ne vous a jamais envoyé que des montants infimes. C'est une préparation courante de l'empoisonnement d'adresse. Ne la copiez pas d'ici.",
	lookalike: (label) =>
		`Ressemble à ${label}, mais c'est une autre adresse. Possible empoisonnement d'adresse : vérifiez chaque caractère avant d'envoyer.`,
	both: (label) =>
		`Ressemble à ${label}, mais c'est une autre adresse, et elle ne vous a jamais envoyé que des montants infimes. C'est le schéma habituel de l'empoisonnement d'adresse. Ne la copiez pas d'ici.`,
	tagDustOnly: 'Montants infimes seulement',
	tagLookalike: 'Imitation',
	tagBoth: 'Empoisonnement possible',
	quarantined: 'Vous avez mis cette adresse en quarantaine vous-même.',
	tagQuarantined: 'En quarantaine',
	checkerLookalike: (label) =>
		`Ressemble à ${label} de votre Address Book, mais c'est une autre adresse. Possible empoisonnement d'adresse : vérifiez chaque caractère avant d'envoyer.`,
	checkerNote: "Comparée dans votre navigateur avec votre propre Address Book. Rien vous concernant n'a été envoyé avec la vérification.",
	didYouMean: (label) => `Vouliez-vous dire ${label} ?`,
	lookalikeExplain: (label) =>
		`Cette adresse commence et finit comme ${label}, mais les caractères surlignés sont différents. Des adresses de ce type servent souvent à l'empoisonnement d'adresse. Enregistrez-la seulement si vous êtes sûr qu'elle est correcte.`,
	youEntered: 'Vous avez saisi',
	savedAs: (label) => `Enregistrée sous ${label}`,
	saveAnyway: 'L’enregistrer quand même',
	cancel: 'Annuler',
};

const MAP: Record<Lang, PoisonWarningLocale> = { en, es, fr };

export function getPoisonWarning(lang: Lang): PoisonWarningLocale {
	return MAP[lang] ?? en;
}

/** The sentence for a flag. */
export function poisonSentence(t: PoisonWarningLocale, signal: string, imitates: string | null): string {
	if (signal === 'quarantined') return t.quarantined;
	if (signal === 'both' && imitates) return t.both(imitates);
	if (signal === 'lookalike' && imitates) return t.lookalike(imitates);
	return t.dustOnly;
}

/** The short tag for a flag. */
export function poisonTag(t: PoisonWarningLocale, signal: string): string {
	if (signal === 'quarantined') return t.tagQuarantined;
	if (signal === 'both') return t.tagBoth;
	if (signal === 'lookalike') return t.tagLookalike;
	return t.tagDustOnly;
}
