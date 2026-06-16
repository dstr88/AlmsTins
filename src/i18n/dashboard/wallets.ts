// Wallets dashboard page — page-level scaffolding strings (EN · ES · FR).
//
// Cookie-based (Phase 3): wallets.astro reads getLang(Astro.request) and selects
// via getWallets(lang). These are the strings the PAGE owns — the "why label
// your addresses?" explainer panel and the Layout title. The child components
// (WalletOverview, AddressLabels — React islands) carry their own English text
// and are localized in separate passes.
//
// Crypto jargon stays English per design.claude.md: wallet, on-chain, exchange,
// protocol, hash, plus names (Coinbase, Aave, AlmsTins, Needs Attention).
// ES/FR are first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface WalletsLocale {
  lang: Lang;
  pageTitle: string;
  whyLabelTitle: string;
  whyLabelBody1: string;
  whyLabelBody2: string;
  bookkeepingLabel: string;
  bookkeepingText: string;
  fewerNeedsAttentionLabel: string;
  fewerNeedsAttentionText: string;
  scamDetectionLabel: string;
  scamDetectionText: string;
  auditTrailLabel: string;
  auditTrailText: string;
  tip: string;
}

export const en: WalletsLocale = {
  lang: 'en',
  pageTitle: 'Wallets | Almstins',
  whyLabelTitle: 'Why label your addresses?',
  whyLabelBody1:
    'Every on-chain transaction links two addresses — a sender and a receiver. Giving those addresses a name',
  whyLabelBody2:
    'lets that context travel through your entire transaction history. AlmsTins automatically labels hundreds of known exchange and protocol addresses; your custom labels fill in the rest.',
  bookkeepingLabel: 'Bookkeeping clarity',
  bookkeepingText: 'labeled counterparties replace cryptic hashes in your G/L and income sections.',
  fewerNeedsAttentionLabel: 'Fewer "Needs Attention" items',
  fewerNeedsAttentionText:
    'a named address gives the tax engine context it needs to categorize a transfer.',
  scamDetectionLabel: 'Scam detection',
  scamDetectionText: 'unknown addresses stand out when everything else has a name.',
  auditTrailLabel: 'Audit trail',
  auditTrailText:
    'your labels are private notes that make any future review fast and defensible.',
  tip: 'Tip: label addresses right after a new transaction — a fresh label today saves a tax-season mystery tomorrow.',
};

export const es: WalletsLocale = {
  lang: 'es',
  pageTitle: 'Wallets | Almstins',
  whyLabelTitle: '¿Por qué etiquetar tus direcciones?',
  whyLabelBody1:
    'Cada transacción on-chain enlaza dos direcciones — un emisor y un receptor. Darle un nombre a esas direcciones',
  whyLabelBody2:
    'permite que ese contexto viaje por todo tu historial de transacciones. AlmsTins etiqueta automáticamente cientos de direcciones conocidas de exchanges y protocolos; tus etiquetas personalizadas completan el resto.',
  bookkeepingLabel: 'Claridad contable',
  bookkeepingText:
    'las contrapartes etiquetadas reemplazan los hashes crípticos en tu libro mayor y secciones de ingresos.',
  fewerNeedsAttentionLabel: 'Menos elementos en "Needs Attention"',
  fewerNeedsAttentionText:
    'una dirección con nombre le da al motor fiscal el contexto que necesita para categorizar una transferencia.',
  scamDetectionLabel: 'Detección de estafas',
  scamDetectionText: 'las direcciones desconocidas resaltan cuando todo lo demás tiene un nombre.',
  auditTrailLabel: 'Registro de auditoría',
  auditTrailText:
    'tus etiquetas son notas privadas que hacen que cualquier revisión futura sea rápida y defendible.',
  tip: 'Consejo: etiqueta las direcciones justo después de una nueva transacción — una etiqueta fresca hoy te ahorra un misterio en temporada de impuestos mañana.',
};

export const fr: WalletsLocale = {
  lang: 'fr',
  pageTitle: 'Wallets | Almstins',
  whyLabelTitle: 'Pourquoi étiqueter vos adresses ?',
  whyLabelBody1:
    'Chaque transaction on-chain relie deux adresses — un expéditeur et un destinataire. Donner un nom à ces adresses',
  whyLabelBody2:
    "permet à ce contexte de circuler dans tout votre historique de transactions. AlmsTins étiquette automatiquement des centaines d'adresses connues d'exchanges et de protocoles ; vos étiquettes personnalisées complètent le reste.",
  bookkeepingLabel: 'Clarté comptable',
  bookkeepingText:
    'les contreparties étiquetées remplacent les hashes cryptiques dans votre grand livre et vos sections de revenus.',
  fewerNeedsAttentionLabel: 'Moins d\'éléments « Needs Attention »',
  fewerNeedsAttentionText:
    'une adresse nommée donne au moteur fiscal le contexte dont il a besoin pour catégoriser un transfert.',
  scamDetectionLabel: 'Détection des arnaques',
  scamDetectionText: 'les adresses inconnues ressortent lorsque tout le reste porte un nom.',
  auditTrailLabel: 'Piste d\'audit',
  auditTrailText:
    "vos étiquettes sont des notes privées qui rendent tout examen futur rapide et défendable.",
  tip: "Astuce : étiquetez les adresses juste après une nouvelle transaction — une étiquette fraîche aujourd'hui vous évite un mystère en période de déclaration demain.",
};

const MAP: Record<Lang, WalletsLocale> = { en, es, fr };

/** Select the Wallets locale for a language, falling back to English. */
export function getWallets(lang: Lang): WalletsLocale {
  return MAP[lang] ?? en;
}
