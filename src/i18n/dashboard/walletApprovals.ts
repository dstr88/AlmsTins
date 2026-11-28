// Standing approvals on the Wallets page (EN · ES · FR): the Approvals section on each Ethereum-family
// wallet card and its "How it works" tab (src/components/dashboard/WalletApprovals.tsx).
//
// Donnie's rule (Nov 28, 2026): no approval is ever shown as safe. The word appears only in the negated
// "Why none of these is safe" heading (his wording, Nov 28 review); nothing else calls an approval, a contract
// or the list safe, and nothing says Almstins protects anyone (tests/approvals/approvalsCopy.test.ts).
// Almstins reads public chain data and never asks for a signature; canceling happens in the user's own
// wallet. No em dashes. Crypto words (NFT, Permit2, revoke.cash, Etherscan) stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface HowItWorksItem {
	title: string;
	body: string;
}

export interface WalletApprovalsLocale {
	lang: Lang;
	sectionTitle: string;
	checkButton: string;
	checking: string;
	checkAgain: string;
	open: string;
	close: string;
	/** Before any check: what the button does. */
	notChecked: string;
	/** The card's line after a check. */
	summary: (total: number) => string;
	revokeFirstCount: (n: number) => string;
	/** Approvals given whose current state couldn't be read: never counted as in force, never dropped. */
	unknownCount: (n: number) => string;
	tabList: string;
	tabHowItWorks: string;
	/** The list's lead line, word for word from the plan. */
	lead: string;
	empty: string;
	groupRevokeFirst: string;
	groupStillARisk: string;
	groupUnknown: string;
	groupStillARiskNote: string;
	groupUnknownNote: string;
	colSpender: string;
	colWhat: string;
	colAmount: string;
	colGiven: string;
	colLastActive: string;
	colWhy: string;
	colCancel: string;
	whatToken: (symbol: string) => string;
	whatPermit2: (symbol: string) => string;
	whatNftAll: (collection: string) => string;
	whatNftOne: (id: string, collection: string) => string;
	unknownToken: string;
	amountUnlimited: string;
	amountAllNfts: string;
	amountOneNft: string;
	amountUnknown: string;
	expiresOn: (date: string) => string;
	noEndDate: string;
	lastActiveNone: string;
	lastActiveUnread: string;
	dateUnknown: string;
	reasonUnlimited: string;
	reasonWholeCollection: string;
	reasonInactive: (months: number) => string;
	reasonChecker: (hits: string) => string;
	noFlag: string;
	unknownRow: string;
	checkerIncomplete: string;
	checkerHit: Record<string, string>;
	chainName: (chain: string) => string;
	revokeLink: string;
	checkerLink: (explorer: string) => string;
	cancelNote: string;
	chainPartial: (chain: string) => string;
	chainUnavailable: (chain: string) => string;
	/** While a check is still running: the networks not read yet. The list so far is never presented as the whole list. */
	stillReading: (chains: string) => string;
	asOf: (when: string) => string;
	rateLimited: string;
	failed: string;
	howItWorksTitle: string;
	howItWorks: HowItWorksItem[];
	/** The GoPlus credit (a brand credit, the same English phrase in every language). */
	poweredByGoPlus: string;
}

const CHAIN_NAMES: Record<string, string> = {
	ethereum: 'Ethereum',
	polygon: 'Polygon',
	avalanche: 'Avalanche',
	arbitrum: 'Arbitrum',
};
const chainName = (chain: string) => CHAIN_NAMES[chain] ?? chain;

export const en: WalletApprovalsLocale = {
	lang: 'en',
	sectionTitle: 'Approvals',
	checkButton: 'Check approvals',
	checking: 'Checking approvals…',
	checkAgain: 'Check again',
	open: 'Show approvals',
	close: 'Hide approvals',
	notChecked: 'Lists the approvals this wallet has given on Ethereum, Polygon, Avalanche and Arbitrum, from public chain data. No wallet connection.',
	summary: (n) => (n === 1 ? '1 approval still in force' : `${n} approvals still in force`),
	revokeFirstCount: (n) => `${n} to revoke first`,
	unknownCount: (n) => `${n} couldn't be checked`,
	tabList: 'Approvals',
	tabHowItWorks: 'How it works',
	lead: 'Each approval below lets a contract take these tokens or NFTs without asking you again, until you cancel it.',
	empty: 'No standing approvals found on Ethereum, Polygon, Avalanche or Arbitrum.',
	groupRevokeFirst: 'Revoke first',
	groupStillARisk: 'Still a risk',
	groupUnknown: "Couldn't check",
	groupStillARiskNote: 'None of the flags applies to these. Each one still lets the contract take these tokens or NFTs until you cancel it.',
	groupUnknownNote: "These approvals were given, and Almstins couldn't read whether they still stand. Look them up on revoke.cash.",
	colSpender: 'Who can spend',
	colWhat: 'What',
	colAmount: 'How much',
	colGiven: 'Given',
	colLastActive: 'Contract last active',
	colWhy: "Why it's flagged",
	colCancel: 'Cancel',
	whatToken: (s) => s,
	whatPermit2: (s) => `${s} through Uniswap Permit2`,
	whatNftAll: (c) => `All NFTs in ${c}`,
	whatNftOne: (id, c) => `NFT #${id} in ${c}`,
	unknownToken: 'an unnamed token',
	amountUnlimited: 'Unlimited',
	amountAllNfts: 'All, now and later',
	amountOneNft: 'This one NFT',
	amountUnknown: 'Not read',
	expiresOn: (d) => `Until ${d}`,
	noEndDate: 'No end date',
	lastActiveNone: 'No transactions listed',
	lastActiveUnread: "Couldn't read",
	dateUnknown: 'Unknown',
	reasonUnlimited: 'Unlimited',
	reasonWholeCollection: 'Covers the whole collection',
	reasonInactive: (m) => `This contract hasn't been used in ${m} months`,
	reasonChecker: (h) => `The wallet checker's sources flag this contract: ${h}`,
	noFlag: 'No flag. Still a risk until you cancel it.',
	unknownRow: "Couldn't check whether this approval still stands.",
	checkerIncomplete: "The wallet checker's sources couldn't all be reached for this contract.",
	checkerHit: {
		blacklisted: 'on a scam blacklist',
		phishing: 'phishing',
		honeypotRelated: 'tied to honeypot tokens',
		stealingAttack: 'theft',
		darkwebTransactions: 'dark web transactions',
		cybercrime: 'cybercrime',
		moneyLaundering: 'money laundering',
		financialCrime: 'financial crime',
		blackmail: 'blackmail',
		mixer: 'a mixer',
		sanctioned: 'the OFAC sanctions list',
	},
	chainName,
	revokeLink: 'revoke.cash',
	checkerLink: (x) => `${x} approval checker`,
	cancelNote:
		'Canceling needs a signature in your own wallet, on revoke.cash or the explorer’s Token Approval Checker. Almstins never asks you to sign anything. revoke.cash shows one network at a time, so each link opens this wallet on that network.',
	chainPartial: (c) => `${chainName(c)}: this wallet has more approvals than one check reads. The newest are listed; see ${chainName(c)} on revoke.cash for the rest.`,
	chainUnavailable: (c) => `${chainName(c)} couldn't be read right now, so nothing is listed for it. That doesn't mean it has no approvals.`,
	stillReading: (c) => `Still reading ${c}. The list below is what has been read so far; it fills in as each network finishes.`,
	asOf: (w) => `As of ${w}. An approval can change a minute later.`,
	rateLimited: 'Too many approval checks in the last hour. Try again later.',
	failed: "Approvals couldn't be checked right now. Try again in a few minutes.",
	howItWorksTitle: 'How it works',
	poweredByGoPlus: 'Powered by GoPlus Security',
	howItWorks: [
		{
			title: 'What it reads',
			body: 'The approvals written to the chain for this wallet: tokens, whole NFT collections, single NFTs and Uniswap Permit2. They are public data, read by address. No wallet connection. "Contract last active" is the newest transaction the explorer lists for the contract; a contract that is only called through another contract can look older than it is.',
		},
		{
			title: 'How it knows an approval is still in force',
			body: 'It asks the token contract now. Canceled or used-up approvals drop off. Ordinary approvals never expire; Permit2 approvals show their end date. The list is as of the time shown at the top.',
		},
		{
			title: "What it can't see",
			body: "A signed permit, Permit2 signature or NFT listing that no one has used yet: it isn't on the chain until it's used, so no tool can see it, revoke.cash included. Plain and sign-in messages, which never go on the chain. Which website asked for a signature, and what your wallet's pop-up showed.",
		},
		{
			title: 'How to cancel',
			body: 'In your own wallet, through revoke.cash or the explorer’s Token Approval Checker. Almstins never asks you to sign anything.',
		},
		{
			title: 'Why none of these is safe',
			body: 'An approval keeps working after you stop using the site. If the contract you approved is hacked later, the attacker can use your approval to take what it covers, with no new signature from you. Users of Socket (January 2024) and LI.FI (July 2024) lost millions this way, through approvals they had already given.',
		},
	],
};

export const es: WalletApprovalsLocale = {
	lang: 'es',
	sectionTitle: 'Aprobaciones',
	checkButton: 'Revisar aprobaciones',
	checking: 'Revisando aprobaciones…',
	checkAgain: 'Revisar de nuevo',
	open: 'Ver aprobaciones',
	close: 'Ocultar aprobaciones',
	notChecked: 'Muestra las aprobaciones que esta wallet ha dado en Ethereum, Polygon, Avalanche y Arbitrum, a partir de datos públicos de la cadena. Sin conectar la wallet.',
	summary: (n) => (n === 1 ? '1 aprobación sigue vigente' : `${n} aprobaciones siguen vigentes`),
	revokeFirstCount: (n) => `${n} para revocar primero`,
	unknownCount: (n) => (n === 1 ? '1 no se pudo revisar' : `${n} no se pudieron revisar`),
	tabList: 'Aprobaciones',
	tabHowItWorks: 'Cómo funciona',
	lead: 'Cada aprobación de abajo permite que un contrato tome estos tokens o NFT sin volver a preguntarte, hasta que la canceles.',
	empty: 'No se encontraron aprobaciones vigentes en Ethereum, Polygon, Avalanche ni Arbitrum.',
	groupRevokeFirst: 'Revocar primero',
	groupStillARisk: 'Siguen siendo un riesgo',
	groupUnknown: 'No se pudo revisar',
	groupStillARiskNote: 'Ninguna alerta aplica a estas. Cada una sigue permitiendo que el contrato tome estos tokens o NFT hasta que la canceles.',
	groupUnknownNote: 'Estas aprobaciones se dieron, y Almstins no pudo leer si siguen vigentes. Búscalas en revoke.cash.',
	colSpender: 'Quién puede gastar',
	colWhat: 'Qué',
	colAmount: 'Cuánto',
	colGiven: 'Dada',
	colLastActive: 'Última actividad del contrato',
	colWhy: 'Por qué tiene alerta',
	colCancel: 'Cancelar',
	whatToken: (s) => s,
	whatPermit2: (s) => `${s} a través de Uniswap Permit2`,
	whatNftAll: (c) => `Todos los NFT de ${c}`,
	whatNftOne: (id, c) => `NFT #${id} de ${c}`,
	unknownToken: 'un token sin nombre',
	amountUnlimited: 'Ilimitada',
	amountAllNfts: 'Todos, ahora y después',
	amountOneNft: 'Solo este NFT',
	amountUnknown: 'Sin leer',
	expiresOn: (d) => `Hasta el ${d}`,
	noEndDate: 'Sin fecha de fin',
	lastActiveNone: 'Sin transacciones listadas',
	lastActiveUnread: 'No se pudo leer',
	dateUnknown: 'Desconocida',
	reasonUnlimited: 'Ilimitada',
	reasonWholeCollection: 'Cubre toda la colección',
	reasonInactive: (m) => `Este contrato no se ha usado en ${m} meses`,
	reasonChecker: (h) => `Las fuentes del verificador de wallets marcan este contrato: ${h}`,
	noFlag: 'Sin alerta. Sigue siendo un riesgo hasta que la canceles.',
	unknownRow: 'No se pudo revisar si esta aprobación sigue vigente.',
	checkerIncomplete: 'No se pudo consultar todas las fuentes del verificador de wallets para este contrato.',
	checkerHit: {
		blacklisted: 'en una lista negra de estafas',
		phishing: 'phishing',
		honeypotRelated: 'ligado a tokens honeypot',
		stealingAttack: 'robo',
		darkwebTransactions: 'transacciones en la dark web',
		cybercrime: 'ciberdelito',
		moneyLaundering: 'lavado de dinero',
		financialCrime: 'delito financiero',
		blackmail: 'extorsión',
		mixer: 'un mezclador',
		sanctioned: 'la lista de sanciones de la OFAC',
	},
	chainName,
	revokeLink: 'revoke.cash',
	checkerLink: (x) => `verificador de aprobaciones de ${x}`,
	cancelNote:
		'Cancelar requiere una firma en tu propia wallet, en revoke.cash o en el Token Approval Checker del explorador. Almstins nunca te pide firmar nada. revoke.cash muestra una red a la vez, así que cada enlace abre esta wallet en esa red.',
	chainPartial: (c) => `${chainName(c)}: esta wallet tiene más aprobaciones de las que lee una revisión. Se muestran las más recientes; consulta ${chainName(c)} en revoke.cash para ver el resto.`,
	chainUnavailable: (c) => `No se pudo leer ${chainName(c)} en este momento, así que no se muestra nada para esa red. Eso no significa que no tenga aprobaciones.`,
	stillReading: (c) => `Todavía leyendo ${c}. La lista de abajo es lo leído hasta ahora; se completa a medida que termina cada red.`,
	asOf: (w) => `Al ${w}. Una aprobación puede cambiar un minuto después.`,
	rateLimited: 'Demasiadas revisiones de aprobaciones en la última hora. Inténtalo más tarde.',
	failed: 'No se pudieron revisar las aprobaciones en este momento. Inténtalo de nuevo en unos minutos.',
	howItWorksTitle: 'Cómo funciona',
	poweredByGoPlus: 'Powered by GoPlus Security',
	howItWorks: [
		{
			title: 'Qué lee',
			body: 'Las aprobaciones escritas en la cadena para esta wallet: tokens, colecciones completas de NFT, NFT individuales y Uniswap Permit2. Son datos públicos, leídos por dirección. Sin conectar la wallet. "Última actividad del contrato" es la transacción más reciente que el explorador lista para el contrato; un contrato que solo se llama a través de otro puede parecer más antiguo de lo que es.',
		},
		{
			title: 'Cómo sabe si una aprobación sigue vigente',
			body: 'Le pregunta al contrato del token en ese momento. Las aprobaciones canceladas o agotadas desaparecen. Las aprobaciones normales nunca vencen; las de Permit2 muestran su fecha de fin. La lista corresponde a la hora que aparece arriba.',
		},
		{
			title: 'Lo que no puede ver',
			body: 'Un permit firmado, una firma de Permit2 o un listado de NFT que nadie ha usado todavía: no está en la cadena hasta que se usa, así que ninguna herramienta puede verlo, ni siquiera revoke.cash. Los mensajes simples y de inicio de sesión, que nunca van a la cadena. Qué sitio web pidió una firma y qué mostró la ventana emergente de tu wallet.',
		},
		{
			title: 'Cómo cancelar',
			body: 'En tu propia wallet, a través de revoke.cash o del Token Approval Checker del explorador. Almstins nunca te pide firmar nada.',
		},
		{
			title: 'Por qué ninguna de estas es segura',
			body: 'Una aprobación sigue funcionando después de que dejas de usar el sitio. Si más adelante hackean el contrato que aprobaste, el atacante puede usar tu aprobación para tomar lo que cubre, sin una nueva firma tuya. Usuarios de Socket (enero de 2024) y LI.FI (julio de 2024) perdieron millones así, con aprobaciones que ya habían dado.',
		},
	],
};

export const fr: WalletApprovalsLocale = {
	lang: 'fr',
	sectionTitle: 'Autorisations',
	checkButton: 'Vérifier les autorisations',
	checking: 'Vérification des autorisations…',
	checkAgain: 'Vérifier à nouveau',
	open: 'Afficher les autorisations',
	close: 'Masquer les autorisations',
	notChecked: 'Liste les autorisations données par ce portefeuille sur Ethereum, Polygon, Avalanche et Arbitrum, à partir des données publiques de la chaîne. Sans connexion du portefeuille.',
	summary: (n) => (n === 1 ? '1 autorisation encore en vigueur' : `${n} autorisations encore en vigueur`),
	revokeFirstCount: (n) => `${n} à révoquer d’abord`,
	unknownCount: (n) => (n === 1 ? '1 n’a pas pu être vérifiée' : `${n} n’ont pas pu être vérifiées`),
	tabList: 'Autorisations',
	tabHowItWorks: 'Comment ça marche',
	lead: 'Chaque autorisation ci-dessous permet à un contrat de prendre ces jetons ou NFT sans vous redemander, jusqu’à ce que vous l’annuliez.',
	empty: 'Aucune autorisation en vigueur trouvée sur Ethereum, Polygon, Avalanche ou Arbitrum.',
	groupRevokeFirst: 'À révoquer d’abord',
	groupStillARisk: 'Toujours un risque',
	groupUnknown: 'Vérification impossible',
	groupStillARiskNote: 'Aucune alerte ne s’applique à celles-ci. Chacune permet toujours au contrat de prendre ces jetons ou NFT jusqu’à ce que vous l’annuliez.',
	groupUnknownNote: 'Ces autorisations ont été données, et Almstins n’a pas pu lire si elles sont encore en vigueur. Consultez-les sur revoke.cash.',
	colSpender: 'Qui peut dépenser',
	colWhat: 'Quoi',
	colAmount: 'Combien',
	colGiven: 'Donnée le',
	colLastActive: 'Dernière activité du contrat',
	colWhy: 'Pourquoi une alerte',
	colCancel: 'Annuler',
	whatToken: (s) => s,
	whatPermit2: (s) => `${s} via Uniswap Permit2`,
	whatNftAll: (c) => `Tous les NFT de ${c}`,
	whatNftOne: (id, c) => `NFT #${id} de ${c}`,
	unknownToken: 'un jeton sans nom',
	amountUnlimited: 'Illimitée',
	amountAllNfts: 'Tous, maintenant et plus tard',
	amountOneNft: 'Ce seul NFT',
	amountUnknown: 'Non lu',
	expiresOn: (d) => `Jusqu’au ${d}`,
	noEndDate: 'Sans date de fin',
	lastActiveNone: 'Aucune transaction listée',
	lastActiveUnread: 'Lecture impossible',
	dateUnknown: 'Inconnue',
	reasonUnlimited: 'Illimitée',
	reasonWholeCollection: 'Couvre toute la collection',
	reasonInactive: (m) => `Ce contrat n’a pas été utilisé depuis ${m} mois`,
	reasonChecker: (h) => `Les sources du vérificateur de portefeuille signalent ce contrat : ${h}`,
	noFlag: 'Aucune alerte. Toujours un risque tant que vous ne l’annulez pas.',
	unknownRow: 'Impossible de vérifier si cette autorisation est encore en vigueur.',
	checkerIncomplete: 'Les sources du vérificateur de portefeuille n’ont pas toutes pu être consultées pour ce contrat.',
	checkerHit: {
		blacklisted: 'sur une liste noire d’arnaques',
		phishing: 'hameçonnage',
		honeypotRelated: 'lié à des jetons honeypot',
		stealingAttack: 'vol',
		darkwebTransactions: 'transactions sur le dark web',
		cybercrime: 'cybercriminalité',
		moneyLaundering: 'blanchiment d’argent',
		financialCrime: 'délit financier',
		blackmail: 'chantage',
		mixer: 'un mixeur',
		sanctioned: 'la liste de sanctions de l’OFAC',
	},
	chainName,
	revokeLink: 'revoke.cash',
	checkerLink: (x) => `vérificateur d’autorisations ${x}`,
	cancelNote:
		'Annuler demande une signature dans votre propre portefeuille, sur revoke.cash ou le Token Approval Checker de l’explorateur. Almstins ne vous demande jamais de signer quoi que ce soit. revoke.cash affiche un réseau à la fois : chaque lien ouvre ce portefeuille sur ce réseau.',
	chainPartial: (c) => `${chainName(c)} : ce portefeuille a plus d’autorisations qu’une vérification n’en lit. Les plus récentes sont listées ; consultez ${chainName(c)} sur revoke.cash pour le reste.`,
	chainUnavailable: (c) => `${chainName(c)} n’a pas pu être lu pour le moment, donc rien n’est listé pour ce réseau. Cela ne veut pas dire qu’il n’a aucune autorisation.`,
	stillReading: (c) => `Lecture en cours : ${c}. La liste ci-dessous est ce qui a été lu jusqu’ici ; elle se complète à mesure que chaque réseau se termine.`,
	asOf: (w) => `Au ${w}. Une autorisation peut changer une minute plus tard.`,
	rateLimited: 'Trop de vérifications d’autorisations au cours de la dernière heure. Réessayez plus tard.',
	failed: 'Les autorisations n’ont pas pu être vérifiées pour le moment. Réessayez dans quelques minutes.',
	howItWorksTitle: 'Comment ça marche',
	poweredByGoPlus: 'Powered by GoPlus Security',
	howItWorks: [
		{
			title: 'Ce qui est lu',
			body: 'Les autorisations inscrites sur la chaîne pour ce portefeuille : jetons, collections NFT entières, NFT individuels et Uniswap Permit2. Ce sont des données publiques, lues par adresse. Sans connexion du portefeuille. « Dernière activité du contrat » est la transaction la plus récente que l’explorateur liste pour le contrat ; un contrat appelé seulement par un autre contrat peut sembler plus ancien qu’il ne l’est.',
		},
		{
			title: 'Comment savoir qu’une autorisation est encore en vigueur',
			body: 'Le contrat du jeton est interrogé au moment de la vérification. Les autorisations annulées ou épuisées disparaissent. Les autorisations ordinaires n’expirent jamais ; celles de Permit2 affichent leur date de fin. La liste correspond à l’heure indiquée en haut.',
		},
		{
			title: 'Ce qui reste invisible',
			body: 'Un permit signé, une signature Permit2 ou une annonce NFT que personne n’a encore utilisés : ils ne sont sur la chaîne qu’une fois utilisés, donc aucun outil ne peut les voir, revoke.cash compris. Les messages simples et de connexion, qui ne vont jamais sur la chaîne. Le site web qui a demandé une signature, et ce que la fenêtre de votre portefeuille a affiché.',
		},
		{
			title: 'Comment annuler',
			body: 'Dans votre propre portefeuille, via revoke.cash ou le Token Approval Checker de l’explorateur. Almstins ne vous demande jamais de signer quoi que ce soit.',
		},
		{
			title: 'Pourquoi aucune n’est sûre',
			body: 'Une autorisation continue de fonctionner après que vous avez cessé d’utiliser le site. Si le contrat que vous avez autorisé est piraté plus tard, l’attaquant peut se servir de votre autorisation pour prendre ce qu’elle couvre, sans nouvelle signature de votre part. Des utilisateurs de Socket (janvier 2024) et de LI.FI (juillet 2024) ont perdu des millions de cette façon, avec des autorisations déjà données.',
		},
	],
};

const MAP: Record<Lang, WalletApprovalsLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getWalletApprovals(lang: Lang): WalletApprovalsLocale {
	return MAP[lang] ?? en;
}
