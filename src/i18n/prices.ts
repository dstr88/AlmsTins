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
// A Verify paid plan (Business, Pro). The name, prices and destination count come from
// src/lib/verifyPlans.ts: `money` places the amount ({n}), `yearly` places the yearly price
// ({price}) and an item may place the plan's destinations ({n}).
interface VerifyPaidCopy { money: string; unit: string; yearly: string; items: string[]; cta: string }

export interface PricesCopy {
  lang: Lang;
  meta: { title: string; description: string };
  nav: { login: string; signup: string };
  hero: { title: string; sub: string };
  free: { heading: string; checker: FreeCard; tracking: FreeCard; verify: FreeCard };
  plans: { heading: string; sub: string; starter: PlanCard; pro: PlanCard; unlimited: PlanCard };
  // storeFree items may place the Free plan's limits: {address} wallet addresses, {qr} payment QRs.
  verify: { heading: string; tag: string; lead: string; storeFree: StoreFreeCard; paid: VerifyPaidCopy; exchanges: TalkCard };
  foot: string;
}

export const en: PricesCopy = {
  lang: 'en',
  meta: {
    title: 'Almstins Pricing — Start Free, Pay for More Capacity',
    description: 'Track your crypto across wallets, exchanges, and DeFi with cost basis and realized gains and losses, free for up to 3 wallets. Verify protects your published payment addresses, with a Free plan that stays free.',
  },
  nav: { login: 'Log in', signup: 'Sign up free' },
  hero: {
    title: 'Start free. Pay only for more capacity.',
    sub: 'The safety tools cost nothing — and always will. You only pay when you need to track or watch more.',
  },
  free: {
    heading: 'Free — for everyone',
    checker: { name: 'Wallet & Site Checker', price: '$0', unit: '· no login', desc: 'Paste any wallet address or website and check it for scams, honeypots, phishing, and sanctions — before you send a thing.', cta: 'Check an address →' },
    tracking: { name: 'Wallet tracking', price: '$0', unit: '· up to 3 wallets', desc: 'Everything you own across wallets, exchanges, and DeFi, with cost basis and realized gains and losses. Read-only, no wallet connection.', cta: 'Start free →' },
    verify: { name: 'Verify for store owners', price: '$0', unit: '· 2 wallets + 1 QR', desc: 'Register the addresses and payment QR you publish and verify them before you trust them, so a swapped address never reaches your customers.', cta: 'Start free →' },
  },
  plans: {
    heading: 'Track more — wallet plans',
    sub: 'Every plan includes full bookkeeping with cost basis and gains, all exchange imports, and auto-classify. Paid plans add the done-for-you automation.',
    starter: { name: 'Starter', price: '$7', unit: '/mo', yearly: 'or $70/year', items: ['Up to 8 wallets', 'AI Triage, receipt validation & price backfill', 'Email support'], cta: 'Choose Starter →' },
    pro: { name: 'Pro', badge: 'Recommended', price: '$20', unit: '/mo', yearly: 'or $200/year', items: ['Up to 20 wallets', 'Everything in Starter', 'Priority support & early access'], cta: 'Choose Pro →' },
    unlimited: { name: 'Unlimited', price: '$39', unit: '/mo', yearly: 'or $400/year', items: ['Unlimited wallets', 'Everything in Pro', 'Year Summary PDF for your records and your tax professional + white-glove onboarding'], cta: 'Choose Unlimited →' },
  },
  verify: {
    heading: 'Verify — protect your payment destinations',
    tag: 'paid plans by email',
    lead: "Post your QR on every table and every register — print a hundred. Verify checks the address behind it, not the paper. Scan or paste any sign and we'll tell you instantly whether it still matches what you registered — with automatic swap alerts rolling out.",
    storeFree: { name: 'Store · Free', price: '$0', unit: '· always', items: ['{address} wallet addresses and {qr} payment QR or link, e.g. your ETH and BTC addresses and your Stripe link', 'Unlimited placements, same QR on as many tables as you like', 'Best-effort checks + email alerts'], cta: 'Start free →' },
    paid: { money: '${n}', unit: '/mo', yearly: 'or {price}/year', items: ['{n} destinations, any mix of wallet addresses and payment QRs or links', 'Unlimited placements', 'Not sold online: ask by email'], cta: 'Ask by email →' },
    exchanges: { name: 'Exchanges', price: "Let's talk", desc: 'Connect your API so your users can verify your official deposit addresses before they send — your defense against deposit-address phishing. Annual license + setup.', cta: 'Book a call →' },
  },
  foot: 'Read-only. No wallet connection, ever. We never hold your keys or move your funds.',
};

export const es: PricesCopy = {
  lang: 'es',
  meta: {
    title: 'Precios de Almstins — Empieza gratis, paga por más capacidad',
    description: 'Controla tu cripto en billeteras, exchanges y DeFi con costo base y ganancias y pérdidas realizadas, gratis hasta 3 billeteras. Verify protege las direcciones de pago que publicas, con un plan gratuito que sigue siendo gratis.',
  },
  nav: { login: 'Iniciar sesión', signup: 'Crear cuenta gratis' },
  hero: {
    title: 'Empieza gratis. Paga solo por más capacidad.',
    sub: 'Las herramientas de seguridad no cuestan nada — y nunca lo harán. Solo pagas cuando necesitas seguir o vigilar más.',
  },
  free: {
    heading: 'Gratis — para todos',
    checker: { name: 'Verificador de billeteras y sitios', price: '$0', unit: '· sin iniciar sesión', desc: 'Pega cualquier dirección de billetera o sitio web y verifícalo contra estafas, honeypots, phishing y sanciones — antes de enviar nada.', cta: 'Verificar una dirección →' },
    tracking: { name: 'Seguimiento de billeteras', price: '$0', unit: '· hasta 3 billeteras', desc: 'Todo lo que posees en billeteras, exchanges y DeFi, con costo base y ganancias y pérdidas realizadas. Solo lectura, sin conectar la billetera.', cta: 'Empieza gratis →' },
    verify: { name: 'Verify para comercios', price: '$0', unit: '· 2 direcciones + 1 QR', desc: 'Registra las direcciones y el QR de pago que publicas y verifícalos antes de confiar en ellos, para que una dirección sustituida nunca llegue a tus clientes.', cta: 'Empieza gratis →' },
  },
  plans: {
    heading: 'Sigue más — planes de billeteras',
    sub: 'Todos los planes incluyen la contabilidad completa con costo base y ganancias, todas las importaciones de exchanges y la auto-clasificación. Los planes de pago añaden la automatización lista para ti.',
    starter: { name: 'Starter', price: '$7', unit: '/mes', yearly: 'o $70/año', items: ['Hasta 8 billeteras', 'AI Triage, validación de recibos y relleno de precios', 'Soporte por correo'], cta: 'Elegir Starter →' },
    pro: { name: 'Pro', badge: 'Recomendado', price: '$20', unit: '/mes', yearly: 'o $200/año', items: ['Hasta 20 billeteras', 'Todo lo de Starter', 'Soporte prioritario y acceso anticipado'], cta: 'Elegir Pro →' },
    unlimited: { name: 'Unlimited', price: '$39', unit: '/mes', yearly: 'o $400/año', items: ['Billeteras ilimitadas', 'Todo lo de Pro', 'PDF de resumen anual para tus registros y tu profesional de impuestos + incorporación personalizada'], cta: 'Elegir Unlimited →' },
  },
  verify: {
    heading: 'Verify — protege tus direcciones de pago',
    tag: 'planes de pago por correo',
    lead: 'Pon tu QR en cada mesa y cada caja — imprime cien. Verify comprueba la dirección que hay detrás, no el papel. Escanea o pega cualquier letrero y te diremos al instante si sigue coincidiendo con lo que registraste — con alertas automáticas de sustitución en camino.',
    storeFree: { name: 'Comercio · Gratis', price: '$0', unit: '· siempre', items: ['{address} direcciones de billetera y {qr} QR o enlace de pago, p. ej. tus direcciones de ETH y BTC y tu enlace de Stripe', 'Ubicaciones ilimitadas, el mismo QR en tantas mesas como quieras', 'Comprobaciones de mejor esfuerzo + alertas por correo'], cta: 'Empieza gratis →' },
    paid: { money: '${n}', unit: '/mes', yearly: 'o {price}/año', items: ['{n} destinos, en cualquier combinación de direcciones de billetera y QR o enlaces de pago', 'Ubicaciones ilimitadas', 'No se vende en línea: pídelo por correo'], cta: 'Pedir por correo →' },
    exchanges: { name: 'Exchanges', price: 'Hablemos', desc: 'Conecta tu API para que tus usuarios verifiquen tus direcciones de depósito oficiales antes de enviar — tu defensa contra el phishing de direcciones de depósito. Licencia anual + configuración.', cta: 'Agenda una llamada →' },
  },
  foot: 'Solo lectura. Sin conectar la billetera, nunca. Nunca tenemos tus claves ni movemos tus fondos.',
};

export const fr: PricesCopy = {
  lang: 'fr',
  meta: {
    title: 'Tarifs Almstins — Commencez gratuitement, payez pour plus de capacité',
    description: "Suivez votre crypto sur vos portefeuilles, exchanges et DeFi avec le coût de base et les plus-values et moins-values réalisées, gratuit jusqu'à 3 portefeuilles. Verify protège les adresses de paiement que vous publiez, avec un forfait gratuit qui reste gratuit.",
  },
  nav: { login: 'Se connecter', signup: 'Créer un compte gratuit' },
  hero: {
    title: 'Commencez gratuitement. Payez seulement pour plus de capacité.',
    sub: 'Les outils de sécurité ne coûtent rien — et ne coûteront jamais rien. Vous ne payez que lorsque vous avez besoin de suivre ou de surveiller davantage.',
  },
  free: {
    heading: 'Gratuit — pour tout le monde',
    checker: { name: 'Vérificateur de portefeuilles et de sites', price: '0 $', unit: '· sans connexion', desc: "Collez n'importe quelle adresse de portefeuille ou site web et vérifiez-le contre les arnaques, honeypots, hameçonnage et sanctions — avant d'envoyer quoi que ce soit.", cta: 'Vérifier une adresse →' },
    tracking: { name: 'Suivi de portefeuille', price: '0 $', unit: "· jusqu'à 3 portefeuilles", desc: 'Tout ce que vous possédez sur vos portefeuilles, exchanges et DeFi, avec le coût de base et les plus-values et moins-values réalisées. En lecture seule, sans connexion de portefeuille.', cta: 'Commencer gratuitement →' },
    verify: { name: 'Verify pour les commerçants', price: '0 $', unit: '· 2 adresses + 1 QR', desc: "Enregistrez les adresses et le QR de paiement que vous publiez et vérifiez-les avant de leur faire confiance, pour qu'une adresse remplacée n'atteigne jamais vos clients.", cta: 'Commencer gratuitement →' },
  },
  plans: {
    heading: 'Suivez plus — forfaits portefeuilles',
    sub: "Chaque forfait inclut la tenue de livres complète avec coût de base et plus-values, tous les imports d'exchanges et l'auto-classification. Les forfaits payants ajoutent l'automatisation clé en main.",
    starter: { name: 'Starter', price: '7 $', unit: '/mois', yearly: 'ou 70 $/an', items: ["Jusqu'à 8 portefeuilles", 'AI Triage, validation de reçus et remplissage des prix', 'Support par e-mail'], cta: 'Choisir Starter →' },
    pro: { name: 'Pro', badge: 'Recommandé', price: '20 $', unit: '/mois', yearly: 'ou 200 $/an', items: ["Jusqu'à 20 portefeuilles", 'Tout ce qui est dans Starter', 'Support prioritaire et accès anticipé'], cta: 'Choisir Pro →' },
    unlimited: { name: 'Unlimited', price: '39 $', unit: '/mois', yearly: 'ou 400 $/an', items: ['Portefeuilles illimités', 'Tout ce qui est dans Pro', 'PDF de récapitulatif annuel pour vos registres et votre professionnel fiscal + accompagnement personnalisé'], cta: 'Choisir Unlimited →' },
  },
  verify: {
    heading: 'Verify — protégez vos adresses de paiement',
    tag: 'forfaits payants par e-mail',
    lead: "Affichez votre QR sur chaque table et chaque caisse — imprimez-en cent. Verify vérifie l'adresse qui se cache derrière, pas le papier. Scannez ou collez n'importe quel panneau et nous vous dirons aussitôt s'il correspond toujours à ce que vous avez enregistré — avec des alertes de remplacement automatiques qui arrivent.",
    storeFree: { name: 'Commerçant · Gratuit', price: '0 $', unit: '· toujours', items: ['{address} adresses de portefeuille et {qr} QR ou lien de paiement, p. ex. vos adresses ETH et BTC et votre lien Stripe', 'Emplacements illimités, le même QR sur autant de tables que vous voulez', 'Vérifications au mieux + alertes par e-mail'], cta: 'Commencer gratuitement →' },
    paid: { money: '{n} $', unit: '/mois', yearly: 'ou {price}/an', items: ['{n} destinations, en combinant librement adresses de portefeuille et QR ou liens de paiement', 'Emplacements illimités', 'Pas de vente en ligne : demandez par e-mail'], cta: 'Demander par e-mail →' },
    exchanges: { name: 'Exchanges', price: 'Discutons-en', desc: "Connectez votre API pour que vos utilisateurs vérifient vos adresses de dépôt officielles avant d'envoyer — votre défense contre l'hameçonnage d'adresses de dépôt. Licence annuelle + installation.", cta: 'Réserver un appel →' },
  },
  foot: 'En lecture seule. Sans connexion de portefeuille, jamais. Nous ne détenons jamais vos clés et ne déplaçons jamais vos fonds.',
};

const MAP: Record<Lang, PricesCopy> = { en, es, fr };

export function getPrices(lang: Lang): PricesCopy {
  return MAP[lang] ?? en;
}
