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
  costBasisLabel: string;
  costBasisEstimateNote: string;
  costBasisWalletRuleNote: string;
  identificationsLink: string;
  costBasisDesc: string;
  fifoLabel: string;
  fifoDesc: string;
  hifoLabel: string;
  hifoDesc: string;
  methodLockedNote: string;
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
    'Short/long-term split using the IRS one-year holding rule.',
  otherProfileDesc:
    'Single date-ordered disposal list with holding-days column.',
  costBasisLabel: 'Cost-basis method (estimate for comparison)',
  costBasisEstimateNote:
    'This is an estimate for comparison. It does not record that you chose these units at the time of a sale, and it does not show an identification was made.',
  costBasisWalletRuleNote:
    'For sales from 2025 matched wallet by wallet, the figures follow the identifications you have recorded (or earliest acquired in each wallet when you have none), not this setting.',
  identificationsLink: 'Record which units a sale uses',
  costBasisDesc:
    'Sets how your record calculates gains when you dispose of an asset, and the default for your Year Summary and exports. ' +
    'It controls how Almstins computes your own record — it does not instruct any exchange or change a broker\'s Form 1099-DA. ' +
    'Record-keeping, not tax advice; confirm the method with your tax professional.',
  fifoLabel: 'FIFO',
  fifoDesc: 'First in, first out. The IRS default — earliest-acquired units are treated as sold first.',
  hifoLabel: 'HIFO',
  hifoDesc: 'Highest cost first. A specific-identification method that sells your highest-cost units first; requires records kept at the time of each sale.',
  methodLockedNote: 'Choosing a cost-basis method is an Unlimited-plan feature.',
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
    'División a corto/largo plazo usando la regla de tenencia de un año del IRS.',
  otherProfileDesc:
    'Lista única de disposiciones ordenada por fecha con columna de días de tenencia.',
  costBasisLabel: 'Método de coste base (estimación para comparar)',
  costBasisEstimateNote:
    'Es una estimación para comparar. No registra que elegiste estas unidades en el momento de una venta ni muestra que se hizo una identificación.',
  costBasisWalletRuleNote:
    'Para las ventas desde 2025 conciliadas wallet por wallet, las cifras siguen las identificaciones que hayas registrado (o las adquiridas primero en cada wallet si no tienes ninguna), no este ajuste.',
  identificationsLink: 'Registrar qué unidades usa una venta',
  costBasisDesc:
    'Define cómo tu registro calcula las ganancias al disponer de un activo, y el valor por defecto de tu Resumen Anual y exportaciones. ' +
    'Controla cómo Almstins calcula tu propio registro — no da instrucciones a ningún exchange ni cambia el Formulario 1099-DA de un bróker. ' +
    'Es registro contable, no asesoramiento fiscal; confirma el método con tu profesional fiscal.',
  fifoLabel: 'FIFO',
  fifoDesc: 'First in, first out. El valor por defecto del IRS: las unidades adquiridas primero se consideran vendidas primero.',
  hifoLabel: 'HIFO',
  hifoDesc: 'Highest cost first. Método de identificación específica que vende primero las unidades de mayor coste; requiere registros guardados en el momento de cada venta.',
  methodLockedNote: 'Elegir un método de coste base es una función del plan Unlimited.',
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
    'Répartition court/long terme selon la règle de détention d\'un an de l\'IRS.',
  otherProfileDesc:
    'Liste unique des cessions ordonnée par date avec une colonne de jours de détention.',
  costBasisLabel: 'Méthode de coût de base (estimation pour comparer)',
  costBasisEstimateNote:
    "Il s'agit d'une estimation pour comparer. Elle n'enregistre pas que vous avez choisi ces unités au moment d'une vente et ne montre pas qu'une identification a été faite.",
  costBasisWalletRuleNote:
    "Pour les ventes depuis 2025 rapprochées wallet par wallet, les chiffres suivent les identifications que vous avez enregistrées (ou les plus anciennes de chaque wallet si vous n'en avez aucune), pas ce réglage.",
  identificationsLink: 'Enregistrer quelles unités une vente utilise',
  costBasisDesc:
    'Définit comment votre registre calcule les plus-values lors d\'une cession, et la valeur par défaut de votre Résumé annuel et de vos exports. ' +
    'Cela contrôle la façon dont Almstins calcule votre propre registre — cela ne donne aucune instruction à une plateforme et ne change pas le formulaire 1099-DA d\'un courtier. ' +
    'Tenue de registres, pas un conseil fiscal ; confirmez la méthode avec votre professionnel fiscal.',
  fifoLabel: 'FIFO',
  fifoDesc: 'First in, first out. La valeur par défaut de l\'IRS : les unités acquises en premier sont réputées vendues en premier.',
  hifoLabel: 'HIFO',
  hifoDesc: 'Highest cost first. Méthode d\'identification spécifique qui vend d\'abord vos unités au coût le plus élevé ; nécessite des registres tenus au moment de chaque vente.',
  methodLockedNote: 'Choisir une méthode de coût de base est une fonction du plan Unlimited.',
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
