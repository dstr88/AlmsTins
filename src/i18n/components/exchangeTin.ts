// ExchangeTin (.astro) strings. The Open/Close toggle labels are read in a
// client <script> via a define:vars island; lastImportedTemplate uses a {date}
// placeholder (.replace at use). dateLocale drives the freshness date format.

import type { Lang } from '@/lib/i18n/locale';

export interface ExchangeTinLocale {
  lang: Lang;
  dateLocale: string;
  dataThrough: string;
  lastImportedTemplate: string;
  expand: string;
  open: string;
  close: string;
}

export const en: ExchangeTinLocale = {
  lang: 'en',
  dateLocale: 'en-US',
  dataThrough: 'data through',
  lastImportedTemplate: 'Last imported: {date}',
  expand: 'Expand',
  open: 'Open',
  close: 'Close',
};

export const es: ExchangeTinLocale = {
  lang: 'es',
  dateLocale: 'es-ES',
  dataThrough: "datos hasta",
  lastImportedTemplate: "Última importación: {date}",
  expand: "Expandir",
  open: "Abrir",
  close: "Cerrar",
};

export const fr: ExchangeTinLocale = {
  lang: 'fr',
  dateLocale: 'fr-FR',
  dataThrough: "données jusqu'au",
  lastImportedTemplate: "Dernière importation : {date}",
  expand: "Développer",
  open: "Ouvrir",
  close: "Fermer",
};

const MAP: Record<Lang, ExchangeTinLocale> = { en, es, fr };

export function getExchangeTin(lang: Lang): ExchangeTinLocale {
  return MAP[lang] ?? en;
}
