/**
 * Almstins Verify — merchant landing page copy (EN / ES / FR).
 *
 * Mirrors the i18n convention in src/i18n/walletChecker.ts: a typed copy
 * interface + one entry per Lang. Markup lives once in
 * src/components/VerifyPage.astro and renders from copy[lang].
 *
 * Brand-locked strings are NOT translated — see BRAND, BRAND_QUOTE, ALMSTINS_URL.
 * Swapping the product name (e.g. "Almstins Guard") is a one-line change to BRAND.
 */

export type Lang = 'en' | 'es' | 'fr';

/** Product name — brand-locked, never translated. Single source of truth. */
export const BRAND = 'Almstins Verify';
/** Section 5 brand line — brand-locked, never translated. */
export const BRAND_QUOTE = 'Your wallet never touches our server — because we never ask for it.';
/** Footer link — brand-locked, never translated. */
export const ALMSTINS_URL = 'almstins.com';

export const LANGS: Array<{ code: Lang; href: string; label: string; aria: string }> = [
  { code: 'en', href: '/verify',    label: 'EN', aria: 'View in English' },
  { code: 'es', href: '/verify/es', label: 'ES', aria: 'Ver en español' },
  { code: 'fr', href: '/verify/fr', label: 'FR', aria: 'Voir en français' },
];

export interface VerifyCopy {
  /** Page <title> is composed in the component as `${BRAND} — ${meta.tagline}`. */
  meta: { tagline: string; description: string };
  jsonld: { description: string; featureList: string[] };
  nav: { brandAria: string; tagline: string; login: string };
  hero: {
    eyebrow: string;
    title: string;
    sub: string;
    ctaPrimary: string;
    ctaSecondary: string;
    ctaDemo: string;
  };
  problem: { heading: string; body: string[] };
  how: { heading: string; steps: Array<{ title: string; body: string }> };
  free: { heading: string; items: string[]; note: string };
  trust: { heading: string; points: Array<{ title: string; body: string }> };
  early: { heading: string; body: string };
  finalCta: { heading: string; button: string; sub: string; footerAria: string };
  /** Verified-vendors FAQ: how any vendor gets verified, plus the exchange (API-endpoint) path. */
  vendors: {
    heading: string;
    intro: string;
    howToLabel: string;
    steps: string[];
    scaleLabel: string;
    scaleBody: string;
    contractLabel: string;
    earlyNote: string; // developer-controlled; contains a mailto link → rendered with set:html
  };
}

const en: VerifyCopy = {
  meta: {
    tagline: 'Verify your crypto receiving addresses before you trust them',
    description:
      'Register the crypto addresses and payment QR your business publishes, prove they are yours — no wallet connection — then check any sign or invoice against them before you rely on it. Free to start: 2 wallets and 1 QR. Automatic monitoring and swap alerts are coming.',
  },
  jsonld: {
    description:
      'Register the payment destinations your business publishes, prove you control them, and verify any published address or QR on demand before you trust it. No wallet connection, no custody. Automatic monitoring and alerts are coming.',
    featureList: [
      'Register crypto receiving addresses',
      'Register a payment QR',
      'Prove ownership without a wallet connection',
      'Verify published destinations on demand',
      'Automatic monitoring and email alerts (coming soon)',
      'No custody — funds are never moved',
    ],
  },
  nav: {
    brandAria: 'Almstins home',
    tagline: 'Verify the addresses your customers pay',
    login: 'Sign in',
  },
  hero: {
    eyebrow: 'Early access · Free to start',
    title: 'The address your customers pay could be swapped. Now you can check it before you trust it.',
    sub: "Register your receiving addresses and payment QR, prove they're yours — no wallet connection, ever — then verify any sign, invoice, or checkout against them before you rely on it. Free to start: 2 wallets and 1 QR.",
    ctaPrimary: 'Create your free account',
    ctaSecondary: 'How it works ↓',
    ctaDemo: 'Try the vendor demo →',
  },
  problem: {
    heading: 'The problem',
    body: [
      'You publish a receiving address — a QR by the register, a wallet on an invoice, a link at checkout. An attacker quietly replaces it with their own. The sticker still looks right. The customer still pays. The money just goes somewhere else — and you find out when someone says they paid and you never got it.',
      'On-chain there\'s no chargeback and no one to call. The first defense is simple: check your own published address before you trust it — and before a customer pays it.',
    ],
  },
  how: {
    heading: 'How it works',
    steps: [
      {
        title: 'Register',
        body: 'Add the receiving addresses and the payment QR your customers actually use.',
      },
      {
        title: "Prove they're yours",
        body: 'For a wallet address, send yourself a tiny amount or host a small file on your site — never a wallet connection, never signing. For a payment link (like Stripe), registering it in your account is the proof. No keys. Ever.',
      },
      {
        title: 'Verify before you trust',
        body: "Before you rely on a published QR or address, scan or paste it and we'll tell you instantly whether it still matches what you registered. Automatic monitoring and swap alerts are on the way.",
      },
    ],
  },
  free: {
    heading: 'What you get, free',
    items: [
      'Register and verify 2 receiving addresses',
      'Register and verify 1 payment QR',
      'Automatic monitoring and email alerts (coming soon)',
      'No wallet connection, ever — we read public data you point us to',
      "Your data stays yours — we can't see your customers, and we can't move your funds",
    ],
    note: "Pricing is coming soon — for now everything here is free while we test it with the people who'll use it.",
  },
  trust: {
    heading: 'Why you can trust it',
    points: [
      {
        title: 'We never connect to your wallet.',
        body: 'Verification is a one-time signature or a file on your site — you keep your keys.',
      },
      {
        title: 'We never touch your funds.',
        body: "Almstins can't move a coin. There's nothing to steal here.",
      },
      {
        title: "We can't see your customers.",
        body: 'You check your own published addresses — never the people who pay them. No tracking, by design.',
      },
    ],
  },
  early: {
    heading: 'Early & honest',
    body: "This is early. It's free while we learn what merchants actually need. If you take crypto — anywhere in the world — try it, then tell us what would make it genuinely useful. We're building this with you, not at you.",
  },
  finalCta: {
    heading: 'Check before money moves.',
    button: 'Create your free account',
    sub: 'Register + verify 2 wallets + 1 QR. No card, no wallet connection.',
    footerAria: 'Almstins home',
  },
  vendors: {
    heading: 'Verified vendors',
    intro: 'Any business that takes crypto can verify the addresses it publishes — so customers can trust an address is really yours before they send.',
    howToLabel: 'How to get verified',
    steps: [
      'Create a free account and add the receiving addresses and payment QR you publish.',
      "Prove they're yours — a quick signature or a small file on your site. No wallet connection, no keys, ever.",
      'Verify them on demand before you rely on them — scan a sign and we confirm it still matches. Automatic monitoring is coming.',
    ],
    scaleLabel: 'Publishing many addresses?',
    scaleBody: 'Exchanges and large platforms can verify everything from their own domain at once: prove your domain, then host a read-only endpoint and issue us an API key. We pull your list so it can be verified — no adding addresses one by one. Live monitoring is on the way.',
    contractLabel: 'Your endpoint returns:',
    earlyNote: 'Early access. Any key you give us only reads a list you already publish — it can never move funds or see anything private. To get set up, email <a href="mailto:donnie@titaniumhut.com">donnie@titaniumhut.com</a>.',
  },
};

const es: VerifyCopy = {
  meta: {
    tagline: 'Verifica tus direcciones de cobro antes de confiar en ellas',
    description:
      'Registra las direcciones cripto y el QR de pago que publica tu negocio, demuestra que son tuyos — sin conectar la billetera — y luego comprueba cualquier letrero o factura contra ellas antes de fiarte. Gratis para empezar: 2 direcciones y 1 QR. La supervisión automática y las alertas de sustitución llegan pronto.',
  },
  jsonld: {
    description:
      'Registra los destinos de pago que publica tu negocio, demuestra que los controlas y verifica cualquier dirección o QR publicado a demanda antes de confiar en él. Sin conexión de billetera, sin custodia. La supervisión automática y las alertas llegan pronto.',
    featureList: [
      'Registrar direcciones de recepción de cripto',
      'Registrar un QR de pago',
      'Demostrar la propiedad sin conectar la billetera',
      'Verificar los destinos publicados a demanda',
      'Supervisión automática y alertas por correo (próximamente)',
      'Sin custodia — nunca se mueven los fondos',
    ],
  },
  nav: {
    brandAria: 'Inicio de Almstins',
    tagline: 'Verifica las direcciones donde te pagan tus clientes',
    login: 'Iniciar sesión',
  },
  hero: {
    eyebrow: 'Acceso anticipado · Gratis para empezar',
    title: 'La dirección donde te pagan tus clientes podría ser sustituida. Ahora puedes comprobarla antes de confiar.',
    sub: 'Registra tus direcciones de recepción y tu QR de pago, demuestra que son tuyos — sin conectar la billetera, nunca — y luego verifica cualquier letrero, factura o pantalla de pago contra ellas antes de fiarte. Gratis para empezar: 2 direcciones y 1 QR.',
    ctaPrimary: 'Crea tu cuenta gratis',
    ctaSecondary: 'Cómo funciona ↓',
    ctaDemo: 'Prueba la demo para comercios →',
  },
  problem: {
    heading: 'El problema',
    body: [
      'Publicas una dirección de recepción — un QR junto a la caja, una billetera en una factura, un enlace en el pago. Un atacante la reemplaza silenciosamente por la suya. La calcomanía sigue pareciendo correcta. El cliente igual paga. El dinero simplemente va a otra parte — y te enteras cuando alguien dice que pagó y tú nunca lo recibiste.',
      'En la cadena no hay contracargo ni a quién llamar. La primera defensa es simple: comprueba tú mismo tu dirección publicada antes de confiar en ella — y antes de que un cliente pague.',
    ],
  },
  how: {
    heading: 'Cómo funciona',
    steps: [
      {
        title: 'Regístralas',
        body: 'Agrega las direcciones de recepción y el QR de pago que tus clientes realmente usan.',
      },
      {
        title: 'Demuestra que son tuyas',
        body: 'Para una dirección de billetera, envíate un pequeño monto o aloja un pequeño archivo en tu sitio — nunca conectas la billetera ni firmas nada. Para un enlace de pago (como Stripe), registrarlo en tu cuenta es la prueba. Sin claves. Nunca.',
      },
      {
        title: 'Verifica antes de confiar',
        body: 'Antes de fiarte de un QR o una dirección publicados, escanéalos o pégalos y te diremos al instante si siguen coincidiendo con lo que registraste. La supervisión automática y las alertas de sustitución están en camino.',
      },
    ],
  },
  free: {
    heading: 'Lo que obtienes, gratis',
    items: [
      'Registra y verifica 2 direcciones de recepción',
      'Registra y verifica 1 QR de pago',
      'Supervisión automática y alertas por correo (próximamente)',
      'Sin conectar la billetera, nunca — leemos datos públicos que tú nos indicas',
      'Tus datos siguen siendo tuyos — no podemos ver a tus clientes, y no podemos mover tus fondos',
    ],
    note: 'Los precios llegan pronto — por ahora todo es gratis mientras lo probamos con las personas que lo usarán.',
  },
  trust: {
    heading: 'Por qué puedes confiar',
    points: [
      {
        title: 'Nunca nos conectamos a tu billetera.',
        body: 'La verificación es una firma única o un archivo en tu sitio — tú conservas tus claves.',
      },
      {
        title: 'Nunca tocamos tus fondos.',
        body: 'Almstins no puede mover ni una moneda. Aquí no hay nada que robar.',
      },
      {
        title: 'No podemos ver a tus clientes.',
        body: 'Compruebas tus propias direcciones publicadas — nunca a las personas que les pagan. Sin rastreo, por diseño.',
      },
    ],
  },
  early: {
    heading: 'Temprano y honesto',
    body: 'Esto es temprano. Es gratis mientras aprendemos lo que los comercios realmente necesitan. Si aceptas cripto — en cualquier parte del mundo — pruébalo y luego dinos qué lo haría genuinamente útil. Lo estamos construyendo contigo, no a costa tuya.',
  },
  finalCta: {
    heading: 'Comprueba antes de que el dinero se mueva.',
    button: 'Crea tu cuenta gratis',
    sub: 'Registra + verifica 2 direcciones + 1 QR. Sin tarjeta, sin conexión de billetera.',
    footerAria: 'Inicio de Almstins',
  },
  vendors: {
    heading: 'Comercios verificados',
    intro: 'Cualquier negocio que acepte cripto puede verificar las direcciones que publica — para que los clientes confíen en que una dirección es realmente tuya antes de enviar.',
    howToLabel: 'Cómo verificarte',
    steps: [
      'Crea una cuenta gratis y añade las direcciones de cobro y el QR de pago que publicas.',
      'Demuestra que son tuyas — una firma rápida o un pequeño archivo en tu sitio. Sin conectar la wallet, sin claves, nunca.',
      'Verifícalas a demanda antes de fiarte — escanea un letrero y confirmamos que sigue coincidiendo. La supervisión automática llega pronto.',
    ],
    scaleLabel: '¿Publicas muchas direcciones?',
    scaleBody: 'Los exchanges y las plataformas grandes pueden verificarlo todo desde su propio dominio a la vez: verifica tu dominio, luego aloja un endpoint de solo lectura y emítenos una clave de API. Extraemos tu lista para que pueda verificarse — sin añadir direcciones una por una. La supervisión en vivo está en camino.',
    contractLabel: 'Tu endpoint devuelve:',
    earlyNote: 'Acceso anticipado. Cualquier clave que nos des solo lee una lista que ya publicas — nunca puede mover fondos ni ver nada privado. Para configurarlo, escribe a <a href="mailto:donnie@titaniumhut.com">donnie@titaniumhut.com</a>.',
  },
};

const fr: VerifyCopy = {
  meta: {
    tagline: 'Vérifiez vos adresses de réception crypto avant de leur faire confiance',
    description:
      'Enregistrez les adresses crypto et le QR de paiement que votre entreprise publie, prouvez qu\'ils sont à vous — sans connexion de portefeuille — puis vérifiez n\'importe quelle pancarte ou facture par rapport à elles avant de vous y fier. Gratuit pour commencer : 2 adresses et 1 QR. La surveillance automatique et les alertes de remplacement arrivent bientôt.',
  },
  jsonld: {
    description:
      'Enregistrez les destinations de paiement que votre entreprise publie, prouvez que vous les contrôlez et vérifiez n\'importe quelle adresse ou QR publié à la demande avant de vous y fier. Sans connexion de portefeuille, sans garde des fonds. La surveillance automatique et les alertes arrivent bientôt.',
    featureList: [
      'Enregistrer des adresses de réception crypto',
      'Enregistrer un QR de paiement',
      'Prouver la propriété sans connexion de portefeuille',
      'Vérifier les destinations publiées à la demande',
      'Surveillance automatique et alertes par e-mail (bientôt)',
      'Sans garde — les fonds ne sont jamais déplacés',
    ],
  },
  nav: {
    brandAria: 'Accueil Almstins',
    tagline: 'Vérifiez les adresses où vos clients vous paient',
    login: 'Se connecter',
  },
  hero: {
    eyebrow: 'Accès anticipé · Gratuit pour commencer',
    title: "L'adresse où vos clients vous paient pourrait être remplacée. Vous pouvez désormais la vérifier avant de vous y fier.",
    sub: "Enregistrez vos adresses de réception et votre QR de paiement, prouvez qu'ils sont à vous — sans jamais connecter de portefeuille — puis vérifiez n'importe quelle pancarte, facture ou page de paiement par rapport à elles avant de vous y fier. Gratuit pour commencer : 2 adresses et 1 QR.",
    ctaPrimary: 'Créez votre compte gratuit',
    ctaSecondary: 'Comment ça marche ↓',
    ctaDemo: 'Essayer la démo commerçant →',
  },
  problem: {
    heading: 'Le problème',
    body: [
      "Vous publiez une adresse de réception — un QR près de la caisse, un portefeuille sur une facture, un lien au moment du paiement. Un attaquant la remplace discrètement par la sienne. L'autocollant semble toujours correct. Le client paie quand même. L'argent part simplement ailleurs — et vous l'apprenez quand quelqu'un dit avoir payé alors que vous n'avez jamais rien reçu.",
      "Sur la chaîne, il n'y a ni rétrofacturation ni personne à appeler. La première défense est simple : vérifiez vous-même votre adresse publiée avant de vous y fier — et avant qu'un client ne la paie.",
    ],
  },
  how: {
    heading: 'Comment ça marche',
    steps: [
      {
        title: 'Enregistrez',
        body: 'Ajoutez les adresses de réception et le QR de paiement que vos clients utilisent réellement.',
      },
      {
        title: "Prouvez qu'ils sont à vous",
        body: 'Pour une adresse de portefeuille, envoyez-vous un petit montant ou hébergez un petit fichier sur votre site — jamais de connexion de portefeuille, jamais de signature. Pour un lien de paiement (comme Stripe), l’enregistrer dans votre compte est la preuve. Sans clés. Jamais.',
      },
      {
        title: 'Vérifiez avant de faire confiance',
        body: "Avant de vous fier à un QR ou une adresse publiés, scannez-les ou collez-les et nous vous dirons instantanément s'ils correspondent toujours à ce que vous avez enregistré. La surveillance automatique et les alertes de remplacement arrivent bientôt.",
      },
    ],
  },
  free: {
    heading: 'Ce que vous obtenez, gratuitement',
    items: [
      'Enregistrez et vérifiez 2 adresses de réception',
      'Enregistrez et vérifiez 1 QR de paiement',
      'Surveillance automatique et alertes par e-mail (bientôt)',
      'Sans connexion de portefeuille, jamais — nous lisons les données publiques que vous nous indiquez',
      'Vos données restent les vôtres — nous ne voyons pas vos clients, et nous ne pouvons pas déplacer vos fonds',
    ],
    note: "Les tarifs arrivent bientôt — pour l'instant tout est gratuit pendant que nous le testons avec celles et ceux qui l'utiliseront.",
  },
  trust: {
    heading: 'Pourquoi vous pouvez avoir confiance',
    points: [
      {
        title: 'Nous ne nous connectons jamais à votre portefeuille.',
        body: 'La vérification est une signature unique ou un fichier sur votre site — vous gardez vos clés.',
      },
      {
        title: 'Nous ne touchons jamais à vos fonds.',
        body: "Almstins ne peut pas déplacer la moindre pièce. Il n'y a rien à voler ici.",
      },
      {
        title: 'Nous ne pouvons pas voir vos clients.',
        body: 'Vous vérifiez vos propres adresses publiées — jamais les personnes qui les paient. Aucun pistage, par conception.',
      },
    ],
  },
  early: {
    heading: 'Tôt et honnête',
    body: "C'est un début. C'est gratuit pendant que nous apprenons ce dont les commerçants ont réellement besoin. Si vous acceptez la crypto — partout dans le monde — essayez, puis dites-nous ce qui le rendrait vraiment utile. Nous le construisons avec vous, pas à vos dépens.",
  },
  finalCta: {
    heading: 'Vérifiez avant que l\'argent ne bouge.',
    button: 'Créez votre compte gratuit',
    sub: 'Enregistrez + vérifiez 2 adresses + 1 QR. Sans carte, sans connexion de portefeuille.',
    footerAria: 'Accueil Almstins',
  },
  vendors: {
    heading: 'Commerçants vérifiés',
    intro: 'Toute entreprise qui accepte la crypto peut vérifier les adresses qu’elle publie — pour que les clients sachent qu’une adresse est bien la vôtre avant d’envoyer.',
    howToLabel: 'Comment se faire vérifier',
    steps: [
      'Créez un compte gratuit et ajoutez les adresses de réception et le QR de paiement que vous publiez.',
      'Prouvez qu’elles sont à vous — une signature rapide ou un petit fichier sur votre site. Sans connexion de wallet, sans clés, jamais.',
      'Vérifiez-les à la demande avant de vous y fier — scannez une pancarte et nous confirmons qu’elle correspond toujours. La surveillance automatique arrive bientôt.',
    ],
    scaleLabel: 'Vous publiez de nombreuses adresses ?',
    scaleBody: 'Les exchanges et les grandes plateformes peuvent tout vérifier depuis leur propre domaine d’un coup : prouvez votre domaine, puis hébergez un endpoint en lecture seule et émettez-nous une clé API. Nous récupérons votre liste pour qu’elle puisse être vérifiée — sans ajouter les adresses une par une. La surveillance en direct arrive bientôt.',
    contractLabel: 'Votre endpoint renvoie :',
    earlyNote: 'Accès anticipé. Toute clé que vous nous donnez lit seulement une liste que vous publiez déjà — elle ne peut jamais déplacer de fonds ni voir quoi que ce soit de privé. Pour la mise en place, écrivez à <a href="mailto:donnie@titaniumhut.com">donnie@titaniumhut.com</a>.',
  },
};

export const copy: Record<Lang, VerifyCopy> = { en, es, fr };
