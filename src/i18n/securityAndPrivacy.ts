// Security & Privacy page — all user-visible strings (EN · ES · FR).
//
// Route-based i18n (see design.claude.md → "i18n Pattern — Public-Facing Pages").
// Rendered by src/components/SecurityAndPrivacyPage.astro; thin wrappers at
// src/pages/security-and-privacy.astro (en), /security-and-privacy/es.astro,
// /security-and-privacy/fr.astro.
//
// Fields carrying inline <strong> are rendered with set:html in the component
// (corePromise.p2, store/notStore intros + items, callout.p1, encryption.*,
// auth.items, deletion.*, thirdParty.items, faq answers, footer.*).

import type { Lang } from '@/lib/i18n/locale';

export interface SecurityContent {
  lang: Lang;
  meta: { title: string };
  hero: { title: string; subtitle: string };
  corePromise: { heading: string; p1: string; p2: string };
  dataStore: {
    heading: string;
    storeIntro: string;
    storeItems: string[];
    notStoreIntro: string;
    notStoreItems: string[];
  };
  callout: { p1: string; p2: string; p3: string };
  encryption: { heading: string; p1: string; p2: string; p3: string };
  billing: { heading: string; p1: string; p2: string };
  auth: { heading: string; intro: string; items: string[]; outro: string };
  deletion: { heading: string; p1: string; p2: string };
  thirdParty: { heading: string; intro: string; items: string[]; outro: string };
  compliance: { heading: string; intro: string; items: string[] };
  faq: { heading: string; items: { q: string; a: string }[] };
  footer: { p1: string; p2: string };
}

export const en: SecurityContent = {
  lang: 'en',
  meta: { title: 'Security & Privacy — Almstins' },
  hero: {
    title: 'Security & Privacy',
    subtitle: `How Almstins protects your data and why its architecture—not just promises—makes it safe.`,
  },
  corePromise: {
    heading: 'The Core Promise',
    p1: `Almstins never connects to your wallet, never requests your private keys, and never touches your signing authority. It reads your holdings from the public blockchain by address—the same way anyone on the internet can look up what's in a wallet. The difference is that Almstins organizes that data into one place, tracks its history, and helps you verify addresses before you send funds.`,
    p2: `<strong>This isn't a promise we make. It's an architectural constraint we built in.</strong> You can verify it yourself: Almstins has no wallet connection mechanism in the code, no signing interface, and no way to request permissions from your wallet.`,
  },
  dataStore: {
    heading: 'What Data We Store',
    storeIntro: `When you use Almstins, we store:`,
    storeItems: [
      `<strong>Your email address</strong> — only for account login. Want maximum privacy? Use a dedicated email address that isn't tied to your real name — only that address lives in our database. You can also sign in with Google or GitHub.`,
      `<strong>Wallet addresses you add</strong> — the blockchain addresses you own (e.g., 0x1234...). These are public data; anyone can already see what's in these addresses on the blockchain.`,
      `<strong>Transaction history</strong> — imported from CSVs you upload (from exchanges like Coinbase, Kraken, Gemini, etc.) or read directly from the blockchain. We store the date, amount, price, and your notes about each transaction.`,
      `<strong>Cost basis records</strong> — the price you paid for each asset, calculated from your transaction history.`,
      `<strong>Settings and preferences</strong> — labels you create, alerts you set, and other configuration.`,
    ],
    notStoreIntro: `We do <strong>not</strong> store:`,
    notStoreItems: [
      `Your private keys, seed phrases, or recovery words (we have no way to access these).`,
      `Your payment information — Stripe handles all billing, and we never see your credit card details.`,
      `Your real name (unless you volunteer it in notes).`,
      `Your IP address or browsing behavior beyond standard server logs.`,
    ],
  },
  callout: {
    p1: `<strong>The Lucia Question:</strong> "If you're breached, does someone have a map of who owns what?"`,
    p2: `Yes, if breached, an attacker would learn: which blockchain addresses you own, how much is in them, and your transaction history (dates, amounts, assets). This is sensitive financial data. But it's not the same as your private keys—they can't move your funds. They can't trade on your behalf. They can't sign anything.`,
    p3: `To minimize this risk, we encrypt all sensitive data at rest (see below), and we recommend adding a dedicated email address for Almstins (not your primary email) so your identity isn't automatically tied to your holdings data.`,
  },
  encryption: {
    heading: 'Encryption & Data Security',
    p1: `<strong>Encryption at rest:</strong> Sensitive data (wallet addresses, transaction history, cost basis) is encrypted in our database using industry-standard AES-256 encryption. If someone gains database access, they get ciphertext, not plaintext holdings data.`,
    p2: `<strong>Encryption in transit:</strong> All communication between your browser and Almstins uses HTTPS/TLS 1.3. Your data is encrypted while traveling over the network.`,
    p3: `<strong>Secure infrastructure:</strong> Almstins is hosted on Render with automatic SSL certificates, DDoS protection, and regular security updates. We don't manage our own servers.`,
  },
  billing: {
    heading: 'Billing & Payment',
    p1: `Almstins uses Stripe to handle all billing. We never see, store, or process your credit card details. Stripe is a PCI-DSS Level 1 service provider, the highest certification level for payment security.`,
    p2: `What we store: whether your account has a paid subscription, your subscription tier, and when your subscription renews. Stripe stores the rest (card details, billing address, etc.).`,
  },
  auth: {
    heading: 'Authentication Options',
    intro: `You have three ways to sign in to Almstins:`,
    items: [
      `<strong>Email address (most private)</strong> — Create a dedicated email address just for Almstins — one that isn't tied to your real name. Only that address is stored in our database, and you control the password. This is the simplest way to keep your identity separate from your holdings — no technical setup.`,
      `<strong>Google Sign-In</strong> — Google handles authentication. We receive only your email address from Google, and we never store your Google password.`,
      `<strong>GitHub Sign-In</strong> — Sign in with an existing GitHub account. We receive only your GitHub account identifier and never store a password.`,
    ],
    outro: `In all cases, your login credentials are never shared with third parties, and we never use them to access any external service on your behalf (like your exchange account or blockchain).`,
  },
  deletion: {
    heading: 'Data Deletion & Export',
    p1: `<strong>Export your data:</strong> You can request a complete export of your Almstins data (transactions, addresses, notes, settings) in JSON format. Email hello@almstins.com to request it.`,
    p2: `<strong>Delete your account:</strong> You can delete your account and all associated data at any time. Once deleted, we have no way to recover it. Deletion takes effect immediately. Email hello@almstins.com or delete it directly from your account settings.`,
  },
  thirdParty: {
    heading: 'Third-Party Services',
    intro: `Almstins uses a small set of external services:`,
    items: [
      `<strong>Stripe</strong> (payments) — PCI-DSS Level 1. Handles all billing and card processing. We never see your card details.`,
      `<strong>CoinGecko</strong> (historical prices) — Public API. We request historical cryptocurrency prices; CoinGecko doesn't know which assets you own, only that we asked for a price on a given date.`,
      `<strong>Etherscan / Snowtrace / Blockstream</strong> (blockchain data) — Public explorers. We query transaction details using your wallet addresses. These services don't know you're Almstins; they see an API request for public data.`,
      `<strong>Google / GitHub</strong> (authentication) — Only if you sign in via these providers. They know you signed into Almstins; we know only your email or ID from them.`,
    ],
    outro: `None of these services can access your private keys, move your funds, or see anything except the specific requests we make.`,
  },
  compliance: {
    heading: 'Regulatory Compliance',
    intro: `Almstins is a bookkeeping and verification tool, not a financial service, custodian, or investment advisor. As such, it's not regulated as a bank or money transmitter in most jurisdictions. However, we take compliance seriously:`,
    items: [
      `We follow GDPR (European privacy) and CCPA (California privacy) requirements.`,
      `We do not knowingly serve users in countries with comprehensive sanctions (e.g., Cuba, Iran, North Korea, Syria).`,
      `We do not process transactions or hold funds; we only track and organize data you provide.`,
    ],
  },
  faq: {
    heading: 'Frequently Asked Questions',
    items: [
      {
        q: `Can Almstins move my funds or trade on my behalf?`,
        a: `No. Almstins has no private keys, no signing authority, and no connection to your wallets or exchanges. It can only read and organize data that's already public on the blockchain or that you import from a CSV.`,
      },
      {
        q: `What if Almstins is hacked?`,
        a: `An attacker would gain access to: your wallet addresses, transaction history, and cost basis records (all encrypted, but decryptable with a stolen database key). They would <strong>not</strong> gain access to your private keys, card details, or Stripe data. Your funds are safe because they're on the blockchain, not in Almstins. To minimize risk, use a dedicated email address for Almstins that isn't tied to your real name — so even the encrypted holdings data isn't linked to your identity.`,
      },
      {
        q: `Why does Almstins need my wallet addresses?`,
        a: `To track what you own. Almstins reads the public blockchain by address (anyone can do this) to fetch your current holdings and historical transactions. The addresses themselves are public; your identity is not—unless you link them manually or the blockchain analysis proves otherwise.`,
      },
      {
        q: `Does Almstins track me across the internet?`,
        a: `No. We don't use tracking pixels, cookies for tracking, or third-party analytics platforms. We log standard server metrics (IP address, request time, response code) for security and debugging, but we don't sell or share this data.`,
      },
      {
        q: `Can I use Almstins if I'm worried about privacy?`,
        a: `Yes. The most privacy-conscious approach: use a dedicated email address that isn't tied to your real name, and (for maximum separation) track a dedicated blockchain address that isn't publicly linked to your identity. That way, only you know the connection between your identity and your holdings.`,
      },
      {
        q: `Is Almstins open source?`,
        a: `Not yet, but we're considering it. The core logic (address verification, transaction parsing, cost basis calculation) could be audited by the community if published. For now, you can verify the no-wallet-connection claim by reading the client-side code in your browser's developer tools.`,
      },
      {
        q: `Who should I contact with security concerns?`,
        a: `Email security@almstins.com with any security concerns, vulnerability reports, or questions about data handling. Please do not publicly disclose vulnerabilities; give us time to fix them.`,
      },
    ],
  },
  footer: {
    p1: `<strong>Last updated:</strong> June 5, 2026. This page is the source of truth for Almstins' security and privacy practices. Practices may change; we will update this page and notify affected users of material changes.`,
    p2: `<strong>Not financial or legal advice.</strong> This page describes technical and operational practices. For questions about whether Almstins is right for your specific situation, consult a financial advisor, tax professional, or attorney.`,
  },
};

export const es: SecurityContent = {
  lang: 'es',
  meta: { title: 'Seguridad y Privacidad — Almstins' },
  hero: {
    title: 'Seguridad y Privacidad',
    subtitle: `Cómo Almstins protege tus datos y por qué su arquitectura —no solo las promesas— lo hace seguro.`,
  },
  corePromise: {
    heading: 'La Promesa Central',
    p1: `Almstins nunca se conecta a tu billetera, nunca solicita tus llaves privadas y nunca toca tu autoridad de firma. Lee tus tenencias desde la blockchain pública por dirección —de la misma forma en que cualquiera en internet puede consultar qué hay en una billetera. La diferencia es que Almstins organiza esos datos en un solo lugar, registra su historial y te ayuda a verificar direcciones antes de que envíes fondos.`,
    p2: `<strong>Esto no es una promesa que hacemos. Es una limitación arquitectónica que integramos.</strong> Puedes verificarlo tú mismo: Almstins no tiene ningún mecanismo de conexión de billetera en el código, ninguna interfaz de firma y ninguna forma de solicitar permisos a tu billetera.`,
  },
  dataStore: {
    heading: 'Qué Datos Guardamos',
    storeIntro: `Cuando usas Almstins, guardamos:`,
    storeItems: [
      `<strong>Tu dirección de correo electrónico</strong> — solo para iniciar sesión. ¿Quieres máxima privacidad? Usa una dirección de correo dedicada que no esté ligada a tu nombre real — solo esa dirección vive en nuestra base de datos. También puedes iniciar sesión con Google o GitHub.`,
      `<strong>Las direcciones de billetera que agregues</strong> — las direcciones de blockchain que posees (p. ej., 0x1234...). Son datos públicos; cualquiera ya puede ver qué hay en estas direcciones en la blockchain.`,
      `<strong>Historial de transacciones</strong> — importado de los CSV que subes (de exchanges como Coinbase, Kraken, Gemini, etc.) o leído directamente de la blockchain. Guardamos la fecha, el monto, el precio y tus notas sobre cada transacción.`,
      `<strong>Registros de base de costo</strong> — el precio que pagaste por cada activo, calculado a partir de tu historial de transacciones.`,
      `<strong>Configuraciones y preferencias</strong> — etiquetas que creas, alertas que configuras y otros ajustes.`,
    ],
    notStoreIntro: `<strong>No</strong> guardamos:`,
    notStoreItems: [
      `Tus llaves privadas, frases semilla o palabras de recuperación (no tenemos forma de acceder a ellas).`,
      `Tu información de pago — Stripe gestiona toda la facturación, y nunca vemos los datos de tu tarjeta.`,
      `Tu nombre real (a menos que lo proporciones voluntariamente en las notas).`,
      `Tu dirección IP ni tu comportamiento de navegación más allá de los registros estándar del servidor.`,
    ],
  },
  callout: {
    p1: `<strong>La Pregunta de Lucía:</strong> «Si sufren una brecha, ¿alguien tendrá un mapa de quién posee qué?»`,
    p2: `Sí; ante una brecha, un atacante sabría: qué direcciones de blockchain posees, cuánto hay en ellas y tu historial de transacciones (fechas, montos, activos). Son datos financieros sensibles. Pero no son lo mismo que tus llaves privadas: no pueden mover tus fondos, no pueden operar en tu nombre, no pueden firmar nada.`,
    p3: `Para minimizar este riesgo, ciframos todos los datos sensibles en reposo (ver más abajo), y recomendamos agregar un correo electrónico dedicado para Almstins (no tu correo principal) para que tu identidad no quede automáticamente ligada a los datos de tus tenencias.`,
  },
  encryption: {
    heading: 'Cifrado y Seguridad de Datos',
    p1: `<strong>Cifrado en reposo:</strong> Los datos sensibles (direcciones de billetera, historial de transacciones, base de costo) se cifran en nuestra base de datos con cifrado AES-256, un estándar de la industria. Si alguien obtiene acceso a la base de datos, obtiene texto cifrado, no datos de tenencias en texto plano.`,
    p2: `<strong>Cifrado en tránsito:</strong> Toda la comunicación entre tu navegador y Almstins usa HTTPS/TLS 1.3. Tus datos viajan cifrados por la red.`,
    p3: `<strong>Infraestructura segura:</strong> Almstins está alojado en Render con certificados SSL automáticos, protección contra DDoS y actualizaciones de seguridad regulares. No administramos nuestros propios servidores.`,
  },
  billing: {
    heading: 'Facturación y Pagos',
    p1: `Almstins usa Stripe para gestionar toda la facturación. Nunca vemos, guardamos ni procesamos los datos de tu tarjeta. Stripe es un proveedor de servicios PCI-DSS Nivel 1, el nivel de certificación más alto en seguridad de pagos.`,
    p2: `Lo que guardamos: si tu cuenta tiene una suscripción de pago, tu nivel de suscripción y cuándo se renueva. Stripe guarda el resto (datos de la tarjeta, dirección de facturación, etc.).`,
  },
  auth: {
    heading: 'Opciones de Autenticación',
    intro: `Tienes tres formas de iniciar sesión en Almstins:`,
    items: [
      `<strong>Correo electrónico (la opción más privada)</strong> — Crea una dirección de correo dedicada solo para Almstins — una que no esté ligada a tu nombre real. Solo esa dirección se guarda en nuestra base de datos, y tú controlas la contraseña. Es la forma más sencilla de mantener tu identidad separada de tus tenencias — sin configuración técnica.`,
      `<strong>Inicio de sesión con Google</strong> — Google gestiona la autenticación. Solo recibimos tu dirección de correo de Google, y nunca guardamos tu contraseña de Google.`,
      `<strong>Inicio de sesión con GitHub</strong> — Inicia sesión con una cuenta de GitHub existente. Solo recibimos tu identificador de cuenta de GitHub y nunca guardamos una contraseña.`,
    ],
    outro: `En todos los casos, tus credenciales de inicio de sesión nunca se comparten con terceros, y nunca las usamos para acceder a ningún servicio externo en tu nombre (como tu cuenta de exchange o la blockchain).`,
  },
  deletion: {
    heading: 'Eliminación y Exportación de Datos',
    p1: `<strong>Exporta tus datos:</strong> Puedes solicitar una exportación completa de tus datos de Almstins (transacciones, direcciones, notas, configuraciones) en formato JSON. Escribe a hello@almstins.com para solicitarla.`,
    p2: `<strong>Elimina tu cuenta:</strong> Puedes eliminar tu cuenta y todos los datos asociados en cualquier momento. Una vez eliminados, no tenemos forma de recuperarlos. La eliminación surte efecto de inmediato. Escribe a hello@almstins.com o elimínala directamente desde la configuración de tu cuenta.`,
  },
  thirdParty: {
    heading: 'Servicios de Terceros',
    intro: `Almstins usa un pequeño conjunto de servicios externos:`,
    items: [
      `<strong>Stripe</strong> (pagos) — PCI-DSS Nivel 1. Gestiona toda la facturación y el procesamiento de tarjetas. Nunca vemos los datos de tu tarjeta.`,
      `<strong>CoinGecko</strong> (precios históricos) — API pública. Solicitamos precios históricos de criptomonedas; CoinGecko no sabe qué activos posees, solo que pedimos un precio en una fecha determinada.`,
      `<strong>Etherscan / Snowtrace / Blockstream</strong> (datos de blockchain) — Exploradores públicos. Consultamos detalles de transacciones usando tus direcciones de billetera. Estos servicios no saben que eres Almstins; ven una solicitud de API por datos públicos.`,
      `<strong>Google / GitHub</strong> (autenticación) — Solo si inicias sesión con estos proveedores. Ellos saben que iniciaste sesión en Almstins; nosotros solo conocemos tu correo o ID a través de ellos.`,
    ],
    outro: `Ninguno de estos servicios puede acceder a tus llaves privadas, mover tus fondos ni ver nada más allá de las solicitudes específicas que hacemos.`,
  },
  compliance: {
    heading: 'Cumplimiento Normativo',
    intro: `Almstins es una herramienta de contabilidad y verificación, no un servicio financiero, custodio ni asesor de inversiones. Como tal, no está regulado como un banco ni como un transmisor de dinero en la mayoría de las jurisdicciones. Sin embargo, nos tomamos el cumplimiento en serio:`,
    items: [
      `Cumplimos con los requisitos del RGPD (privacidad europea) y la CCPA (privacidad de California).`,
      `No prestamos servicio a sabiendas a usuarios en países con sanciones integrales (p. ej., Cuba, Irán, Corea del Norte, Siria).`,
      `No procesamos transacciones ni custodiamos fondos; solo registramos y organizamos los datos que proporcionas.`,
    ],
  },
  faq: {
    heading: 'Preguntas Frecuentes',
    items: [
      {
        q: `¿Puede Almstins mover mis fondos u operar en mi nombre?`,
        a: `No. Almstins no tiene llaves privadas, ni autoridad de firma, ni conexión con tus billeteras o exchanges. Solo puede leer y organizar datos que ya son públicos en la blockchain o que importas desde un CSV.`,
      },
      {
        q: `¿Qué pasa si hackean a Almstins?`,
        a: `Un atacante obtendría acceso a: tus direcciones de billetera, tu historial de transacciones y tus registros de base de costo (todos cifrados, pero descifrables con una clave de base de datos robada). <strong>No</strong> obtendría acceso a tus llaves privadas, los datos de tu tarjeta ni los datos de Stripe. Tus fondos están seguros porque están en la blockchain, no en Almstins. Para minimizar el riesgo, usa una dirección de correo dedicada para Almstins que no esté ligada a tu nombre real — así, ni siquiera los datos cifrados de tus tenencias quedan vinculados a tu identidad.`,
      },
      {
        q: `¿Por qué Almstins necesita mis direcciones de billetera?`,
        a: `Para registrar lo que posees. Almstins lee la blockchain pública por dirección (cualquiera puede hacerlo) para obtener tus tenencias actuales y tus transacciones históricas. Las direcciones en sí son públicas; tu identidad no lo es, a menos que las vincules manualmente o el análisis de la blockchain demuestre lo contrario.`,
      },
      {
        q: `¿Almstins me rastrea por internet?`,
        a: `No. No usamos píxeles de rastreo, cookies de seguimiento ni plataformas de analítica de terceros. Registramos métricas estándar del servidor (dirección IP, hora de la solicitud, código de respuesta) por seguridad y depuración, pero no vendemos ni compartimos estos datos.`,
      },
      {
        q: `¿Puedo usar Almstins si me preocupa la privacidad?`,
        a: `Sí. El enfoque más cuidadoso con la privacidad: usa una dirección de correo dedicada que no esté ligada a tu nombre real y (para máxima separación) rastrea una dirección de blockchain dedicada que no esté vinculada públicamente a tu identidad. Así, solo tú conoces la conexión entre tu identidad y tus tenencias.`,
      },
      {
        q: `¿Almstins es de código abierto?`,
        a: `Todavía no, pero lo estamos considerando. La lógica central (verificación de direcciones, análisis de transacciones, cálculo de base de costo) podría ser auditada por la comunidad si se publica. Por ahora, puedes verificar la afirmación de «sin conexión de billetera» leyendo el código del lado del cliente en las herramientas de desarrollador de tu navegador.`,
      },
      {
        q: `¿A quién debo contactar por preocupaciones de seguridad?`,
        a: `Escribe a security@almstins.com con cualquier preocupación de seguridad, reporte de vulnerabilidad o pregunta sobre el manejo de datos. Por favor, no divulgues vulnerabilidades públicamente; danos tiempo para corregirlas.`,
      },
    ],
  },
  footer: {
    p1: `<strong>Última actualización:</strong> 5 de junio de 2026. Esta página es la fuente de verdad sobre las prácticas de seguridad y privacidad de Almstins. Las prácticas pueden cambiar; actualizaremos esta página y notificaremos a los usuarios afectados ante cambios importantes.`,
    p2: `<strong>No es asesoría financiera ni legal.</strong> Esta página describe prácticas técnicas y operativas. Para preguntas sobre si Almstins es adecuado para tu situación específica, consulta a un asesor financiero, un profesional de impuestos o un abogado.`,
  },
};

export const fr: SecurityContent = {
  lang: 'fr',
  meta: { title: 'Sécurité et confidentialité — Almstins' },
  hero: {
    title: 'Sécurité et confidentialité',
    subtitle: `Comment Almstins protège vos données et pourquoi son architecture — et pas seulement des promesses — la rend sûre.`,
  },
  corePromise: {
    heading: 'La promesse fondamentale',
    p1: `Almstins ne se connecte jamais à votre portefeuille, ne demande jamais vos clés privées et ne touche jamais à votre autorité de signature. Il lit vos avoirs depuis la blockchain publique par adresse — de la même manière que n'importe qui sur Internet peut consulter ce que contient un portefeuille. La différence, c'est qu'Almstins organise ces données en un seul endroit, en suit l'historique et vous aide à vérifier les adresses avant d'envoyer des fonds.`,
    p2: `<strong>Ce n'est pas une promesse que nous faisons. C'est une contrainte architecturale que nous avons intégrée.</strong> Vous pouvez le vérifier vous-même : Almstins n'a aucun mécanisme de connexion de portefeuille dans le code, aucune interface de signature et aucun moyen de demander des autorisations à votre portefeuille.`,
  },
  dataStore: {
    heading: 'Quelles données nous conservons',
    storeIntro: `Lorsque vous utilisez Almstins, nous conservons :`,
    storeItems: [
      `<strong>Votre adresse e-mail</strong> — uniquement pour la connexion au compte. Vous voulez une confidentialité maximale ? Utilisez une adresse e-mail dédiée qui n'est pas liée à votre vrai nom — seule cette adresse figure dans notre base de données. Vous pouvez aussi vous connecter avec Google ou GitHub.`,
      `<strong>Les adresses de portefeuille que vous ajoutez</strong> — les adresses blockchain que vous possédez (p. ex. 0x1234...). Ce sont des données publiques ; n'importe qui peut déjà voir ce que contiennent ces adresses sur la blockchain.`,
      `<strong>L'historique des transactions</strong> — importé des fichiers CSV que vous téléversez (depuis des plateformes comme Coinbase, Kraken, Gemini, etc.) ou lu directement sur la blockchain. Nous conservons la date, le montant, le prix et vos notes sur chaque transaction.`,
      `<strong>Les registres de prix de revient</strong> — le prix que vous avez payé pour chaque actif, calculé à partir de votre historique de transactions.`,
      `<strong>Les paramètres et préférences</strong> — les étiquettes que vous créez, les alertes que vous définissez et d'autres réglages.`,
    ],
    notStoreIntro: `Nous ne conservons <strong>pas</strong> :`,
    notStoreItems: [
      `Vos clés privées, phrases de récupération (seed) ou mots de récupération (nous n'avons aucun moyen d'y accéder).`,
      `Vos informations de paiement — Stripe gère toute la facturation, et nous ne voyons jamais les détails de votre carte bancaire.`,
      `Votre vrai nom (sauf si vous le fournissez volontairement dans des notes).`,
      `Votre adresse IP ou votre comportement de navigation au-delà des journaux serveur standards.`,
    ],
  },
  callout: {
    p1: `<strong>La question de Lucia :</strong> « En cas de violation de données, est-ce que quelqu'un dispose d'une carte de qui possède quoi ? »`,
    p2: `Oui ; en cas de violation, un attaquant apprendrait : quelles adresses blockchain vous possédez, combien elles contiennent et votre historique de transactions (dates, montants, actifs). Ce sont des données financières sensibles. Mais ce n'est pas la même chose que vos clés privées : il ne peut pas déplacer vos fonds, il ne peut pas négocier en votre nom, il ne peut rien signer.`,
    p3: `Pour réduire ce risque, nous chiffrons toutes les données sensibles au repos (voir ci-dessous), et nous recommandons d'utiliser une adresse e-mail dédiée à Almstins (pas votre adresse principale) afin que votre identité ne soit pas automatiquement liée aux données de vos avoirs.`,
  },
  encryption: {
    heading: 'Chiffrement et sécurité des données',
    p1: `<strong>Chiffrement au repos :</strong> Les données sensibles (adresses de portefeuille, historique des transactions, prix de revient) sont chiffrées dans notre base de données avec le chiffrement AES-256, une norme de l'industrie. Si quelqu'un obtient l'accès à la base de données, il obtient du texte chiffré, pas vos avoirs en clair.`,
    p2: `<strong>Chiffrement en transit :</strong> Toutes les communications entre votre navigateur et Almstins utilisent HTTPS/TLS 1.3. Vos données sont chiffrées lorsqu'elles transitent sur le réseau.`,
    p3: `<strong>Infrastructure sécurisée :</strong> Almstins est hébergé sur Render avec des certificats SSL automatiques, une protection contre les attaques DDoS et des mises à jour de sécurité régulières. Nous ne gérons pas nos propres serveurs.`,
  },
  billing: {
    heading: 'Facturation et paiement',
    p1: `Almstins utilise Stripe pour gérer toute la facturation. Nous ne voyons, ne conservons ni ne traitons jamais les détails de votre carte bancaire. Stripe est un prestataire de services certifié PCI-DSS Niveau 1, le plus haut niveau de certification en matière de sécurité des paiements.`,
    p2: `Ce que nous conservons : si votre compte dispose d'un abonnement payant, votre niveau d'abonnement et la date de renouvellement de votre abonnement. Stripe conserve le reste (détails de la carte, adresse de facturation, etc.).`,
  },
  auth: {
    heading: 'Options d\'authentification',
    intro: `Vous avez trois façons de vous connecter à Almstins :`,
    items: [
      `<strong>Adresse e-mail (la plus privée)</strong> — Créez une adresse e-mail dédiée uniquement à Almstins — une qui n'est pas liée à votre vrai nom. Seule cette adresse est conservée dans notre base de données, et vous contrôlez le mot de passe. C'est la façon la plus simple de garder votre identité séparée de vos avoirs — sans configuration technique.`,
      `<strong>Connexion avec Google</strong> — Google gère l'authentification. Nous ne recevons que votre adresse e-mail de Google, et nous ne conservons jamais votre mot de passe Google.`,
      `<strong>Connexion avec GitHub</strong> — Connectez-vous avec un compte GitHub existant. Nous ne recevons que l'identifiant de votre compte GitHub et ne conservons jamais de mot de passe.`,
    ],
    outro: `Dans tous les cas, vos identifiants de connexion ne sont jamais partagés avec des tiers, et nous ne les utilisons jamais pour accéder à un service externe en votre nom (comme votre compte d'échange ou la blockchain).`,
  },
  deletion: {
    heading: 'Suppression et exportation des données',
    p1: `<strong>Exportez vos données :</strong> Vous pouvez demander une exportation complète de vos données Almstins (transactions, adresses, notes, paramètres) au format JSON. Écrivez à hello@almstins.com pour en faire la demande.`,
    p2: `<strong>Supprimez votre compte :</strong> Vous pouvez supprimer votre compte et toutes les données associées à tout moment. Une fois supprimées, nous n'avons aucun moyen de les récupérer. La suppression prend effet immédiatement. Écrivez à hello@almstins.com ou supprimez-le directement depuis les paramètres de votre compte.`,
  },
  thirdParty: {
    heading: 'Services tiers',
    intro: `Almstins utilise un petit ensemble de services externes :`,
    items: [
      `<strong>Stripe</strong> (paiements) — PCI-DSS Niveau 1. Gère toute la facturation et le traitement des cartes. Nous ne voyons jamais les détails de votre carte.`,
      `<strong>CoinGecko</strong> (prix historiques) — API publique. Nous demandons les prix historiques des cryptomonnaies ; CoinGecko ne sait pas quels actifs vous possédez, seulement que nous avons demandé un prix à une date donnée.`,
      `<strong>Etherscan / Snowtrace / Blockstream</strong> (données blockchain) — Explorateurs publics. Nous interrogeons les détails des transactions à l'aide de vos adresses de portefeuille. Ces services ne savent pas que vous êtes sur Almstins ; ils voient une requête d'API pour des données publiques.`,
      `<strong>Google / GitHub</strong> (authentification) — Uniquement si vous vous connectez via ces fournisseurs. Ils savent que vous vous êtes connecté à Almstins ; nous ne connaissons que votre adresse e-mail ou votre identifiant fourni par eux.`,
    ],
    outro: `Aucun de ces services ne peut accéder à vos clés privées, déplacer vos fonds ni voir quoi que ce soit en dehors des requêtes spécifiques que nous effectuons.`,
  },
  compliance: {
    heading: 'Conformité réglementaire',
    intro: `Almstins est un outil de comptabilité et de vérification, pas un service financier, un dépositaire ni un conseiller en investissement. À ce titre, il n'est pas réglementé comme une banque ou un transmetteur de fonds dans la plupart des juridictions. Néanmoins, nous prenons la conformité au sérieux :`,
    items: [
      `Nous respectons les exigences du RGPD (confidentialité européenne) et de la CCPA (confidentialité de la Californie).`,
      `Nous ne servons pas sciemment les utilisateurs des pays faisant l'objet de sanctions globales (p. ex. Cuba, Iran, Corée du Nord, Syrie).`,
      `Nous ne traitons pas de transactions et ne détenons pas de fonds ; nous ne faisons que suivre et organiser les données que vous fournissez.`,
    ],
  },
  faq: {
    heading: 'Foire aux questions',
    items: [
      {
        q: `Almstins peut-il déplacer mes fonds ou négocier en mon nom ?`,
        a: `Non. Almstins n'a pas de clés privées, pas d'autorité de signature et aucune connexion à vos portefeuilles ou plateformes d'échange. Il ne peut que lire et organiser des données déjà publiques sur la blockchain ou que vous importez depuis un CSV.`,
      },
      {
        q: `Que se passe-t-il si Almstins est piraté ?`,
        a: `Un attaquant accéderait à : vos adresses de portefeuille, votre historique de transactions et vos registres de prix de revient (tous chiffrés, mais déchiffrables avec une clé de base de données volée). Il n'accéderait <strong>pas</strong> à vos clés privées, aux détails de votre carte ni aux données Stripe. Vos fonds sont en sécurité car ils sont sur la blockchain, pas dans Almstins. Pour réduire le risque, utilisez une adresse e-mail dédiée à Almstins qui n'est pas liée à votre vrai nom — ainsi, même les données chiffrées de vos avoirs ne sont pas liées à votre identité.`,
      },
      {
        q: `Pourquoi Almstins a-t-il besoin de mes adresses de portefeuille ?`,
        a: `Pour suivre ce que vous possédez. Almstins lit la blockchain publique par adresse (n'importe qui peut le faire) pour récupérer vos avoirs actuels et vos transactions passées. Les adresses elles-mêmes sont publiques ; votre identité ne l'est pas — sauf si vous les liez manuellement ou si l'analyse de la blockchain prouve le contraire.`,
      },
      {
        q: `Almstins me suit-il à travers Internet ?`,
        a: `Non. Nous n'utilisons pas de pixels de suivi, de cookies de pistage ni de plateformes d'analyse tierces. Nous enregistrons des métriques serveur standards (adresse IP, heure de la requête, code de réponse) à des fins de sécurité et de débogage, mais nous ne vendons ni ne partageons ces données.`,
      },
      {
        q: `Puis-je utiliser Almstins si je me soucie de ma confidentialité ?`,
        a: `Oui. L'approche la plus respectueuse de la confidentialité : utilisez une adresse e-mail dédiée qui n'est pas liée à votre vrai nom et (pour une séparation maximale) suivez une adresse blockchain dédiée qui n'est pas publiquement liée à votre identité. Ainsi, vous seul connaissez le lien entre votre identité et vos avoirs.`,
      },
      {
        q: `Almstins est-il à code ouvert ?`,
        a: `Pas encore, mais nous l'envisageons. La logique centrale (vérification des adresses, analyse des transactions, calcul du prix de revient) pourrait être auditée par la communauté si elle était publiée. Pour l'instant, vous pouvez vérifier l'affirmation « aucune connexion de portefeuille » en lisant le code côté client dans les outils de développement de votre navigateur.`,
      },
      {
        q: `Qui dois-je contacter pour des préoccupations de sécurité ?`,
        a: `Écrivez à security@almstins.com pour toute préoccupation de sécurité, signalement de vulnérabilité ou question sur le traitement des données. Veuillez ne pas divulguer publiquement les vulnérabilités ; donnez-nous le temps de les corriger.`,
      },
    ],
  },
  footer: {
    p1: `<strong>Dernière mise à jour :</strong> 5 juin 2026. Cette page fait foi en matière de pratiques de sécurité et de confidentialité d'Almstins. Les pratiques peuvent évoluer ; nous mettrons à jour cette page et informerons les utilisateurs concernés en cas de changements importants.`,
    p2: `<strong>Ni conseil financier ni juridique.</strong> Cette page décrit des pratiques techniques et opérationnelles. Pour savoir si Almstins convient à votre situation particulière, consultez un conseiller financier, un fiscaliste ou un avocat.`,
  },
};
