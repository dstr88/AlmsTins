// Pricing page copy — EN · ES · FR.
//
// Public page via route-duplication (like /about): src/pages/prices.astro (en),
// /prices/es.astro (es), /prices/fr.astro (fr) all render <PricesPage t={...} />.
// Prices stay in USD; only the unit/word strings and prose are localized.
// French uses its currency style ("7 $") and spacing before : ; ! ?.

import type { Lang } from '@/lib/i18n/locale';

interface FreeCard { name: string; price: string; unit: string; desc: string; cta: string }
interface PlanCard { name: string; badge?: string; price: string; unit: string; yearly: string; items: string[]; cta: string }
interface TalkCard { name: string; price: string; desc: string; cta: string }
interface StoreFreeCard { name: string; price: string; unit: string; items: string[]; cta: string }

export interface PricesCopy {
  lang: Lang;
  meta: { title: string; description: string };
  nav: { login: string; signup: string };
  hero: { title: string; sub: string };
  free: { heading: string; checker: FreeCard; tracking: FreeCard; verify: FreeCard };
  plans: { heading: string; sub: string; taxNote: string; starter: PlanCard; pro: PlanCard; unlimited: PlanCard };
  verify: { heading: string; tag: string; lead: string; storeFree: StoreFreeCard; needMore: TalkCard; exchanges: TalkCard };
  foot: string;
}

export const en: PricesCopy = {
  lang: 'en',
  meta: {
    title: 'Almstins Pricing — Start Free, Pay for More Capacity',
    description: 'Track your crypto across wallets, exchanges, and DeFi with cost basis and a full tax breakdown — free for up to 3 wallets. Verify protects your published payment addresses, free during early access.',
  },
  nav: { login: 'Log in', signup: 'Sign up free' },
  hero: {
    title: 'Start free. Pay only for more capacity.',
    sub: 'The safety tools cost nothing — and always will. You only pay when you need to track or watch more.',
  },
  free: {
    heading: 'Free — for everyone',
    checker: { name: 'Wallet & Site Checker', price: '$0', unit: '· no login', desc: 'Paste any wallet address or website and check it for scams, honeypots, phishing, and sanctions — before you send a thing.', cta: 'Check an address →' },
    tracking: { name: 'Wallet tracking', price: '$0', unit: '· up to 3 wallets', desc: 'Everything you own across wallets, exchanges, and DeFi — with cost basis, realized gains, and a full tax breakdown. Read-only, no wallet connection.', cta: 'Start free →' },
    verify: { name: 'Verify for store owners', price: '$0', unit: '· early access', desc: 'Register the addresses and payment QR you publish and verify them before you trust them — so a swapped address never reaches your customers.', cta: 'Get early access →' },
  },
  plans: {
    heading: 'Track more — wallet plans',
    sub: 'Every plan includes the full bookkeeping & tax breakdown, all exchange imports, and auto-classify. Paid plans add the done-for-you automation.',
    taxNote: 'Prices exclude VAT / sales tax where applicable — any tax is shown at checkout based on your billing address.',
    starter: { name: 'Starter', price: '$7', unit: '/mo', yearly: 'or $70/year', items: ['Up to 8 wallets', 'AI Triage, receipt validation & price backfill', 'Email support'], cta: 'Choose Starter →' },
    pro: { name: 'Pro', badge: 'Recommended', price: '$20', unit: '/mo', yearly: 'or $200/year', items: ['Up to 20 wallets', 'Everything in Starter', 'Priority support & early access'], cta: 'Choose Pro →' },
    unlimited: { name: 'Unlimited', price: '$39', unit: '/mo', yearly: 'or $400/year', items: ['Unlimited wallets', 'Everything in Pro', 'Year-Summary tax PDF + white-glove onboarding'], cta: 'Choose Unlimited →' },
  },
  verify: {
    heading: 'Verify — protect your payment destinations',
    tag: 'early access',
    lead: "Post your QR on every table and every register — print a hundred. Verify checks the address behind it, not the paper. Scan or paste any sign and we'll tell you instantly whether it still matches what you registered — with automatic swap alerts rolling out.",
    storeFree: { name: 'Store · Free', price: '$0', unit: '· early access', items: ['Up to 3 destinations — e.g. your Stripe link, ETH, and BTC', 'Unlimited placements — same QR on as many tables as you like', 'Best-effort checks + email alerts'], cta: 'Get early access →' },
    needMore: { name: 'Need to watch more?', price: "Let's talk", desc: "Running several distinct wallets or payment links — a multi-currency or multi-location operation? Tell us what you publish and we'll sort out a plan that fits.", cta: 'Get in touch →' },
    exchanges: { name: 'Exchanges', price: "Let's talk", desc: 'Connect your API so your users can verify your official deposit addresses before they send — your defense against deposit-address phishing. Annual license + setup.', cta: 'Book a call →' },
  },
  foot: 'Read-only. No wallet connection, ever. We never hold your keys or move your funds.',
};

export const es: PricesCopy = {
  lang: 'es',
  meta: {
    title: 'Precios de Almstins — Empieza gratis, paga por más capacidad',
    description: 'Controla tu cripto en billeteras, exchanges y DeFi con costo base y un desglose fiscal completo — gratis hasta 3 billeteras. Verify protege las direcciones de pago que publicas, gratis durante el acceso anticipado.',
  },
  nav: { login: 'Iniciar sesión', signup: 'Crear cuenta gratis' },
  hero: {
    title: 'Empieza gratis. Paga solo por más capacidad.',
    sub: 'Las herramientas de seguridad no cuestan nada — y nunca lo harán. Solo pagas cuando necesitas seguir o vigilar más.',
  },
  free: {
    heading: 'Gratis — para todos',
    checker: { name: 'Verificador de billeteras y sitios', price: '$0', unit: '· sin iniciar sesión', desc: 'Pega cualquier dirección de billetera o sitio web y verifícalo contra estafas, honeypots, phishing y sanciones — antes de enviar nada.', cta: 'Verificar una dirección →' },
    tracking: { name: 'Seguimiento de billeteras', price: '$0', unit: '· hasta 3 billeteras', desc: 'Todo lo que posees en billeteras, exchanges y DeFi — con costo base, ganancias realizadas y un desglose fiscal completo. Solo lectura, sin conectar la billetera.', cta: 'Empieza gratis →' },
    verify: { name: 'Verify para comercios', price: '$0', unit: '· acceso anticipado', desc: 'Registra las direcciones y el QR de pago que publicas y verifícalos antes de confiar en ellos — para que una dirección sustituida nunca llegue a tus clientes.', cta: 'Obtener acceso anticipado →' },
  },
  plans: {
    heading: 'Sigue más — planes de billeteras',
    sub: 'Todos los planes incluyen el desglose contable y fiscal completo, todas las importaciones de exchanges y la auto-clasificación. Los planes de pago añaden la automatización lista para ti.',
    taxNote: 'Los precios no incluyen IVA ni impuestos sobre las ventas cuando corresponda — el impuesto se muestra al pagar según su dirección de facturación.',
    starter: { name: 'Starter', price: '$7', unit: '/mes', yearly: 'o $70/año', items: ['Hasta 8 billeteras', 'AI Triage, validación de recibos y relleno de precios', 'Soporte por correo'], cta: 'Elegir Starter →' },
    pro: { name: 'Pro', badge: 'Recomendado', price: '$20', unit: '/mes', yearly: 'o $200/año', items: ['Hasta 20 billeteras', 'Todo lo de Starter', 'Soporte prioritario y acceso anticipado'], cta: 'Elegir Pro →' },
    unlimited: { name: 'Unlimited', price: '$39', unit: '/mes', yearly: 'o $400/año', items: ['Billeteras ilimitadas', 'Todo lo de Pro', 'PDF de resumen anual + incorporación personalizada'], cta: 'Elegir Unlimited →' },
  },
  verify: {
    heading: 'Verify — protege tus direcciones de pago',
    tag: 'acceso anticipado',
    lead: 'Pon tu QR en cada mesa y cada caja — imprime cien. Verify comprueba la dirección que hay detrás, no el papel. Escanea o pega cualquier letrero y te diremos al instante si sigue coincidiendo con lo que registraste — con alertas automáticas de sustitución en camino.',
    storeFree: { name: 'Comercio · Gratis', price: '$0', unit: '· acceso anticipado', items: ['Hasta 3 destinos — p. ej. tu enlace de Stripe, ETH y BTC', 'Ubicaciones ilimitadas — el mismo QR en tantas mesas como quieras', 'Comprobaciones de mejor esfuerzo + alertas por correo'], cta: 'Obtener acceso anticipado →' },
    needMore: { name: '¿Necesitas vigilar más?', price: 'Hablemos', desc: '¿Manejas varias billeteras o enlaces de pago distintos — una operación multimoneda o de varios locales? Cuéntanos qué publicas y armamos un plan que encaje.', cta: 'Ponte en contacto →' },
    exchanges: { name: 'Exchanges', price: 'Hablemos', desc: 'Conecta tu API para que tus usuarios verifiquen tus direcciones de depósito oficiales antes de enviar — tu defensa contra el phishing de direcciones de depósito. Licencia anual + configuración.', cta: 'Agenda una llamada →' },
  },
  foot: 'Solo lectura. Sin conectar la billetera, nunca. Nunca tenemos tus claves ni movemos tus fondos.',
};

export const fr: PricesCopy = {
  lang: 'fr',
  meta: {
    title: 'Tarifs Almstins — Commencez gratuitement, payez pour plus de capacité',
    description: "Suivez votre crypto sur vos portefeuilles, exchanges et DeFi avec le coût de base et un récapitulatif fiscal complet — gratuit jusqu'à 3 portefeuilles. Verify protège les adresses de paiement que vous publiez, gratuit pendant l'accès anticipé.",
  },
  nav: { login: 'Se connecter', signup: 'Créer un compte gratuit' },
  hero: {
    title: 'Commencez gratuitement. Payez seulement pour plus de capacité.',
    sub: 'Les outils de sécurité ne coûtent rien — et ne coûteront jamais rien. Vous ne payez que lorsque vous avez besoin de suivre ou de surveiller davantage.',
  },
  free: {
    heading: 'Gratuit — pour tout le monde',
    checker: { name: 'Vérificateur de portefeuilles et de sites', price: '0 $', unit: '· sans connexion', desc: "Collez n'importe quelle adresse de portefeuille ou site web et vérifiez-le contre les arnaques, honeypots, hameçonnage et sanctions — avant d'envoyer quoi que ce soit.", cta: 'Vérifier une adresse →' },
    tracking: { name: 'Suivi de portefeuille', price: '0 $', unit: "· jusqu'à 3 portefeuilles", desc: 'Tout ce que vous possédez sur vos portefeuilles, exchanges et DeFi — avec le coût de base, les gains réalisés et un récapitulatif fiscal complet. En lecture seule, sans connexion de portefeuille.', cta: 'Commencer gratuitement →' },
    verify: { name: 'Verify pour les commerçants', price: '0 $', unit: '· accès anticipé', desc: "Enregistrez les adresses et le QR de paiement que vous publiez et vérifiez-les avant de leur faire confiance — pour qu'une adresse remplacée n'atteigne jamais vos clients.", cta: "Obtenir l'accès anticipé →" },
  },
  plans: {
    heading: 'Suivez plus — forfaits portefeuilles',
    sub: "Chaque forfait inclut le récapitulatif comptable et fiscal complet, tous les imports d'exchanges et l'auto-classification. Les forfaits payants ajoutent l'automatisation clé en main.",
    taxNote: "Les prix s'entendent hors TVA et taxes de vente le cas échéant — la taxe est affichée au paiement selon votre adresse de facturation.",
    starter: { name: 'Starter', price: '7 $', unit: '/mois', yearly: 'ou 70 $/an', items: ["Jusqu'à 8 portefeuilles", 'AI Triage, validation de reçus et remplissage des prix', 'Support par e-mail'], cta: 'Choisir Starter →' },
    pro: { name: 'Pro', badge: 'Recommandé', price: '20 $', unit: '/mois', yearly: 'ou 200 $/an', items: ["Jusqu'à 20 portefeuilles", 'Tout ce qui est dans Starter', 'Support prioritaire et accès anticipé'], cta: 'Choisir Pro →' },
    unlimited: { name: 'Unlimited', price: '39 $', unit: '/mois', yearly: 'ou 400 $/an', items: ['Portefeuilles illimités', 'Tout ce qui est dans Pro', 'PDF de récapitulatif annuel + accompagnement personnalisé'], cta: 'Choisir Unlimited →' },
  },
  verify: {
    heading: 'Verify — protégez vos adresses de paiement',
    tag: 'accès anticipé',
    lead: "Affichez votre QR sur chaque table et chaque caisse — imprimez-en cent. Verify vérifie l'adresse qui se cache derrière, pas le papier. Scannez ou collez n'importe quel panneau et nous vous dirons aussitôt s'il correspond toujours à ce que vous avez enregistré — avec des alertes de remplacement automatiques qui arrivent.",
    storeFree: { name: 'Commerçant · Gratuit', price: '0 $', unit: '· accès anticipé', items: ['Jusqu\'à 3 destinations — p. ex. votre lien Stripe, ETH et BTC', 'Emplacements illimités — le même QR sur autant de tables que vous voulez', 'Vérifications au mieux + alertes par e-mail'], cta: "Obtenir l'accès anticipé →" },
    needMore: { name: "Besoin d'en surveiller plus ?", price: 'Discutons-en', desc: 'Vous gérez plusieurs portefeuilles ou liens de paiement distincts — une activité multidevises ou multisites ? Dites-nous ce que vous publiez et nous trouverons un forfait adapté.', cta: 'Nous contacter →' },
    exchanges: { name: 'Exchanges', price: 'Discutons-en', desc: "Connectez votre API pour que vos utilisateurs vérifient vos adresses de dépôt officielles avant d'envoyer — votre défense contre l'hameçonnage d'adresses de dépôt. Licence annuelle + installation.", cta: 'Réserver un appel →' },
  },
  foot: 'En lecture seule. Sans connexion de portefeuille, jamais. Nous ne détenons jamais vos clés et ne déplaçons jamais vos fonds.',
};

const MAP: Record<Lang, PricesCopy> = { en, es, fr };

export function getPrices(lang: Lang): PricesCopy {
  return MAP[lang] ?? en;
}
