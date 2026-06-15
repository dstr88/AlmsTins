// Shared dashboard strings (Phase 0 i18n foundation).
//
// Common nav + UI strings used across the logged-in app. Per-page locales
// (vault.ts, portfolio.ts, …) get added in later phases following this same
// shape. NOTE: FR/ES below are first-pass and should be reviewed by a
// fluent/finance-literate speaker before any dashboard i18n ships
// (tax/financial terminology especially).

import type { Lang } from '@/lib/i18n/locale';

export interface DashboardCommon {
  nav: {
    vault: string;
    portfolio: string;
    networth: string;
    research: string;
    bookkeeping: string;
    transactions: string;
    alerts: string;
    wallets: string;
    settings: string;
    tradfi: string;
    analytics: string;
    billing: string;
  };
  ui: {
    loading: string;
    save: string;
    cancel: string;
    delete: string;
    edit: string;
    add: string;
    close: string;
    confirm: string;
    retry: string;
    error: string;
    noData: string;
    signOut: string;
  };
}

const en: DashboardCommon = {
  nav: {
    vault: 'Vault',
    portfolio: 'Portfolio',
    networth: 'Net Worth',
    research: 'Research',
    bookkeeping: 'Bookkeeping',
    transactions: 'Transactions',
    alerts: 'Alerts',
    wallets: 'Wallets',
    settings: 'Settings',
    tradfi: 'TradFi',
    analytics: 'Analytics',
    billing: 'Billing',
  },
  ui: {
    loading: 'Loading…',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add',
    close: 'Close',
    confirm: 'Confirm',
    retry: 'Retry',
    error: 'Error',
    noData: 'No data yet',
    signOut: 'Sign out',
  },
};

const es: DashboardCommon = {
  nav: {
    vault: 'Bóveda',
    portfolio: 'Portafolio',
    networth: 'Patrimonio neto',
    research: 'Investigación',
    bookkeeping: 'Contabilidad',
    transactions: 'Transacciones',
    alerts: 'Alertas',
    wallets: 'Billeteras',
    settings: 'Configuración',
    tradfi: 'TradFi',
    analytics: 'Analíticas',
    billing: 'Facturación',
  },
  ui: {
    loading: 'Cargando…',
    save: 'Guardar',
    cancel: 'Cancelar',
    delete: 'Eliminar',
    edit: 'Editar',
    add: 'Añadir',
    close: 'Cerrar',
    confirm: 'Confirmar',
    retry: 'Reintentar',
    error: 'Error',
    noData: 'Sin datos aún',
    signOut: 'Cerrar sesión',
  },
};

const fr: DashboardCommon = {
  nav: {
    vault: 'Coffre',
    portfolio: 'Portefeuille',
    networth: 'Valeur nette',
    research: 'Recherche',
    bookkeeping: 'Comptabilité',
    transactions: 'Transactions',
    alerts: 'Alertes',
    wallets: 'Adresses',
    settings: 'Paramètres',
    tradfi: 'TradFi',
    analytics: 'Analyses',
    billing: 'Facturation',
  },
  ui: {
    loading: 'Chargement…',
    save: 'Enregistrer',
    cancel: 'Annuler',
    delete: 'Supprimer',
    edit: 'Modifier',
    add: 'Ajouter',
    close: 'Fermer',
    confirm: 'Confirmer',
    retry: 'Réessayer',
    error: 'Erreur',
    noData: 'Aucune donnée',
    signOut: 'Se déconnecter',
  },
};

const LOCALES: Record<Lang, DashboardCommon> = { en, es, fr };

export function getDashboardCommon(lang: Lang): DashboardCommon {
  return LOCALES[lang] ?? en;
}
