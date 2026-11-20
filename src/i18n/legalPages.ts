/**
 * The words around the public legal pages (/terms, /privacy and their /es and /fr): the browser
 * title, the search description and the language switch. The documents themselves are in
 * src/i18n/termsOfService.ts and src/i18n/privacyPolicy.ts.
 */
import type { Lang } from '@/lib/i18n/locale';
import type { LegalDoc } from '@/lib/legalLinks';

export interface LegalPagesCopy {
  docs: Record<LegalDoc, { title: string; description: string }>;
  langAria: string;
  homeAria: string;
  langLinks: Record<Lang, { label: string; aria: string }>;
}

const LANG_LINKS: LegalPagesCopy['langLinks'] = {
  en: { label: 'EN', aria: 'View in English' },
  es: { label: 'ES', aria: 'Ver en español' },
  fr: { label: 'FR', aria: 'Voir en français' },
};

export const legalPagesCopy: Record<Lang, LegalPagesCopy> = {
  en: {
    docs: {
      terms: { title: 'User Agreement | Almstins', description: 'The Almstins User Agreement: the terms for using Almstins.' },
      privacy: { title: 'Privacy Policy | Almstins', description: 'The Almstins Privacy Policy: what we collect, why, who receives it and how to delete it.' },
    },
    langAria: 'Language',
    homeAria: 'Almstins home page',
    langLinks: LANG_LINKS,
  },
  es: {
    docs: {
      terms: { title: 'Acuerdo de Usuario | Almstins', description: 'El Acuerdo de Usuario de Almstins: las condiciones para usar Almstins.' },
      privacy: { title: 'Política de Privacidad | Almstins', description: 'La Política de Privacidad de Almstins: qué recopilamos, por qué, quién lo recibe y cómo borrarlo.' },
    },
    langAria: 'Idioma',
    homeAria: 'Página de inicio de Almstins',
    langLinks: LANG_LINKS,
  },
  fr: {
    docs: {
      terms: { title: 'Accord d’utilisateur | Almstins', description: 'L’Accord d’utilisateur d’Almstins : les conditions d’utilisation d’Almstins.' },
      privacy: { title: 'Politique de confidentialité | Almstins', description: 'La Politique de confidentialité d’Almstins : ce que nous collectons, pourquoi, qui le reçoit et comment le supprimer.' },
    },
    langAria: 'Langue',
    homeAria: 'Page d’accueil d’Almstins',
    langLinks: LANG_LINKS,
  },
};
