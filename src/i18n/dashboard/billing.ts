// Billing & Plan dashboard page — page-level scaffolding strings (EN · ES · FR).
//
// Cookie-based (Phase 3): billing.astro reads getLang(Astro.request) and selects
// via getBilling(lang). These are the strings the PAGE owns — headings, status
// labels, plan feature bullets, the interval toggle, badges, and the CTA buttons.
//
// What stays English per design.claude.md: product/company names (Almstins,
// Stripe), plan names (Starter, Pro, Unlimited), prices ($7/mo etc.). Plan
// *feature* descriptions and surrounding UI chrome are translated. ES/FR are
// first-pass; billing wording is accurate but pending review.

import type { Lang } from '@/lib/i18n/locale';

export interface BillingLocale {
  lang: Lang;
  pageTitle: string;
  heroTitle: string;
  /** "✓ Subscription activated — welcome to {plan}!" */
  successBanner: (plan: string) => string;
  cancelledBanner: string;
  currentPlanLabel: string;
  unlimitedTins: string;
  /** "Up to N tins" */
  upToTins: (n: number) => string;
  /** "Cancels on {date}" */
  cancelsOn: (date: string) => string;
  /** "Renews {date}" */
  renews: (date: string) => string;
  manageSubscription: string;
  intervalMonthly: string;
  intervalYearly: string;
  yearlySave: string;
  mostPopular: string;
  currentPlanBadge: string;
  // Starter features
  starterFeat1: string;
  starterFeat2: string;
  starterFeat3: string;
  starterFeat4: string;
  // Pro features
  proFeat1: string;
  proFeat2: string;
  proFeat3: string;
  proFeat4: string;
  // Unlimited features
  unlimitedFeat1: string;
  unlimitedFeat2: string;
  unlimitedFeat3: string;
  unlimitedFeat4: string;
  upgradeToStarter: string;
  switchToStarter: string;
  upgradeToPro: string;
  switchToPro: string;
  upgradeToUnlimited: string;
  finePrint: string;
  contactUs: string;
  // Client-side (script) status messages
  redirecting: string;
  checkoutError: string;
  networkError: string;
  openingPortal: string;
  portalError: string;
}

export const en: BillingLocale = {
  lang: 'en',
  pageTitle: 'Billing | Almstins',
  heroTitle: 'Billing & Plan',
  successBanner: (plan) => `✓ Subscription activated — welcome to ${plan}!`,
  cancelledBanner: 'Checkout cancelled. Your plan was not changed.',
  currentPlanLabel: 'Current plan',
  unlimitedTins: 'Unlimited tins',
  upToTins: (n) => `Up to ${n} tins`,
  cancelsOn: (date) => `Cancels on ${date}`,
  renews: (date) => `Renews ${date}`,
  manageSubscription: 'Manage subscription →',
  intervalMonthly: 'Monthly',
  intervalYearly: 'Yearly',
  yearlySave: 'Save ~17%',
  mostPopular: 'Most popular',
  currentPlanBadge: 'Current plan',
  starterFeat1: 'Up to 8 tins',
  starterFeat2: 'All exchanges & importers',
  starterFeat3: 'Bookkeeping & tax breakdown',
  starterFeat4: 'Email support',
  proFeat1: 'Up to 20 tins',
  proFeat2: 'Everything in Starter',
  proFeat3: 'Priority support',
  proFeat4: 'Early access to new features',
  unlimitedFeat1: 'Unlimited tins',
  unlimitedFeat2: 'Everything in Pro',
  unlimitedFeat3: 'White-glove onboarding',
  unlimitedFeat4: 'Direct access to founder',
  upgradeToStarter: 'Upgrade to Starter',
  switchToStarter: 'Switch to Starter',
  upgradeToPro: 'Upgrade to Pro',
  switchToPro: 'Switch to Pro',
  upgradeToUnlimited: 'Upgrade to Unlimited',
  finePrint: 'Cancel anytime. Switching plans takes effect immediately. Questions?',
  contactUs: 'Contact us',
  redirecting: 'Redirecting…',
  checkoutError: 'Unable to start checkout. Please try again.',
  networkError: 'Network error. Please try again.',
  openingPortal: 'Opening portal…',
  portalError: 'Unable to open billing portal.',
};

export const es: BillingLocale = {
  lang: 'es',
  pageTitle: 'Facturación | Almstins',
  heroTitle: 'Facturación y plan',
  successBanner: (plan) => `✓ Suscripción activada — ¡bienvenido a ${plan}!`,
  cancelledBanner: 'Pago cancelado. Tu plan no se modificó.',
  currentPlanLabel: 'Plan actual',
  unlimitedTins: 'Tins ilimitadas',
  upToTins: (n) => `Hasta ${n} tins`,
  cancelsOn: (date) => `Se cancela el ${date}`,
  renews: (date) => `Se renueva el ${date}`,
  manageSubscription: 'Gestionar suscripción →',
  intervalMonthly: 'Mensual',
  intervalYearly: 'Anual',
  yearlySave: 'Ahorra ~17%',
  mostPopular: 'Más popular',
  currentPlanBadge: 'Plan actual',
  starterFeat1: 'Hasta 8 tins',
  starterFeat2: 'Todos los exchanges e importadores',
  starterFeat3: 'Contabilidad y desglose de impuestos',
  starterFeat4: 'Soporte por correo',
  proFeat1: 'Hasta 20 tins',
  proFeat2: 'Todo lo de Starter',
  proFeat3: 'Soporte prioritario',
  proFeat4: 'Acceso anticipado a nuevas funciones',
  unlimitedFeat1: 'Tins ilimitadas',
  unlimitedFeat2: 'Todo lo de Pro',
  unlimitedFeat3: 'Incorporación personalizada',
  unlimitedFeat4: 'Acceso directo al fundador',
  upgradeToStarter: 'Mejorar a Starter',
  switchToStarter: 'Cambiar a Starter',
  upgradeToPro: 'Mejorar a Pro',
  switchToPro: 'Cambiar a Pro',
  upgradeToUnlimited: 'Mejorar a Unlimited',
  finePrint: 'Cancela cuando quieras. Los cambios de plan se aplican de inmediato. ¿Preguntas?',
  contactUs: 'Contáctanos',
  redirecting: 'Redirigiendo…',
  checkoutError: 'No se pudo iniciar el pago. Inténtalo de nuevo.',
  networkError: 'Error de red. Inténtalo de nuevo.',
  openingPortal: 'Abriendo portal…',
  portalError: 'No se pudo abrir el portal de facturación.',
};

export const fr: BillingLocale = {
  lang: 'fr',
  pageTitle: 'Facturation | Almstins',
  heroTitle: 'Facturation et forfait',
  successBanner: (plan) => `✓ Abonnement activé — bienvenue dans ${plan} !`,
  cancelledBanner: "Paiement annulé. Votre forfait n'a pas été modifié.",
  currentPlanLabel: 'Forfait actuel',
  unlimitedTins: 'Tins illimitées',
  upToTins: (n) => `Jusqu'à ${n} tins`,
  cancelsOn: (date) => `Résiliation le ${date}`,
  renews: (date) => `Renouvellement le ${date}`,
  manageSubscription: "Gérer l'abonnement →",
  intervalMonthly: 'Mensuel',
  intervalYearly: 'Annuel',
  yearlySave: 'Économisez ~17%',
  mostPopular: 'Le plus populaire',
  currentPlanBadge: 'Forfait actuel',
  starterFeat1: "Jusqu'à 8 tins",
  starterFeat2: 'Tous les exchanges et importateurs',
  starterFeat3: 'Comptabilité et détail fiscal',
  starterFeat4: 'Support par e-mail',
  proFeat1: "Jusqu'à 20 tins",
  proFeat2: 'Tout ce qui est dans Starter',
  proFeat3: 'Support prioritaire',
  proFeat4: 'Accès anticipé aux nouvelles fonctionnalités',
  unlimitedFeat1: 'Tins illimitées',
  unlimitedFeat2: 'Tout ce qui est dans Pro',
  unlimitedFeat3: 'Accompagnement personnalisé',
  unlimitedFeat4: 'Accès direct au fondateur',
  upgradeToStarter: 'Passer à Starter',
  switchToStarter: 'Changer pour Starter',
  upgradeToPro: 'Passer à Pro',
  switchToPro: 'Changer pour Pro',
  upgradeToUnlimited: 'Passer à Unlimited',
  finePrint: 'Annulez à tout moment. Le changement de forfait prend effet immédiatement. Des questions ?',
  contactUs: 'Contactez-nous',
  redirecting: 'Redirection…',
  checkoutError: 'Impossible de démarrer le paiement. Veuillez réessayer.',
  networkError: 'Erreur réseau. Veuillez réessayer.',
  openingPortal: 'Ouverture du portail…',
  portalError: "Impossible d'ouvrir le portail de facturation.",
};

const MAP: Record<Lang, BillingLocale> = { en, es, fr };

/** Select the Billing locale for a language, falling back to English. */
export function getBilling(lang: Lang): BillingLocale {
  return MAP[lang] ?? en;
}
