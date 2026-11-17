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
};

const MAP: Record<Lang, PoisonWarningLocale> = { en, es, fr };

export function getPoisonWarning(lang: Lang): PoisonWarningLocale {
	return MAP[lang] ?? en;
}

/** The sentence for a flag. */
export function poisonSentence(t: PoisonWarningLocale, signal: string, imitates: string | null): string {
	if (signal === 'both' && imitates) return t.both(imitates);
	if (signal === 'lookalike' && imitates) return t.lookalike(imitates);
	return t.dustOnly;
}

/** The short tag for a flag. */
export function poisonTag(t: PoisonWarningLocale, signal: string): string {
	if (signal === 'both') return t.tagBoth;
	if (signal === 'lookalike') return t.tagLookalike;
	return t.tagDustOnly;
}
