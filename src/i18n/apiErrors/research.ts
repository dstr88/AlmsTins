import type { Lang } from '@/lib/i18n/locale';

export interface ResearchErrorsLocale {
  // attachment.ts
  missingFile: string;
  unsupportedFileType: string;
  fileTooLarge: string;

  // ai-triage.ts
  aiTriagePaywall: string;
  noTransactionsProvided: string;
  aiTriageNotConfigured: string;

  // backfill-prices.ts
  backfillPaywall: string;

  // address-lookup.ts
  addressRequired: string;
}

// ── English ───────────────────────────────────────────────────────────────────
const en: ResearchErrorsLocale = {
  missingFile:            'Missing file upload.',
  unsupportedFileType:    'Unsupported file type. Use PNG, JPG, GIF, WEBP, or PDF.',
  fileTooLarge:           'File exceeds 5 MB limit.',

  aiTriagePaywall:        'AI Triage is available on any paid plan. Upgrade at /dashboard/billing.',
  noTransactionsProvided: 'No transactions provided',
  aiTriageNotConfigured:  'AI triage is not configured.',

  backfillPaywall:        'Price backfill is available on any paid plan. Upgrade at /dashboard/billing.',

  addressRequired:        'address is required',
};

// ── Spanish ───────────────────────────────────────────────────────────────────
const es: ResearchErrorsLocale = {
  missingFile:            "Falta el archivo adjunto.",
  unsupportedFileType:    "Tipo de archivo no permitido. Usa PNG, JPG, GIF, WEBP o PDF.",
  fileTooLarge:           "El archivo supera el límite de 5 MB.",

  aiTriagePaywall:        "La clasificación con IA está disponible en cualquier plan de pago. Mejora tu plan en /dashboard/billing.",
  noTransactionsProvided: "No se proporcionaron transacciones",
  aiTriageNotConfigured:  "La clasificación con IA no está configurada.",

  backfillPaywall:        "El relleno de precios está disponible en cualquier plan de pago. Mejora tu plan en /dashboard/billing.",

  addressRequired:        "La dirección es obligatoria",
};

// ── French ────────────────────────────────────────────────────────────────────
const fr: ResearchErrorsLocale = {
  missingFile:            "Aucun fichier joint.",
  unsupportedFileType:    "Type de fichier non pris en charge. Utilisez PNG, JPG, GIF, WEBP ou PDF.",
  fileTooLarge:           "Le fichier dépasse la limite de 5 Mo.",

  aiTriagePaywall:        "Le tri IA est disponible sur tout plan payant. Passez à un plan supérieur sur /dashboard/billing.",
  noTransactionsProvided: "Aucune transaction fournie",
  aiTriageNotConfigured:  "Le tri IA n'est pas configuré.",

  backfillPaywall:        "Le remplissage des prix est disponible sur tout plan payant. Passez à un plan supérieur sur /dashboard/billing.",

  addressRequired:        "L'adresse est obligatoire",
};

// ── Lookup ────────────────────────────────────────────────────────────────────
const LOCALES: Record<Lang, ResearchErrorsLocale> = { en, es, fr };

export function getResearchErrors(lang: Lang): ResearchErrorsLocale {
  return LOCALES[lang] ?? en;
}
