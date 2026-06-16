// Settings dashboard page — page-level scaffolding strings (EN · ES · FR).
//
// Cookie-based (Phase 3): settings.astro reads getLang(Astro.request) and selects
// via getSettings(lang). These are the strings the PAGE owns — headings, section
// labels, jurisdiction descriptions, and the inline save-feedback strings used by
// the page's own <script> block. The jurisdiction profile labels (p.label) come
// from the PROFILES data and are not localized here.
//
// Crypto/tax jargon stays English per design.claude.md: cost basis, FIFO, on-chain,
// product/form names (Form 8949, Schedule D, IRS, Almstins). ES/FR are first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface SettingsLocale {
  lang: Lang;
  pageTitle: string;
  title: string;
  sub: string;
  jurisdictionLabel: string;
  jurisdictionDesc: string;
  usProfileDesc: string;
  otherProfileDesc: string;
  saving: string;
  saved: string;
  couldNotSave: string;
  networkError: string;
}

export const en: SettingsLocale = {
  lang: 'en',
  pageTitle: 'Settings | Almstins',
  title: 'Settings',
  sub: 'Preferences are saved per account and apply across all bookkeeping views.',
  jurisdictionLabel: 'Jurisdiction',
  jurisdictionDesc:
    'Controls how disposals are grouped and which informational references appear. ' +
    'Almstins is a record-keeping tool — nothing here constitutes tax, legal, or filing advice. ' +
    'Consult a qualified tax professional before filing.',
  usProfileDesc:
    'Short/long-term split using IRS one-year holding rule. Shows informational Form 8949 and Schedule D references.',
  otherProfileDesc:
    'Single date-ordered disposal list with holding-days column. No US form references.',
  saving: 'Saving…',
  saved: 'Saved.',
  couldNotSave: 'Could not save — try again.',
  networkError: 'Network error — try again.',
};

export const es: SettingsLocale = {
  lang: 'es',
  pageTitle: 'Ajustes | Almstins',
  title: 'Ajustes',
  sub: 'Las preferencias se guardan por cuenta y se aplican a todas las vistas de contabilidad.',
  jurisdictionLabel: 'Jurisdicción',
  jurisdictionDesc:
    'Controla cómo se agrupan las disposiciones y qué referencias informativas aparecen. ' +
    'Almstins es una herramienta de registro — nada de lo aquí presentado constituye asesoramiento fiscal, legal o de declaración. ' +
    'Consulta a un profesional fiscal cualificado antes de declarar.',
  usProfileDesc:
    'División a corto/largo plazo usando la regla de tenencia de un año del IRS. Muestra referencias informativas al Form 8949 y al Schedule D.',
  otherProfileDesc:
    'Lista única de disposiciones ordenada por fecha con columna de días de tenencia. Sin referencias a formularios de EE. UU.',
  saving: 'Guardando…',
  saved: 'Guardado.',
  couldNotSave: 'No se pudo guardar — inténtalo de nuevo.',
  networkError: 'Error de red — inténtalo de nuevo.',
};

export const fr: SettingsLocale = {
  lang: 'fr',
  pageTitle: 'Paramètres | Almstins',
  title: 'Paramètres',
  sub: 'Les préférences sont enregistrées par compte et s\'appliquent à toutes les vues de comptabilité.',
  jurisdictionLabel: 'Juridiction',
  jurisdictionDesc:
    'Détermine comment les cessions sont regroupées et quelles références informatives apparaissent. ' +
    'Almstins est un outil de tenue de registres — rien ici ne constitue un conseil fiscal, juridique ou de déclaration. ' +
    'Consultez un professionnel fiscal qualifié avant toute déclaration.',
  usProfileDesc:
    'Répartition court/long terme selon la règle de détention d\'un an de l\'IRS. Affiche des références informatives au Form 8949 et au Schedule D.',
  otherProfileDesc:
    'Liste unique des cessions ordonnée par date avec une colonne de jours de détention. Aucune référence aux formulaires américains.',
  saving: 'Enregistrement…',
  saved: 'Enregistré.',
  couldNotSave: 'Échec de l\'enregistrement — réessayez.',
  networkError: 'Erreur réseau — réessayez.',
};

const MAP: Record<Lang, SettingsLocale> = { en, es, fr };

/** Select the Settings locale for a language, falling back to English. */
export function getSettings(lang: Lang): SettingsLocale {
  return MAP[lang] ?? en;
}
