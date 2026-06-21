// Verify dashboard (/dashboard/verify) — page + island strings (EN · ES · FR).
//
// Cookie-based app i18n: verify.astro reads getLang(Astro.request) and selects via
// getVerifyDashboard(lang), then passes the strings to the React island as a prop.
// Island props are serialized to JSON, so every value here is a plain string —
// interpolation uses {n}/{what} tokens replaced client-side, never functions.
//
// "Almstins Verify" is a brand name and stays as-is. Chain names (Ethereum, Bitcoin,
// …) are proper nouns and live in the component, not here; only the URL rail label
// is translated. ES/FR are first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface VerifyDashboardLocale {
  lang: Lang;
  // Page + hero (verify.astro)
  pageTitle: string;
  heroKicker: string;
  heroTitle: string;
  heroSub: string;
  heroAlt: string;
  // Notice + load error (island)
  notice: string;
  loadError: string;
  // Rail label (chain names stay English; only URL is translated)
  railUrl: string;
  // Sections
  addressesTitle: string;
  qrTitle: string;
  emptyNone: string;
  loading: string;
  limitReached: string; // "… ({n}) …"
  // Row
  confirmRemove: string;
  removeAria: string;
  // Add form
  chainAria: string;
  addrPlaceholder: string;
  qrPlaceholder: string;
  labelPlaceholder: string;
  registerBtn: string;
  addingBtn: string;
  addError: string;
  addErrDuplicate: string;
  addErrInvalid: string;
  // Verify a sign
  verifyTitle: string;
  verifyHint: string;
  verifyPlaceholder: string;
  scanBtn: string;
  scanningBtn: string;
  checkBtn: string;
  checkingBtn: string;
  match: string;
  matchWith: string; // "… ({what})."
  noMatch: string;
  noQrFound: string;
  scanReadError: string;
  checkFailed: string;
  verifyNetworkError: string;
  // Safety overlay — an independent scam screen on the scanned value, shown
  // alongside the "is it still yours" match. Address → wallet-check; URL → dapp-check.
  safetyLabel: string;
  safetyChecking: string;
  safetyClean: string;
  safetyCaution: string;
  safetyUnclear: string;
  safetyDanger: string;
  safetyError: string;
  // Phase 3 — proof-of-control (domain attestation) outcomes. verifyProof.ts returns
  // a code; the UI maps it to one of these. Defined locale-first ahead of the panel.
  proofProven: string;
  proofChallengeMismatch: string;
  proofAddressNotListed: string;
  proofUnreachable: string;
  proofMalformed: string;
  proofInvalidDomain: string;
}

export const en: VerifyDashboardLocale = {
  lang: 'en',
  pageTitle: 'Verify | Almstins',
  heroKicker: 'Almstins Verify',
  heroTitle: 'Watch your receiving addresses',
  heroSub: 'Register the payment destinations you publish — Almstins watches them for swaps.',
  heroAlt: "A merchant's Scan-to-Pay crypto QR protected by a glowing Almstins Verify shield",
  notice: "Ownership proof and live monitoring arrive in the next update. For now, register the destinations you want to watch — they're held privately under your account.",
  loadError: 'Could not load your destinations.',
  railUrl: 'Link / URL',
  addressesTitle: 'Receiving addresses',
  qrTitle: 'Payment QR',
  emptyNone: 'None yet.',
  loading: 'Loading…',
  limitReached: 'Free early-access limit reached ({n}). More capacity is coming.',
  confirmRemove: 'Remove this destination?',
  removeAria: 'Remove destination',
  chainAria: 'Chain',
  addrPlaceholder: 'Receiving address',
  qrPlaceholder: 'Payment link or address the QR encodes',
  labelPlaceholder: 'Label (optional)',
  registerBtn: 'Register',
  addingBtn: 'Adding…',
  addError: 'Could not add that destination.',
  addErrDuplicate: 'You have already registered this destination.',
  addErrInvalid: 'A destination value is required.',
  verifyTitle: 'Verify a sign',
  verifyHint: 'Scan or paste the QR / address from a sign, invoice, or checkout to confirm it still matches a destination you registered — before anyone pays it.',
  verifyPlaceholder: 'Scan or paste an address or payment link',
  scanBtn: '📷 Scan',
  scanningBtn: 'Reading…',
  checkBtn: 'Check',
  checkingBtn: 'Checking…',
  match: '✓ Still yours — this matches a destination you registered.',
  matchWith: '✓ Still yours — this matches a destination you registered ({what}).',
  noMatch: "⚠ Not one of your registered destinations. If this is your own sign, the QR may have been swapped — don't rely on it until you confirm.",
  noQrFound: 'No QR code found in that image — paste the address instead.',
  scanReadError: 'Could not read that image — paste the address instead.',
  checkFailed: 'Could not check that.',
  verifyNetworkError: 'Could not reach the verifier. Try again.',
  safetyLabel: 'Safety check:',
  safetyChecking: 'Screening for scam signals…',
  safetyClean: '✓ No known scam signals on this destination.',
  safetyCaution: '⚠ Some caution signals — review before you pay.',
  safetyUnclear: 'Not enough data to clear it — treat with caution.',
  safetyDanger: '⛔ Scam signals detected — do not pay this.',
  safetyError: 'Could not complete the safety check.',
  proofProven: '✓ Ownership proven — this domain published your address.',
  proofChallengeMismatch: '⚠ The verification file is there, but its code doesn’t match. Re-publish the exact file we gave you.',
  proofAddressNotListed: '⚠ Domain verified, but this address isn’t listed in the file. Add it and check again.',
  proofUnreachable: '⚠ Couldn’t reach the verification file. Publish it at /.well-known/almstins-verify.json and try again.',
  proofMalformed: '⚠ The verification file was found but couldn’t be read. Check it’s valid JSON in the format we gave you.',
  proofInvalidDomain: '⚠ That doesn’t look like a public domain we can verify.',
};

export const es: VerifyDashboardLocale = {
  lang: 'es',
  pageTitle: 'Verify | Almstins',
  heroKicker: 'Almstins Verify',
  heroTitle: 'Vigila tus direcciones de cobro',
  heroSub: 'Registra los destinos de pago que publicas — Almstins los vigila por si los cambian.',
  heroAlt: 'El QR cripto de cobro de un comercio protegido por un escudo brillante de Almstins Verify',
  notice: 'La prueba de propiedad y la supervisión en vivo llegan en la próxima actualización. Por ahora, registra los destinos que quieres vigilar — se guardan de forma privada en tu cuenta.',
  loadError: 'No se pudieron cargar tus destinos.',
  railUrl: 'Enlace / URL',
  addressesTitle: 'Direcciones de cobro',
  qrTitle: 'QR de pago',
  emptyNone: 'Ninguno todavía.',
  loading: 'Cargando…',
  limitReached: 'Límite de acceso anticipado gratuito alcanzado ({n}). Pronto habrá más capacidad.',
  confirmRemove: '¿Eliminar este destino?',
  removeAria: 'Eliminar destino',
  chainAria: 'Cadena',
  addrPlaceholder: 'Dirección de cobro',
  qrPlaceholder: 'Enlace de pago o dirección que codifica el QR',
  labelPlaceholder: 'Etiqueta (opcional)',
  registerBtn: 'Registrar',
  addingBtn: 'Añadiendo…',
  addError: 'No se pudo añadir ese destino.',
  addErrDuplicate: 'Ya registraste este destino.',
  addErrInvalid: 'Se requiere un valor de destino.',
  verifyTitle: 'Verifica un letrero',
  verifyHint: 'Escanea o pega el QR / la dirección de un letrero, factura o pantalla de pago para confirmar que todavía coincide con un destino que registraste — antes de que alguien pague.',
  verifyPlaceholder: 'Escanea o pega una dirección o un enlace de pago',
  scanBtn: '📷 Escanear',
  scanningBtn: 'Leyendo…',
  checkBtn: 'Comprobar',
  checkingBtn: 'Comprobando…',
  match: '✓ Sigue siendo tuyo — coincide con un destino que registraste.',
  matchWith: '✓ Sigue siendo tuyo — coincide con un destino que registraste ({what}).',
  noMatch: '⚠ No es uno de tus destinos registrados. Si es tu propio letrero, puede que hayan cambiado el QR — no te fíes hasta confirmarlo.',
  noQrFound: 'No se encontró ningún código QR en esa imagen — pega la dirección en su lugar.',
  scanReadError: 'No se pudo leer esa imagen — pega la dirección en su lugar.',
  checkFailed: 'No se pudo comprobar eso.',
  verifyNetworkError: 'No se pudo conectar con el verificador. Inténtalo de nuevo.',
  safetyLabel: 'Control de seguridad:',
  safetyChecking: 'Analizando señales de estafa…',
  safetyClean: '✓ Sin señales de estafa conocidas en este destino.',
  safetyCaution: '⚠ Algunas señales de precaución — revísalo antes de pagar.',
  safetyUnclear: 'No hay datos suficientes para descartarlo — trátalo con precaución.',
  safetyDanger: '⛔ Señales de estafa detectadas — no pagues esto.',
  safetyError: 'No se pudo completar el control de seguridad.',
  proofProven: '✓ Propiedad verificada — este dominio publicó tu dirección.',
  proofChallengeMismatch: '⚠ El archivo de verificación está, pero su código no coincide. Vuelve a publicar el archivo exacto que te dimos.',
  proofAddressNotListed: '⚠ Dominio verificado, pero esta dirección no aparece en el archivo. Agrégala y vuelve a comprobar.',
  proofUnreachable: '⚠ No se pudo acceder al archivo de verificación. Publícalo en /.well-known/almstins-verify.json e inténtalo de nuevo.',
  proofMalformed: '⚠ Se encontró el archivo de verificación pero no se pudo leer. Comprueba que sea JSON válido con el formato que te dimos.',
  proofInvalidDomain: '⚠ Eso no parece un dominio público que podamos verificar.',
};

export const fr: VerifyDashboardLocale = {
  lang: 'fr',
  pageTitle: 'Verify | Almstins',
  heroKicker: 'Almstins Verify',
  heroTitle: 'Surveillez vos adresses de réception',
  heroSub: 'Enregistrez les destinations de paiement que vous publiez — Almstins les surveille contre les substitutions.',
  heroAlt: 'Le QR crypto « Scan-to-Pay » d’un commerçant protégé par un bouclier lumineux Almstins Verify',
  notice: 'La preuve de propriété et la surveillance en direct arrivent dans la prochaine mise à jour. Pour l’instant, enregistrez les destinations que vous voulez surveiller — elles restent privées sur votre compte.',
  loadError: 'Impossible de charger vos destinations.',
  railUrl: 'Lien / URL',
  addressesTitle: 'Adresses de réception',
  qrTitle: 'QR de paiement',
  emptyNone: 'Aucune pour l’instant.',
  loading: 'Chargement…',
  limitReached: 'Limite d’accès anticipé gratuit atteinte ({n}). Plus de capacité arrive bientôt.',
  confirmRemove: 'Supprimer cette destination ?',
  removeAria: 'Supprimer la destination',
  chainAria: 'Chaîne',
  addrPlaceholder: 'Adresse de réception',
  qrPlaceholder: 'Lien de paiement ou adresse encodée par le QR',
  labelPlaceholder: 'Libellé (facultatif)',
  registerBtn: 'Enregistrer',
  addingBtn: 'Ajout…',
  addError: 'Impossible d’ajouter cette destination.',
  addErrDuplicate: 'Vous avez déjà enregistré cette destination.',
  addErrInvalid: 'Une valeur de destination est requise.',
  verifyTitle: 'Vérifier une affiche',
  verifyHint: 'Scannez ou collez le QR / l’adresse d’une affiche, d’une facture ou d’une page de paiement pour confirmer qu’il correspond toujours à une destination que vous avez enregistrée — avant tout paiement.',
  verifyPlaceholder: 'Scannez ou collez une adresse ou un lien de paiement',
  scanBtn: '📷 Scanner',
  scanningBtn: 'Lecture…',
  checkBtn: 'Vérifier',
  checkingBtn: 'Vérification…',
  match: '✓ Toujours à vous — cela correspond à une destination que vous avez enregistrée.',
  matchWith: '✓ Toujours à vous — cela correspond à une destination que vous avez enregistrée ({what}).',
  noMatch: '⚠ Ce n’est pas une de vos destinations enregistrées. Si c’est votre propre affiche, le QR a peut-être été remplacé — ne vous y fiez pas avant de vérifier.',
  noQrFound: 'Aucun code QR trouvé dans cette image — collez plutôt l’adresse.',
  scanReadError: 'Impossible de lire cette image — collez plutôt l’adresse.',
  checkFailed: 'Impossible de vérifier cela.',
  verifyNetworkError: 'Impossible de joindre le vérificateur. Réessayez.',
  safetyLabel: 'Contrôle de sécurité :',
  safetyChecking: 'Analyse des signaux d’arnaque…',
  safetyClean: '✓ Aucun signal d’arnaque connu sur cette destination.',
  safetyCaution: '⚠ Quelques signaux de prudence — vérifiez avant de payer.',
  safetyUnclear: 'Données insuffisantes pour l’écarter — à traiter avec prudence.',
  safetyDanger: '⛔ Signaux d’arnaque détectés — ne payez pas.',
  safetyError: 'Impossible de terminer le contrôle de sécurité.',
  proofProven: '✓ Propriété prouvée — ce domaine a publié votre adresse.',
  proofChallengeMismatch: '⚠ Le fichier de vérification est là, mais son code ne correspond pas. Republiez le fichier exact que nous vous avons fourni.',
  proofAddressNotListed: '⚠ Domaine vérifié, mais cette adresse ne figure pas dans le fichier. Ajoutez-la et revérifiez.',
  proofUnreachable: '⚠ Impossible d’accéder au fichier de vérification. Publiez-le à /.well-known/almstins-verify.json et réessayez.',
  proofMalformed: '⚠ Le fichier de vérification a été trouvé mais n’a pas pu être lu. Vérifiez qu’il s’agit d’un JSON valide au format fourni.',
  proofInvalidDomain: '⚠ Cela ne ressemble pas à un domaine public que nous pouvons vérifier.',
};

const MAP: Record<Lang, VerifyDashboardLocale> = { en, es, fr };

export function getVerifyDashboard(lang: Lang): VerifyDashboardLocale {
  return MAP[lang] ?? MAP.en;
}
