// "Whose account is this?": the owner label field on each wallet card (WalletOverview, a React
// island) and each exchange account card (ExchangeAccountCard.astro). EN · ES · FR.
//
// The owner label is free text the user types (for example "Me" or "Spouse"); it becomes the
// Owner column of the history download. No em dashes.

import type { Lang } from '@/lib/i18n/locale';

export interface OwnerLabelLocale {
	lang: Lang;
	/** The field's label. */
	fieldLabel: string;
	placeholder: string;
	/** Shown on a wallet card when no owner is saved. */
	notSet: string;
	/** Tooltip on the field. */
	hint: string;
	saving: string;
	saved: string;
	saveError: string;
	tooLong: string;
}

export const en: OwnerLabelLocale = {
	lang: 'en',
	fieldLabel: 'Whose account is this?',
	placeholder: 'For example: Me, Spouse',
	notSet: 'Not set',
	hint: 'Shown as the Owner in your history download. Up to 60 characters.',
	saving: 'Saving…',
	saved: 'Saved',
	saveError: 'Could not save. Please try again.',
	tooLong: 'Use 60 characters or fewer.',
};

export const es: OwnerLabelLocale = {
	lang: 'es',
	fieldLabel: '¿De quién es esta cuenta?',
	placeholder: 'Por ejemplo: Yo, Cónyuge',
	notSet: 'Sin indicar',
	hint: 'Aparece como Propietario en la descarga de su historial. Hasta 60 caracteres.',
	saving: 'Guardando…',
	saved: 'Guardado',
	saveError: 'No se pudo guardar. Inténtelo de nuevo.',
	tooLong: 'Use 60 caracteres o menos.',
};

export const fr: OwnerLabelLocale = {
	lang: 'fr',
	fieldLabel: 'À qui appartient ce compte ?',
	placeholder: 'Par exemple : Moi, Conjoint',
	notSet: 'Non indiqué',
	hint: 'Affiché comme Propriétaire dans le téléchargement de votre historique. 60 caractères au maximum.',
	saving: 'Enregistrement…',
	saved: 'Enregistré',
	saveError: "L'enregistrement n'a pas fonctionné. Veuillez réessayer.",
	tooLong: '60 caractères au maximum.',
};

const LOCALES: Record<Lang, OwnerLabelLocale> = { en, es, fr };

export function getOwnerLabel(lang: Lang): OwnerLabelLocale {
	return LOCALES[lang] ?? en;
}
