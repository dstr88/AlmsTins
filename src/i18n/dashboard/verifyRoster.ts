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
  downloadHint: 'Upload the downloaded file anywhere on your own site — a plain static file, nothing to configure.',
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
    { title: 'Labels stay private', desc: 'A label is just for you, to tell your own wallets apart. It stays private inside the encrypted file.' },
    { title: 'Stale listings expire on their own', desc: 'If the file disappears from your site, or the DNS record changes, your addresses stop showing as verified within a day.' },
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
  downloadHint: 'Sube el archivo descargado a cualquier parte de tu propio sitio — un archivo estático simple, nada que configurar.',
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
    { title: 'Las etiquetas permanecen privadas', desc: 'Una etiqueta es solo para ti, para distinguir tus propias billeteras. Permanece privada dentro del archivo cifrado.' },
    { title: 'Las listas obsoletas caducan solas', desc: 'Si el archivo desaparece de tu sitio, o cambia el registro DNS, tus direcciones dejan de mostrarse como verificadas en un día.' },
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
  downloadHint: 'Téléversez le fichier téléchargé n’importe où sur votre propre site — un simple fichier statique, rien à configurer.',
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
    { title: 'Les libellés restent privés', desc: 'Un libellé est seulement pour vous, pour distinguer vos propres portefeuilles. Il reste privé à l’intérieur du fichier chiffré.' },
    { title: 'Les listes obsolètes expirent d’elles-mêmes', desc: 'Si le fichier disparaît de votre site, ou que l’enregistrement DNS change, vos adresses cessent d’apparaître comme vérifiées en une journée.' },
  ],
};

const MAP: Record<Lang, VerifyRosterLocale> = { en, es, fr };

export function getVerifyRoster(lang: Lang): VerifyRosterLocale {
  return MAP[lang] ?? MAP.en;
}
