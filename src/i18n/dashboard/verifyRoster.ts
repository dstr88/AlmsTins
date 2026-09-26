// Verify roster tool — page + island strings (EN · ES · FR), shared by both steps:
// /dashboard/verify/roster (addresses + encrypt) and /dashboard/verify/dns
// (point DNS at the published file + check). Same pattern as verify.ts: island props
// are plain strings, {n}/{what} interpolated client-side. ES/FR are first-pass, same
// tolerance as the rest of Verify's copy.

import type { Lang } from '@/lib/i18n/locale';

export interface VerifyRosterLocale {
  lang: Lang;
  pageTitle: string;
  heroKicker: string;
  heroTitle: string;
  backLink: string;
  brandLabel: string; // header-bar wordmark, top-left — not translated, same across langs
  lightPathHint: string; // trust line + "only 1-2 addresses? …" nudge toward the DNS-direct path
  stepOneLabel: string; // "Step one — Add your domain" card label
  domainLabel: string;
  domainPlaceholder: string;
  getChallengeBtn: string;
  addressesTitle: string;
  addressPlaceholder: string;
  labelPlaceholder: string;
  addRowBtn: string;
  removeRowAria: string;
  csvImportBtn: string;
  csvImportHint: string;
  csvError: string;
  encryptBtn: string;
  encryptingBtn: string;
  encryptError: string;
  downloadHint: string;
  dnsFileUrlExample: string; // "{url}" token — shown on the DNS page under dnsStepValue
  nextDnsLinkBtn: string; // roster page, shown once encrypted — links to the DNS page
  addAnotherWebpageLink: string; // secondary link on both pages — resets to a fresh domain
  dnsPageTitle: string;
  dnsPageHeroTitle: string;
  dnsPageHeroSub: string;
  backToRosterLink: string; // DNS page's back link, returns to the address editor
  dnsStepTitle: string;
  dnsStepBody: string; // "{record}" token = the DNS record name
  dnsStepValue: string; // "put the URL where you uploaded the file here"
  checkNowBtn: string;
  checkingBtn: string;
  outcomeProven: string;
  outcomeNotListed: string; // "{n}" of your addresses matched
  outcomeUnreachable: string;
  outcomeMalformed: string;
  outcomeChallengeMismatch: string;
  outcomeInvalidDomain: string;
  loadedFromCache: string; // "{time}" — shown when the editor pre-fills from a prior publish
  howItWorksTitle: string;
  howItWorksItems: { title: string; desc: string }[]; // exactly 4 — rendered 01-04
  progressTitle: string;
  progressSteps: string[]; // exactly 4 — steps 1-2 highlight per RosterEditor's own state;
                            // 3-4 (encrypted / DNS-published) are informational only for now
  tabsAriaLabel: string; // labels the how-it-works/set-up/faq tablist at the top of the roster page
  faqTitle: string;
  faqItems: { q: string; a: string }[];
}

const en: VerifyRosterLocale = {
  lang: 'en',
  pageTitle: 'Publish an address roster — Almstins Verify',
  heroKicker: 'FOR BUSINESSES WITH SEVERAL WALLETS',
  heroTitle: 'Publish your addresses, encrypt and privately store them on your own website.',
  backLink: '← Back to Verify',
  brandLabel: 'Titanium Hut',
  lightPathHint: "The site your customers already trust — we'll verify against it. Only one or two addresses? A DNS record alone is simpler — no file to host.",
  stepOneLabel: 'Step one — Add your domain',
  domainLabel: 'Your domain',
  domainPlaceholder: 'yourbusiness.com',
  getChallengeBtn: 'Start secure setup',
  addressesTitle: 'Your addresses',
  addressPlaceholder: 'Paste a wallet address',
  labelPlaceholder: 'Label (optional)',
  addRowBtn: '+ Add address',
  removeRowAria: 'Remove this address',
  csvImportBtn: 'Import from CSV',
  csvImportHint: 'A column of addresses, and an optional label column — with or without a header row.',
  csvError: "Couldn't find any addresses in that file.",
  encryptBtn: 'Encrypt & download',
  encryptingBtn: 'Encrypting…',
  encryptError: "Couldn't reach the encryption key. Try again in a moment.",
  downloadHint: 'Upload almstins-roster.enc.json to the main folder of your website — the same place as your homepage file. That keeps its address simple, which is what you’ll need for the DNS record next.',
  dnsFileUrlExample: 'If you uploaded it to the main folder, that’s: {url}',
  nextDnsLinkBtn: 'Next: point your DNS →',
  addAnotherWebpageLink: '+ Add another webpage',
  dnsPageTitle: 'Point your DNS — Almstins Verify',
  dnsPageHeroTitle: 'Point your DNS at it',
  dnsPageHeroSub: "Add one DNS record on your domain so we can find the file you published, then check to confirm it's live.",
  backToRosterLink: '← Back to your addresses',
  dnsStepTitle: 'Point to it from DNS',
  dnsStepBody: 'Add a TXT record named {record} on your domain,',
  dnsStepValue: 'with the full URL where you uploaded the file as its value.',
  checkNowBtn: 'Check now',
  checkingBtn: 'Checking…',
  outcomeProven: 'Verified — your roster is live.',
  outcomeNotListed: "Your domain is proven, but this address wasn't in the list you published.",
  outcomeUnreachable: "Couldn't fetch anything at that URL yet — DNS can take a few minutes to update.",
  outcomeMalformed: "That file isn't in a format we recognize — try re-downloading it.",
  outcomeChallengeMismatch: 'That file matches a different account.',
  outcomeInvalidDomain: 'Enter a valid domain first.',
  loadedFromCache: 'Loaded your last published list ({time}).',
  howItWorksTitle: 'How this works',
  howItWorksItems: [
    { title: 'Encrypted before it leaves your browser', desc: "We never see your list in plain text until we decrypt it ourselves — and neither can anyone who finds the file on your site." },
    { title: 'Changes take effect instantly', desc: 'Adding or removing an address applies the moment you check again — no waiting for a scheduled recheck.' },
    { title: 'Wallet addresses stay private', desc: 'Only you can see which addresses are on your list. A label is just for you, to tell your own wallets apart — it stays private too.' },
    { title: 'Stale listings expire on their own', desc: 'If the file disappears from your site, or the DNS record changes, your addresses stop showing as verified within a day.' },
  ],
  progressTitle: 'Set up',
  progressSteps: [
    'Name your website',
    'Identify your wallets',
    'Encrypt the addresses',
    'Save it in the main folder of your website',
  ],
  tabsAriaLabel: 'Guide',
  faqTitle: 'FAQ',
  faqItems: [
    { q: 'Who is this for?', a: "Merchants or businesses with more than one or two receiving addresses. If you only have one or two, a plain DNS TXT record is simpler — no file to host, no CSV to build." },
    { q: 'Can Almstins read my address list?', a: 'Only when we check it, and only because we hold the private key. Your browser encrypts the list (RSA-OAEP-4096 + AES-256-GCM) with our public key before anything leaves your machine — we never see it in plain text until we decrypt it ourselves to run a check.' },
    { q: 'Can anyone who finds the file on my site read it?', a: "No. The published file is exactly as public as any other file on your site — your hosting does zero authentication — but without our private key it's just noise. Nobody but Almstins can decrypt it, including anyone who stumbles across the URL." },
    { q: 'What if I add or remove an address later?', a: "Re-encrypt and re-upload the file, then check again — the new list applies immediately. There's no scheduled recheck to wait out." },
    { q: 'Are the labels I add private too?', a: "Yes. A label is only ever for you, to tell your own wallets apart — it's encrypted along with the address and never shown to anyone else." },
    { q: 'What happens if the file disappears from my site, or I change my DNS?', a: 'Your addresses stop showing as verified within a day. Nothing is deleted on our side — republish the file or fix the DNS record and it recovers on its own.' },
    { q: 'What format does the CSV need to be in?', a: "One column of addresses, and an optional second column for labels — with or without a header row. It's parsed entirely in your browser; the file itself is never uploaded anywhere, only the rows it produces." },
    { q: 'Does every address on my list count against my plan?', a: "Yes — publishing a roster auto-registers any address that isn't already one of your destinations, same as adding it by hand. A free account registers up to 2 before it stops; it won't silently exceed your plan's limit." },
  ],
};

const es: VerifyRosterLocale = {
  lang: 'es',
  pageTitle: 'Publicar una lista de direcciones — Almstins Verify',
  heroKicker: 'PARA NEGOCIOS CON VARIAS BILLETERAS',
  heroTitle: 'Publica tus direcciones, cífralas y guárdalas de forma privada en tu propio sitio web.',
  backLink: '← Volver a Verify',
  brandLabel: 'Titanium Hut',
  lightPathHint: 'El sitio en el que tus clientes ya confían — lo verificaremos contra él. ¿Solo una o dos direcciones? Un registro DNS por sí solo es más simple — sin archivo que alojar.',
  stepOneLabel: 'Paso uno — Agrega tu dominio',
  domainLabel: 'Tu dominio',
  domainPlaceholder: 'tunegocio.com',
  getChallengeBtn: 'Iniciar configuración segura',
  addressesTitle: 'Tus direcciones',
  addressPlaceholder: 'Pega una dirección de billetera',
  labelPlaceholder: 'Etiqueta (opcional)',
  addRowBtn: '+ Agregar dirección',
  removeRowAria: 'Quitar esta dirección',
  csvImportBtn: 'Importar desde CSV',
  csvImportHint: 'Una columna de direcciones, y una columna de etiqueta opcional — con o sin fila de encabezado.',
  csvError: 'No encontramos ninguna dirección en ese archivo.',
  encryptBtn: 'Cifrar y descargar',
  encryptingBtn: 'Cifrando…',
  encryptError: 'No pudimos obtener la clave de cifrado. Intenta de nuevo en un momento.',
  downloadHint: 'Sube almstins-roster.enc.json a la carpeta principal de tu sitio web — el mismo lugar que el archivo de tu página de inicio. Eso mantiene su dirección simple, que es lo que necesitarás para el registro DNS a continuación.',
  dnsFileUrlExample: 'Si lo subiste a la carpeta principal, esa es: {url}',
  nextDnsLinkBtn: 'Siguiente: apunta tu DNS →',
  addAnotherWebpageLink: '+ Agregar otra página web',
  dnsPageTitle: 'Apunta tu DNS — Almstins Verify',
  dnsPageHeroTitle: 'Apunta tu DNS hacia el archivo',
  dnsPageHeroSub: 'Agrega un registro DNS en tu dominio para que podamos encontrar el archivo que publicaste, y luego comprueba que esté activo.',
  backToRosterLink: '← Volver a tus direcciones',
  dnsStepTitle: 'Apúntalo desde DNS',
  dnsStepBody: 'Agrega un registro TXT llamado {record} en tu dominio,',
  dnsStepValue: 'con la URL completa donde subiste el archivo como su valor.',
  checkNowBtn: 'Comprobar ahora',
  checkingBtn: 'Comprobando…',
  outcomeProven: 'Verificado — tu lista está activa.',
  outcomeNotListed: 'Tu dominio está comprobado, pero esta dirección no estaba en la lista que publicaste.',
  outcomeUnreachable: 'Aún no pudimos obtener nada de esa URL — el DNS puede tardar unos minutos en actualizarse.',
  outcomeMalformed: 'Ese archivo no tiene un formato que reconozcamos — intenta descargarlo de nuevo.',
  outcomeChallengeMismatch: 'Ese archivo corresponde a otra cuenta.',
  outcomeInvalidDomain: 'Ingresa primero un dominio válido.',
  loadedFromCache: 'Cargamos tu última lista publicada ({time}).',
  howItWorksTitle: 'Cómo funciona esto',
  howItWorksItems: [
    { title: 'Cifrado antes de salir de tu navegador', desc: 'Nunca vemos tu lista en texto plano hasta descifrarla nosotros mismos — y tampoco puede hacerlo nadie que encuentre el archivo en tu sitio.' },
    { title: 'Los cambios surten efecto al instante', desc: 'Agregar o quitar una dirección aplica en cuanto vuelves a comprobar — sin esperar a una revisión programada.' },
    { title: 'Las direcciones de billetera permanecen privadas', desc: 'Solo tú puedes ver qué direcciones están en tu lista. Una etiqueta es solo para ti, para distinguir tus propias billeteras — también permanece privada.' },
    { title: 'Las listas obsoletas caducan solas', desc: 'Si el archivo desaparece de tu sitio, o cambia el registro DNS, tus direcciones dejan de mostrarse como verificadas en un día.' },
  ],
  progressTitle: 'Configuración',
  progressSteps: [
    'Nombra tu sitio web',
    'Identifica tus billeteras',
    'Cifra las direcciones',
    'Guárdalo en la carpeta principal de tu sitio web',
  ],
  tabsAriaLabel: 'Guía',
  faqTitle: 'Preguntas frecuentes',
  faqItems: [
    { q: '¿Para quién es esto?', a: 'Para comercios o negocios con más de una o dos direcciones de cobro. Si solo tienes una o dos, un registro TXT de DNS por sí solo es más simple — sin archivo que alojar, sin CSV que armar.' },
    { q: '¿Puede Almstins leer mi lista de direcciones?', a: 'Solo cuando la comprobamos, y solo porque nosotros guardamos la clave privada. Tu navegador cifra la lista (RSA-OAEP-4096 + AES-256-GCM) con nuestra clave pública antes de que nada salga de tu equipo — nunca la vemos en texto plano hasta descifrarla nosotros mismos para hacer una comprobación.' },
    { q: '¿Puede alguien que encuentre el archivo en mi sitio leerlo?', a: 'No. El archivo publicado es tan público como cualquier otro archivo de tu sitio — tu hosting no hace ninguna verificación de acceso — pero sin nuestra clave privada es solo ruido. Nadie más que Almstins puede descifrarlo, ni siquiera alguien que encuentre la URL por casualidad.' },
    { q: '¿Qué pasa si agrego o quito una dirección después?', a: 'Vuelve a cifrar y a subir el archivo, y comprueba de nuevo — la lista nueva aplica de inmediato. No hay que esperar ninguna revisión programada.' },
    { q: '¿Las etiquetas que agrego también son privadas?', a: 'Sí. Una etiqueta es solo para ti, para distinguir tus propias billeteras — se cifra junto con la dirección y nunca se muestra a nadie más.' },
    { q: '¿Qué pasa si el archivo desaparece de mi sitio, o cambio mi DNS?', a: 'Tus direcciones dejan de mostrarse como verificadas en un día. Nada se borra de nuestro lado — vuelve a publicar el archivo o corrige el registro DNS y se recupera solo.' },
    { q: '¿Qué formato debe tener el CSV?', a: 'Una columna de direcciones, y una columna opcional de etiquetas — con o sin fila de encabezado. Se procesa por completo en tu navegador; el archivo en sí nunca se sube a ningún lado, solo las filas que produce.' },
    { q: '¿Cada dirección de mi lista cuenta contra mi plan?', a: 'Sí — publicar una lista registra cada dirección nueva como uno de tus destinos en Almstins, igual que agregarlas a mano. Una cuenta gratuita registra hasta 2 y luego se detiene; no se salta el límite de tu plan en silencio.' },
  ],
};

const fr: VerifyRosterLocale = {
  lang: 'fr',
  pageTitle: 'Publier une liste d’adresses — Almstins Verify',
  heroKicker: 'POUR LES ENTREPRISES AVEC PLUSIEURS PORTEFEUILLES',
  heroTitle: 'Publiez vos adresses, chiffrez-les et conservez-les en privé sur votre propre site web.',
  backLink: '← Retour à Verify',
  brandLabel: 'Titanium Hut',
  lightPathHint: 'Le site où vos clients ont déjà confiance — nous vérifierons par rapport à lui. Seulement une ou deux adresses ? Un enregistrement DNS seul est plus simple — aucun fichier à héberger.',
  stepOneLabel: 'Étape un — Ajoutez votre domaine',
  domainLabel: 'Votre domaine',
  domainPlaceholder: 'votreentreprise.com',
  getChallengeBtn: 'Démarrer la configuration sécurisée',
  addressesTitle: 'Vos adresses',
  addressPlaceholder: 'Collez une adresse de portefeuille',
  labelPlaceholder: 'Libellé (optionnel)',
  addRowBtn: '+ Ajouter une adresse',
  removeRowAria: 'Retirer cette adresse',
  csvImportBtn: 'Importer depuis un CSV',
  csvImportHint: 'Une colonne d’adresses, et une colonne de libellé optionnelle — avec ou sans ligne d’en-tête.',
  csvError: 'Aucune adresse trouvée dans ce fichier.',
  encryptBtn: 'Chiffrer et télécharger',
  encryptingBtn: 'Chiffrement…',
  encryptError: 'Impossible de joindre la clé de chiffrement. Réessayez dans un instant.',
  downloadHint: 'Téléversez almstins-roster.enc.json dans le dossier principal de votre site web — le même endroit que le fichier de votre page d’accueil. Cela garde son adresse simple, ce dont vous aurez besoin pour l’enregistrement DNS suivant.',
  dnsFileUrlExample: 'Si vous l’avez téléversé dans le dossier principal, c’est : {url}',
  nextDnsLinkBtn: 'Suivant : pointez votre DNS →',
  addAnotherWebpageLink: '+ Ajouter une autre page web',
  dnsPageTitle: 'Pointez votre DNS — Almstins Verify',
  dnsPageHeroTitle: 'Pointez votre DNS vers le fichier',
  dnsPageHeroSub: 'Ajoutez un enregistrement DNS sur votre domaine pour que nous puissions trouver le fichier publié, puis vérifiez qu’il est actif.',
  backToRosterLink: '← Retour à vos adresses',
  dnsStepTitle: 'Pointez-y depuis le DNS',
  dnsStepBody: 'Ajoutez un enregistrement TXT nommé {record} sur votre domaine,',
  dnsStepValue: 'avec l’URL complète où vous avez téléversé le fichier comme valeur.',
  checkNowBtn: 'Vérifier maintenant',
  checkingBtn: 'Vérification…',
  outcomeProven: 'Vérifié — votre liste est active.',
  outcomeNotListed: 'Votre domaine est prouvé, mais cette adresse ne figurait pas dans la liste publiée.',
  outcomeUnreachable: 'Rien à récupérer à cette URL pour l’instant — le DNS peut prendre quelques minutes à se propager.',
  outcomeMalformed: 'Ce fichier n’est pas dans un format reconnu — essayez de le retélécharger.',
  outcomeChallengeMismatch: 'Ce fichier correspond à un autre compte.',
  outcomeInvalidDomain: 'Entrez d’abord un domaine valide.',
  loadedFromCache: 'Votre dernière liste publiée a été chargée ({time}).',
  howItWorksTitle: 'Comment ça marche',
  howItWorksItems: [
    { title: 'Chiffré avant de quitter votre navigateur', desc: 'Nous ne voyons jamais votre liste en clair avant de la déchiffrer nous-mêmes — et personne qui trouve le fichier sur votre site ne le peut non plus.' },
    { title: 'Les changements prennent effet instantanément', desc: 'Ajouter ou retirer une adresse s’applique dès que vous revérifiez — sans attendre une revérification programmée.' },
    { title: 'Les adresses de portefeuille restent privées', desc: 'Vous seul pouvez voir quelles adresses figurent sur votre liste. Un libellé est seulement pour vous, pour distinguer vos propres portefeuilles — il reste privé lui aussi.' },
    { title: 'Les listes obsolètes expirent d’elles-mêmes', desc: 'Si le fichier disparaît de votre site, ou que l’enregistrement DNS change, vos adresses cessent d’apparaître comme vérifiées en une journée.' },
  ],
  progressTitle: 'Configuration',
  progressSteps: [
    'Nommez votre site web',
    'Identifiez vos portefeuilles',
    'Chiffrez les adresses',
    'Enregistrez-le dans le dossier principal de votre site web',
  ],
  tabsAriaLabel: 'Guide',
  faqTitle: 'FAQ',
  faqItems: [
    { q: "À qui s'adresse cet outil ?", a: "Aux commerces ou entreprises ayant plus d'une ou deux adresses de réception. Si vous n'en avez qu'une ou deux, un enregistrement TXT DNS seul est plus simple — aucun fichier à héberger, aucun CSV à préparer." },
    { q: 'Almstins peut-il lire ma liste d’adresses ?', a: 'Seulement au moment de la vérification, et uniquement parce que nous détenons la clé privée. Votre navigateur chiffre la liste (RSA-OAEP-4096 + AES-256-GCM) avec notre clé publique avant que quoi que ce soit ne quitte votre machine — nous ne la voyons jamais en clair avant de la déchiffrer nous-mêmes pour effectuer une vérification.' },
    { q: 'Quelqu’un qui trouve le fichier sur mon site peut-il le lire ?', a: "Non. Le fichier publié est aussi public que n'importe quel autre fichier de votre site — votre hébergeur ne fait aucune vérification d'accès — mais sans notre clé privée, ce n'est que du bruit. Personne d'autre qu'Almstins ne peut le déchiffrer, même quelqu'un qui tombe sur l'URL par hasard." },
    { q: "Que se passe-t-il si j'ajoute ou retire une adresse plus tard ?", a: "Rechiffrez et retéléversez le fichier, puis vérifiez à nouveau — la nouvelle liste s'applique immédiatement. Aucune revérification programmée à attendre." },
    { q: 'Les libellés que j’ajoute sont-ils aussi privés ?', a: "Oui. Un libellé n'est que pour vous, pour distinguer vos propres portefeuilles — il est chiffré avec l'adresse et jamais montré à personne d'autre." },
    { q: 'Que se passe-t-il si le fichier disparaît de mon site, ou si je change mon DNS ?', a: "Vos adresses cessent d'apparaître comme vérifiées en une journée. Rien n'est supprimé de notre côté — republiez le fichier ou corrigez l'enregistrement DNS et tout se rétablit de soi-même." },
    { q: 'Quel format doit avoir le CSV ?', a: "Une colonne d'adresses, et une colonne de libellés optionnelle — avec ou sans ligne d'en-tête. Il est traité entièrement dans votre navigateur ; le fichier lui-même n'est jamais téléversé nulle part, seules les lignes qu'il produit le sont." },
    { q: 'Chaque adresse de ma liste compte-t-elle dans mon forfait ?', a: "Oui — publier une liste enregistre chaque nouvelle adresse comme l'une de vos destinations Almstins, comme si vous l'ajoutiez à la main. Un compte gratuit en enregistre jusqu'à 2 puis s'arrête ; il ne dépasse jamais silencieusement la limite de votre forfait." },
  ],
};

const MAP: Record<Lang, VerifyRosterLocale> = { en, es, fr };

export function getVerifyRoster(lang: Lang): VerifyRosterLocale {
  return MAP[lang] ?? MAP.en;
}
