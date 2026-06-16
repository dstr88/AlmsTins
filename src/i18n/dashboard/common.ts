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
    addresses: string;
    summary: string;
    history: string;
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
  chrome: {
    /** breadcrumb labels not covered by nav.* */
    scamChecker: string;
    adminDashboard: string;
    admin: string;
    /** account menu */
    account: string;
    accountEmail: string;
    alertEmail: string;
    notSet: string;
    tenantId: string;
    lastLogin: string;
    memberSince: string;
    billingPlan: string;
    deleteAccount: string;
    logOut: string;
    /** aria-labels */
    ariaEditAlertEmail: string;
    ariaCopyTenantId: string;
    /** help pill / drawer static */
    helpPill: string;
    helpTitle: string;
    helpPlaceholder: string;
    helpSend: string;
    /** help drawer client-script strings */
    helpLoading: string;
    helpEmpty: string;
    helpSupportPrefix: string;
    helpYouPrefix: string;
    helpLoadError: string;
    helpSending: string;
    helpSendError: string;
    /** char-count format — receives (len, limit) */
    helpCharCount: (len: number, limit: number) => string;
    /** promo banner */
    promoDays: (days: number) => string;
    promoKeep: string;
    promoViewPlans: string;
    /** demo nav */
    demoSignup: string;
    demoExit: string;
    /** nav toggle */
    ariaOpenMenu: string;
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
    addresses: 'Addresses',
    summary: 'Summary',
    history: 'History',
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
  chrome: {
    scamChecker: 'Scam Checker',
    adminDashboard: 'Admin Dashboard',
    admin: 'Admin',
    account: 'Account',
    accountEmail: 'Account email',
    alertEmail: 'Alert email',
    notSet: 'not set',
    tenantId: 'Tenant ID',
    lastLogin: 'Last login',
    memberSince: 'Member since',
    billingPlan: 'Billing & Plan',
    deleteAccount: 'Delete my account',
    logOut: 'Log out',
    ariaEditAlertEmail: 'Edit alert email',
    ariaCopyTenantId: 'Copy tenant ID',
    helpPill: '💬 Help',
    helpTitle: 'Get Help',
    helpPlaceholder: 'Describe your issue…',
    helpSend: 'Send',
    helpLoading: 'Loading…',
    helpEmpty: 'No messages yet.\nDescribe your issue below and we\'ll get back to you.',
    helpSupportPrefix: 'Support · ',
    helpYouPrefix: 'You · ',
    helpLoadError: 'Could not load messages.',
    helpSending: 'Sending…',
    helpSendError: 'Could not send message. Please try again.',
    helpCharCount: (len, limit) => `${len} / ${limit}`,
    promoDays: (days) => `Your free year ends in ${days} day${days === 1 ? '' : 's'}`,
    promoKeep: 'Keep your access — upgrade before it expires.',
    promoViewPlans: 'View Plans →',
    demoSignup: 'Log in / Sign up free →',
    demoExit: 'Exit demo',
    ariaOpenMenu: 'Open menu',
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
    addresses: 'Direcciones',
    summary: 'Resumen',
    history: 'Historial',
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
  chrome: {
    scamChecker: 'Scam Checker',
    adminDashboard: 'Panel de administración',
    admin: 'Admin',
    account: 'Cuenta',
    accountEmail: "Correo de la cuenta",
    alertEmail: "Correo de alertas",
    notSet: "no definido",
    tenantId: "ID de inquilino",
    lastLogin: "Último acceso",
    memberSince: "Miembro desde",
    billingPlan: "Facturación y plan",
    deleteAccount: "Eliminar mi cuenta",
    logOut: "Cerrar sesión",
    ariaEditAlertEmail: "Editar correo de alertas",
    ariaCopyTenantId: "Copiar ID de inquilino",
    helpPill: "💬 Ayuda",
    helpTitle: "Obtener ayuda",
    helpPlaceholder: "Describe tu problema…",
    helpSend: "Enviar",
    helpLoading: "Cargando…",
    helpEmpty: "Sin mensajes aún.\nDescribe tu problema abajo y te responderemos.",
    helpSupportPrefix: "Soporte · ",
    helpYouPrefix: "Tú · ",
    helpLoadError: "No se pudieron cargar los mensajes.",
    helpSending: "Enviando…",
    helpSendError: "No se pudo enviar el mensaje. Por favor, inténtalo de nuevo.",
    helpCharCount: (len, limit) => `${len} / ${limit}`,
    promoDays: (days) => `Tu año gratuito termina en ${days} día${days === 1 ? "" : "s"}`,
    promoKeep: "Mantén tu acceso — actualiza antes de que expire.",
    promoViewPlans: "Ver planes →",
    demoSignup: "Iniciar sesión / Registrarse gratis →",
    demoExit: "Salir del demo",
    ariaOpenMenu: "Abrir menú",
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
    addresses: 'Adresses',
    summary: 'Récapitulatif',
    history: 'Historique',
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
  chrome: {
    scamChecker: 'Scam Checker',
    adminDashboard: "Tableau de bord admin",
    admin: 'Admin',
    account: 'Compte',
    accountEmail: "Adresse e-mail du compte",
    alertEmail: "E-mail d'alerte",
    notSet: "non défini",
    tenantId: "Identifiant locataire",
    lastLogin: "Dernière connexion",
    memberSince: "Membre depuis",
    billingPlan: "Facturation et plan",
    deleteAccount: "Supprimer mon compte",
    logOut: "Se déconnecter",
    ariaEditAlertEmail: "Modifier l'e-mail d'alerte",
    ariaCopyTenantId: "Copier l'identifiant locataire",
    helpPill: "💬 Aide",
    helpTitle: "Obtenir de l'aide",
    helpPlaceholder: "Décrivez votre problème…",
    helpSend: "Envoyer",
    helpLoading: "Chargement…",
    helpEmpty: "Aucun message pour l'instant.\nDécrivez votre problème ci-dessous et nous vous répondrons.",
    helpSupportPrefix: "Assistance · ",
    helpYouPrefix: "Vous · ",
    helpLoadError: "Impossible de charger les messages.",
    helpSending: "Envoi en cours…",
    helpSendError: "Impossible d'envoyer le message. Veuillez réessayer.",
    helpCharCount: (len, limit) => `${len} / ${limit}`,
    promoDays: (days) => `Votre année gratuite se termine dans ${days} jour${days === 1 ? "" : "s"}`,
    promoKeep: "Conservez votre accès — passez à la version payante avant expiration.",
    promoViewPlans: "Voir les plans →",
    demoSignup: "Connexion / Inscription gratuite →",
    demoExit: "Quitter la démo",
    ariaOpenMenu: "Ouvrir le menu",
  },
};

const LOCALES: Record<Lang, DashboardCommon> = { en, es, fr };

export function getDashboardCommon(lang: Lang): DashboardCommon {
  return LOCALES[lang] ?? en;
}
