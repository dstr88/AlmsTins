// Tax page — finance terminology (Schedule D, Form 8949, cost basis, gains…) is FIRST-PASS; gate behind a fluent finance-literate reviewer before authoritative (design.claude.md).
//
// Schedule D Summary page — page-level strings (EN · ES · FR).
//
// US tax FORM names, line/box labels (Schedule D, Form 8949, Box A–F, line numbers),
// crypto jargon, tickers, company names, $, %, and dates are NOT translated.
// Financial concept words (gain, loss, proceeds, cost basis, short/long-term) ARE
// translated as first-pass — gate behind a fluent finance-literate reviewer.

import type { Lang } from '@/lib/i18n/locale';

export interface ScheduleDLocale {
  lang: Lang;
  pageTitle: string;
  /** "← Tax Center" back link */
  backLink: string;
  heroTitle: string;
  heroSubtitle: string;
  loadingText: string;
  /** "Failed to load Form 8949 data." */
  errorLoad: string;
  /** "Network error — please try again." */
  errorNetwork: string;
  /** Disclaimer paragraph */
  disclaimer: string;
  /** Part I section heading */
  part1Title: string;
  /** "(Assets held 1 year or less)" */
  part1Sub: string;
  /** Part II section heading */
  part2Title: string;
  /** "(Assets held more than 1 year)" */
  part2Sub: string;
  /** Part III section heading */
  part3Title: string;
  /** Print button label */
  btnPrint: string;
  /** "Next steps for your CPA" panel heading */
  nextStepsTitle: string;
  nextStep1: string;
  nextStep2: string;
  nextStep3: string;
  nextStep4: string;
  // ── Schedule D line descriptions ──────────────────────────────────────────
  /** Line 1a description */
  line1aDesc: string;
  line1aNote: string;
  /** Line 1b description */
  line1bDesc: string;
  line1bNote: string;
  /** Line 2 description */
  line2Desc: string;
  /** Line 3 description */
  line3Desc: string;
  /** Line 4 description */
  line4Desc: string;
  /** Line 5 description */
  line5Desc: string;
  /** Line 6 description */
  line6Desc: string;
  line6Note: string;
  /** Line 7 description */
  line7Desc: string;
  line7Note: string;
  /** Line 8a description */
  line8aDesc: string;
  line8aNote: string;
  /** Line 8b description */
  line8bDesc: string;
  line8bNote: string;
  /** Line 9 description */
  line9Desc: string;
  /** Line 10 description */
  line10Desc: string;
  /** Line 11 description */
  line11Desc: string;
  /** Line 12 description */
  line12Desc: string;
  /** Line 13 description */
  line13Desc: string;
  /** Line 14 description */
  line14Desc: string;
  /** Line 15 description */
  line15Desc: string;
  line15Note: string;
  /** Line 16 description */
  line16Desc: string;
  line16Note: string;
  /** Line 17 description */
  line17Desc: string;
  /** Line 18 description */
  line18Desc: string;
  /** Line 19 description */
  line19Desc: string;
  /** Line 20 description */
  line20Desc: string;
  /** Line 21 description */
  line21Desc: string;
  line21Note: string;
  /** Carryforward arrow row description */
  lineCarryDesc: string;
  lineCarryNote: string;
  /** "Form 8949 Box X totals" note template — receives box letter */
  boxTotalsNote: (box: string) => string;
  /** Box C / F detail note — receives row count, proceeds, basis */
  boxDetailNote: (box: string, count: number, proceeds: string, basis: string) => string;
  /** Print-only page badge — "Informational summary — not for filing" */
  printHeaderBadge: string;
  /** Print-only page title — "Capital Gains & Losses — US Schedule D format" */
  printHeaderTitle: string;
  /** Print header suffix */
  printSuffix: string;
  /** "Short-term + Long-term net" */
  printStLtNote: string;
  /** Carryover estimate note */
  carryEstimateNote: string;
}

export const en: ScheduleDLocale = {
  lang: 'en',
  pageTitle: 'Schedule D | Almstins',
  backLink: '← Tax Center',
  heroTitle: 'Capital Gains & Losses Summary',
  heroSubtitle: 'Totals laid out in the US Schedule D line-by-line format, for your reference.',
  loadingText: 'Loading Schedule D…',
  errorLoad: 'Failed to load Form 8949 data.',
  errorNetwork: 'Network error — please try again.',
  disclaimer:
    'This summary maps your crypto transactions to Schedule D lines. The totals below flow from your Form 8949 data. Always verify with your CPA before filing.',
  part1Title: 'Part I — Short-Term Capital Gains and Losses',
  part1Sub: '(Assets held 1 year or less)',
  part2Title: 'Part II — Long-Term Capital Gains and Losses',
  part2Sub: '(Assets held more than 1 year)',
  part3Title: 'Part III — Summary',
  btnPrint: '🖨 Print',
  nextStepsTitle: 'Next steps for your CPA',
  nextStep1:
    'Attach Form 8949 (both parts) to this Schedule D — download from the <a href="/dashboard/yearEnd/form8949">Form 8949 page</a>',
  nextStep2: 'Enter the Schedule D totals on Form 1040, Line 7 (capital gain/loss)',
  nextStep3: 'If Line 16 is a loss, also complete the Capital Loss Carryover Worksheet',
  nextStep4:
    'Ordinary crypto income (staking, interest) goes on Schedule 1, Line 8z — not Schedule D',
  line1aDesc:
    'Totals for all short-term transactions reported on Form 1099-B with Box A checked — basis shown to IRS, no adjustments',
  line1aNote: 'Form 8949 Box A totals',
  line1bDesc:
    'Totals for all short-term transactions where basis was NOT reported to IRS (Box B)',
  line1bNote: 'Form 8949 Box B totals',
  line2Desc:
    'Totals for short-term transactions NOT on Form 1099-B — includes all pre-2025 crypto',
  line3Desc: 'Net short-term gain/loss from partnerships, S-corps, estates, and trusts',
  line4Desc:
    'Short-term gain from Form 6252, and short-term gain/loss from Forms 4684, 6781, and 8824',
  line5Desc: 'Net short-term gain/loss from partnerships, S-corps (Schedule K-1)',
  line6Desc: 'Short-term capital loss carryover (from prior-year Schedule D Worksheet)',
  line6Note:
    'Enter as negative number. Value shown is Almstins estimate from loss carryforward tracker.',
  line7Desc: 'Net short-term capital gain or (loss)',
  line7Note: 'Lines 1a + 1b + 2 + 3 + 4 + 5 + 6. Transfer to Schedule D line 7.',
  line8aDesc:
    'Totals for all long-term transactions reported on Form 1099-B with Box D checked — basis shown to IRS, no adjustments',
  line8aNote: 'Form 8949 Box D totals',
  line8bDesc:
    'Totals for long-term transactions where basis was NOT reported to IRS (Box E)',
  line8bNote: 'Form 8949 Box E totals',
  line9Desc:
    'Totals for long-term transactions NOT on Form 1099-B — includes all pre-2025 crypto',
  line10Desc: 'Net long-term gain/loss from partnerships, S-corps, estates, and trusts',
  line11Desc:
    'Long-term capital gain distributions not reported directly on Form 1040',
  line12Desc:
    'Gain from Form 4797, Part I; long-term gain from Forms 2439 and 6252',
  line13Desc: 'Net long-term gain/loss from partnerships, S-corps (Schedule K-1)',
  line14Desc: 'Long-term capital loss carryover (from prior-year Schedule D Worksheet)',
  line15Desc: 'Net long-term capital gain or (loss)',
  line15Note: 'Lines 8a + 8b + 9 through 14. Transfer to Form 1040, Line 7.',
  line16Desc:
    'Combine lines 7 and 15. If a loss, go to line 17; if a gain, enter on Form 1040, Line 7.',
  line16Note: 'Short-term + Long-term net',
  line17Desc:
    'Are you reporting a gain from Form 2439, 4684, 6252, 6781, or 8824?',
  line18Desc:
    'Unrecaptured Section 1250 gain from installment sales or pass-throughs',
  line19Desc:
    'Net Section 1202 gain (qualified small business stock — 50% exclusion)',
  line20Desc: 'Collectibles (28% rate) gain or (loss)',
  line21Desc:
    'If line 16 is a loss — your allowable capital loss deduction (max $3,000 / $1,500 if MFS)',
  line21Note:
    'Enter as negative on Form 1040 line 7. Excess carries forward to next year.',
  lineCarryDesc: 'Capital loss carryforward to next year (not entered on 1040)',
  lineCarryNote: "Retain this amount for next year's Schedule D Worksheet.",
  boxTotalsNote: (box) => `Form 8949 Box ${box} totals`,
  boxDetailNote: (box, count, proceeds, basis) =>
    `Form 8949 Box ${box} · ${count} transactions · Proceeds ${proceeds} · Basis ${basis}`,
  printHeaderBadge: 'Informational summary — not for filing',
  printHeaderTitle: 'Capital Gains & Losses — US Schedule D format',
  printSuffix: 'Prepared by Almstins · Informational, not for filing',
  printStLtNote: 'Short-term + Long-term net',
  carryEstimateNote:
    'Enter as negative number. Value shown is Almstins estimate from loss carryforward tracker.',
};

export const es: ScheduleDLocale = {
  lang: 'es',
  pageTitle: 'Schedule D | Almstins',
  backLink: '← Centro Fiscal',
  heroTitle: 'Resumen de Ganancias y Pérdidas de Capital',
  heroSubtitle:
    'Totales presentados en el formato línea por línea del Schedule D de EE. UU., para tu referencia.',
  loadingText: 'Cargando Schedule D…',
  errorLoad: 'Error al cargar los datos del Form 8949.',
  errorNetwork: 'Error de red — por favor, inténtalo de nuevo.',
  disclaimer:
    'Este resumen mapea tus transacciones de criptomonedas a las líneas del Schedule D. Los totales siguientes provienen de tus datos del Form 8949. Verifica siempre con tu CPA antes de presentar la declaración.',
  part1Title: 'Parte I — Ganancias y Pérdidas de Capital a Corto Plazo',
  part1Sub: '(Activos mantenidos 1 año o menos)',
  part2Title: 'Parte II — Ganancias y Pérdidas de Capital a Largo Plazo',
  part2Sub: '(Activos mantenidos más de 1 año)',
  part3Title: 'Parte III — Resumen',
  btnPrint: '🖨 Imprimir',
  nextStepsTitle: 'Próximos pasos para tu CPA',
  nextStep1:
    'Adjunta el Form 8949 (ambas partes) a este Schedule D — descárgalo desde la <a href="/dashboard/yearEnd/form8949">página del Form 8949</a>',
  nextStep2:
    'Ingresa los totales del Schedule D en el Form 1040, Línea 7 (ganancia/pérdida de capital)',
  nextStep3:
    'Si la Línea 16 es una pérdida, completa también la Hoja de Trabajo de Arrastre de Pérdidas de Capital',
  nextStep4:
    'Los ingresos ordinarios de criptomonedas (staking, intereses) van en el Schedule 1, Línea 8z — no en el Schedule D',
  line1aDesc:
    'Totales de todas las transacciones a corto plazo reportadas en el Form 1099-B con el Casilla A marcada — base de costo informada al IRS, sin ajustes',
  line1aNote: 'Totales de la Casilla A del Form 8949',
  line1bDesc:
    'Totales de todas las transacciones a corto plazo donde la base de costo NO fue reportada al IRS (Casilla B)',
  line1bNote: 'Totales de la Casilla B del Form 8949',
  line2Desc:
    'Totales de transacciones a corto plazo NO incluidas en el Form 1099-B — incluye todas las criptomonedas anteriores a 2025',
  line3Desc:
    'Ganancia/pérdida neta a corto plazo de sociedades, S-corps, sucesiones y fideicomisos',
  line4Desc:
    'Ganancia a corto plazo del Form 6252 y ganancia/pérdida a corto plazo de los Forms 4684, 6781 y 8824',
  line5Desc:
    'Ganancia/pérdida neta a corto plazo de sociedades y S-corps (Schedule K-1)',
  line6Desc:
    'Arrastre de pérdida de capital a corto plazo (de la Hoja de Trabajo del Schedule D del año anterior)',
  line6Note:
    'Ingresa como número negativo. El valor mostrado es la estimación de Almstins del rastreador de pérdidas a trasladar.',
  line7Desc: 'Ganancia o (pérdida) neta de capital a corto plazo',
  line7Note:
    'Líneas 1a + 1b + 2 + 3 + 4 + 5 + 6. Transfiere al Schedule D, Línea 7.',
  line8aDesc:
    'Totales de todas las transacciones a largo plazo reportadas en el Form 1099-B con la Casilla D marcada — base de costo informada al IRS, sin ajustes',
  line8aNote: 'Totales de la Casilla D del Form 8949',
  line8bDesc:
    'Totales de transacciones a largo plazo donde la base de costo NO fue reportada al IRS (Casilla E)',
  line8bNote: 'Totales de la Casilla E del Form 8949',
  line9Desc:
    'Totales de transacciones a largo plazo NO incluidas en el Form 1099-B — incluye todas las criptomonedas anteriores a 2025',
  line10Desc:
    'Ganancia/pérdida neta a largo plazo de sociedades, S-corps, sucesiones y fideicomisos',
  line11Desc:
    'Distribuciones de ganancias de capital a largo plazo no reportadas directamente en el Form 1040',
  line12Desc:
    'Ganancia del Form 4797, Parte I; ganancia a largo plazo de los Forms 2439 y 6252',
  line13Desc:
    'Ganancia/pérdida neta a largo plazo de sociedades y S-corps (Schedule K-1)',
  line14Desc:
    'Arrastre de pérdida de capital a largo plazo (de la Hoja de Trabajo del Schedule D del año anterior)',
  line15Desc: 'Ganancia o (pérdida) neta de capital a largo plazo',
  line15Note:
    'Líneas 8a + 8b + 9 hasta 14. Transfiere al Form 1040, Línea 7.',
  line16Desc:
    'Combina las Líneas 7 y 15. Si es una pérdida, ve a la Línea 17; si es una ganancia, ingrésala en el Form 1040, Línea 7.',
  line16Note: 'Neto a corto plazo + largo plazo',
  line17Desc:
    '¿Estás reportando una ganancia del Form 2439, 4684, 6252, 6781 u 8824?',
  line18Desc:
    'Ganancia no recapturada de la Sección 1250 de ventas a plazos o transferencias',
  line19Desc:
    'Ganancia neta de la Sección 1202 (acciones de empresas pequeñas calificadas — exclusión del 50%)',
  line20Desc: 'Ganancia o (pérdida) de coleccionables (tasa del 28%)',
  line21Desc:
    'Si la Línea 16 es una pérdida — tu deducción de pérdida de capital permitida (máx. $3,000 / $1,500 si MFS)',
  line21Note:
    'Ingresa como negativo en el Form 1040, Línea 7. El exceso se traslada al año siguiente.',
  lineCarryDesc:
    'Arrastre de pérdida de capital al año siguiente (no se ingresa en el 1040)',
  lineCarryNote:
    'Conserva este monto para la Hoja de Trabajo del Schedule D del próximo año.',
  boxTotalsNote: (box) => `Totales de la Casilla ${box} del Form 8949`,
  boxDetailNote: (box, count, proceeds, basis) =>
    `Casilla ${box} del Form 8949 · ${count} transacciones · Ingresos ${proceeds} · Base de costo ${basis}`,
  printHeaderBadge: 'Resumen informativo — no apto para presentación',
  printHeaderTitle: 'Ganancias y pérdidas de capital — formato Schedule D de EE. UU.',
  printSuffix: 'Preparado por Almstins · Informativo, no para presentación',
  printStLtNote: 'Neto a corto plazo + largo plazo',
  carryEstimateNote:
    'Ingresa como número negativo. El valor mostrado es la estimación de Almstins del rastreador de pérdidas a trasladar.',
};

export const fr: ScheduleDLocale = {
  lang: 'fr',
  pageTitle: 'Schedule D | Almstins',
  backLink: '← Centre fiscal',
  heroTitle: 'Récapitulatif des gains et pertes en capital',
  heroSubtitle:
    'Totaux présentés ligne par ligne au format Schedule D américain, à titre de référence.',
  loadingText: 'Chargement du Schedule D…',
  errorLoad: 'Échec du chargement des données du Form 8949.',
  errorNetwork: 'Erreur réseau — veuillez réessayer.',
  disclaimer:
    'Ce récapitulatif associe vos transactions crypto aux lignes du Schedule D. Les totaux ci-dessous proviennent de vos données du Form 8949. Vérifiez toujours avec votre CPA avant de déposer.',
  part1Title: 'Partie I — Gains et pertes en capital à court terme',
  part1Sub: '(Actifs détenus 1 an ou moins)',
  part2Title: 'Partie II — Gains et pertes en capital à long terme',
  part2Sub: "(Actifs détenus plus d'un an)",
  part3Title: 'Partie III — Récapitulatif',
  btnPrint: '🖨 Imprimer',
  nextStepsTitle: 'Prochaines étapes pour votre CPA',
  nextStep1:
    'Joindre le Form 8949 (les deux parties) à ce Schedule D — télécharger depuis la <a href="/dashboard/yearEnd/form8949">page du Form 8949</a>',
  nextStep2:
    'Saisir les totaux du Schedule D sur le Form 1040, Ligne 7 (gain/perte en capital)',
  nextStep3:
    'Si la Ligne 16 est une perte, remplir également la Feuille de calcul du report de perte en capital',
  nextStep4:
    'Les revenus ordinaires crypto (staking, intérêts) figurent sur le Schedule 1, Ligne 8z — pas sur le Schedule D',
  line1aDesc:
    "Totaux de toutes les transactions à court terme déclarées sur le Form 1099-B avec la Case A cochée — base de coût communiquée à l'IRS, sans ajustements",
  line1aNote: 'Totaux de la Case A du Form 8949',
  line1bDesc:
    "Totaux de toutes les transactions à court terme dont la base de coût n'a PAS été communiquée à l'IRS (Case B)",
  line1bNote: 'Totaux de la Case B du Form 8949',
  line2Desc:
    "Totaux des transactions à court terme N'FIGURANT PAS sur le Form 1099-B — inclut toutes les cryptos antérieures à 2025",
  line3Desc:
    'Gain/perte net(te) à court terme provenant de sociétés de personnes, S-corps, successions et fiducies',
  line4Desc:
    'Gain à court terme du Form 6252 et gain/perte à court terme des Forms 4684, 6781 et 8824',
  line5Desc:
    'Gain/perte net(te) à court terme de sociétés de personnes et S-corps (Schedule K-1)',
  line6Desc:
    "Report de perte en capital à court terme (de la Feuille de calcul du Schedule D de l'année précédente)",
  line6Note:
    "Saisir en négatif. La valeur affichée est l'estimation Almstins du suivi des pertes à reporter.",
  line7Desc: 'Gain ou (perte) net(te) en capital à court terme',
  line7Note:
    'Lignes 1a + 1b + 2 + 3 + 4 + 5 + 6. Reporter sur le Schedule D, Ligne 7.',
  line8aDesc:
    "Totaux de toutes les transactions à long terme déclarées sur le Form 1099-B avec la Case D cochée — base de coût communiquée à l'IRS, sans ajustements",
  line8aNote: 'Totaux de la Case D du Form 8949',
  line8bDesc:
    "Totaux des transactions à long terme dont la base de coût n'a PAS été communiquée à l'IRS (Case E)",
  line8bNote: 'Totaux de la Case E du Form 8949',
  line9Desc:
    "Totaux des transactions à long terme N'FIGURANT PAS sur le Form 1099-B — inclut toutes les cryptos antérieures à 2025",
  line10Desc:
    'Gain/perte net(te) à long terme provenant de sociétés de personnes, S-corps, successions et fiducies',
  line11Desc:
    'Distributions de gains en capital à long terme non déclarées directement sur le Form 1040',
  line12Desc:
    'Gain du Form 4797, Partie I ; gain à long terme des Forms 2439 et 6252',
  line13Desc:
    'Gain/perte net(te) à long terme de sociétés de personnes et S-corps (Schedule K-1)',
  line14Desc:
    "Report de perte en capital à long terme (de la Feuille de calcul du Schedule D de l'année précédente)",
  line15Desc: 'Gain ou (perte) net(te) en capital à long terme',
  line15Note:
    'Lignes 8a + 8b + 9 à 14. Reporter sur le Form 1040, Ligne 7.',
  line16Desc:
    'Combiner les Lignes 7 et 15. Si perte, aller à la Ligne 17 ; si gain, saisir sur le Form 1040, Ligne 7.',
  line16Note: 'Net à court terme + long terme',
  line17Desc:
    'Déclarez-vous un gain des Forms 2439, 4684, 6252, 6781 ou 8824 ?',
  line18Desc:
    'Gain non repris de la Section 1250 provenant de ventes à tempérament ou de transferts',
  line19Desc:
    'Gain net de la Section 1202 (actions de petites entreprises qualifiées — exclusion de 50 %)',
  line20Desc: 'Gain ou (perte) sur objets de collection (taux de 28 %)',
  line21Desc:
    'Si la Ligne 16 est une perte — votre déduction de perte en capital autorisée (max. $3 000 / $1 500 si MFS)',
  line21Note:
    "Saisir en négatif sur le Form 1040, Ligne 7. L'excédent est reporté à l'année suivante.",
  lineCarryDesc:
    "Report de perte en capital sur l'année suivante (non saisi sur le 1040)",
  lineCarryNote:
    "Conserver ce montant pour la Feuille de calcul du Schedule D de l'année prochaine.",
  boxTotalsNote: (box) => `Totaux de la Case ${box} du Form 8949`,
  boxDetailNote: (box, count, proceeds, basis) =>
    `Case ${box} du Form 8949 · ${count} transactions · Produits ${proceeds} · Base de coût ${basis}`,
  printHeaderBadge: 'Récapitulatif informatif — non destiné au dépôt',
  printHeaderTitle: 'Gains et pertes en capital — format Schedule D américain',
  printSuffix: 'Préparé par Almstins · Informatif, non destiné au dépôt',
  printStLtNote: 'Net à court terme + long terme',
  carryEstimateNote:
    "Saisir en négatif. La valeur affichée est l'estimation Almstins du suivi des pertes à reporter.",
};

const MAP: Record<Lang, ScheduleDLocale> = { en, es, fr };

/** Select the Schedule D locale for a language, falling back to English. */
export function getScheduleD(lang: Lang): ScheduleDLocale {
  return MAP[lang] ?? en;
}
