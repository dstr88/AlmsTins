// Onboarding drip — a 4-email welcome series (EN · ES · FR), founder-voiced.
//
// Sent by the daily cron (/api/cron/onboarding-drip) via Resend (campaignEmail.ts),
// one step at a time on the cadence in onboardingDrip.ts (day 0 / 2 / 5 / 10).
// Content is static (no user input), so no escaping needed in the template.

import type { Lang } from '@/lib/i18n/locale';
import type { DripLocale } from './dripTemplate';

export const en: DripLocale = {
  lang: 'en',
  brand: 'Almstins',
  signoff: '— Donnie',
  unsubscribe: 'Unsubscribe from these emails',
  contact: 'Reply any time, or message me on Telegram',
  emails: [
    {
      subject: 'Welcome to Almstins — check any address, free',
      paragraphs: [
        'Thanks for signing up. Almstins does two things: it helps you see everything you own across wallets, exchanges, and DeFi — and it helps you not lose it to a scam.',
        'Start with the second one. Paste any wallet address or website and we check it against the major scam, phishing, and sanctions databases before you send anything — free, no login, and no limit on how many you check, for as long as you need.',
        'No wallet connection, ever. We only ever read public data.',
      ],
      ctaLabel: 'Check an address',
      ctaPath: '/wallet-checker',
    },
    {
      subject: 'See everything you own in one place',
      paragraphs: [
        'Most people don’t actually know what their crypto is worth — it’s scattered across exchanges, wallets, and chains.',
        'Add one wallet address — read-only, no connection, no keys — and Almstins pulls your balances, prices them live, and works out your cost basis and gains automatically.',
        'Start with one. It takes about thirty seconds.',
      ],
      ctaLabel: 'Add a wallet',
      ctaPath: '/dashboard/vault',
    },
    {
      subject: 'Your crypto taxes, mostly done already',
      paragraphs: [
        'The hardest part of crypto isn’t the volatility — it’s tax season, reconstructing a year of trades from a dozen different sources.',
        'Almstins keeps the books as you go: every buy, sell, and transfer reconciled, with realized gains broken down by asset and by year. When it’s time to file — or hand it to an accountant — it’s already organized.',
      ],
      ctaLabel: 'See your tax breakdown',
      ctaPath: '/dashboard/bookkeeping',
    },
    {
      subject: 'Two last things Almstins can do for you',
      paragraphs: [
        'By now you’ve hopefully checked an address and started tracking what you own. Two last things worth knowing.',
        'If you take crypto for a business, Almstins Verify watches the addresses you publish — so a swapped QR or address never reaches your customers. It’s free while it’s in early access.',
        'And if you’ve outgrown the free three wallets, the paid plans add more capacity plus the done-for-you tools: AI triage, receipt validation, and a year-end tax PDF for your accountant.',
        'Either way — thank you for being here this early. It means a lot.',
      ],
      ctaLabel: 'See the plans',
      ctaPath: '/prices',
    },
  ],
};

export const es: DripLocale = {
  lang: 'es',
  brand: 'Almstins',
  signoff: '— Donnie',
  unsubscribe: 'Darse de baja de estos correos',
  contact: 'Responde cuando quieras, o escríbeme por Telegram',
  emails: [
    {
      subject: 'Bienvenido a Almstins — verifica cualquier dirección, gratis',
      paragraphs: [
        'Gracias por registrarte. Almstins hace dos cosas: te ayuda a ver todo lo que tienes en billeteras, exchanges y DeFi — y te ayuda a no perderlo por una estafa.',
        'Empieza por lo segundo. Pega cualquier dirección de billetera o sitio web y lo verificamos contra las principales bases de datos de estafas, phishing y sanciones antes de que envíes nada — gratis, sin iniciar sesión y sin límite de cuántas verificas, durante el tiempo que necesites.',
        'Sin conectar la billetera, nunca. Solo leemos datos públicos.',
      ],
      ctaLabel: 'Verificar una dirección',
      ctaPath: '/wallet-checker',
    },
    {
      subject: 'Ve todo lo que tienes en un solo lugar',
      paragraphs: [
        'La mayoría no sabe realmente cuánto vale su cripto — está repartida entre exchanges, billeteras y cadenas.',
        'Agrega una dirección de billetera — solo lectura, sin conexión, sin claves — y Almstins obtiene tus saldos, los valora en vivo y calcula tu costo base y tus ganancias automáticamente.',
        'Empieza con una. Toma unos treinta segundos.',
      ],
      ctaLabel: 'Agregar una billetera',
      ctaPath: '/dashboard/vault',
    },
    {
      subject: 'Tus impuestos de cripto, casi listos',
      paragraphs: [
        'Lo más difícil de la cripto no es la volatilidad — es la temporada de impuestos, reconstruir un año de operaciones desde una docena de fuentes distintas.',
        'Almstins lleva la contabilidad sobre la marcha: cada compra, venta y transferencia reconciliada, con las ganancias realizadas desglosadas por activo y por año. Cuando llega el momento de declarar — o de dárselo a tu contador — ya está organizado.',
      ],
      ctaLabel: 'Ver tu desglose fiscal',
      ctaPath: '/dashboard/bookkeeping',
    },
    {
      subject: 'Dos últimas cosas que Almstins puede hacer por ti',
      paragraphs: [
        'A estas alturas ya habrás verificado una dirección y empezado a controlar lo que tienes. Dos últimas cosas que vale la pena saber.',
        'Si aceptas cripto en un negocio, Almstins Verify vigila las direcciones que publicas — para que una dirección o un QR sustituido nunca llegue a tus clientes. Es gratis durante el acceso anticipado.',
        'Y si te has quedado corto con las tres billeteras gratis, los planes de pago añaden más capacidad y las herramientas listas para ti: AI triage, validación de recibos y un PDF de resumen anual para tu contador.',
        'En cualquier caso — gracias por estar aquí tan pronto. Significa mucho.',
      ],
      ctaLabel: 'Ver los planes',
      ctaPath: '/prices',
    },
  ],
};

export const fr: DripLocale = {
  lang: 'fr',
  brand: 'Almstins',
  signoff: '— Donnie',
  unsubscribe: 'Se désabonner de ces e-mails',
  contact: 'Répondez quand vous voulez, ou écrivez-moi sur Telegram',
  emails: [
    {
      subject: 'Bienvenue sur Almstins — vérifiez n’importe quelle adresse, gratuitement',
      paragraphs: [
        'Merci de votre inscription. Almstins fait deux choses : il vous aide à voir tout ce que vous possédez sur vos portefeuilles, exchanges et DeFi — et il vous aide à ne pas le perdre à cause d’une arnaque.',
        'Commencez par la seconde. Collez n’importe quelle adresse de portefeuille ou site web et nous la vérifions contre les principales bases de données d’arnaques, d’hameçonnage et de sanctions avant que vous n’envoyiez quoi que ce soit — gratuitement, sans connexion et sans limite du nombre de vérifications, aussi longtemps que vous en avez besoin.',
        'Sans connexion de portefeuille, jamais. Nous ne lisons que des données publiques.',
      ],
      ctaLabel: 'Vérifier une adresse',
      ctaPath: '/wallet-checker',
    },
    {
      subject: 'Voyez tout ce que vous possédez au même endroit',
      paragraphs: [
        'La plupart des gens ne savent pas vraiment ce que vaut leur crypto — elle est éparpillée entre exchanges, portefeuilles et chaînes.',
        'Ajoutez une adresse de portefeuille — en lecture seule, sans connexion, sans clés — et Almstins récupère vos soldes, les valorise en direct et calcule votre coût de base et vos gains automatiquement.',
        'Commencez par une seule. Cela prend une trentaine de secondes.',
      ],
      ctaLabel: 'Ajouter un portefeuille',
      ctaPath: '/dashboard/vault',
    },
    {
      subject: 'Vos impôts crypto, déjà presque faits',
      paragraphs: [
        'Le plus dur avec la crypto, ce n’est pas la volatilité — c’est la période des impôts, reconstituer une année de transactions à partir d’une dizaine de sources différentes.',
        'Almstins tient les comptes au fur et à mesure : chaque achat, vente et transfert réconcilié, avec les gains réalisés détaillés par actif et par année. Au moment de déclarer — ou de confier le tout à votre comptable — c’est déjà organisé.',
      ],
      ctaLabel: 'Voir votre récapitulatif fiscal',
      ctaPath: '/dashboard/bookkeeping',
    },
    {
      subject: 'Deux dernières choses qu’Almstins peut faire pour vous',
      paragraphs: [
        'À ce stade, vous avez sans doute vérifié une adresse et commencé à suivre ce que vous possédez. Deux dernières choses qui valent la peine d’être connues.',
        'Si vous acceptez la crypto pour une activité, Almstins Verify surveille les adresses que vous publiez — pour qu’une adresse ou un QR remplacé n’atteigne jamais vos clients. C’est gratuit pendant l’accès anticipé.',
        'Et si les trois portefeuilles gratuits ne vous suffisent plus, les forfaits payants ajoutent plus de capacité et les outils clé en main : AI triage, validation de reçus et un PDF de récapitulatif annuel pour votre comptable.',
        'Dans tous les cas — merci d’être là aussi tôt. Cela compte beaucoup.',
      ],
      ctaLabel: 'Voir les forfaits',
      ctaPath: '/prices',
    },
  ],
};

/** Onboarding campaign locales, consumed by the campaign drip engine. */
export const onboardingLocales: Record<Lang, DripLocale> = { en, es, fr };
