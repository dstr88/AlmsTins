/**
 * Copy for /verify/business (EN, ES, FR): the public page for a business that puts a crypto
 * address on its invoices, and for the teams and agents that pay such invoices. The shop-facing
 * page stays at /verify (src/i18n/verify.ts); this one has its own words.
 *
 * Template: src/components/verifyBusiness/VerifyBusinessPage.astro. Everything that is not a word
 * (routes, links, plan sizes, the file path, the re-check interval) lives in
 * src/lib/verifyBusiness.ts, which places it into the {placeholders} below:
 *   {address} {qr}   the Free plan's wallet addresses and payment QRs or links
 *   {hours}          how often Almstins re-checks a domain proof
 *   {path}           where the proof file is published on the owner's website
 *   {networks}       the networks the satoshi test works on
 *   {email}          the mailbox that arranges the paid plans
 *   {n} {price}      on a paid plan card: its destinations and its yearly price
 *
 * Rules for this copy (tests/verify/businessPage.test.ts holds them):
 *   - only what is live is described, in the words the product already uses: the satoshi test
 *     (a self-send), Claimed, Verified, the four answers of the check;
 *   - Almstins warns and flags and the payer decides. It never says it stops, blocks, protects or
 *     prevents anything, and it calls nothing safe;
 *   - the limits are a section of the page, not small print;
 *   - no em dash, in any language; no statistics, customer numbers or real-world cases;
 *   - the scanner page renders in English today, so the Spanish and French copies say so.
 */

import type { Lang } from '@/lib/i18n/locale';

/** The four answers of the check API, in the order the page shows them. */
export type CheckAnswer = 'proven' | 'mismatch' | 'unanchored' | 'unknown';

/** One of the three readers. The link each action opens is set in src/lib/verifyBusiness.ts. */
export interface ReaderCopy {
  /** Who the card speaks to, in a few words. */
  kicker: string;
  title: string;
  body: string;
  /** The one action for this reader. */
  action: string;
  /** One line under the action. */
  note: string;
}

/** One step of proving an address, with what it costs and what it earns. */
export interface ProofStepCopy {
  title: string;
  body: string;
  cost: string;
  earns: string;
}

export interface TitledCopy {
  title: string;
  body: string;
}

export interface VerifyBusinessCopy {
  lang: Lang;
  meta: { title: string; description: string };
  nav: { brand: string; tagline: string; brandAria: string; langsAria: string };
  hero: { eyebrow: string; h1: string; sub: string; stance: string };
  /** In this order: the business that invoices, the team that pays, the agent operator. */
  readers: { heading: string; items: [ReaderCopy, ReaderCopy, ReaderCopy] };
  problem: { heading: string; body: string[] };
  prove: {
    heading: string;
    lede: string;
    costLabel: string;
    earnsLabel: string;
    steps: [ProofStepCopy, ProofStepCopy];
    /** Under step one: the networks the satoshi test works on. */
    networks: string;
    /** Short notes under the steps: several addresses, no way to host a file, the re-check. */
    more: TitledCopy[];
    cta: string;
  };
  payer: {
    heading: string;
    lede: string;
    /** What each scanner result means. The titles are the scanner's own (src/i18n/verifyScan.ts). */
    results: { verified: string; claimed: string; unproven: string };
    disputed: string;
    screen: TitledCopy;
    cta: string;
  };
  agent: {
    heading: string;
    lede: string;
    answers: Record<CheckAnswer, { h: string; p: string }>;
    rule: TitledCopy;
    cta: string;
    more: string;
  };
  limits: { heading: string; lede: string; items: TitledCopy[] };
  plans: {
    heading: string;
    lede: string;
    free: { name: string; price: string; unit: string; items: string[]; cta: string };
    /** Business and Pro. Names, prices and sizes come from src/lib/verifyPlans.ts. */
    paid: { money: string; unit: string; yearly: string; items: string[]; cta: string };
    note: string;
    pricesLink: string;
  };
  closing: { heading: string; body: string; shop: string };
}

const en: VerifyBusinessCopy = {
  lang: 'en',
  meta: {
    title: 'Almstins Verify for business: prove the crypto address on your invoices',
    description:
      'A business proves the crypto addresses it asks people to pay and lists them on its own website. Payments teams and AI agents check an address before they pay. The Free plan holds {address} wallet addresses and {qr} payment QR or link.',
  },
  nav: {
    brand: 'Almstins Verify',
    tagline: 'For businesses that invoice in crypto',
    brandAria: 'Almstins Verify home',
    langsAria: 'Language',
  },
  hero: {
    eyebrow: 'Almstins Verify for business',
    h1: 'Prove that the crypto address on your invoice is yours.',
    sub: 'An address on an invoice can be swapped, and the invoice still looks right. With Almstins Verify, a business proves the addresses it asks people to pay and lists them on its own website. The people and systems that pay it can check an address before any money moves.',
    stance: 'No wallet connection and no signature. Almstins never holds keys or funds.',
  },
  readers: {
    heading: 'Who this page is for',
    items: [
      {
        kicker: 'You send invoices',
        title: 'A business that puts a crypto address on its invoices',
        body: 'Prove each address once, list it on your own website, and give the people who pay you a way to check it.',
        action: 'Prove your addresses',
        note: 'A free account: Google, GitHub or an email link.',
      },
      {
        kicker: 'You pay invoices',
        title: 'A payments or treasury team',
        body: 'Before you pay an address from an invoice or an email, check it. The scanner is free and needs no account.',
        action: 'Check an address now',
        note: 'Paste an address or a payment link, or scan a QR.',
      },
      {
        kicker: 'Your software pays',
        title: 'Someone running AI agents that pay suppliers',
        body: 'Your agent asks one question before it pays and gets one of four answers. Every answer but one goes to a person.',
        action: 'Read the agent docs',
        note: 'One request. No account needed to start.',
      },
    ],
  },
  problem: {
    heading: 'The problem: a swapped address still looks right',
    body: [
      'An invoice arrives by email with a crypto address on it. Between the sender and the payer, that address can be replaced: in a mailbox someone else got into, in an edited PDF, on a copied web page. The logo, the amount and the invoice number are all still correct. Only the address has changed.',
      'A crypto payment cannot be recalled. There is no chargeback, and no bank can reverse it. Once it is sent to the wrong address, getting it back depends on whoever received it.',
      'So the check has to happen before the payment, and it has to rest on something other than the invoice itself.',
    ],
  },
  prove: {
    heading: 'How a business proves its addresses',
    lede: 'Two steps. The first shows that you control the address. The second ties it to your website.',
    costLabel: 'What it costs',
    earnsLabel: 'What it earns',
    steps: [
      {
        title: 'Claim the address with the satoshi test (a self-send)',
        body: 'Add the address in your Verify dashboard. Almstins gives you a tiny, exact amount. From your own wallet app, you send that amount from the address back to itself. The coins stay in your wallet. There is no wallet connection and no signature.',
        cost: 'The normal network fee for one small transaction. Almstins charges nothing.',
        earns: 'The address reads Claimed: an Almstins account has shown that it controls this address. No business name is shown yet.',
      },
      {
        title: 'List it in a small file on your own website',
        body: 'Almstins gives you a small file that lists your addresses. You publish it on your website at {path}. The file carries a code issued to your account, so a copy of it on another website does not count.',
        cost: 'Nothing from Almstins. You need a website you control and a way to publish one file on it.',
        earns: 'A claimed address listed in that file reads Verified, with your domain shown beside it. If the file later no longer lists the address, it goes back to Claimed.',
      },
    ],
    networks: 'The satoshi test works on: {networks}.',
    more: [
      {
        title: 'Several addresses?',
        body: 'Publish them as one encrypted roster on your own domain. Anyone can fetch the file, and only Almstins can read it.',
      },
      {
        title: 'No way to publish a file?',
        body: 'A DNS record proves that you control the domain and attaches your business name. It carries no list of addresses, so the file or the roster is what earns Verified.',
      },
      {
        title: 'After that, Almstins keeps checking',
        body: 'Almstins re-checks your domain proof, and any page you ask it to watch, every {hours} hours, and emails you if something changes.',
      },
    ],
    cta: 'Prove your addresses',
  },
  payer: {
    heading: 'What a payer sees',
    lede: 'Anyone can paste an address or a payment link, or scan a QR, at the free scanner. No account is needed. For an address, the scanner shows one of these.',
    results: {
      verified: 'A business claimed the address, and its own website lists it. The card names that website.',
      claimed: 'An account has shown that it controls the address, but no website vouches for it right now. No name is shown. Anyone can claim an address they control, so the card tells the payer to confirm the recipient another way.',
      unproven: 'Nobody has proven this address with Almstins. That says nothing against the address. It is only unproven.',
    },
    disputed: 'If two accounts stand behind the same address, the scanner names neither of them until one withdraws.',
    screen: {
      title: 'A second, separate answer',
      body: 'The scanner also screens an address against known scam and sanctions lists, and a payment link against lists of known phishing and scam sites. A clean screen means that no source Almstins checked has flagged it yet. Lists are incomplete and can lag.',
    },
    cta: 'Check an address now',
  },
  agent: {
    heading: 'What an AI agent or payment system gets',
    lede: 'Before it pays, your agent or payment system sends one request to the check with two things: the address, and the domain of the business it means to pay. It gets back one of four answers. The check is free and needs no account to start.',
    answers: {
      proven: {
        h: 'The business you expected lists this address',
        p: 'The address is Verified, and the domain that lists it is the one you passed. This is the only answer to proceed on.',
      },
      mismatch: {
        h: 'A domain lists this address, but not the one you expected',
        p: 'Your records name one business and the address belongs to another. Hold the payment and have a person confirm with the payee through a channel you already trust.',
      },
      unanchored: {
        h: 'Claimed, but no domain vouches for it right now',
        p: 'Someone has shown control of the address, or a listing has lapsed. It does not mean anything is wrong. Hold, and confirm with the payee.',
      },
      unknown: {
        h: 'No proof on record',
        p: 'Nobody has proven this address with Almstins. It is an absence, not an accusation. Hold, and send it to a person.',
      },
    },
    rule: {
      title: 'The published rule',
      body: 'Proceed only when the answer is proven and you passed the domain you expected, taken from your own records and never from the invoice. Hold everything else for a person. If the check itself is unavailable, it says so. That is a reason to try again, never an answer.',
    },
    cta: 'Read the agent docs',
    more: 'Almstins Agentics, for teams running agents',
  },
  limits: {
    heading: 'The limits',
    lede: 'Read these before you rely on a result.',
    items: [
      {
        title: 'It proves control, not identity.',
        body: 'Verified means that someone controls a domain and an address, and that the domain lists the address. It does not show who legally owns the business, or whether the business is honest.',
      },
      {
        title: 'A good result is not a guarantee.',
        body: 'Proven, Verified or a clean screen describes the address at the time of the check. It is not a promise about any payment. The decision to pay stays with the payer.',
      },
      {
        title: 'Almstins warns and flags. That is all it does.',
        body: 'It is never in the path of a payment. It holds no keys and no funds, and it moves and signs nothing. It cannot hold up a payment or undo one.',
      },
      {
        title: 'A change can go unnoticed for hours.',
        body: 'Almstins re-checks a domain proof every {hours} hours. If a file changes between two checks, a result can be out of date until the next one.',
      },
    ],
  },
  plans: {
    heading: 'Plans',
    lede: 'The Free plan stays free. The paid plans hold more destinations and are arranged by email.',
    free: {
      name: 'Free',
      price: '$0',
      unit: 'always',
      items: [
        '{address} wallet addresses and {qr} payment QR or link',
        'The satoshi test and the file on your website',
        'Re-checks every {hours} hours, with an email if something changes',
      ],
      cta: 'Start free',
    },
    paid: {
      money: '${n}',
      unit: '/mo',
      yearly: 'or {price}/year',
      items: ['{n} destinations, any mix of wallet addresses and payment QRs or links', 'Not sold online: ask by email'],
      cta: 'Ask by email',
    },
    note: 'A destination is one wallet address, or one payment QR or link. To move to Business or Pro, write to {email}.',
    pricesLink: 'All Almstins prices',
  },
  closing: {
    heading: 'Your next step',
    body: 'One action for each reader.',
    shop: 'Taking payments in a shop? See Almstins Verify for store owners',
  },
};

const es: VerifyBusinessCopy = {
  lang: 'es',
  meta: {
    title: 'Almstins Verify para empresas: demuestra la dirección cripto de tus facturas',
    description:
      'Una empresa demuestra las direcciones cripto a las que pide que le paguen y las publica en su propio sitio web. Los equipos de pagos y los agentes de IA comprueban una dirección antes de pagar. El plan gratuito incluye {address} direcciones de billetera y {qr} QR o enlace de pago.',
  },
  nav: {
    brand: 'Almstins Verify',
    tagline: 'Para empresas que facturan en cripto',
    brandAria: 'Inicio de Almstins Verify',
    langsAria: 'Idioma',
  },
  hero: {
    eyebrow: 'Almstins Verify para empresas',
    h1: 'Demuestra que la dirección cripto de tu factura es tuya.',
    sub: 'Una dirección en una factura puede ser sustituida, y la factura sigue pareciendo correcta. Con Almstins Verify, una empresa demuestra las direcciones a las que pide que le paguen y las publica en su propio sitio web. Las personas y los sistemas que le pagan pueden comprobar una dirección antes de que se mueva el dinero.',
    stance: 'Sin conectar la billetera y sin firmar nada. Almstins nunca guarda claves ni fondos.',
  },
  readers: {
    heading: 'Para quién es esta página',
    items: [
      {
        kicker: 'Envías facturas',
        title: 'Una empresa que pone una dirección cripto en sus facturas',
        body: 'Demuestra cada dirección una vez, publícala en tu propio sitio web y da a quienes te pagan una forma de comprobarla.',
        action: 'Demuestra tus direcciones',
        note: 'Una cuenta gratuita: Google, GitHub o un enlace por correo.',
      },
      {
        kicker: 'Pagas facturas',
        title: 'Un equipo de pagos o de tesorería',
        body: 'Antes de pagar a una dirección que viene en una factura o en un correo, compruébala. El escáner es gratuito y no pide cuenta.',
        action: 'Comprueba una dirección ahora',
        note: 'Pega una dirección o un enlace de pago, o escanea un QR.',
      },
      {
        kicker: 'Tu software paga',
        title: 'Alguien que opera agentes de IA que pagan a proveedores',
        body: 'Tu agente hace una pregunta antes de pagar y recibe una de cuatro respuestas. Todas menos una pasan a una persona.',
        action: 'Lee la documentación para agentes',
        note: 'Una sola solicitud. No hace falta cuenta para empezar.',
      },
    ],
  },
  problem: {
    heading: 'El problema: una dirección sustituida sigue pareciendo correcta',
    body: [
      'Llega una factura por correo con una dirección cripto. Entre quien la envía y quien la paga, esa dirección puede ser reemplazada: en un buzón al que entró otra persona, en un PDF editado, en una página web copiada. El logotipo, el importe y el número de factura siguen siendo correctos. Solo ha cambiado la dirección.',
      'Un pago en cripto no se puede revertir. No hay contracargo, y ningún banco puede deshacerlo. Una vez enviado a la dirección equivocada, recuperarlo depende de quien lo recibió.',
      'Por eso la comprobación tiene que hacerse antes del pago, y tiene que apoyarse en algo distinto de la propia factura.',
    ],
  },
  prove: {
    heading: 'Cómo demuestra una empresa sus direcciones',
    lede: 'Dos pasos. El primero muestra que controlas la dirección. El segundo la vincula a tu sitio web.',
    costLabel: 'Lo que cuesta',
    earnsLabel: 'Lo que consigue',
    steps: [
      {
        title: 'Reclama la dirección con la prueba del satoshi (un autoenvío)',
        body: 'Agrega la dirección en tu panel de Verify. Almstins te da una cantidad pequeña y exacta. Desde tu propia app de billetera, envías esa cantidad desde la dirección a sí misma. Las monedas se quedan en tu billetera. No se conecta la billetera y no se firma nada.',
        cost: 'La comisión normal de la red por una transacción pequeña. Almstins no cobra nada.',
        earns: 'La dirección aparece como «Control confirmado» (Claimed): una cuenta de Almstins ha mostrado que controla esta dirección. Todavía no se muestra ningún nombre de empresa.',
      },
      {
        title: 'Publícala en un archivo pequeño en tu propio sitio web',
        body: 'Almstins te da un archivo pequeño que incluye tus direcciones. Lo publicas en tu sitio web en {path}. El archivo lleva un código emitido para tu cuenta, así que una copia en otro sitio web no cuenta.',
        cost: 'Nada por parte de Almstins. Necesitas un sitio web que controles y una forma de publicar un archivo en él.',
        earns: 'Una dirección reclamada que figura en ese archivo aparece como «Verificado» (Verified), con tu dominio al lado. Si el archivo deja de incluirla, vuelve a «Control confirmado».',
      },
    ],
    networks: 'La prueba del satoshi funciona en: {networks}.',
    more: [
      {
        title: '¿Varias direcciones?',
        body: 'Publícalas como una sola lista cifrada en tu propio dominio. Cualquiera puede descargar el archivo, y solo Almstins puede leerlo.',
      },
      {
        title: '¿No puedes publicar un archivo?',
        body: 'Un registro DNS demuestra que controlas el dominio y asocia el nombre de tu empresa. No lleva ninguna lista de direcciones, así que lo que da «Verificado» es el archivo o la lista cifrada.',
      },
      {
        title: 'Después, Almstins sigue comprobando',
        body: 'Almstins vuelve a comprobar tu prueba de dominio, y cualquier página que le pidas vigilar, cada {hours} horas, y te avisa por correo si algo cambia.',
      },
    ],
    cta: 'Demuestra tus direcciones',
  },
  payer: {
    heading: 'Lo que ve quien paga',
    lede: 'Cualquiera puede pegar una dirección o un enlace de pago, o escanear un QR, en el escáner gratuito. No hace falta cuenta. Para una dirección, el escáner muestra uno de estos resultados. Por ahora, el escáner muestra el resultado en inglés.',
    results: {
      verified: 'Una empresa reclamó la dirección, y su propio sitio web la publica. La tarjeta nombra ese sitio web.',
      claimed: 'Una cuenta ha mostrado que controla la dirección, pero ningún sitio web responde por ella en este momento. No se muestra ningún nombre. Cualquiera puede reclamar una dirección que controla, así que la tarjeta pide a quien paga que confirme el destinatario por otra vía.',
      unproven: 'Nadie ha demostrado esta dirección con Almstins. Eso no dice nada en contra de la dirección. Solo está sin demostrar.',
    },
    disputed: 'Si dos cuentas respaldan la misma dirección, el escáner no nombra a ninguna hasta que una se retira.',
    screen: {
      title: 'Una segunda respuesta, aparte',
      body: 'El escáner también revisa una dirección en listas conocidas de estafas y sanciones, y un enlace de pago en listas de sitios conocidos de phishing y estafa. Un resultado limpio significa que ninguna fuente consultada por Almstins lo ha señalado todavía. Las listas son incompletas y pueden ir con retraso.',
    },
    cta: 'Comprueba una dirección ahora',
  },
  agent: {
    heading: 'Lo que recibe un agente de IA o un sistema de pagos',
    lede: 'Antes de pagar, tu agente o tu sistema de pagos envía una solicitud a la comprobación con dos datos: la dirección y el dominio de la empresa a la que quiere pagar. Recibe una de cuatro respuestas. La comprobación es gratuita y no pide cuenta para empezar.',
    answers: {
      proven: {
        h: 'La empresa que esperabas publica esta dirección',
        p: 'La dirección está verificada, y el dominio que la publica es el que indicaste. Es la única respuesta con la que se procede.',
      },
      mismatch: {
        h: 'Un dominio publica esta dirección, pero no es el que esperabas',
        p: 'Tus registros nombran una empresa y la dirección pertenece a otra. Deja el pago en espera y haz que una persona lo confirme con el beneficiario por un canal en el que ya confíes.',
      },
      unanchored: {
        h: 'Reclamada, pero ningún dominio responde por ella ahora',
        p: 'Alguien ha mostrado que controla la dirección, o una publicación ha caducado. No significa que algo vaya mal. Déjalo en espera y confirma con el beneficiario.',
      },
      unknown: {
        h: 'No hay ninguna prueba registrada',
        p: 'Nadie ha demostrado esta dirección con Almstins. Es una ausencia, no una acusación. Déjalo en espera y pásalo a una persona.',
      },
    },
    rule: {
      title: 'La regla publicada',
      body: 'Procede solo cuando la respuesta sea proven y hayas indicado el dominio que esperabas, tomado de tus propios registros y nunca de la factura. Deja todo lo demás en espera para una persona. Si la comprobación no está disponible, lo dice. Eso es un motivo para volver a intentarlo, nunca una respuesta.',
    },
    cta: 'Lee la documentación para agentes',
    more: 'Almstins Agentics, para equipos que operan agentes',
  },
  limits: {
    heading: 'Los límites',
    lede: 'Léelos antes de apoyarte en un resultado.',
    items: [
      {
        title: 'Demuestra el control, no la identidad.',
        body: 'Verificado significa que alguien controla un dominio y una dirección, y que el dominio publica la dirección. No muestra quién es el dueño legal de la empresa, ni si la empresa es honesta.',
      },
      {
        title: 'Un buen resultado no es una garantía.',
        body: 'Proven, verificado o un resultado limpio describen la dirección en el momento de la comprobación. No es una promesa sobre ningún pago. La decisión de pagar sigue siendo de quien paga.',
      },
      {
        title: 'Almstins advierte y señala. Nada más.',
        body: 'Nunca está en el camino de un pago. No guarda claves ni fondos, y no mueve ni firma nada. No puede retener un pago ni deshacerlo.',
      },
      {
        title: 'Un cambio puede pasar inadvertido durante horas.',
        body: 'Almstins vuelve a comprobar una prueba de dominio cada {hours} horas. Si un archivo cambia entre dos comprobaciones, un resultado puede estar desactualizado hasta la siguiente.',
      },
    ],
  },
  plans: {
    heading: 'Planes',
    lede: 'El plan gratuito sigue siendo gratis. Los planes de pago admiten más destinos y se contratan por correo.',
    free: {
      name: 'Gratis',
      price: '$0',
      unit: 'siempre',
      items: [
        '{address} direcciones de billetera y {qr} QR o enlace de pago',
        'La prueba del satoshi y el archivo en tu sitio web',
        'Comprobaciones cada {hours} horas, con un correo si algo cambia',
      ],
      cta: 'Empieza gratis',
    },
    paid: {
      money: '${n}',
      unit: '/mes',
      yearly: 'o {price}/año',
      items: ['{n} destinos, en cualquier combinación de direcciones de billetera y QR o enlaces de pago', 'No se vende en línea: pídelo por correo'],
      cta: 'Pedir por correo',
    },
    note: 'Un destino es una dirección de billetera, o un QR o enlace de pago. Para pasar a Business o Pro, escribe a {email}.',
    pricesLink: 'Todos los precios de Almstins',
  },
  closing: {
    heading: 'Tu siguiente paso',
    body: 'Una acción para cada lector.',
    shop: '¿Cobras en una tienda? Mira Almstins Verify para comercios',
  },
};

const fr: VerifyBusinessCopy = {
  lang: 'fr',
  meta: {
    title: 'Almstins Verify pour les entreprises : prouvez l’adresse crypto de vos factures',
    description:
      'Une entreprise prouve les adresses crypto auxquelles elle demande d’être payée et les publie sur son propre site web. Les équipes paiements et les agents d’IA vérifient une adresse avant de payer. Le forfait gratuit comprend {address} adresses de portefeuille et {qr} QR ou lien de paiement.',
  },
  nav: {
    brand: 'Almstins Verify',
    tagline: 'Pour les entreprises qui facturent en crypto',
    brandAria: 'Accueil Almstins Verify',
    langsAria: 'Langue',
  },
  hero: {
    eyebrow: 'Almstins Verify pour les entreprises',
    h1: 'Prouvez que l’adresse crypto sur votre facture est bien la vôtre.',
    sub: 'Une adresse sur une facture peut être remplacée, et la facture a toujours l’air correcte. Avec Almstins Verify, une entreprise prouve les adresses auxquelles elle demande d’être payée et les publie sur son propre site web. Les personnes et les systèmes qui la paient peuvent vérifier une adresse avant tout mouvement d’argent.',
    stance: 'Sans connexion de portefeuille et sans signature. Almstins ne détient jamais de clés ni de fonds.',
  },
  readers: {
    heading: 'À qui s’adresse cette page',
    items: [
      {
        kicker: 'Vous envoyez des factures',
        title: 'Une entreprise qui met une adresse crypto sur ses factures',
        body: 'Prouvez chaque adresse une fois, publiez-la sur votre propre site web et donnez à ceux qui vous paient un moyen de la vérifier.',
        action: 'Prouvez vos adresses',
        note: 'Un compte gratuit : Google, GitHub ou un lien par e-mail.',
      },
      {
        kicker: 'Vous payez des factures',
        title: 'Une équipe paiements ou trésorerie',
        body: 'Avant de payer une adresse reçue sur une facture ou dans un e-mail, vérifiez-la. Le scanner est gratuit et ne demande aucun compte.',
        action: 'Vérifiez une adresse maintenant',
        note: 'Collez une adresse ou un lien de paiement, ou scannez un QR.',
      },
      {
        kicker: 'Votre logiciel paie',
        title: 'Quelqu’un qui fait tourner des agents d’IA qui paient des fournisseurs',
        body: 'Votre agent pose une question avant de payer et reçoit l’une de quatre réponses. Toutes sauf une vont à une personne.',
        action: 'Lisez la documentation pour agents',
        note: 'Une seule requête. Aucun compte nécessaire pour commencer.',
      },
    ],
  },
  problem: {
    heading: 'Le problème : une adresse remplacée a toujours l’air correcte',
    body: [
      'Une facture arrive par e-mail avec une adresse crypto. Entre l’expéditeur et le payeur, cette adresse peut être remplacée : dans une boîte mail où quelqu’un d’autre est entré, dans un PDF modifié, sur une page web copiée. Le logo, le montant et le numéro de facture sont toujours corrects. Seule l’adresse a changé.',
      'Un paiement en crypto ne peut pas être rappelé. Il n’y a pas de rétrofacturation, et aucune banque ne peut l’annuler. Une fois envoyé à la mauvaise adresse, le récupérer dépend de celui qui l’a reçu.',
      'La vérification doit donc avoir lieu avant le paiement, et s’appuyer sur autre chose que la facture elle-même.',
    ],
  },
  prove: {
    heading: 'Comment une entreprise prouve ses adresses',
    lede: 'Deux étapes. La première montre que vous contrôlez l’adresse. La seconde la relie à votre site web.',
    costLabel: 'Ce que cela coûte',
    earnsLabel: 'Ce que cela donne',
    steps: [
      {
        title: 'Revendiquez l’adresse avec le test du satoshi (un auto-envoi)',
        body: 'Ajoutez l’adresse dans votre tableau de bord Verify. Almstins vous donne un petit montant exact. Depuis votre propre application de portefeuille, vous envoyez ce montant de l’adresse vers elle-même. Les fonds restent dans votre portefeuille. Il n’y a ni connexion de portefeuille ni signature.',
        cost: 'Les frais de réseau habituels pour une petite transaction. Almstins ne facture rien.',
        earns: 'L’adresse apparaît comme « Contrôle confirmé » (Claimed) : un compte Almstins a montré qu’il contrôle cette adresse. Aucun nom d’entreprise n’est encore affiché.',
      },
      {
        title: 'Publiez-la dans un petit fichier sur votre propre site web',
        body: 'Almstins vous donne un petit fichier qui liste vos adresses. Vous le publiez sur votre site web à l’emplacement {path}. Le fichier porte un code émis pour votre compte : une copie sur un autre site web ne compte donc pas.',
        cost: 'Rien de la part d’Almstins. Il vous faut un site web que vous contrôlez et un moyen d’y publier un fichier.',
        earns: 'Une adresse revendiquée qui figure dans ce fichier apparaît comme « Vérifié » (Verified), avec votre domaine à côté. Si le fichier cesse de la lister, elle revient à « Contrôle confirmé ».',
      },
    ],
    networks: 'Le test du satoshi fonctionne sur : {networks}.',
    more: [
      {
        title: 'Plusieurs adresses ?',
        body: 'Publiez-les sous la forme d’une seule liste chiffrée sur votre propre domaine. N’importe qui peut télécharger le fichier, et seul Almstins peut le lire.',
      },
      {
        title: 'Impossible de publier un fichier ?',
        body: 'Un enregistrement DNS prouve que vous contrôlez le domaine et y associe le nom de votre entreprise. Il ne porte aucune liste d’adresses : c’est donc le fichier ou la liste chiffrée qui donne « Vérifié ».',
      },
      {
        title: 'Ensuite, Almstins continue de vérifier',
        body: 'Almstins revérifie votre preuve de domaine, et toute page que vous lui demandez de surveiller, toutes les {hours} heures, et vous écrit par e-mail si quelque chose change.',
      },
    ],
    cta: 'Prouvez vos adresses',
  },
  payer: {
    heading: 'Ce que voit un payeur',
    lede: 'N’importe qui peut coller une adresse ou un lien de paiement, ou scanner un QR, dans le scanner gratuit. Aucun compte n’est nécessaire. Pour une adresse, le scanner affiche l’un de ces résultats. Pour l’instant, le scanner affiche le résultat en anglais.',
    results: {
      verified: 'Une entreprise a revendiqué l’adresse, et son propre site web la publie. La carte nomme ce site web.',
      claimed: 'Un compte a montré qu’il contrôle l’adresse, mais aucun site web ne s’en porte garant pour le moment. Aucun nom n’est affiché. N’importe qui peut revendiquer une adresse qu’il contrôle : la carte demande donc au payeur de confirmer le destinataire par un autre moyen.',
      unproven: 'Personne n’a prouvé cette adresse auprès d’Almstins. Cela ne dit rien contre l’adresse. Elle est seulement non prouvée.',
    },
    disputed: 'Si deux comptes se tiennent derrière la même adresse, le scanner ne nomme aucun des deux tant que l’un ne s’est pas retiré.',
    screen: {
      title: 'Une seconde réponse, distincte',
      body: 'Le scanner contrôle aussi une adresse dans des listes connues d’arnaques et de sanctions, et un lien de paiement dans des listes de sites connus d’hameçonnage et d’arnaque. Un résultat sans alerte signifie qu’aucune source consultée par Almstins ne l’a encore signalé. Les listes sont incomplètes et peuvent avoir du retard.',
    },
    cta: 'Vérifiez une adresse maintenant',
  },
  agent: {
    heading: 'Ce que reçoit un agent d’IA ou un système de paiement',
    lede: 'Avant de payer, votre agent ou votre système de paiement envoie une requête à la vérification avec deux éléments : l’adresse, et le domaine de l’entreprise qu’il entend payer. Il reçoit l’une de quatre réponses. La vérification est gratuite et ne demande aucun compte pour commencer.',
    answers: {
      proven: {
        h: 'L’entreprise que vous attendiez publie cette adresse',
        p: 'L’adresse est vérifiée, et le domaine qui la publie est celui que vous avez indiqué. C’est la seule réponse sur laquelle poursuivre.',
      },
      mismatch: {
        h: 'Un domaine publie cette adresse, mais pas celui que vous attendiez',
        p: 'Vos registres nomment une entreprise et l’adresse appartient à une autre. Mettez le paiement en attente et faites-le confirmer par une personne auprès du bénéficiaire, par un canal en lequel vous avez déjà confiance.',
      },
      unanchored: {
        h: 'Revendiquée, mais aucun domaine ne s’en porte garant pour le moment',
        p: 'Quelqu’un a montré qu’il contrôle l’adresse, ou une publication a expiré. Cela ne signifie pas que quelque chose ne va pas. Mettez en attente et confirmez auprès du bénéficiaire.',
      },
      unknown: {
        h: 'Aucune preuve enregistrée',
        p: 'Personne n’a prouvé cette adresse auprès d’Almstins. C’est une absence, pas une accusation. Mettez en attente et transmettez à une personne.',
      },
    },
    rule: {
      title: 'La règle publiée',
      body: 'Poursuivez uniquement lorsque la réponse est proven et que vous avez indiqué le domaine attendu, pris dans vos propres registres et jamais sur la facture. Mettez tout le reste en attente pour une personne. Si la vérification elle-même est indisponible, elle le dit. C’est une raison de réessayer, jamais une réponse.',
    },
    cta: 'Lisez la documentation pour agents',
    more: 'Almstins Agentics, pour les équipes qui font tourner des agents',
  },
  limits: {
    heading: 'Les limites',
    lede: 'Lisez-les avant de vous appuyer sur un résultat.',
    items: [
      {
        title: 'Cela prouve le contrôle, pas l’identité.',
        body: 'Vérifié signifie que quelqu’un contrôle un domaine et une adresse, et que le domaine publie l’adresse. Cela ne montre pas qui possède légalement l’entreprise, ni si l’entreprise est honnête.',
      },
      {
        title: 'Un bon résultat n’est pas une garantie.',
        body: 'Proven, vérifié ou un résultat sans alerte décrivent l’adresse au moment de la vérification. Ce n’est pas une promesse sur un paiement. La décision de payer reste celle du payeur.',
      },
      {
        title: 'Almstins avertit et signale. Rien de plus.',
        body: 'Il n’est jamais sur le chemin d’un paiement. Il ne détient ni clés ni fonds, ne déplace rien et ne signe rien. Il ne peut ni retenir un paiement ni l’annuler.',
      },
      {
        title: 'Un changement peut passer inaperçu pendant des heures.',
        body: 'Almstins revérifie une preuve de domaine toutes les {hours} heures. Si un fichier change entre deux vérifications, un résultat peut être dépassé jusqu’à la suivante.',
      },
    ],
  },
  plans: {
    heading: 'Forfaits',
    lede: 'Le forfait gratuit reste gratuit. Les forfaits payants contiennent plus de destinations et se demandent par e-mail.',
    free: {
      name: 'Gratuit',
      price: '0 $',
      unit: 'toujours',
      items: [
        '{address} adresses de portefeuille et {qr} QR ou lien de paiement',
        'Le test du satoshi et le fichier sur votre site web',
        'Revérifications toutes les {hours} heures, avec un e-mail si quelque chose change',
      ],
      cta: 'Commencer gratuitement',
    },
    paid: {
      money: '{n} $',
      unit: '/mois',
      yearly: 'ou {price}/an',
      items: ['{n} destinations, en combinant librement adresses de portefeuille et QR ou liens de paiement', 'Pas de vente en ligne : demandez par e-mail'],
      cta: 'Demander par e-mail',
    },
    note: 'Une destination est une adresse de portefeuille, ou un QR ou lien de paiement. Pour passer à Business ou Pro, écrivez à {email}.',
    pricesLink: 'Tous les tarifs Almstins',
  },
  closing: {
    heading: 'Votre prochaine étape',
    body: 'Une action pour chaque lecteur.',
    shop: 'Vous encaissez en boutique ? Voir Almstins Verify pour les commerçants',
  },
};

/** One copy per language. */
export const verifyBusinessCopy: Record<Lang, VerifyBusinessCopy> = { en, es, fr };
