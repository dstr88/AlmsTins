// VaultNotepad (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// Crypto jargon / tickers stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface VaultNotepadLocale {
  lang: Lang;

  // Textarea
  inputPlaceholder: string;

  // Font size controls
  decreaseFontSize: string;
  increaseFontSize: string;

  // Submit button
  saving: string;
  addNote: string;

  // Status / loading / error
  loading: string;
  loadError: string;

  // Empty state
  empty: string;

  // Resolved toggle (interpolated: count of resolved notes)
  resolvedToggle: (count: number) => string;

  // NoteRow check button
  markAccounted: string;
  markUnaccounted: string;

  // NoteRow delete button
  deleteNote: string;
}

export const en: VaultNotepadLocale = {
  lang: 'en',

  inputPlaceholder: 'e.g. Sent 50 USDC to Webflow Apr 30 — need to import & classify',

  decreaseFontSize: 'Decrease font size',
  increaseFontSize: 'Increase font size',

  saving: 'Saving…',
  addNote: 'Add note',

  loading: 'Loading…',
  loadError: 'Could not load notes.',

  empty: 'Jot down anything worth remembering — a transfer to flag, a cost basis question, a reminder to import a CSV.',

  resolvedToggle: (count) => `${count} accounted for`,

  markAccounted: 'Mark as accounted for',
  markUnaccounted: 'Mark as unaccounted',

  deleteNote: 'Delete note',
};

export const es: VaultNotepadLocale = {
  lang: 'es',

  inputPlaceholder: "p. ej. Envié 50 USDC a Webflow el 30 de abril — necesito importar y clasificar",

  decreaseFontSize: "Disminuir tamaño de fuente",
  increaseFontSize: "Aumentar tamaño de fuente",

  saving: "Guardando…",
  addNote: "Agregar nota",

  loading: "Cargando…",
  loadError: "No se pudieron cargar las notas.",

  empty: "Anota todo lo que valga la pena recordar — una transferencia que marcar, una pregunta sobre la base de costo, un recordatorio para importar un CSV.",

  resolvedToggle: (count) => `${count} registrado${count === 1 ? '' : 's'}`,

  markAccounted: "Marcar como registrado",
  markUnaccounted: "Marcar como no registrado",

  deleteNote: "Eliminar nota",
};

export const fr: VaultNotepadLocale = {
  lang: 'fr',

  inputPlaceholder: "ex. Envoyé 50 USDC à Webflow le 30 avril — à importer et classer",

  decreaseFontSize: "Réduire la taille de la police",
  increaseFontSize: "Augmenter la taille de la police",

  saving: "Enregistrement…",
  addNote: "Ajouter une note",

  loading: "Chargement…",
  loadError: "Impossible de charger les notes.",

  empty: "Notez tout ce qui vaut la peine d'être retenu — un transfert à signaler, une question sur la base de coût, un rappel pour importer un CSV.",

  resolvedToggle: (count) => `${count} pris en compte`,

  markAccounted: "Marquer comme pris en compte",
  markUnaccounted: "Marquer comme non pris en compte",

  deleteNote: "Supprimer la note",
};

const MAP: Record<Lang, VaultNotepadLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getVaultNotepad(lang: Lang): VaultNotepadLocale {
  return MAP[lang] ?? en;
}
