// About page — all user-visible strings (EN · ES · FR).
//
// Route-based i18n (see design.claude.md → "i18n Pattern — Public-Facing Pages").
// Rendered by src/components/AboutPage.astro; thin wrappers at
// src/pages/about.astro (en), /about/es.astro (es), /about/fr.astro (fr).
//
// Strings that carry inline <strong> are rendered with set:html in the
// component (callout, why.*, believe.items, reach.body); everything else is
// plain text via {} auto-escaping.

import type { Lang } from '@/lib/i18n/locale';

export interface AboutContent {
  lang: Lang;
  meta: { title: string };
  hero: {
    photoAlt: string;
    greeting: string;
    line1: string;
    line2: string;
  };
  problem: { heading: string; p1: string; p2: string; p3: string };
  callout: string; // HTML
  why: { heading: string; p1: string; p2: string; p3: string; p4: string }; // each HTML
  believe: { heading: string; intro: string; items: string[] }; // items HTML
  matters: { heading: string; p1: string; p2: string; p3: string };
  building: { heading: string; intro: string; items: string[]; outro: string };
  beta: { heading: string; p1: string; p2: string };
  reach: { heading: string; body: string }; // HTML
}

export const en: AboutContent = {
  lang: 'en',
  meta: { title: 'About Almstins — Built by a Teacher Who Felt the Problem' },
  hero: {
    photoAlt: 'Donnie Starkey',
    greeting: `Hi. I'm Donnie.`,
    line1: `I'm a teacher and builder.`,
    line2: `I built Almstins because I felt the problem personally.`,
  },
  problem: {
    heading: 'The Problem I Hit',
    p1: `I bought some Bitcoin and Ethereum about four years ago. I took "not your keys, not your coins" seriously, so I moved it into a self-custody wallet. I also knew I needed to diversify, so I spread my holdings across several wallets — if one was ever compromised, the rest stayed safe.`,
    p2: `Then tax season arrived. I had no idea what I actually owned, what it cost me, or where it was. I had fragments across different places — a spreadsheet, an exchange CSV, some scribbled notes, and a lot of confusion. To reconstruct the history, I had to spend weeks digging through transaction hashes and receipt emails. I tried tax software, but it never saw the full picture, so I couldn't trust the numbers it gave me.`,
    p3: `That's when I realized the bigger problem: there was no tool that let me see my full picture even if I connected my wallets. A wallet connection is just another attack surface, so I avoid them. And there was no way to verify that an address was safe before I sent money to it.`,
  },
  callout: `<strong>I'm a teacher.</strong> I know that the best tool is the one that explains itself and earns trust by being clear, not clever. I know that people don't need jargon; they need clarity. And I know that when something matters, you have to build it right or not at all.`,
  why: {
    heading: 'Why I Built Almstins This Way',
    p1: `<strong>No wallet connection, ever.</strong> The moment you hand your wallet to an app, you've created a new risk. Almstins reads your blockchain data the same way you can on Etherscan—publicly. Your keys stay safe because they never leave your wallet.`,
    p2: `<strong>Bookkeeping as infrastructure.</strong> Accountability requires documentation. Almstins isn't a trading tool or a price tracker. It's a record. Every asset, every transaction, every cost basis. Because you can't manage what you can't measure, and you can't prove your position without a history.`,
    p3: `<strong>Safety before the click.</strong> I built the wallet checker to answer one question: "Is this address safe before I send?" Scams, sanctions, honeypots, phishing—they all happen after the click. The checker lets you verify first.`,
    p4: `<strong>Clear over clever.</strong> The docs are plain English. The error messages tell you what went wrong and what to do. The safety verdicts don't hide behind a risk score; they tell you what we actually know and don't know.`,
  },
  believe: {
    heading: 'What I Believe',
    intro: `Crypto is infrastructure that lets individuals move, store, and manage their own money without asking permission. But infrastructure only works if people can trust it. Trust doesn't come from marketing; it comes from:`,
    items: [
      `<strong>Honest design decisions.</strong> Building constraints into the architecture (no wallet connection) instead of hiding behind promises.`,
      `<strong>Transparency.</strong> Saying what we store, what we don't, what could go wrong, and how we protect it.`,
      `<strong>Completeness.</strong> Solving the full problem—not just the exciting part, but the boring bookkeeping part that actually matters.`,
      `<strong>Clarity.</strong> Writing for people, not algorithms. Explaining in English, not jargon.`,
    ],
  },
  matters: {
    heading: 'Why This Matters Right Now',
    p1: `Crypto's moving from speculation into infrastructure. Stablecoins for remittances, Bitcoin as reserve assets, DeFi as the backbone of cross-border payments. The users arriving aren't degens—they're people who need the infrastructure to actually work.`,
    p2: `They need tools that don't break, don't betray, and don't ask them to trust blindly. They need documentation so they can prove what they own. They need safety so they don't send funds to the wrong place.`,
    p3: `That's what Almstins is. Not a bet on price, not a playground. Infrastructure.`,
  },
  building: {
    heading: `What I'm Building Toward`,
    intro: `Almstins today is a portfolio tracker + safety checker + bookkeeping tool. The roadmap is longer:`,
    items: [
      `A MetaMask Snap that checks addresses before you sign, so safety reaches into your wallet itself.`,
      `Deeper integration with tax professionals and advisories so Almstins isn't just a tool you use—it's a layer your accountant and your advisor both understand.`,
      `Ecosystem tooling that lets other builders plug safety and accountability into their products.`,
    ],
    outro: `The north star: make it obvious that the best crypto product is the one that doesn't ask you to trust it blindly. Make documentation and verification as easy as the transaction itself.`,
  },
  beta: {
    heading: 'A Note on Beta',
    p1: `Almstins is in beta. That's not an apology; it's a description. We're still learning what advisories need, what emerging-market users need, what the next layer of security looks like. We're building in public and iterating based on real feedback.`,
    p2: `Being in beta doesn't mean the code is unstable or that your data is at risk. It means we're still deciding what comes next based on what you tell us actually matters.`,
  },
  reach: {
    heading: 'How to Reach Me',
    body: `If you have feedback, questions, or just want to talk about where this is heading, I read every message. Email me at <strong>hello@almstins.com</strong> or find me on LinkedIn.`,
  },
};

export const es: AboutContent = {
  lang: 'es',
  meta: { title: 'Sobre Almstins — Hecho por un educador que vivió el problema' },
  hero: {
    photoAlt: 'Donnie Starkey',
    greeting: 'Hola. Soy Donnie.',
    line1: 'Soy educador y desarrollador.',
    line2: 'Construí Almstins porque viví el problema en carne propia.',
  },
  problem: {
    heading: 'El Problema que Viví',
    p1: `Compré algo de Bitcoin y Ethereum hace unos cuatro años. Me tomé en serio el principio «not your keys, not your coins» (si no son tus llaves, no son tus monedas), así que lo pasé a una billetera de custodia propia. También sabía que necesitaba diversificar, así que repartí mis tenencias en varias billeteras — si una se veía comprometida, las demás quedaban a salvo.`,
    p2: `Luego llegó la temporada de impuestos. No tenía idea de qué poseía realmente, cuánto me había costado ni dónde estaba. Tenía fragmentos repartidos en distintos lugares — una hoja de cálculo, un CSV de un exchange, algunas notas garabateadas y mucha confusión. Para reconstruir el historial, tuve que pasar semanas hurgando entre hashes de transacciones y correos de recibos. Probé software de impuestos, pero nunca veía el panorama completo, así que no podía confiar en los números que me daba.`,
    p3: `Ahí fue cuando me di cuenta del problema más grande: no había ninguna herramienta que me dejara ver mi panorama completo aunque conectara mis billeteras. Una conexión de billetera no es más que otra superficie de ataque, así que las evito. Y no había forma de verificar que una dirección fuera segura antes de enviarle dinero.`,
  },
  callout: `<strong>Soy educador.</strong> Sé que la mejor herramienta es la que se explica sola y se gana la confianza siendo clara, no astuta. Sé que la gente no necesita jerga; necesita claridad. Y sé que cuando algo importa, hay que construirlo bien o no construirlo.`,
  why: {
    heading: 'Por Qué Construí Almstins Así',
    p1: `<strong>Sin conexión de billetera, nunca.</strong> En el momento en que le entregas tu billetera a una aplicación, creas un riesgo nuevo. Almstins lee los datos de tu blockchain de la misma forma en que tú puedes hacerlo en Etherscan: públicamente. Tus llaves permanecen seguras porque nunca salen de tu billetera.`,
    p2: `<strong>Contabilidad como infraestructura.</strong> La rendición de cuentas exige documentación. Almstins no es una herramienta de trading ni un rastreador de precios. Es un registro. Cada activo, cada transacción, cada base de costo. Porque no puedes gestionar lo que no puedes medir, y no puedes probar tu posición sin un historial.`,
    p3: `<strong>Seguridad antes del clic.</strong> Construí el verificador de billeteras para responder una sola pregunta: «¿Es segura esta dirección antes de enviar?». Las estafas, las sanciones, los honeypots y el phishing ocurren todos después del clic. El verificador te deja comprobar primero.`,
    p4: `<strong>Claro antes que astuto.</strong> La documentación está en lenguaje sencillo. Los mensajes de error te dicen qué salió mal y qué hacer. Los veredictos de seguridad no se esconden tras un puntaje de riesgo; te dicen lo que de verdad sabemos y lo que no.`,
  },
  believe: {
    heading: 'En Qué Creo',
    intro: `El cripto es infraestructura que permite a las personas mover, guardar y gestionar su propio dinero sin pedir permiso. Pero la infraestructura solo funciona si la gente puede confiar en ella. La confianza no viene del marketing; viene de:`,
    items: [
      `<strong>Decisiones de diseño honestas.</strong> Integrar las limitaciones en la arquitectura (sin conexión de billetera) en lugar de esconderse tras promesas.`,
      `<strong>Transparencia.</strong> Decir qué guardamos, qué no, qué podría salir mal y cómo lo protegemos.`,
      `<strong>Integridad.</strong> Resolver el problema completo — no solo la parte emocionante, sino la aburrida parte contable que de verdad importa.`,
      `<strong>Claridad.</strong> Escribir para personas, no para algoritmos. Explicar en lenguaje sencillo, sin jerga.`,
    ],
  },
  matters: {
    heading: 'Por Qué Esto Importa Ahora',
    p1: `El cripto está pasando de la especulación a la infraestructura. Stablecoins para remesas, Bitcoin como activo de reserva, DeFi como columna vertebral de los pagos transfronterizos. Los usuarios que están llegando no son especuladores — son personas que necesitan que la infraestructura realmente funcione.`,
    p2: `Necesitan herramientas que no fallen, que no traicionen y que no les pidan confiar a ciegas. Necesitan documentación para poder probar lo que poseen. Necesitan seguridad para no enviar fondos al lugar equivocado.`,
    p3: `Eso es Almstins. No una apuesta al precio, no un patio de juegos. Infraestructura.`,
  },
  building: {
    heading: 'Hacia Dónde Voy',
    intro: `Almstins hoy es un rastreador de portafolio + verificador de seguridad + herramienta de contabilidad. La hoja de ruta es más larga:`,
    items: [
      `Un Snap de MetaMask que verifica direcciones antes de que firmes, para que la seguridad llegue hasta tu propia billetera.`,
      `Integración más profunda con profesionales de impuestos y asesores, para que Almstins no sea solo una herramienta que usas — sea una capa que tanto tu contador como tu asesor entiendan.`,
      `Herramientas de ecosistema que permitan a otros desarrolladores integrar seguridad y rendición de cuentas en sus productos.`,
    ],
    outro: `La estrella guía: dejar en claro que el mejor producto cripto es el que no te pide confiar a ciegas. Hacer que la documentación y la verificación sean tan fáciles como la transacción misma.`,
  },
  beta: {
    heading: 'Una Nota Sobre la Beta',
    p1: `Almstins está en beta. Eso no es una disculpa; es una descripción. Seguimos aprendiendo qué necesitan los asesores, qué necesitan los usuarios de mercados emergentes y cómo se ve la siguiente capa de seguridad. Construimos en público e iteramos con base en comentarios reales.`,
    p2: `Estar en beta no significa que el código sea inestable ni que tus datos estén en riesgo. Significa que todavía estamos decidiendo qué viene después según lo que nos digas que de verdad importa.`,
  },
  reach: {
    heading: 'Cómo Contactarme',
    body: `Si tienes comentarios, preguntas o solo quieres hablar sobre hacia dónde va esto, leo cada mensaje. Escríbeme a <strong>hello@almstins.com</strong> o encuéntrame en LinkedIn.`,
  },
};

export const fr: AboutContent = {
  lang: 'fr',
  meta: { title: `À propos d'Almstins — Créé par un enseignant qui a vécu le problème` },
  hero: {
    photoAlt: 'Donnie Starkey',
    greeting: 'Bonjour. Je suis Donnie.',
    line1: 'Je suis enseignant et créateur.',
    line2: `J'ai créé Almstins parce que j'ai vécu le problème personnellement.`,
  },
  problem: {
    heading: `Le problème que j'ai rencontré`,
    p1: `J'ai acheté du Bitcoin et de l'Ethereum il y a environ quatre ans. J'ai pris au sérieux le principe « not your keys, not your coins » (si ce ne sont pas vos clés, ce ne sont pas vos pièces), alors je les ai transférés dans un portefeuille en auto-conservation. Je savais aussi qu'il fallait diversifier, donc j'ai réparti mes avoirs sur plusieurs portefeuilles — si l'un était un jour compromis, les autres restaient à l'abri.`,
    p2: `Puis la période des impôts est arrivée. Je n'avais aucune idée de ce que je possédais réellement, de ce que cela m'avait coûté, ni d'où cela se trouvait. J'avais des fragments éparpillés à différents endroits — un tableur, un CSV d'une plateforme d'échange, quelques notes griffonnées et beaucoup de confusion. Pour reconstituer l'historique, j'ai dû passer des semaines à fouiller dans les hachages de transactions et les courriels de reçus. J'ai essayé des logiciels d'impôts, mais ils ne voyaient jamais le tableau complet, donc je ne pouvais pas me fier aux chiffres qu'ils me donnaient.`,
    p3: `C'est là que j'ai compris le problème plus profond : aucun outil ne me permettait de voir mon tableau complet, même en connectant mes portefeuilles. Une connexion de portefeuille n'est qu'une surface d'attaque de plus, alors je les évite. Et il n'existait aucun moyen de vérifier qu'une adresse était sûre avant de lui envoyer de l'argent.`,
  },
  callout: `<strong>Je suis enseignant.</strong> Je sais que le meilleur outil est celui qui s'explique de lui-même et gagne la confiance en étant clair, pas astucieux. Je sais que les gens n'ont pas besoin de jargon ; ils ont besoin de clarté. Et je sais que lorsqu'une chose compte vraiment, il faut la construire correctement ou pas du tout.`,
  why: {
    heading: `Pourquoi j'ai construit Almstins ainsi`,
    p1: `<strong>Aucune connexion de portefeuille, jamais.</strong> Dès l'instant où vous confiez votre portefeuille à une application, vous créez un nouveau risque. Almstins lit les données de votre blockchain de la même manière que vous pouvez le faire sur Etherscan : publiquement. Vos clés restent en sécurité parce qu'elles ne quittent jamais votre portefeuille.`,
    p2: `<strong>La comptabilité comme infrastructure.</strong> La responsabilité exige de la documentation. Almstins n'est pas un outil de trading ni un suiveur de prix. C'est un registre. Chaque actif, chaque transaction, chaque prix de revient. Parce qu'on ne peut pas gérer ce qu'on ne peut pas mesurer, et qu'on ne peut pas prouver sa position sans historique.`,
    p3: `<strong>La sécurité avant le clic.</strong> J'ai créé le vérificateur de portefeuilles pour répondre à une seule question : « Cette adresse est-elle sûre avant que j'envoie ? » Les arnaques, les sanctions, les honeypots, le phishing — tout cela arrive après le clic. Le vérificateur vous permet de vérifier d'abord.`,
    p4: `<strong>Clair plutôt qu'astucieux.</strong> La documentation est en langage clair et simple. Les messages d'erreur vous disent ce qui n'a pas fonctionné et quoi faire. Les verdicts de sécurité ne se cachent pas derrière un score de risque ; ils vous disent ce que nous savons réellement et ce que nous ignorons.`,
  },
  believe: {
    heading: 'Ce en quoi je crois',
    intro: `La cryptomonnaie est une infrastructure qui permet aux individus de déplacer, conserver et gérer leur propre argent sans demander la permission. Mais une infrastructure ne fonctionne que si les gens peuvent lui faire confiance. La confiance ne vient pas du marketing ; elle vient de :`,
    items: [
      `<strong>Des décisions de conception honnêtes.</strong> Intégrer les contraintes dans l'architecture (aucune connexion de portefeuille) au lieu de se cacher derrière des promesses.`,
      `<strong>La transparence.</strong> Dire ce que nous stockons, ce que nous ne stockons pas, ce qui pourrait mal tourner et comment nous le protégeons.`,
      `<strong>L'exhaustivité.</strong> Résoudre le problème en entier — pas seulement la partie passionnante, mais la partie comptable ennuyeuse qui compte vraiment.`,
      `<strong>La clarté.</strong> Écrire pour les gens, pas pour les algorithmes. Expliquer en langage simple, pas en jargon.`,
    ],
  },
  matters: {
    heading: 'Pourquoi cela compte maintenant',
    p1: `La cryptomonnaie passe de la spéculation à l'infrastructure. Les stablecoins pour les transferts de fonds, le Bitcoin comme actif de réserve, la DeFi comme colonne vertébrale des paiements transfrontaliers. Les utilisateurs qui arrivent ne sont pas des spéculateurs — ce sont des gens qui ont besoin que l'infrastructure fonctionne vraiment.`,
    p2: `Ils ont besoin d'outils qui ne tombent pas en panne, qui ne trahissent pas et qui ne leur demandent pas de faire confiance aveuglément. Ils ont besoin de documentation pour pouvoir prouver ce qu'ils possèdent. Ils ont besoin de sécurité pour ne pas envoyer de fonds au mauvais endroit.`,
    p3: `C'est cela, Almstins. Pas un pari sur le prix, pas un terrain de jeu. Une infrastructure.`,
  },
  building: {
    heading: 'Ce que je construis',
    intro: `Almstins est aujourd'hui un suiveur de portefeuille + un vérificateur de sécurité + un outil de comptabilité. La feuille de route est plus longue :`,
    items: [
      `Un Snap MetaMask qui vérifie les adresses avant que vous signiez, pour que la sécurité atteigne votre portefeuille lui-même.`,
      `Une intégration plus profonde avec les fiscalistes et les conseillers, pour qu'Almstins ne soit pas seulement un outil que vous utilisez — mais une couche que votre comptable et votre conseiller comprennent tous les deux.`,
      `Des outils d'écosystème qui permettent à d'autres créateurs d'intégrer la sécurité et la responsabilité dans leurs produits.`,
    ],
    outro: `L'étoile polaire : rendre évident que le meilleur produit cryptographique est celui qui ne vous demande pas de lui faire confiance aveuglément. Rendre la documentation et la vérification aussi simples que la transaction elle-même.`,
  },
  beta: {
    heading: 'Une note sur la version bêta',
    p1: `Almstins est en version bêta. Ce n'est pas une excuse ; c'est une description. Nous apprenons encore ce dont les conseillers ont besoin, ce dont les utilisateurs des marchés émergents ont besoin, et à quoi ressemble la prochaine couche de sécurité. Nous construisons en public et itérons à partir de retours réels.`,
    p2: `Être en version bêta ne signifie pas que le code est instable ni que vos données sont en danger. Cela signifie que nous décidons encore de la suite en fonction de ce que vous nous dites qui compte vraiment.`,
  },
  reach: {
    heading: 'Comment me joindre',
    body: `Si vous avez des commentaires, des questions ou si vous voulez simplement discuter de la direction que prend tout cela, je lis chaque message. Écrivez-moi à <strong>hello@almstins.com</strong> ou trouvez-moi sur LinkedIn.`,
  },
};
