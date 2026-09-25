// Verify roster tool (/dashboard/verify/roster) — page + island strings (EN · ES · FR).
// Same pattern as verify.ts: island props are plain strings, {n}/{what} interpolated
// client-side. ES/FR are first-pass, same tolerance as the rest of Verify's copy.

import type { Lang } from '@/lib/i18n/locale';

export interface VerifyRosterLocale {
  lang: Lang;
  pageTitle: string;
  heroKicker: string;
  heroTitle: string;
  heroSub: string;
  backLink: string;
  lightPathHint: string; // "only 1-2 addresses? …" nudge toward the DNS-direct path
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
  faqTitle: string;
  faqBody: string[];
}

const en: VerifyRosterLocale = {
  lang: 'en',
  pageTitle: 'Publish an address roster — Almstins Verify',
  heroKicker: 'FOR BUSINESSES WITH SEVERAL WALLETS',
  heroTitle: 'Publish your addresses, encrypted',
  heroSub: 'List every address you accept payment at. We encrypt it in your browser before it ever leaves your computer — your own site hosts the file, but nobody who finds it can read it except us.',
  backLink: '← Back to Verify',
  lightPathHint: 'Only one or two addresses? A DNS record alone is simpler — no file to host.',
  domainLabel: 'Your domain',
  domainPlaceholder: 'yourbusiness.com',
  getChallengeBtn: 'Start',
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
  faqTitle: 'How this works',
  faqBody: [
    'The address list is encrypted in your browser before anything is sent anywhere — we never see it in plain text until we decrypt it ourselves, and neither can anyone who happens to find the file on your site.',
    'Adding or removing an address takes effect the moment you check again — no waiting for a scheduled recheck.',
    'A label is just for you, to tell your own wallets apart. It stays private inside the encrypted file.',
    "If the file ever disappears from your site, or the DNS record changes, your addresses stop showing as verified within a day — automatically, no action needed from you.",
  ],
};

const es: VerifyRosterLocale = {
  lang: 'es',
  pageTitle: 'Publicar una lista de direcciones — Almstins Verify',
  heroKicker: 'PARA NEGOCIOS CON VARIAS BILLETERAS',
  heroTitle: 'Publica tus direcciones, cifradas',
  heroSub: 'Enumera cada dirección donde aceptas pagos. La ciframos en tu navegador antes de que salga de tu computadora — tu propio sitio aloja el archivo, pero nadie que lo encuentre puede leerlo excepto nosotros.',
  backLink: '← Volver a Verify',
  lightPathHint: '¿Solo una o dos direcciones? Un registro DNS por sí solo es más simple — sin archivo que alojar.',
  domainLabel: 'Tu dominio',
  domainPlaceholder: 'tunegocio.com',
  getChallengeBtn: 'Comenzar',
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
  faqTitle: 'Cómo funciona esto',
  faqBody: [
    'La lista de direcciones se cifra en tu navegador antes de enviarse a ningún lado — nunca la vemos en texto plano hasta descifrarla nosotros mismos, y tampoco puede hacerlo nadie que encuentre el archivo en tu sitio.',
    'Agregar o quitar una dirección surte efecto en cuanto vuelves a comprobar — sin esperar a una revisión programada.',
    'Una etiqueta es solo para ti, para distinguir tus propias billeteras. Permanece privada dentro del archivo cifrado.',
    'Si el archivo desaparece de tu sitio, o cambia el registro DNS, tus direcciones dejan de mostrarse como verificadas en un día — automáticamente, sin que tengas que hacer nada.',
  ],
};

const fr: VerifyRosterLocale = {
  lang: 'fr',
  pageTitle: 'Publier une liste d’adresses — Almstins Verify',
  heroKicker: 'POUR LES ENTREPRISES AVEC PLUSIEURS PORTEFEUILLES',
  heroTitle: 'Publiez vos adresses, chiffrées',
  heroSub: 'Listez chaque adresse où vous acceptez un paiement. Nous la chiffrons dans votre navigateur avant qu’elle ne quitte votre ordinateur — votre propre site héberge le fichier, mais personne qui le trouve ne peut le lire, sauf nous.',
  backLink: '← Retour à Verify',
  lightPathHint: 'Seulement une ou deux adresses ? Un enregistrement DNS seul est plus simple — aucun fichier à héberger.',
  domainLabel: 'Votre domaine',
  domainPlaceholder: 'votreentreprise.com',
  getChallengeBtn: 'Commencer',
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
  faqTitle: 'Comment ça marche',
  faqBody: [
    'La liste d’adresses est chiffrée dans votre navigateur avant tout envoi — nous ne la voyons jamais en clair avant de la déchiffrer nous-mêmes, et personne qui trouve le fichier sur votre site ne le peut non plus.',
    'Ajouter ou retirer une adresse prend effet dès que vous revérifiez — sans attendre une revérification programmée.',
    'Un libellé est seulement pour vous, pour distinguer vos propres portefeuilles. Il reste privé à l’intérieur du fichier chiffré.',
    'Si le fichier disparaît de votre site, ou que l’enregistrement DNS change, vos adresses cessent d’apparaître comme vérifiées en une journée — automatiquement, sans aucune action de votre part.',
  ],
};

const MAP: Record<Lang, VerifyRosterLocale> = { en, es, fr };

export function getVerifyRoster(lang: Lang): VerifyRosterLocale {
  return MAP[lang] ?? MAP.en;
}
