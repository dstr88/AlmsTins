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
  nav: { brandAria: string; tagline: string };
  hero: {
    eyebrow: string;
    title: string;
    sub: string;
  };
  /**
   * "See what a payer sees": the field near the top of the page
   * (src/components/verify/VerifyCheckFirst.tsx, Verify first run Part D). A business owner pastes
   * the address they ask people to pay and gets the public scanner's own answer; the result
   * cards and their words are the scanner's (src/i18n/verifyScan.ts), not repeated here.
   *
   * Rules for this copy: no em dashes; Almstins warns and flags, and never says it stops,
   * blocks or protects anything; an address nobody has proven is only unproven, so nothing here
   * calls it anything worse. `unproven` and `proveHow` come per noun (address / payment link /
   * payment code) because es/fr agree in gender with it, as in verifyScan.ts.
   */
  checkFirst: {
    title: string;
    /** The field's label, for a screen reader. */
    fieldLabel: string;
    placeholder: string;
    button: string;
    checking: string;
    hint: string;
    /** Above the scanner's result cards. */
    resultLabel: string;
    /** es/fr: the scan page itself still shows this result in English. Empty in English. */
    scannerLangNote: string;
    /** The lookup gave no answer (not a complete address, too many requests, a failed request). */
    couldNotCheck: string;
    /** Nobody has proven the value: the line above the one action. */
    unproven: Record<'address' | 'link' | 'code', string>;
    proveCta: string;
    /** What proving takes and what a payer then sees. {claimed}, {verified} and {notVerified}
     *  are the scanner's own result titles. */
    proveHow: Record<'address' | 'link' | 'code', string>;
    /** {addresses} and {qr} are the Free plan's limits (src/lib/verifyPlans.ts). */
    freePlan: string;
    /** Shown when the safety screen flagged the value. */
    proveFlagged: string;
    /** Where the checked value goes if the visitor presses the action (src/lib/carriedDestination.ts). */
    carryNote: string;
  };
  /**
   * "The tools": the three priced levels (in order: proven wallet, domain-verified,
   * agents), the free customer scan, and the login invitation. Hrefs are
   * language-neutral and live in VerifyPage.astro, matched by position.
   */
  tools: {
    heading: string;
    lede: string;
    levels: Array<{ persona: string; title: string; body: string; price: string; cta: string }>;
    agentKeyLine: string;
    agentSigninBtn: string;
    bannerLabels: [string, string, string];
    agentDemo: { button: string };
    storeDemo: { placeholder: string; button: string; checking: string; result: string; hint: string };
    dnsDemo: { watchLabel: string; label: string; hint: string };
    scan: { badge: string; title: string; body: string; cta: string };
    login: { heading: string; body: string; button: string };
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
  faq: { heading: string; items: { q: string; a: string }[] };
}

const en: VerifyCopy = {
  meta: {
    tagline: 'Verify your crypto receiving addresses before you trust them',
    description:
      'Register the crypto addresses and payment QR your business publishes, prove they are yours (no wallet connection), then check any sign or invoice against them before you rely on it. Free, always: 2 wallets and 1 QR. Almstins re-checks your domain proof, and any page you ask it to watch, every six hours and emails you if something changes.',
  },
  jsonld: {
    description:
      'Register the payment destinations your business publishes, prove you control them, and verify any published address or QR on demand before you trust it. No wallet connection, no custody. Almstins re-checks your domain proof, and any page you ask it to watch, every six hours and emails you if something changes.',
    featureList: [
      'Register crypto receiving addresses',
      'Register a payment QR',
      'Prove ownership without a wallet connection',
      'Verify published destinations on demand',
      'Ongoing checks of what you publish, with email alerts',
      'No custody — funds are never moved',
      'See what a payer sees for your own address before you sign up',
    ],
  },
  nav: {
    brandAria: 'Almstins home',
    tagline: 'Verify the addresses your customers pay',
  },
  hero: {
    eyebrow: 'Free plan · No wallet connection',
    title: 'The address your customers pay could be swapped. Now you can check it before you trust it.',
    sub: "Register your receiving addresses and payment QR, prove they're yours (no wallet connection, ever), then verify any sign, invoice, or checkout against them before you rely on it. Free, always: 2 wallets and 1 QR.",
  },
  checkFirst: {
    title: 'Paste the address you ask people to pay. See what a payer sees today.',
    fieldLabel: 'The wallet address or payment link you ask people to pay',
    placeholder: 'Wallet address or payment link',
    button: 'Check',
    checking: 'Checking…',
    hint: 'Free, with no account. This is the same check the public scanner runs for anyone who is about to pay you.',
    resultLabel: 'What a payer sees today',
    scannerLangNote: '',
    couldNotCheck: 'Almstins could not check this. Make sure it is a complete wallet address or payment link, then try again.',
    unproven: {
      address: 'Nobody has proven this address with Almstins yet. If it is yours, you can change what a payer sees.',
      link: 'Nobody has proven this link with Almstins yet. If it is yours, you can change what a payer sees.',
      code: 'Nobody has proven this payment code with Almstins yet. If it is yours, you can change what a payer sees.',
    },
    proveCta: 'Prove it’s yours, free',
    proveHow: {
      address: 'After you sign in, you claim it with the satoshi test (a self-send): you pay only the normal network fee, with no wallet connection and no signature. A payer then sees “{claimed}”. List it in a small file on your own website and a payer sees “{verified}”, with your domain beside it.',
      link: 'After you sign in, you register it. A payment link has no test of its own: a payer keeps seeing “{notVerified}” until your account has proven a website domain, and today that proof starts from a wallet address.',
      code: 'After you sign in, you register it. A payment code has no test of its own: a payer keeps seeing “{notVerified}” until your account has proven a website domain, and today that proof starts from a wallet address.',
    },
    freePlan: 'The Free plan holds {addresses} wallet addresses and {qr} payment QR or link.',
    proveFlagged: 'Proving it is yours does not remove the warning above.',
    carryNote: 'If you continue, your browser keeps what you checked, in this tab only, so it is already filled in on your first screen after you sign in. It is not put in a link, and nothing is saved to an account until you register it.',
  },
  tools: {
    heading: 'The tools',
    lede: "Three ways to prove what you publish, or check what someone else did — whether you're proving your own wallet, listing several, or building something that pays.",
    levels: [
      {
        persona: 'For anyone building something that pays',
        title: 'Agents',
        body: 'One GET returns a status and a level before your agent sends a payment. Proceed only when the answer is proven and verified — anything else means hold and confirm out of band.',
        price: 'Free',
        cta: 'Read the agent docs',
      },
      {
        persona: 'For store owners accepting crypto',
        title: 'Proven wallet',
        body: 'Prove a receiving address is yours by sending yourself a tiny amount. No wallet connection, no signing, no keys. Payment QRs and payment links register the same way.',
        price: 'Free: 2 wallets + 1 QR',
        cta: 'Log in to get started',
      },
      {
        persona: 'For businesses with one or two receiving addresses',
        title: 'Domain-verified',
        body: 'Prove your domain with a DNS record or a small file on your site, then list your addresses there. A swapped address on a fake page fails the check. More than a couple of addresses? Publish an encrypted roster instead.',
        price: 'Free, or Business and Pro by email',
        cta: 'Log in to get started',
      },
    ],
    agentKeyLine: 'Already building? Mint your own key with one DNS record for 300 checks a minute.',
    agentSigninBtn: 'Log in to get started',
    bannerLabels: ['Agent', 'Store owner', 'Small business'],
    agentDemo: { button: 'Watch a demo' },
    storeDemo: {
      placeholder: 'Paste any wallet address',
      button: 'Watch a demo',
      checking: 'Checking…',
      result: '✓ Proven — this is how your own wallet will look once you claim it.',
      hint: 'A preview, not a real check yet.',
    },
    dnsDemo: {
      watchLabel: 'Watch a demo',
      label: 'What you publish, one line:',
      hint: 'No file to host, nothing to encrypt.',
    },
    scan: {
      badge: 'Free · no login',
      title: 'Scan before you pay',
      body: 'Paste an address or payment link, or scan a payment QR, to see whether its owner proved it. Addresses and links are also screened for known scams. Free for the people who pay, always.',
      cta: 'Open the scanner',
    },
    login: {
      heading: 'One login for all three',
      body: 'New here? Google, GitHub, or an email link creates your free account. No card, no wallet connection.',
      button: 'Log in to get started',
    },
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
        body: "Before you rely on a published QR or address, scan or paste it and we'll tell you instantly whether it still matches what you registered. Almstins re-checks your domain proof, and any page you ask it to watch, every six hours and emails you if something changes.",
      },
    ],
  },
  free: {
    heading: 'What you get, free',
    items: [
      'Register and verify 2 receiving addresses',
      'Register and verify 1 payment QR',
      'Ongoing checks of what you publish, with email alerts',
      'No wallet connection, ever — we read public data you point us to',
      "Your data stays yours — we never learn who your customers are, and we can't move your funds",
    ],
    note: 'The Free plan stays free. The Business and Pro plans hold more destinations: ask by email at support@almstins.com.',
  },
  trust: {
    heading: 'Why you can trust it',
    points: [
      {
        title: 'We never connect to your wallet.',
        body: 'Verification is a tiny send to yourself or a file on your site — you keep your keys.',
      },
      {
        title: 'We never touch your funds.',
        body: "Almstins can't move a coin. There's nothing to steal here.",
      },
      {
        title: 'We never learn who your customers are.',
        body: "You check your own published addresses, never the people who pay them, and we never link a check to anyone's identity. To count checks, we keep one-way hashes of the address or site checked and of the checker's IP address, plus their country. These pages also use Google Analytics.",
      },
    ],
  },
  early: {
    heading: 'Early & honest',
    body: "This is early, and we're still learning what merchants actually need. The Free plan stays free. If you take crypto, anywhere in the world, try it, then tell us what would make it genuinely useful. We're building this with you, not at you.",
  },
  finalCta: {
    heading: 'Check before money moves.',
    button: 'Log in to get started',
    sub: 'Register + verify 2 wallets + 1 QR. No card, no wallet connection.',
    footerAria: 'Almstins home',
  },
  vendors: {
    heading: 'Verified vendors',
    intro: 'Any business that takes crypto can verify the addresses it publishes — so customers can trust an address is really yours before they send.',
    howToLabel: 'How to get verified',
    steps: [
      'Create a free account and add the receiving addresses and payment QR you publish.',
      "Prove they're yours — for a wallet, send yourself a tiny amount or host a small file on your site; a payment QR is proven when you register it. No wallet connection, no keys, ever.",
      'Verify them on demand before you rely on them: scan a sign and we confirm it still matches. Almstins re-checks your domain proof, and any page you ask it to watch, every six hours and emails you if something changes.',
    ],
    scaleLabel: 'Publishing many addresses?',
    scaleBody: 'Exchanges and large platforms can verify everything from their own domain at once (by approval during early access): prove your domain, then host a read-only endpoint and issue us an API key. We pull your list so it can be verified — no adding addresses one by one. Live monitoring is on the way.',
    contractLabel: 'Your endpoint returns:',
    earlyNote: 'Early access. Any key you give us only reads a list you already publish — it can never move funds or see anything private. To request access, email <a href="mailto:support@almstins.com">support@almstins.com</a>.',
  },
  faq: {
    heading: 'FAQ',
    items: [
      { q: 'Which of the three tools is right for me?', a: "If you're building something that sends payments automatically, start with Agents. If you take crypto in one or two wallets and want to prove they're really yours, use Proven wallet. If you have several receiving addresses to prove at once, or you'd rather publish through your own domain, use Domain-verified." },
      { q: 'Is this actually free?', a: 'Yes. The Free plan is always free: 2 wallets and 1 payment QR. The Business and Pro plans hold more destinations; ask by email at support@almstins.com.' },
      { q: 'Do I have to connect my wallet?', a: 'No, never. Proving a wallet is yours means sending yourself a tiny amount or hosting a small file on your own site — not connecting a wallet or signing anything. Verification never asks for signing permission and can’t move a coin.' },
      { q: 'What’s the difference between the tools above and "Scan before you pay"?', a: 'The three tools above are for publishers — proving that an address, QR, or domain you control is really yours. "Scan before you pay" is the free side for the other direction: checking an address, link, or QR someone else gave you, before you send them money. No login needed for that one.' },
      { q: 'What does the box at the top of this page check?', a: 'It runs the same free check as "Scan before you pay", on the address or payment link you ask people to pay, so you see what a payer sees today. No login needed. If nobody has proven it with Almstins, you can sign in and prove it is yours. Your browser then keeps what you checked, in that tab only, so it is already filled in on your first screen after you sign in. It is not put in a link, and nothing is saved to an account until you register it.' },
      { q: 'Can Almstins see who my customers are?', a: 'No. You check your own published addresses, never the people who pay them, and nothing here links an address or a check to a customer’s identity. When anyone runs a check, we keep one-way hashes of the address or site checked and of their IP address, plus their country, so we can count checks. Like the rest of the site, these pages use Google Analytics.' },
      { q: 'What does "verified" actually mean here?', a: 'It means you proved control of that specific address, file, or DNS record — by a tiny self-send, or by publishing something only you could publish — not that Almstins is vouching for your business. It’s your own provable record, checkable by anyone you hand it to.' },
      { q: 'Can I change my addresses later?', a: 'Yes — add, prove, or remove addresses any time from your dashboard. A check always reflects what you have registered right now, not a cached list.' },
      { q: 'I run an exchange or a large platform — is there a bulk option?', a: 'Yes — see Verified vendors below for the API-based path exchanges and platforms use to publish many addresses at once.' },
    ],
  },
};

const es: VerifyCopy = {
  meta: {
    tagline: 'Verifica tus direcciones de cobro antes de confiar en ellas',
    description:
      'Registra las direcciones cripto y el QR de pago que publica tu negocio, demuestra que son tuyos (sin conectar la billetera) y luego comprueba cualquier letrero o factura contra ellas antes de fiarte. Gratis, siempre: 2 direcciones y 1 QR. Almstins vuelve a comprobar tu prueba de dominio, y cualquier página que le pidas vigilar, cada seis horas y te avisa por correo si algo cambia.',
  },
  jsonld: {
    description:
      'Registra los destinos de pago que publica tu negocio, demuestra que los controlas y verifica cualquier dirección o QR publicado a demanda antes de confiar en él. Sin conexión de billetera, sin custodia. Almstins vuelve a comprobar tu prueba de dominio, y cualquier página que le pidas vigilar, cada seis horas y te avisa por correo si algo cambia.',
    featureList: [
      'Registrar direcciones de recepción de cripto',
      'Registrar un QR de pago',
      'Demostrar la propiedad sin conectar la billetera',
      'Verificar los destinos publicados a demanda',
      'Comprobaciones continuas de lo que publicas, con alertas por correo',
      'Sin custodia — nunca se mueven los fondos',
      'Mira lo que ve quien paga con tu propia dirección antes de registrarte',
    ],
  },
  nav: {
    brandAria: 'Inicio de Almstins',
    tagline: 'Verifica las direcciones donde te pagan tus clientes',
  },
  hero: {
    eyebrow: 'Plan gratis · Sin conectar billetera',
    title: 'La dirección donde te pagan tus clientes podría ser sustituida. Ahora puedes comprobarla antes de confiar.',
    sub: 'Registra tus direcciones de recepción y tu QR de pago, demuestra que son tuyos (sin conectar nunca la billetera) y luego verifica cualquier letrero, factura o pantalla de pago contra ellas antes de fiarte. Gratis, siempre: 2 direcciones y 1 QR.',
  },
  checkFirst: {
    title: 'Pega la dirección a la que pides que te paguen. Mira lo que ve hoy quien paga.',
    fieldLabel: 'La dirección de billetera o el enlace de pago al que pides que te paguen',
    placeholder: 'Dirección de billetera o enlace de pago',
    button: 'Comprobar',
    checking: 'Comprobando…',
    hint: 'Gratis y sin cuenta. Es la misma comprobación que hace el escáner público para cualquiera que esté por pagarte.',
    resultLabel: 'Lo que ve hoy quien paga',
    scannerLangNote: 'Por ahora, el escáner público muestra este mismo resultado en inglés.',
    couldNotCheck: 'Almstins no pudo comprobar esto. Revisa que sea una dirección de billetera o un enlace de pago completo e inténtalo de nuevo.',
    unproven: {
      address: 'Nadie ha demostrado esta dirección con Almstins todavía. Si es tuya, puedes cambiar lo que ve quien paga.',
      link: 'Nadie ha demostrado este enlace con Almstins todavía. Si es tuyo, puedes cambiar lo que ve quien paga.',
      code: 'Nadie ha demostrado este código de pago con Almstins todavía. Si es tuyo, puedes cambiar lo que ve quien paga.',
    },
    proveCta: 'Demuestra que te pertenece, gratis',
    proveHow: {
      address: 'Después de iniciar sesión, la reclamas con la prueba del satoshi (un autoenvío): solo pagas la comisión normal de la red, sin conectar la billetera y sin firmar nada. Quien paga ve entonces «{claimed}». Inclúyela en un archivo pequeño de tu propio sitio web y quien paga ve «{verified}», con tu dominio al lado.',
      link: 'Después de iniciar sesión, lo registras. Un enlace de pago no tiene una prueba propia: quien paga sigue viendo «{notVerified}» hasta que tu cuenta haya demostrado un dominio web, y hoy esa prueba empieza con una dirección de billetera.',
      code: 'Después de iniciar sesión, lo registras. Un código de pago no tiene una prueba propia: quien paga sigue viendo «{notVerified}» hasta que tu cuenta haya demostrado un dominio web, y hoy esa prueba empieza con una dirección de billetera.',
    },
    freePlan: 'El plan gratuito incluye {addresses} direcciones de billetera y {qr} QR o enlace de pago.',
    proveFlagged: 'Demostrar que te pertenece no quita la advertencia de arriba.',
    carryNote: 'Si continúas, tu navegador conserva lo que comprobaste, solo en esta pestaña, para que ya esté escrito en tu primera pantalla después de iniciar sesión. No se pone en ningún enlace, y nada queda en una cuenta hasta que lo registres.',
  },
  tools: {
    heading: 'Las herramientas',
    lede: 'Tres formas de probar lo que publicas, o de comprobar lo que publicó otra persona — ya sea que estés probando tu propia billetera, listando varias, o construyendo algo que paga.',
    levels: [
      {
        persona: 'Para quienes construyen algo que paga',
        title: 'Agentes',
        body: 'Una sola petición GET devuelve un estado y un nivel antes de que tu agente envíe un pago. Sigue adelante solo si la respuesta es proven y verified — cualquier otra cosa significa retener y confirmar por otro canal.',
        price: 'Gratis',
        cta: 'Lee la documentación para agentes (en inglés)',
      },
      {
        persona: 'Para comercios que aceptan cripto',
        title: 'Billetera probada',
        body: 'Demuestra que una dirección de recepción es tuya enviándote un pequeño monto. Sin conectar la billetera, sin firmar, sin claves. Los QR de pago y los enlaces de pago se registran igual.',
        price: 'Gratis: 2 direcciones + 1 QR',
        cta: 'Inicia sesión para empezar',
      },
      {
        persona: 'Para negocios con una o dos direcciones de recepción',
        title: 'Dominio verificado',
        body: 'Demuestra tu dominio con un registro DNS o un pequeño archivo en tu sitio, y luego incluye tus direcciones ahí. Una dirección sustituida en una página falsa no pasa la comprobación. ¿Más de un par de direcciones? Publica una lista cifrada en su lugar.',
        price: 'Gratis, o Business y Pro por email',
        cta: 'Inicia sesión para empezar',
      },
    ],
    agentKeyLine: '¿Ya estás construyendo? Genera tu propia clave con un registro DNS para 300 consultas por minuto.',
    agentSigninBtn: 'Inicia sesión para empezar',
    bannerLabels: ['Agente', 'Comercio', 'Negocio pequeño'],
    agentDemo: { button: 'Ver una demo' },
    storeDemo: {
      placeholder: 'Pega cualquier dirección de billetera',
      button: 'Ver una demo',
      checking: 'Comprobando…',
      result: '✓ Probada — así se verá tu propia billetera una vez que la reclames.',
      hint: 'Una vista previa, aún no una comprobación real.',
    },
    dnsDemo: {
      watchLabel: 'Ver una demo',
      label: 'Lo que publicas, en una línea:',
      hint: 'Sin archivo que alojar, nada que cifrar.',
    },
    scan: {
      badge: 'Gratis · sin cuenta',
      title: 'Escanea antes de pagar',
      body: 'Pega una dirección o un enlace de pago, o escanea un QR de pago, para ver si su dueño lo demostró. Las direcciones y los enlaces también se revisan contra estafas conocidas. Gratis para quienes pagan, siempre.',
      cta: 'Abrir el escáner (en inglés)',
    },
    login: {
      heading: 'Un solo inicio de sesión para los tres',
      body: '¿Eres nuevo? Google, GitHub o un enlace por email crean tu cuenta gratuita. Sin tarjeta, sin conectar la billetera.',
      button: 'Inicia sesión para empezar',
    },
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
        body: 'Antes de fiarte de un QR o una dirección publicados, escanéalos o pégalos y te diremos al instante si siguen coincidiendo con lo que registraste. Almstins vuelve a comprobar tu prueba de dominio, y cualquier página que le pidas vigilar, cada seis horas y te avisa por correo si algo cambia.',
      },
    ],
  },
  free: {
    heading: 'Lo que obtienes, gratis',
    items: [
      'Registra y verifica 2 direcciones de recepción',
      'Registra y verifica 1 QR de pago',
      'Comprobaciones continuas de lo que publicas, con alertas por correo',
      'Sin conectar la billetera, nunca — leemos datos públicos que tú nos indicas',
      'Tus datos siguen siendo tuyos — nunca sabemos quiénes son tus clientes, y no podemos mover tus fondos',
    ],
    note: 'El plan gratuito sigue siendo gratis. Los planes Business y Pro admiten más destinos: pídelos por email a support@almstins.com.',
  },
  trust: {
    heading: 'Por qué puedes confiar',
    points: [
      {
        title: 'Nunca nos conectamos a tu billetera.',
        body: 'La verificación es un pequeño envío a ti mismo o un archivo en tu sitio — tú conservas tus claves.',
      },
      {
        title: 'Nunca tocamos tus fondos.',
        body: 'Almstins no puede mover ni una moneda. Aquí no hay nada que robar.',
      },
      {
        title: 'Nunca sabemos quiénes son tus clientes.',
        body: 'Compruebas tus propias direcciones publicadas, nunca a las personas que les pagan, y nunca vinculamos una comprobación con la identidad de nadie. Para contar las comprobaciones, guardamos hashes unidireccionales de la dirección o el sitio comprobado y de la dirección IP de quien comprueba, más su país. Estas páginas también usan Google Analytics.',
      },
    ],
  },
  early: {
    heading: 'Temprano y honesto',
    body: 'Esto es temprano y seguimos aprendiendo lo que los comercios realmente necesitan. El plan gratis sigue siendo gratis. Si aceptas cripto, en cualquier parte del mundo, pruébalo y luego dinos qué lo haría genuinamente útil. Lo estamos construyendo contigo, no a costa tuya.',
  },
  finalCta: {
    heading: 'Comprueba antes de que el dinero se mueva.',
    button: 'Inicia sesión para empezar',
    sub: 'Registra + verifica 2 direcciones + 1 QR. Sin tarjeta, sin conexión de billetera.',
    footerAria: 'Inicio de Almstins',
  },
  vendors: {
    heading: 'Comercios verificados',
    intro: 'Cualquier negocio que acepte cripto puede verificar las direcciones que publica — para que los clientes confíen en que una dirección es realmente tuya antes de enviar.',
    howToLabel: 'Cómo verificarte',
    steps: [
      'Crea una cuenta gratis y añade las direcciones de cobro y el QR de pago que publicas.',
      'Demuestra que son tuyas — para una billetera, envíate un pequeño monto o aloja un pequeño archivo en tu sitio; un QR de pago queda demostrado al registrarlo. Sin conectar la wallet, sin claves, nunca.',
      'Verifícalas a demanda antes de fiarte: escanea un letrero y confirmamos que sigue coincidiendo. Almstins vuelve a comprobar tu prueba de dominio, y cualquier página que le pidas vigilar, cada seis horas y te avisa por correo si algo cambia.',
    ],
    scaleLabel: '¿Publicas muchas direcciones?',
    scaleBody: 'Los exchanges y las plataformas grandes pueden verificarlo todo desde su propio dominio a la vez (con aprobación durante el acceso anticipado): verifica tu dominio, luego aloja un endpoint de solo lectura y emítenos una clave de API. Extraemos tu lista para que pueda verificarse — sin añadir direcciones una por una. La supervisión en vivo está en camino.',
    contractLabel: 'Tu endpoint devuelve:',
    earlyNote: 'Acceso anticipado. Cualquier clave que nos des solo lee una lista que ya publicas — nunca puede mover fondos ni ver nada privado. Para solicitar acceso, escribe a <a href="mailto:support@almstins.com">support@almstins.com</a>.',
  },
  faq: {
    heading: 'Preguntas frecuentes',
    items: [
      { q: '¿Cuál de las tres herramientas es para mí?', a: '¿Estás construyendo algo que envía pagos automáticamente? Empieza con Agentes. ¿Recibes cripto en una o dos billeteras y quieres demostrar que son realmente tuyas? Usa Billetera probada. ¿Tienes varias direcciones de cobro que probar a la vez, o prefieres publicar a través de tu propio dominio? Usa Dominio verificado.' },
      { q: '¿Esto es realmente gratis?', a: 'Sí. El plan gratuito es siempre gratis: 2 billeteras y 1 QR de pago. Los planes Business y Pro admiten más destinos; pídelos por email a support@almstins.com.' },
      { q: '¿Tengo que conectar mi billetera?', a: 'No, nunca. Demostrar que una billetera es tuya significa enviarte un pequeño monto o alojar un pequeño archivo en tu propio sitio — no conectar una billetera ni firmar nada. La verificación nunca pide permiso de firma y no puede mover ni una moneda.' },
      { q: '¿Cuál es la diferencia entre las herramientas de arriba y "Escanea antes de pagar"?', a: 'Las tres herramientas de arriba son para quien publica — demostrar que una dirección, un QR o un dominio que controlas es realmente tuyo. "Escanea antes de pagar" es el lado gratuito para la otra dirección: comprobar una dirección, enlace o QR que alguien más te dio, antes de enviarle dinero. Ese no necesita cuenta.' },
      { q: '¿Qué comprueba el cuadro de la parte superior de esta página?', a: 'Hace la misma comprobación gratuita que "Escanea antes de pagar", con la dirección o el enlace de pago al que pides que te paguen, para que veas lo que ve hoy quien paga. Sin iniciar sesión. Si nadie lo ha demostrado con Almstins, puedes iniciar sesión y demostrar que te pertenece. Tu navegador conserva entonces lo que comprobaste, solo en esa pestaña, para que ya esté escrito en tu primera pantalla después de iniciar sesión. No se pone en ningún enlace, y nada queda en una cuenta hasta que lo registres.' },
      { q: '¿Puede Almstins ver quiénes son mis clientes?', a: 'No. Tú compruebas tus propias direcciones publicadas, nunca a las personas que te pagan, y nada aquí vincula una dirección o una comprobación con la identidad de un cliente. Cuando alguien hace una comprobación, guardamos hashes unidireccionales de la dirección o el sitio comprobado y de su dirección IP, más su país, para poder contar las comprobaciones. Como el resto del sitio, estas páginas usan Google Analytics.' },
      { q: '¿Qué significa realmente "verificado" aquí?', a: 'Significa que demostraste tener control sobre esa dirección, archivo o registro DNS específico — con un pequeño autoenvío, o publicando algo que solo tú podrías publicar — no que Almstins responde por tu negocio. Es tu propio registro comprobable, verificable por cualquiera a quien se lo muestres.' },
      { q: '¿Puedo cambiar mis direcciones más adelante?', a: 'Sí — agrega, prueba o quita direcciones cuando quieras desde tu panel. Una comprobación siempre refleja lo que tienes registrado en este momento, no una lista guardada.' },
      { q: 'Tengo un exchange o una plataforma grande — ¿hay una opción masiva?', a: 'Sí — mira Comercios verificados más abajo para conocer el camino basado en API que usan los exchanges y plataformas para publicar muchas direcciones a la vez.' },
    ],
  },
};

const fr: VerifyCopy = {
  meta: {
    tagline: 'Vérifiez vos adresses de réception crypto avant de leur faire confiance',
    description:
      'Enregistrez les adresses crypto et le QR de paiement que votre entreprise publie, prouvez qu\'ils sont à vous (sans connexion de portefeuille), puis vérifiez n\'importe quelle pancarte ou facture par rapport à elles avant de vous y fier. Gratuit, toujours : 2 adresses et 1 QR. Almstins revérifie votre preuve de domaine, et toute page que vous lui demandez de surveiller, toutes les six heures et vous prévient par e-mail si quelque chose change.',
  },
  jsonld: {
    description:
      'Enregistrez les destinations de paiement que votre entreprise publie, prouvez que vous les contrôlez et vérifiez n\'importe quelle adresse ou QR publié à la demande avant de vous y fier. Sans connexion de portefeuille, sans garde des fonds. Almstins revérifie votre preuve de domaine, et toute page que vous lui demandez de surveiller, toutes les six heures et vous prévient par e-mail si quelque chose change.',
    featureList: [
      'Enregistrer des adresses de réception crypto',
      'Enregistrer un QR de paiement',
      'Prouver la propriété sans connexion de portefeuille',
      'Vérifier les destinations publiées à la demande',
      'Vérifications continues de ce que vous publiez, avec alertes par e-mail',
      'Sans garde — les fonds ne sont jamais déplacés',
      'Voyez ce qu’un payeur voit pour votre propre adresse avant de vous inscrire',
    ],
  },
  nav: {
    brandAria: 'Accueil Almstins',
    tagline: 'Vérifiez les adresses où vos clients vous paient',
  },
  hero: {
    eyebrow: 'Plan gratuit · Sans connexion de portefeuille',
    title: "L'adresse où vos clients vous paient pourrait être remplacée. Vous pouvez désormais la vérifier avant de vous y fier.",
    sub: "Enregistrez vos adresses de réception et votre QR de paiement, prouvez qu'ils sont à vous, sans jamais connecter de portefeuille, puis vérifiez n'importe quelle pancarte, facture ou page de paiement par rapport à elles avant de vous y fier. Gratuit, toujours : 2 adresses et 1 QR.",
  },
  checkFirst: {
    title: 'Collez l’adresse à laquelle vous demandez d’être payé. Voyez ce qu’un payeur voit aujourd’hui.',
    fieldLabel: 'L’adresse de portefeuille ou le lien de paiement auquel vous demandez d’être payé',
    placeholder: 'Adresse de portefeuille ou lien de paiement',
    button: 'Vérifier',
    checking: 'Vérification…',
    hint: 'Gratuit et sans compte. C’est la même vérification que fait le scanner public pour toute personne qui s’apprête à vous payer.',
    resultLabel: 'Ce qu’un payeur voit aujourd’hui',
    scannerLangNote: 'Pour l’instant, le scanner public affiche ce même résultat en anglais.',
    couldNotCheck: 'Almstins n’a pas pu vérifier ceci. Assurez-vous qu’il s’agit d’une adresse de portefeuille ou d’un lien de paiement complet, puis réessayez.',
    unproven: {
      address: 'Personne n’a encore prouvé cette adresse avec Almstins. Si elle est à vous, vous pouvez changer ce qu’un payeur voit.',
      link: 'Personne n’a encore prouvé ce lien avec Almstins. S’il est à vous, vous pouvez changer ce qu’un payeur voit.',
      code: 'Personne n’a encore prouvé ce code de paiement avec Almstins. S’il est à vous, vous pouvez changer ce qu’un payeur voit.',
    },
    proveCta: 'Prouvez que c’est à vous, gratuitement',
    proveHow: {
      address: 'Après votre connexion, vous la revendiquez avec le test du satoshi (un auto-envoi) : vous ne payez que les frais de réseau habituels, sans connexion de portefeuille et sans signature. Un payeur voit alors « {claimed} ». Listez-la dans un petit fichier sur votre propre site web et un payeur voit « {verified} », avec votre domaine à côté.',
      link: 'Après votre connexion, vous l’enregistrez. Un lien de paiement n’a pas de test qui lui soit propre : un payeur continue de voir « {notVerified} » tant que votre compte n’a pas prouvé un domaine web, et aujourd’hui cette preuve commence par une adresse de portefeuille.',
      code: 'Après votre connexion, vous l’enregistrez. Un code de paiement n’a pas de test qui lui soit propre : un payeur continue de voir « {notVerified} » tant que votre compte n’a pas prouvé un domaine web, et aujourd’hui cette preuve commence par une adresse de portefeuille.',
    },
    freePlan: 'Le forfait gratuit comprend {addresses} adresses de portefeuille et {qr} QR ou lien de paiement.',
    proveFlagged: 'Prouver que c’est à vous ne retire pas l’avertissement ci-dessus.',
    carryNote: 'Si vous continuez, votre navigateur conserve ce que vous avez vérifié, dans cet onglet uniquement, afin que ce soit déjà rempli sur votre premier écran après votre connexion. Ce n’est placé dans aucun lien, et rien n’est conservé dans un compte tant que vous ne l’avez pas enregistré.',
  },
  tools: {
    heading: 'Les outils',
    lede: "Trois façons de prouver ce que vous publiez, ou de vérifier ce qu'a publié quelqu'un d'autre — que vous prouviez votre propre portefeuille, en listiez plusieurs, ou construisiez quelque chose qui paie.",
    levels: [
      {
        persona: 'Pour qui construit quelque chose qui paie',
        title: 'Agents',
        body: "Une seule requête GET renvoie un statut et un niveau avant que votre agent n'envoie un paiement. Ne poursuivez que si la réponse est proven et verified — tout le reste signifie retenir et confirmer par un autre canal.",
        price: 'Gratuit',
        cta: 'Lire la documentation agents (en anglais)',
      },
      {
        persona: 'Pour les commerces qui acceptent les cryptos',
        title: 'Portefeuille prouvé',
        body: "Prouvez qu'une adresse de réception est à vous en vous envoyant un petit montant. Sans connexion de portefeuille, sans signature, sans clés. Les QR de paiement et les liens de paiement s'enregistrent de la même façon.",
        price: 'Gratuit : 2 adresses + 1 QR',
        cta: 'Connectez-vous pour commencer',
      },
      {
        persona: 'Pour les entreprises avec une ou deux adresses de réception',
        title: 'Domaine vérifié',
        body: "Prouvez votre domaine avec un enregistrement DNS ou un petit fichier sur votre site, puis listez vos adresses là. Une adresse remplacée sur une fausse page échoue à la vérification. Plus de deux adresses ? Publiez plutôt une liste chiffrée.",
        price: 'Gratuit, ou Business et Pro par e-mail',
        cta: 'Connectez-vous pour commencer',
      },
    ],
    agentKeyLine: 'Déjà en train de construire ? Créez votre propre clé avec un enregistrement DNS pour 300 vérifications par minute.',
    agentSigninBtn: 'Connectez-vous pour commencer',
    bannerLabels: ['Agent', 'Commerce', 'Petite entreprise'],
    agentDemo: { button: 'Voir une démo' },
    storeDemo: {
      placeholder: 'Collez n\'importe quelle adresse de portefeuille',
      button: 'Voir une démo',
      checking: 'Vérification…',
      result: '✓ Prouvé — voici à quoi ressemblera votre portefeuille une fois réclamé.',
      hint: "Un aperçu, pas encore une vérification réelle.",
    },
    dnsDemo: {
      watchLabel: 'Voir une démo',
      label: 'Ce que vous publiez, en une ligne :',
      hint: 'Aucun fichier à héberger, rien à chiffrer.',
    },
    scan: {
      badge: 'Gratuit · sans compte',
      title: 'Scannez avant de payer',
      body: "Collez une adresse ou un lien de paiement, ou scannez un QR de paiement, pour voir si son propriétaire l'a prouvé. Les adresses et les liens sont aussi passés au crible des arnaques connues. Gratuit pour celles et ceux qui paient, toujours.",
      cta: 'Ouvrir le scanner (en anglais)',
    },
    login: {
      heading: 'Une seule connexion pour les trois',
      body: 'Nouveau ? Google, GitHub ou un lien par e-mail crée votre compte gratuit. Sans carte, sans connexion de portefeuille.',
      button: 'Connectez-vous pour commencer',
    },
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
        body: "Avant de vous fier à un QR ou une adresse publiés, scannez-les ou collez-les et nous vous dirons instantanément s'ils correspondent toujours à ce que vous avez enregistré. Almstins revérifie votre preuve de domaine, et toute page que vous lui demandez de surveiller, toutes les six heures et vous prévient par e-mail si quelque chose change.",
      },
    ],
  },
  free: {
    heading: 'Ce que vous obtenez, gratuitement',
    items: [
      'Enregistrez et vérifiez 2 adresses de réception',
      'Enregistrez et vérifiez 1 QR de paiement',
      'Vérifications continues de ce que vous publiez, avec alertes par e-mail',
      'Sans connexion de portefeuille, jamais — nous lisons les données publiques que vous nous indiquez',
      'Vos données restent les vôtres — nous ne savons jamais qui sont vos clients, et nous ne pouvons pas déplacer vos fonds',
    ],
    note: 'Le forfait gratuit reste gratuit. Les forfaits Business et Pro contiennent davantage de destinations : demandez-les par e-mail à support@almstins.com.',
  },
  trust: {
    heading: 'Pourquoi vous pouvez avoir confiance',
    points: [
      {
        title: 'Nous ne nous connectons jamais à votre portefeuille.',
        body: 'La vérification est un petit envoi à vous-même ou un fichier sur votre site — vous gardez vos clés.',
      },
      {
        title: 'Nous ne touchons jamais à vos fonds.',
        body: "Almstins ne peut pas déplacer la moindre pièce. Il n'y a rien à voler ici.",
      },
      {
        title: 'Nous ne savons jamais qui sont vos clients.',
        body: "Vous vérifiez vos propres adresses publiées, jamais les personnes qui les paient, et nous ne relions jamais une vérification à l'identité de quiconque. Pour compter les vérifications, nous conservons des hachages à sens unique de l'adresse ou du site vérifié et de l'adresse IP de la personne qui vérifie, plus son pays. Ces pages utilisent aussi Google Analytics.",
      },
    ],
  },
  early: {
    heading: 'Tôt et honnête',
    body: "C'est un début, et nous apprenons encore ce dont les commerçants ont réellement besoin. Le plan gratuit reste gratuit. Si vous acceptez la crypto, partout dans le monde, essayez, puis dites-nous ce qui le rendrait vraiment utile. Nous le construisons avec vous, pas à vos dépens.",
  },
  finalCta: {
    heading: 'Vérifiez avant que l\'argent ne bouge.',
    button: 'Connectez-vous pour commencer',
    sub: 'Enregistrez + vérifiez 2 adresses + 1 QR. Sans carte, sans connexion de portefeuille.',
    footerAria: 'Accueil Almstins',
  },
  vendors: {
    heading: 'Commerçants vérifiés',
    intro: 'Toute entreprise qui accepte la crypto peut vérifier les adresses qu’elle publie — pour que les clients sachent qu’une adresse est bien la vôtre avant d’envoyer.',
    howToLabel: 'Comment se faire vérifier',
    steps: [
      'Créez un compte gratuit et ajoutez les adresses de réception et le QR de paiement que vous publiez.',
      'Prouvez qu’elles sont à vous — pour un portefeuille, envoyez-vous un petit montant ou hébergez un petit fichier sur votre site ; un QR de paiement est prouvé dès que vous l’enregistrez. Sans connexion de wallet, sans clés, jamais.',
      'Vérifiez-les à la demande avant de vous y fier: scannez une pancarte et nous confirmons qu’elle correspond toujours. Almstins revérifie votre preuve de domaine, et toute page que vous lui demandez de surveiller, toutes les six heures et vous prévient par e-mail si quelque chose change.',
    ],
    scaleLabel: 'Vous publiez de nombreuses adresses ?',
    scaleBody: 'Les exchanges et les grandes plateformes peuvent tout vérifier depuis leur propre domaine d’un coup (sur approbation pendant l’accès anticipé) : prouvez votre domaine, puis hébergez un endpoint en lecture seule et émettez-nous une clé API. Nous récupérons votre liste pour qu’elle puisse être vérifiée — sans ajouter les adresses une par une. La surveillance en direct arrive bientôt.',
    contractLabel: 'Votre endpoint renvoie :',
    earlyNote: 'Accès anticipé. Toute clé que vous nous donnez lit seulement une liste que vous publiez déjà — elle ne peut jamais déplacer de fonds ni voir quoi que ce soit de privé. Pour demander l’accès, écrivez à <a href="mailto:support@almstins.com">support@almstins.com</a>.',
  },
  faq: {
    heading: 'FAQ',
    items: [
      { q: 'Quel outil, parmi les trois, est fait pour moi ?', a: 'Vous construisez quelque chose qui envoie des paiements automatiquement ? Commencez par Agents. Vous acceptez la crypto sur un ou deux portefeuilles et voulez prouver qu’ils sont bien à vous ? Utilisez Portefeuille prouvé. Vous avez plusieurs adresses de réception à prouver à la fois, ou préférez publier via votre propre domaine ? Utilisez Domaine vérifié.' },
      { q: 'Est-ce vraiment gratuit ?', a: 'Oui. Le forfait gratuit est toujours gratuit : 2 portefeuilles et 1 QR de paiement. Les forfaits Business et Pro contiennent davantage de destinations ; demandez-les par e-mail à support@almstins.com.' },
      { q: 'Dois-je connecter mon portefeuille ?', a: 'Non, jamais. Prouver qu’un portefeuille est le vôtre signifie vous envoyer un petit montant ou héberger un petit fichier sur votre propre site — pas connecter un portefeuille ni rien signer. La vérification ne demande jamais de permission de signature et ne peut déplacer aucune pièce.' },
      { q: 'Quelle est la différence entre les outils ci-dessus et « Scannez avant de payer » ?', a: 'Les trois outils ci-dessus s’adressent à celui qui publie — prouver qu’une adresse, un QR ou un domaine que vous contrôlez est bien à vous. « Scannez avant de payer » est le côté gratuit pour l’autre sens : vérifier une adresse, un lien ou un QR que quelqu’un d’autre vous a donné, avant de lui envoyer de l’argent. Celui-là ne demande aucun compte.' },
      { q: 'Que vérifie le champ en haut de cette page ?', a: 'Il fait la même vérification gratuite que « Scannez avant de payer », sur l’adresse ou le lien de paiement auquel vous demandez d’être payé, pour que vous voyiez ce qu’un payeur voit aujourd’hui. Sans connexion. Si personne ne l’a prouvé avec Almstins, vous pouvez vous connecter et prouver que c’est à vous. Votre navigateur conserve alors ce que vous avez vérifié, dans cet onglet uniquement, afin que ce soit déjà rempli sur votre premier écran après votre connexion. Ce n’est placé dans aucun lien, et rien n’est conservé dans un compte tant que vous ne l’avez pas enregistré.' },
      { q: 'Almstins peut-il voir qui sont mes clients ?', a: 'Non. Vous vérifiez vos propres adresses publiées, jamais les personnes qui vous paient, et rien ici ne relie une adresse ou une vérification à l’identité d’un client. Quand quelqu’un lance une vérification, nous conservons des hachages à sens unique de l’adresse ou du site vérifié et de son adresse IP, plus son pays, afin de compter les vérifications. Comme le reste du site, ces pages utilisent Google Analytics.' },
      { q: 'Que signifie vraiment « vérifié » ici ?', a: 'Cela signifie que vous avez prouvé le contrôle de cette adresse, ce fichier ou cet enregistrement DNS précis — par un petit auto-envoi, ou en publiant quelque chose que vous seul pouviez publier — pas qu’Almstins se porte garant de votre entreprise. C’est votre propre preuve vérifiable, consultable par quiconque à qui vous la montrez.' },
      { q: 'Puis-je modifier mes adresses plus tard ?', a: 'Oui — ajoutez, prouvez ou retirez des adresses à tout moment depuis votre tableau de bord. Une vérification reflète toujours ce que vous avez enregistré à l’instant, pas une liste mise en cache.' },
      { q: 'Je gère un exchange ou une grande plateforme — existe-t-il une option groupée ?', a: 'Oui — voir Commerçants vérifiés plus bas pour le chemin basé sur une API qu’utilisent les exchanges et les plateformes pour publier de nombreuses adresses à la fois.' },
    ],
  },
};

export const copy: Record<Lang, VerifyCopy> = { en, es, fr };
