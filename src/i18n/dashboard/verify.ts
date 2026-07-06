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
  emptyAddrBody: string;
  emptyQrBody: string;
  emptyHint: string;
  copyAria: string;
  copied: string;
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
  addErrClaimed: string;
  addErrNameTaken: string;
  // Verify a sign
  verifyTitle: string;
  verifyHint: string;
  verifyPlaceholder: string;
  scanBtn: string;
  cameraBtn: string;
  cameraStopBtn: string;
  uploadBtn: string;
  cameraHint: string;
  cameraError: string;
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
  proofNameAttached: string;
  proveDnsOr: string;
  proveDnsStep: string;
  proofChallengeMismatch: string;
  proofAddressNotListed: string;
  proofUnreachable: string;
  proofMalformed: string;
  proofInvalidDomain: string;
  // Proof-status badge labels (localized; the raw status code drives the CSS class).
  statusUnproven: string;
  statusProven: string;
  statusLapsed: string;
  statusRevoked: string;
  // "Prove ownership" panel
  proveBtn: string;
  proveHint: string;
  proveDomainPlaceholder: string;
  proveGetFileBtn: string;
  proveStep1: string; // "… ({url}) …"
  proveCopyBtn: string;
  proveVerifyBtn: string;
  proveVerifyingBtn: string;
  proveError: string;
  // Self-send proof of control (micro-deposit) — Phase 4.
  proveMethodSelfSend: string;
  proveMethodDomain: string;
  ssHint: string; // "… {address} …"
  ssCheckBtn: string;
  ssCheckingBtn: string;
  ssProven: string;
  ssNotYet: string;
  ssClaimedElsewhere: string;
  ssUnsupported: string;
  ssUnavailable: string;
  // Shareable verified-address QR badge.
  qrBadgeBtn: string;
  paymentQrBtn: string;
  paymentQrHint: string;
  qrBadgeHint: string;
  qrBadgeDownload: string;
  provenBy: string; // "… ({domain})"
  monitorBtn: string;
  monitorSoonBtn: string;
  monitorSoonTitle: string;
  monitorOnBtn: string;
  monitorHint: string;
  monitorPlaceholder: string;
  monitorSaveBtn: string;
  monitorSavingBtn: string;
  monitorStopBtn: string;
  monitorError: string;
  monitorDemoNote: string;
  monitorStatusPresent: string;
  monitorStatusSwapped: string;
  monitorStatusMissing: string;
  monitorStatusUnreachable: string;
  // Verified entities (hosted-API-endpoint variant) — exchanges / large platforms.
  entHeading: string;
  entIntro: string;
  entEmpty: string;
  entDomainPlaceholder: string;
  entAddBtn: string;
  entAddingBtn: string;
  entConnectPrompt: string;
  entEndpointPlaceholder: string;
  entKeyPlaceholder: string;
  entConnectBtn: string;
  entConnectingBtn: string;
  entSynced: string; // "{n} …"
  entPulled: string; // "… {n} …"
  entInvalidEndpoint: string;
  entNotProven: string;
  entEncUnavailable: string;
  entUnauthorized: string;
  entUnreachable: string;
  entMalformed: string;
  entError: string;
  // API keys — programmatic access to the three public endpoints.
  apiKeysHeading: string;
  apiKeysIntro: string;
  apiKeysEmpty: string;
  apiKeysLabelPlaceholder: string;
  apiKeysGenerateBtn: string;
  apiKeysGeneratingBtn: string;
  apiKeysRevokeBtn: string;
  apiKeysRevokingBtn: string;
  apiKeysConfirmRevoke: string;
  apiKeysCopyBtn: string;
  apiKeysCopied: string;
  apiKeysCreatedAt: string;   // "Created {date}"
  apiKeysLastUsed: string;    // "Last used {date}"
  apiKeysNeverUsed: string;
  apiKeysNewKey: string;      // one-time reveal heading
  apiKeysNewHint: string;
  apiKeysDocsLink: string;
  apiKeysError: string;
  apiKeysMaxReached: string;  // "Max {n} keys"
  // Demo mode (seeded sample vendor account) — banner + how-to guide.
  demoBanner: string;
  demoSignupCta: string;
  demoProveNote: string;
  howToHeading: string;
  howToWalletTitle: string;
  howToWalletSteps: string[];
  howToStripeTitle: string;
  howToStripeSteps: string[];
  howToExchangeTitle: string;
  howToExchangeSteps: string[];
  howToCustomerTitle: string;
  howToCustomerSteps: string[];
}

export const en: VerifyDashboardLocale = {
  lang: 'en',
  pageTitle: 'Verify | Almstins',
  heroKicker: 'Almstins Verify',
  heroTitle: 'Watch your receiving addresses',
  heroSub: 'Register the payment destinations you publish — Almstins watches them for swaps.',
  heroAlt: "A merchant's Scan-to-Pay crypto QR protected by a glowing Almstins Verify shield",
  notice: "Almstins Verify is in beta — and free. You're welcome to register up to 3 destinations, and one of them can be a payment QR code instead of a wallet address (so: 2 wallets + 1 QR). They're held privately under your account. Paid plans coming soon.",
  loadError: 'Could not load your destinations.',
  railUrl: 'Link / URL',
  addressesTitle: 'Receiving addresses',
  qrTitle: 'Payment QR',
  emptyNone: 'Nothing here yet',
  emptyAddrBody: 'Add a receiving address to bind it to your QR codes. Customers only ever see addresses you’ve registered here.',
  emptyQrBody: 'Add a payment QR or link your customers scan — we confirm it’s the one you registered before they pay.',
  emptyHint: 'Read-only — no wallet connection, ever. We never ask to sign or move funds.',
  copyAria: 'Copy',
  copied: 'Copied',
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
  addErrClaimed: 'This payment link is already verified by another Almstins account.',
  addErrNameTaken: 'That business name is verified by another business. Choose a different name.',
  verifyTitle: 'Verify a sign',
  verifyHint: 'Scan or paste the QR / address from a sign, invoice, or checkout to confirm it still matches a destination you registered — before anyone pays it.',
  verifyPlaceholder: 'Scan or paste an address or payment link',
  scanBtn: '📷 Scan',
  cameraBtn: '📷 Camera',
  cameraStopBtn: '✕ Stop',
  uploadBtn: '📁 Upload',
  cameraHint: 'Point your camera at the QR — it scans automatically. (Esc to cancel.)',
  cameraError: 'Couldn’t open the camera — allow access, or use Upload instead.',
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
  proofNameAttached: '✓ Domain verified — your business name is now attached. (Verify each wallet separately with a self-send if you haven’t.)',
  proveDnsOr: 'No website to host a file? Use a DNS record instead:',
  proveDnsStep: 'Add a TXT record to your domain (host “@”, or “_almstins-verify”) with this exact value, then verify:',
  proofChallengeMismatch: '⚠ The verification file is there, but its code doesn’t match. Re-publish the exact file we gave you.',
  proofAddressNotListed: '⚠ Domain verified, but this address isn’t listed in the file. Add it and check again.',
  proofUnreachable: '⚠ Couldn’t reach the verification file. Publish it at /.well-known/almstins-verify.json and try again.',
  proofMalformed: '⚠ The verification file was found but couldn’t be read. Check it’s valid JSON in the format we gave you.',
  proofInvalidDomain: '⚠ That doesn’t look like a public domain we can verify.',
  statusUnproven: 'Unverified',
  statusProven: 'Verified',
  statusLapsed: 'Lapsed',
  statusRevoked: 'Revoked',
  proveBtn: 'Prove',
  proveHint: 'Prove you control the domain — that attaches your verified business name. Two ways: publish a small file on your site (best if you also want the domain to vouch for your addresses), or add a DNS TXT record (easiest on Shopify/Wix/Squarespace). Do either.',
  proveDomainPlaceholder: 'yourdomain.com',
  proveGetFileBtn: 'Get file',
  proveStep1: 'Publish this exact file at {url}, then verify:',
  proveCopyBtn: 'Copy',
  proveVerifyBtn: 'Verify now',
  proveVerifyingBtn: 'Verifying…',
  proveError: 'Something went wrong. Try again.',
  proveMethodSelfSend: 'Self-send — no website',
  proveMethodDomain: 'Domain',
  ssHint: 'From the wallet that holds {address}, send any tiny amount — even to yourself. We’ll watch the chain and confirm in about a minute. We never ask you to connect or sign anything.',
  ssCheckBtn: 'I’ve sent it — check now',
  ssCheckingBtn: 'Checking…',
  ssProven: '✓ Verified — you control this address.',
  ssNotYet: 'No outgoing transaction yet. Send one from this address, then check again.',
  ssClaimedElsewhere: 'This address is already verified by another account.',
  ssUnsupported: 'Self-send proof isn’t available for this chain yet.',
  ssUnavailable: 'Couldn’t reach the chain — try again in a moment.',
  qrBadgeBtn: '📱 QR badge',
  paymentQrBtn: '📥 Download QR',
  paymentQrHint: 'A printable QR of this receiving destination — put it on your counter, invoice, or checkout. Customers scan it to pay, and can check it against Almstins before they send. (Prove the destination so the check shows “verified.”)',
  qrBadgeHint: 'Customers scan this to confirm this address is really yours. Print it or add it to your sign, invoice, or checkout.',
  qrBadgeDownload: 'Download PNG',
  provenBy: 'Published by {domain}',
  monitorBtn: '👁 Watch page',
  monitorSoonBtn: '👁 Live monitoring — coming soon',
  monitorSoonTitle: 'Continuous swap-monitoring with alerts is a paid feature, coming soon. On-demand checks stay free.',
  monitorOnBtn: '👁 Watching',
  monitorHint: 'Paste the public web page where you publish this — a "pay here" page, donation page, invoice, or checkout. We re-check it regularly and email you if the address or link shown there ever changes from what you registered (a swap). Works best on a normal web page; values drawn by JavaScript may not be readable.',
  monitorPlaceholder: 'https://yourshop.com/pay',
  monitorSaveBtn: 'Watch this page',
  monitorSavingBtn: 'Saving…',
  monitorStopBtn: 'Stop watching',
  monitorError: 'Couldn’t save that. Use the full https:// address of the page.',
  monitorDemoNote: 'In the live app, you can attach the public page where you publish this destination. We re-check it and email you if the address or link shown there is ever swapped. Sign up free to use it.',
  monitorStatusPresent: '✓ Last check: your destination is still the one shown on that page.',
  monitorStatusSwapped: '⛔ Last check: the page is showing a DIFFERENT destination — possible swap. We’ve emailed your alert address.',
  monitorStatusMissing: 'Last check: we couldn’t find your destination on that page (it may have changed, or be drawn by JavaScript). No alert sent.',
  monitorStatusUnreachable: 'Last check: we couldn’t reach that page. We’ll keep trying; no alert sent.',
  entHeading: 'Exchanges & large platforms',
  entIntro: 'Publish many receiving addresses? Verify them all from your own domain. Prove the domain, then connect a read-only endpoint and we keep your list in sync.',
  entEmpty: 'No domains yet.',
  entDomainPlaceholder: 'yourdomain.com',
  entAddBtn: 'Add domain',
  entAddingBtn: 'Adding…',
  entConnectPrompt: 'Domain verified. Connect a read-only endpoint on this domain plus the API key it accepts — we send it as a Bearer token and only read your address list.',
  entEndpointPlaceholder: 'https://yourdomain.com/addresses',
  entKeyPlaceholder: 'API key',
  entConnectBtn: 'Connect & sync',
  entConnectingBtn: 'Connecting…',
  entSynced: '{n} addresses synced',
  entPulled: '✓ Connected — {n} addresses synced.',
  entInvalidEndpoint: '⚠ The endpoint must be HTTPS on your verified domain (or a subdomain).',
  entNotProven: '⚠ Prove your domain first.',
  entEncUnavailable: "⚠ The server can't store keys right now. Please contact support.",
  entUnauthorized: '⚠ Your endpoint rejected the key (401/403). Check the key.',
  entUnreachable: "⚠ Couldn't reach your endpoint. Check the URL and that it's live.",
  entMalformed: "⚠ Your endpoint's response wasn't in the expected format.",
  entError: 'Something went wrong. Try again.',
  apiKeysHeading: 'API Keys',
  apiKeysIntro: 'Use an API key to call the three public endpoints from scripts or agents — 60 req/min vs 10/min unauthenticated. Keys are scoped to your account and never expire until you revoke them.',
  apiKeysEmpty: 'No keys yet. Generate one to get started.',
  apiKeysLabelPlaceholder: 'Key label (e.g. my-script)',
  apiKeysGenerateBtn: 'Generate key',
  apiKeysGeneratingBtn: 'Generating…',
  apiKeysRevokeBtn: 'Revoke',
  apiKeysRevokingBtn: 'Revoking…',
  apiKeysConfirmRevoke: 'Revoke this key? Any code using it will stop working immediately.',
  apiKeysCopyBtn: 'Copy',
  apiKeysCopied: 'Copied!',
  apiKeysCreatedAt: 'Created {date}',
  apiKeysLastUsed: 'Last used {date}',
  apiKeysNeverUsed: 'Never used',
  apiKeysNewKey: 'Your new API key',
  apiKeysNewHint: 'Copy it now — it will not be shown again.',
  apiKeysDocsLink: 'API documentation →',
  apiKeysError: 'Something went wrong. Try again.',
  apiKeysMaxReached: 'Max {n} keys per account.',
  demoBanner: 'This is a demo vendor account — the destinations below are samples. Try “Verify a sign” to check one, then see how to register your own.',
  demoSignupCta: 'Sign up free →',
  demoProveNote: 'In the live app, you prove this address by sending the tiny amount we show you, from that same wallet — we just watch the chain for it, so we never ask you to connect or sign anything. Once it lands, the address is Verified and locked to your account. Sign up free to prove your own.',
  howToHeading: 'How to register your own',
  howToWalletTitle: 'Add a wallet address',
  howToWalletSteps: [
    'Pick the chain — Bitcoin, Ethereum, Polygon, Avalanche, Solana, or Litecoin.',
    'Paste the receiving address your customers actually pay — the same one on your sign, invoice, or checkout — give it a label, and Register.',
    'Prove you control it: send the tiny amount we show you, from that wallet. We watch the public chain for it — we never ask you to connect a wallet or sign anything.',
    'Once we see it, the address flips to Verified and is locked to your account — claimed once, so no one else can list it as theirs.',
    'No keys to that address (a custodial or exchange deposit address)? It still lists under your account as Self-listed — a clearly lower tier than Verified.',
  ],
  howToStripeTitle: 'Add a Stripe payment link',
  howToStripeSteps: [
    'In Stripe, create a Payment Link (Product catalog → Payment links) and copy its URL — it looks like https://buy.stripe.com/…',
    'Here, under Payment QR, paste that URL and Register it. Registering a link while signed in to your own account is the proof it’s yours — so it turns Verified the moment you save it, and is locked to your account (claimed once, no one else can list it).',
    'You never log in to Stripe through us, and we never ask for keys. We never see your balance, payouts, customers, or payment rails — there is nothing connected to expose.',
    'Now a customer who scans that QR sees ✓ Verified with your label. If a scammer swaps your sticker for a different link, their scan shows ⚠ Not a verified destination — so they stop before paying.',
  ],
  howToExchangeTitle: 'Publishing many addresses? (exchanges & platforms)',
  howToExchangeSteps: [
    'Publish your official address list on your own domain, and prove the domain once by hosting a single Almstins file on it.',
    'Connect a read-only API endpoint that returns the list, plus a key — we only ever read it, and never move funds.',
    'We keep the list in sync, so any customer can verify an official address against your domain before they send.',
  ],
  howToCustomerTitle: 'What your customers see',
  howToCustomerSteps: [
    'Your customer scans the QR or address on your sign, invoice, or checkout.',
    'If it matches a destination you’ve proven, they see ✓ Verified with your label — confidence it’s really you, before they send a cent.',
    'If your QR was swapped for someone else’s address, it shows ⚠ Not a verified destination — so they stop before paying a scammer.',
    'Every scan also runs a free safety screen — scam, sanctions, and honeypot lists for an address; phishing and scam-site lists for a payment link — flagging a dangerous destination even if it isn’t yours.',
  ],
};

export const es: VerifyDashboardLocale = {
  lang: 'es',
  pageTitle: 'Verify | Almstins',
  heroKicker: 'Almstins Verify',
  heroTitle: 'Vigila tus direcciones de cobro',
  heroSub: 'Registra los destinos de pago que publicas — Almstins los vigila por si los cambian.',
  heroAlt: 'El QR cripto de cobro de un comercio protegido por un escudo brillante de Almstins Verify',
  notice: 'Almstins Verify está en beta — y es gratis. Puedes registrar hasta 3 destinos, y uno de ellos puede ser un código QR de pago en lugar de una dirección de billetera (es decir: 2 billeteras + 1 QR). Se guardan de forma privada en tu cuenta. Precios próximamente.',
  loadError: 'No se pudieron cargar tus destinos.',
  railUrl: 'Enlace / URL',
  addressesTitle: 'Direcciones de cobro',
  qrTitle: 'QR de pago',
  emptyNone: 'Aún no hay nada',
  emptyAddrBody: 'Añade una dirección de cobro para vincularla a tus códigos QR. Los clientes solo ven direcciones que has registrado aquí.',
  emptyQrBody: 'Añade un QR o enlace de pago que escaneen tus clientes — confirmamos que es el que registraste antes de que paguen.',
  emptyHint: 'Solo lectura — nunca se conecta la billetera. Nunca pedimos firmar ni mover fondos.',
  copyAria: 'Copiar',
  copied: 'Copiado',
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
  addErrClaimed: 'Este enlace de pago ya está verificado por otra cuenta de Almstins.',
  addErrNameTaken: 'Ese nombre de negocio está verificado por otro negocio. Elige un nombre diferente.',
  verifyTitle: 'Verifica un letrero',
  verifyHint: 'Escanea o pega el QR / la dirección de un letrero, factura o pantalla de pago para confirmar que todavía coincide con un destino que registraste — antes de que alguien pague.',
  verifyPlaceholder: 'Escanea o pega una dirección o un enlace de pago',
  scanBtn: '📷 Escanear',
  cameraBtn: '📷 Cámara',
  cameraStopBtn: '✕ Detener',
  uploadBtn: '📁 Subir',
  cameraHint: 'Apunta la cámara al QR — se escanea automáticamente. (Esc para cancelar.)',
  cameraError: 'No se pudo abrir la cámara — permite el acceso, o usa Subir.',
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
  proofNameAttached: '✓ Dominio verificado — tu nombre de negocio ya está adjunto. (Verifica cada billetera por separado con un autoenvío si aún no lo has hecho.)',
  proveDnsOr: '¿Sin sitio web para alojar un archivo? Usa un registro DNS:',
  proveDnsStep: 'Añade un registro TXT a tu dominio (host «@» o «_almstins-verify») con este valor exacto, y luego verifica:',
  proofChallengeMismatch: '⚠ El archivo de verificación está, pero su código no coincide. Vuelve a publicar el archivo exacto que te dimos.',
  proofAddressNotListed: '⚠ Dominio verificado, pero esta dirección no aparece en el archivo. Agrégala y vuelve a comprobar.',
  proofUnreachable: '⚠ No se pudo acceder al archivo de verificación. Publícalo en /.well-known/almstins-verify.json e inténtalo de nuevo.',
  proofMalformed: '⚠ Se encontró el archivo de verificación pero no se pudo leer. Comprueba que sea JSON válido con el formato que te dimos.',
  proofInvalidDomain: '⚠ Eso no parece un dominio público que podamos verificar.',
  statusUnproven: 'Sin verificar',
  statusProven: 'Verificado',
  statusLapsed: 'Caducado',
  statusRevoked: 'Revocado',
  proveBtn: 'Probar',
  proveHint: 'Demuestra que controlas el dominio — eso adjunta tu nombre de negocio verificado. Dos formas: publica un archivo pequeño en tu sitio (mejor si además quieres que el dominio respalde tus direcciones), o añade un registro DNS TXT (lo más fácil en Shopify/Wix/Squarespace). Haz cualquiera de las dos.',
  proveDomainPlaceholder: 'tudominio.com',
  proveGetFileBtn: 'Obtener archivo',
  proveStep1: 'Publica este archivo exacto en {url} y luego verifica:',
  proveCopyBtn: 'Copiar',
  proveVerifyBtn: 'Verificar ahora',
  proveVerifyingBtn: 'Verificando…',
  proveError: 'Algo salió mal. Inténtalo de nuevo.',
  proveMethodSelfSend: 'Autoenvío — sin sitio web',
  proveMethodDomain: 'Dominio',
  ssHint: 'Desde la billetera que tiene {address}, envía cualquier cantidad mínima — incluso a ti mismo. Observaremos la cadena y lo confirmaremos en aproximadamente un minuto. Nunca te pedimos conectar ni firmar nada.',
  ssCheckBtn: 'Ya lo envié — comprobar ahora',
  ssCheckingBtn: 'Comprobando…',
  ssProven: '✓ Verificada — controlas esta dirección.',
  ssNotYet: 'Aún no hay transacción saliente. Envía una desde esta dirección y vuelve a comprobar.',
  ssClaimedElsewhere: 'Esta dirección ya está verificada por otra cuenta.',
  ssUnsupported: 'La prueba por autoenvío aún no está disponible para esta cadena.',
  ssUnavailable: 'No se pudo acceder a la cadena — inténtalo de nuevo en un momento.',
  qrBadgeBtn: '📱 Código QR',
  paymentQrBtn: '📥 Descargar QR',
  paymentQrHint: 'Un QR imprimible de este destino de cobro — ponlo en tu mostrador, factura o pantalla de pago. Los clientes lo escanean para pagar, y pueden comprobarlo contra Almstins antes de enviar. (Demuestra el destino para que la comprobación muestre «verificado».)',
  qrBadgeHint: 'Los clientes lo escanean para confirmar que esta dirección es realmente tuya. Imprímelo o añádelo a tu letrero, factura o pantalla de pago.',
  qrBadgeDownload: 'Descargar PNG',
  provenBy: 'Publicado por {domain}',
  monitorBtn: '👁 Vigilar página',
  monitorSoonBtn: '👁 Monitoreo en vivo — próximamente',
  monitorSoonTitle: 'La supervisión continua de sustituciones con alertas es una función de pago, próximamente. Las comprobaciones a demanda siguen siendo gratis.',
  monitorOnBtn: '👁 Vigilando',
  monitorHint: 'Pega la página web pública donde publicas esto — una página de "paga aquí", de donaciones, una factura o un checkout. La revisamos con regularidad y te enviamos un correo si la dirección o el enlace que aparece allí cambia respecto a lo que registraste (una sustitución). Funciona mejor en una página web normal; los valores generados por JavaScript pueden no ser legibles.',
  monitorPlaceholder: 'https://tutienda.com/pagar',
  monitorSaveBtn: 'Vigilar esta página',
  monitorSavingBtn: 'Guardando…',
  monitorStopBtn: 'Dejar de vigilar',
  monitorError: 'No se pudo guardar. Usa la dirección https:// completa de la página.',
  monitorDemoNote: 'En la app real, puedes adjuntar la página pública donde publicas este destino. La revisamos y te enviamos un correo si la dirección o el enlace que aparece allí es sustituido. Regístrate gratis para usarlo.',
  monitorStatusPresent: '✓ Última revisión: tu destino sigue siendo el que aparece en esa página.',
  monitorStatusSwapped: '⛔ Última revisión: la página muestra un destino DIFERENTE — posible sustitución. Enviamos un correo a tu dirección de alertas.',
  monitorStatusMissing: 'Última revisión: no encontramos tu destino en esa página (puede haber cambiado o estar generado por JavaScript). No se envió alerta.',
  monitorStatusUnreachable: 'Última revisión: no pudimos acceder a esa página. Seguiremos intentándolo; no se envió alerta.',
  entHeading: 'Exchanges y plataformas grandes',
  entIntro: '¿Publicas muchas direcciones de cobro? Verifícalas todas desde tu propio dominio. Verifica el dominio, luego conecta un endpoint de solo lectura y mantenemos tu lista sincronizada.',
  entEmpty: 'Ningún dominio todavía.',
  entDomainPlaceholder: 'tudominio.com',
  entAddBtn: 'Añadir dominio',
  entAddingBtn: 'Añadiendo…',
  entConnectPrompt: 'Dominio verificado. Conecta un endpoint de solo lectura en este dominio y la clave de API que acepta — la enviamos como token Bearer y solo leemos tu lista de direcciones.',
  entEndpointPlaceholder: 'https://tudominio.com/direcciones',
  entKeyPlaceholder: 'Clave de API',
  entConnectBtn: 'Conectar y sincronizar',
  entConnectingBtn: 'Conectando…',
  entSynced: '{n} direcciones sincronizadas',
  entPulled: '✓ Conectado — {n} direcciones sincronizadas.',
  entInvalidEndpoint: '⚠ El endpoint debe ser HTTPS en tu dominio verificado (o un subdominio).',
  entNotProven: '⚠ Verifica tu dominio primero.',
  entEncUnavailable: '⚠ El servidor no puede guardar claves ahora mismo. Contacta con soporte.',
  entUnauthorized: '⚠ Tu endpoint rechazó la clave (401/403). Revisa la clave.',
  entUnreachable: '⚠ No se pudo acceder a tu endpoint. Revisa la URL y que esté activo.',
  entMalformed: '⚠ La respuesta de tu endpoint no tenía el formato esperado.',
  entError: 'Algo salió mal. Inténtalo de nuevo.',
  apiKeysHeading: 'Claves de API',
  apiKeysIntro: 'Usa una clave de API para llamar a los tres endpoints públicos desde scripts o agentes — 60 req/min vs 10/min sin autenticación. Las claves están vinculadas a tu cuenta y no caducan hasta que las revoques.',
  apiKeysEmpty: 'Aún no hay claves. Genera una para empezar.',
  apiKeysLabelPlaceholder: 'Etiqueta de la clave (ej. mi-script)',
  apiKeysGenerateBtn: 'Generar clave',
  apiKeysGeneratingBtn: 'Generando…',
  apiKeysRevokeBtn: 'Revocar',
  apiKeysRevokingBtn: 'Revocando…',
  apiKeysConfirmRevoke: '¿Revocar esta clave? Cualquier código que la use dejará de funcionar de inmediato.',
  apiKeysCopyBtn: 'Copiar',
  apiKeysCopied: '¡Copiado!',
  apiKeysCreatedAt: 'Creada {date}',
  apiKeysLastUsed: 'Último uso {date}',
  apiKeysNeverUsed: 'Nunca usada',
  apiKeysNewKey: 'Tu nueva clave de API',
  apiKeysNewHint: 'Cópiala ahora — no se mostrará de nuevo.',
  apiKeysDocsLink: 'Documentación de la API →',
  apiKeysError: 'Algo salió mal. Inténtalo de nuevo.',
  apiKeysMaxReached: 'Máximo {n} claves por cuenta.',
  demoBanner: 'Esta es una cuenta de comercio de demostración — los destinos de abajo son ejemplos. Prueba “Verifica un letrero” para comprobar uno y luego mira cómo registrar los tuyos.',
  demoSignupCta: 'Regístrate gratis →',
  demoProveNote: 'En la app real, demuestras esta dirección enviando el pequeño monto que te mostramos, desde esa misma billetera — solo observamos la cadena, así que nunca te pedimos conectar ni firmar nada. Cuando llega, la dirección queda Verificada y bloqueada a tu cuenta. Regístrate gratis para demostrar la tuya.',
  howToHeading: 'Cómo registrar los tuyos',
  howToWalletTitle: 'Agregar una dirección de billetera',
  howToWalletSteps: [
    'Elige la cadena — Bitcoin, Ethereum, Polygon, Avalanche, Solana o Litecoin.',
    'Pega la dirección de cobro que tus clientes realmente pagan — la misma de tu letrero, factura o checkout — ponle una etiqueta y Regístrala.',
    'Demuestra que la controlas: envía el pequeño monto que te mostramos, desde esa billetera. Observamos la cadena pública — nunca te pedimos conectar una billetera ni firmar nada.',
    'En cuanto lo vemos, la dirección pasa a Verificada y queda bloqueada a tu cuenta — reclamada una sola vez, así nadie más puede listarla como suya.',
    '¿No tienes las llaves de esa dirección (es de custodia o de un exchange)? Igual aparece en tu cuenta como Autolistada — un nivel claramente menor que Verificada.',
  ],
  howToStripeTitle: 'Agregar un enlace de pago de Stripe',
  howToStripeSteps: [
    'En Stripe, crea un Payment Link (Catálogo de productos → Payment links) y copia su URL — se ve como https://buy.stripe.com/…',
    'Aquí, en QR de pago, pega esa URL y Regístrala. Registrar un enlace con tu sesión iniciada en tu propia cuenta es la prueba de que es tuyo — así que queda Verificado en el momento en que lo guardas, y bloqueado a tu cuenta (reclamado una sola vez, nadie más puede listarlo).',
    'Nunca inicias sesión en Stripe a través de nosotros y nunca te pedimos claves. Nunca vemos tu saldo, tus pagos, tus clientes ni tus medios de cobro — no hay nada conectado que exponer.',
    'Ahora, un cliente que escanea ese QR ve ✓ Verificada con tu etiqueta. Si un estafador sustituye tu calcomanía por otro enlace, su escaneo muestra ⚠ Destino no verificado — y se detiene antes de pagar.',
  ],
  howToExchangeTitle: '¿Publicas muchas direcciones? (exchanges y plataformas)',
  howToExchangeSteps: [
    'Publica tu lista oficial de direcciones en tu propio dominio y demuestra el dominio una vez alojando en él un único archivo de Almstins.',
    'Conecta un endpoint de API de solo lectura que devuelva la lista, más una clave — solo la leemos y nunca movemos fondos.',
    'Mantenemos la lista sincronizada, para que cualquier cliente verifique una dirección oficial contra tu dominio antes de enviar.',
  ],
  howToCustomerTitle: 'Lo que ven tus clientes',
  howToCustomerSteps: [
    'Tu cliente escanea el QR o la dirección de tu letrero, factura o checkout.',
    'Si coincide con un destino que demostraste, ve ✓ Verificada con tu etiqueta — confianza de que eres tú, antes de enviar un centavo.',
    'Si sustituyeron tu QR por otra dirección, muestra ⚠ Destino no verificado — y se detiene antes de pagarle a un estafador.',
    'Cada escaneo también corre un chequeo de seguridad gratuito — listas de estafas, sanciones y honeypots para una dirección; listas de phishing y sitios fraudulentos para un enlace de pago — marcando un destino peligroso aunque no sea tuyo.',
  ],
};

export const fr: VerifyDashboardLocale = {
  lang: 'fr',
  pageTitle: 'Verify | Almstins',
  heroKicker: 'Almstins Verify',
  heroTitle: 'Surveillez vos adresses de réception',
  heroSub: 'Enregistrez les destinations de paiement que vous publiez — Almstins les surveille contre les substitutions.',
  heroAlt: 'Le QR crypto « Scan-to-Pay » d’un commerçant protégé par un bouclier lumineux Almstins Verify',
  notice: 'Almstins Verify est en bêta — et gratuit. Vous pouvez enregistrer jusqu’à 3 destinations, et l’une d’elles peut être un QR code de paiement au lieu d’une adresse de portefeuille (soit : 2 portefeuilles + 1 QR). Elles restent privées sur votre compte. Tarifs bientôt disponibles.',
  loadError: 'Impossible de charger vos destinations.',
  railUrl: 'Lien / URL',
  addressesTitle: 'Adresses de réception',
  qrTitle: 'QR de paiement',
  emptyNone: 'Rien pour l’instant',
  emptyAddrBody: 'Ajoutez une adresse de réception pour la lier à vos QR codes. Les clients ne voient que les adresses que vous avez enregistrées ici.',
  emptyQrBody: 'Ajoutez un QR ou un lien de paiement que vos clients scannent — nous confirmons que c’est celui que vous avez enregistré avant qu’ils ne paient.',
  emptyHint: 'Lecture seule — jamais de connexion de portefeuille. Nous ne demandons jamais de signer ni de déplacer des fonds.',
  copyAria: 'Copier',
  copied: 'Copié',
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
  addErrClaimed: 'Ce lien de paiement est déjà vérifié par un autre compte Almstins.',
  addErrNameTaken: 'Ce nom d’entreprise est vérifié par une autre entreprise. Choisissez un autre nom.',
  verifyTitle: 'Vérifier une affiche',
  verifyHint: 'Scannez ou collez le QR / l’adresse d’une affiche, d’une facture ou d’une page de paiement pour confirmer qu’il correspond toujours à une destination que vous avez enregistrée — avant tout paiement.',
  verifyPlaceholder: 'Scannez ou collez une adresse ou un lien de paiement',
  scanBtn: '📷 Scanner',
  cameraBtn: '📷 Caméra',
  cameraStopBtn: '✕ Arrêter',
  uploadBtn: '📁 Importer',
  cameraHint: 'Pointez la caméra vers le QR — il se scanne automatiquement. (Échap pour annuler.)',
  cameraError: 'Impossible d’ouvrir la caméra — autorisez l’accès, ou utilisez Importer.',
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
  proofNameAttached: '✓ Domaine vérifié — votre nom d’entreprise est maintenant rattaché. (Vérifiez chaque portefeuille séparément par auto-envoi si ce n’est pas déjà fait.)',
  proveDnsOr: 'Pas de site pour héberger un fichier ? Utilisez un enregistrement DNS :',
  proveDnsStep: 'Ajoutez un enregistrement TXT à votre domaine (hôte « @ » ou « _almstins-verify ») avec cette valeur exacte, puis vérifiez :',
  proofChallengeMismatch: '⚠ Le fichier de vérification est là, mais son code ne correspond pas. Republiez le fichier exact que nous vous avons fourni.',
  proofAddressNotListed: '⚠ Domaine vérifié, mais cette adresse ne figure pas dans le fichier. Ajoutez-la et revérifiez.',
  proofUnreachable: '⚠ Impossible d’accéder au fichier de vérification. Publiez-le à /.well-known/almstins-verify.json et réessayez.',
  proofMalformed: '⚠ Le fichier de vérification a été trouvé mais n’a pas pu être lu. Vérifiez qu’il s’agit d’un JSON valide au format fourni.',
  proofInvalidDomain: '⚠ Cela ne ressemble pas à un domaine public que nous pouvons vérifier.',
  statusUnproven: 'Non vérifié',
  statusProven: 'Vérifié',
  statusLapsed: 'Expiré',
  statusRevoked: 'Révoqué',
  proveBtn: 'Prouver',
  proveHint: 'Prouvez que vous contrôlez le domaine — cela rattache votre nom d’entreprise vérifié. Deux façons : publiez un petit fichier sur votre site (mieux si vous voulez aussi que le domaine atteste vos adresses), ou ajoutez un enregistrement DNS TXT (le plus simple sur Shopify/Wix/Squarespace). Au choix.',
  proveDomainPlaceholder: 'votredomaine.com',
  proveGetFileBtn: 'Obtenir le fichier',
  proveStep1: 'Publiez ce fichier exact à {url}, puis vérifiez :',
  proveCopyBtn: 'Copier',
  proveVerifyBtn: 'Vérifier maintenant',
  proveVerifyingBtn: 'Vérification…',
  proveError: 'Une erreur s’est produite. Réessayez.',
  proveMethodSelfSend: 'Auto-envoi — sans site web',
  proveMethodDomain: 'Domaine',
  ssHint: 'Depuis le portefeuille qui détient {address}, envoyez n’importe quel petit montant — même à vous-même. Nous observerons la chaîne et confirmerons en environ une minute. Nous ne vous demandons jamais de connecter ni de signer quoi que ce soit.',
  ssCheckBtn: 'C’est envoyé — vérifier',
  ssCheckingBtn: 'Vérification…',
  ssProven: '✓ Vérifiée — vous contrôlez cette adresse.',
  ssNotYet: 'Aucune transaction sortante pour l’instant. Envoyez-en une depuis cette adresse, puis revérifiez.',
  ssClaimedElsewhere: 'Cette adresse est déjà vérifiée par un autre compte.',
  ssUnsupported: 'La preuve par auto-envoi n’est pas encore disponible pour cette chaîne.',
  ssUnavailable: 'Impossible d’accéder à la chaîne — réessayez dans un instant.',
  qrBadgeBtn: '📱 Badge QR',
  paymentQrBtn: '📥 Télécharger le QR',
  paymentQrHint: 'Un QR imprimable de cette destination de réception — mettez-le sur votre comptoir, facture ou page de paiement. Les clients le scannent pour payer, et peuvent le vérifier auprès d’Almstins avant d’envoyer. (Prouvez la destination pour que la vérification affiche « vérifié ».)',
  qrBadgeHint: 'Les clients le scannent pour confirmer que cette adresse est bien la vôtre. Imprimez-le ou ajoutez-le à votre panneau, facture ou page de paiement.',
  qrBadgeDownload: 'Télécharger le PNG',
  provenBy: 'Publié par {domain}',
  monitorBtn: '👁 Surveiller la page',
  monitorSoonBtn: '👁 Surveillance en direct — bientôt',
  monitorSoonTitle: 'La surveillance continue des substitutions avec alertes est une fonction payante, bientôt disponible. Les vérifications à la demande restent gratuites.',
  monitorOnBtn: '👁 Surveillance active',
  monitorHint: 'Collez la page web publique où vous publiez ceci — une page « payez ici », une page de dons, une facture ou une page de paiement. Nous la revérifions régulièrement et vous envoyons un e-mail si l’adresse ou le lien qui y figure change par rapport à ce que vous avez enregistré (une substitution). Fonctionne mieux sur une page web classique ; les valeurs générées par JavaScript peuvent ne pas être lisibles.',
  monitorPlaceholder: 'https://votreboutique.com/payer',
  monitorSaveBtn: 'Surveiller cette page',
  monitorSavingBtn: 'Enregistrement…',
  monitorStopBtn: 'Arrêter la surveillance',
  monitorError: 'Enregistrement impossible. Utilisez l’adresse https:// complète de la page.',
  monitorDemoNote: 'Dans l’app réelle, vous pouvez rattacher la page publique où vous publiez cette destination. Nous la revérifions et vous envoyons un e-mail si l’adresse ou le lien qui y figure est substitué. Inscrivez-vous gratuitement pour l’utiliser.',
  monitorStatusPresent: '✓ Dernière vérification : votre destination est toujours celle affichée sur cette page.',
  monitorStatusSwapped: '⛔ Dernière vérification : la page affiche une destination DIFFÉRENTE — substitution possible. Nous avons envoyé un e-mail à votre adresse d’alerte.',
  monitorStatusMissing: 'Dernière vérification : nous n’avons pas trouvé votre destination sur cette page (elle a peut-être changé ou est générée par JavaScript). Aucune alerte envoyée.',
  monitorStatusUnreachable: 'Dernière vérification : nous n’avons pas pu joindre cette page. Nous réessaierons ; aucune alerte envoyée.',
  entHeading: 'Exchanges et grandes plateformes',
  entIntro: 'Vous publiez de nombreuses adresses de réception ? Vérifiez-les toutes depuis votre propre domaine. Prouvez le domaine, puis connectez un endpoint en lecture seule et nous gardons votre liste synchronisée.',
  entEmpty: 'Aucun domaine pour l’instant.',
  entDomainPlaceholder: 'votredomaine.com',
  entAddBtn: 'Ajouter un domaine',
  entAddingBtn: 'Ajout…',
  entConnectPrompt: 'Domaine vérifié. Connectez un endpoint en lecture seule sur ce domaine et la clé API qu’il accepte — nous l’envoyons comme jeton Bearer et lisons uniquement votre liste d’adresses.',
  entEndpointPlaceholder: 'https://votredomaine.com/adresses',
  entKeyPlaceholder: 'Clé API',
  entConnectBtn: 'Connecter et synchroniser',
  entConnectingBtn: 'Connexion…',
  entSynced: '{n} adresses synchronisées',
  entPulled: '✓ Connecté — {n} adresses synchronisées.',
  entInvalidEndpoint: '⚠ L’endpoint doit être en HTTPS sur votre domaine vérifié (ou un sous-domaine).',
  entNotProven: '⚠ Prouvez d’abord votre domaine.',
  entEncUnavailable: '⚠ Le serveur ne peut pas stocker de clés pour le moment. Contactez le support.',
  entUnauthorized: '⚠ Votre endpoint a rejeté la clé (401/403). Vérifiez la clé.',
  entUnreachable: '⚠ Impossible de joindre votre endpoint. Vérifiez l’URL et qu’il est actif.',
  entMalformed: '⚠ La réponse de votre endpoint n’était pas au format attendu.',
  entError: "Une erreur s’est produite. Réessayez.",
  apiKeysHeading: "Clés d’API",
  apiKeysIntro: "Utilisez une clé d’API pour appeler les trois endpoints publics depuis des scripts ou des agents — 60 req/min contre 10/min sans authentification. Les clés sont liées à votre compte et n’expirent pas jusqu’à révocation.",
  apiKeysEmpty: "Aucune clé pour l’instant. Générez-en une pour commencer.",
  apiKeysLabelPlaceholder: "Libellé de la clé (ex. mon-script)",
  apiKeysGenerateBtn: "Générer une clé",
  apiKeysGeneratingBtn: "Génération…",
  apiKeysRevokeBtn: "Révoquer",
  apiKeysRevokingBtn: "Révocation…",
  apiKeysConfirmRevoke: "Révoquer cette clé ? Tout code l’utilisant cessera de fonctionner immédiatement.",
  apiKeysCopyBtn: "Copier",
  apiKeysCopied: "Copié !",
  apiKeysCreatedAt: "Créée {date}",
  apiKeysLastUsed: "Dernière utilisation {date}",
  apiKeysNeverUsed: "Jamais utilisée",
  apiKeysNewKey: "Votre nouvelle clé d’API",
  apiKeysNewHint: "Copiez-la maintenant — elle ne sera plus affichée.",
  apiKeysDocsLink: "Documentation de l’API →",
  apiKeysError: "Une erreur s’est produite. Réessayez.",
  apiKeysMaxReached: "Maximum {n} clés par compte.",
  demoBanner: "Ceci est un compte marchand de démonstration — les destinations ci-dessous sont des exemples. Essayez « Vérifier un panneau » pour en vérifier une, puis voyez comment enregistrer les vôtres.",
  demoSignupCta: 'Inscrivez-vous gratuitement →',
  demoProveNote: 'Dans l’app réelle, vous prouvez cette adresse en envoyant le petit montant que nous indiquons, depuis ce même portefeuille — nous observons simplement la chaîne, donc nous ne vous demandons jamais de connecter ni de signer quoi que ce soit. Une fois reçu, l’adresse est Vérifiée et verrouillée à votre compte. Inscrivez-vous gratuitement pour prouver la vôtre.',
  howToHeading: 'Comment enregistrer les vôtres',
  howToWalletTitle: 'Ajouter une adresse de portefeuille',
  howToWalletSteps: [
    'Choisissez la chaîne — Bitcoin, Ethereum, Polygon, Avalanche, Solana ou Litecoin.',
    'Collez l’adresse de réception que vos clients paient réellement — la même que sur votre panneau, facture ou page de paiement — donnez-lui un libellé, puis Enregistrez-la.',
    'Prouvez que vous la contrôlez : envoyez le petit montant que nous indiquons, depuis ce portefeuille. Nous observons la chaîne publique — nous ne vous demandons jamais de connecter un portefeuille ni de signer quoi que ce soit.',
    'Dès que nous le voyons, l’adresse passe à Vérifiée et est verrouillée à votre compte — revendiquée une seule fois, donc personne d’autre ne peut la lister comme sienne.',
    'Pas les clés de cette adresse (une adresse de dépôt en garde ou d’un exchange) ? Elle figure quand même sous votre compte comme Autodéclarée — un niveau clairement inférieur à Vérifiée.',
  ],
  howToStripeTitle: 'Ajouter un lien de paiement Stripe',
  howToStripeSteps: [
    'Dans Stripe, créez un Payment Link (Catalogue de produits → Payment links) et copiez son URL — elle ressemble à https://buy.stripe.com/…',
    'Ici, sous QR de paiement, collez cette URL et Enregistrez-la. Enregistrer un lien en étant connecté à votre propre compte est la preuve qu’il est à vous — il devient donc Vérifié dès que vous l’enregistrez, et verrouillé à votre compte (revendiqué une seule fois, personne d’autre ne peut le lister).',
    'Vous ne vous connectez jamais à Stripe via nous et nous ne demandons jamais de clés. Nous ne voyons jamais votre solde, vos versements, vos clients ni vos canaux de paiement — il n’y a rien de connecté à exposer.',
    'Désormais, un client qui scanne ce QR voit ✓ Vérifiée avec votre libellé. Si un fraudeur remplace votre autocollant par un autre lien, son scan affiche ⚠ Destination non vérifiée — il s’arrête donc avant de payer.',
  ],
  howToExchangeTitle: 'Vous publiez de nombreuses adresses ? (exchanges et plateformes)',
  howToExchangeSteps: [
    'Publiez votre liste officielle d’adresses sur votre propre domaine et prouvez le domaine une fois en y hébergeant un seul fichier Almstins.',
    'Connectez un point de terminaison d’API en lecture seule qui renvoie la liste, plus une clé — nous la lisons seulement et ne déplaçons jamais de fonds.',
    'Nous gardons la liste synchronisée, pour que tout client vérifie une adresse officielle par rapport à votre domaine avant d’envoyer.',
  ],
  howToCustomerTitle: 'Ce que voient vos clients',
  howToCustomerSteps: [
    'Votre client scanne le QR ou l’adresse sur votre panneau, facture ou page de paiement.',
    'Si cela correspond à une destination que vous avez prouvée, il voit ✓ Vérifiée avec votre libellé — la confiance que c’est bien vous, avant d’envoyer un centime.',
    'Si votre QR a été remplacé par une autre adresse, il affiche ⚠ Destination non vérifiée — il s’arrête donc avant de payer un fraudeur.',
    'Chaque scan lance aussi un contrôle de sécurité gratuit — listes d’arnaques, sanctions et honeypots pour une adresse ; listes de phishing et de sites frauduleux pour un lien de paiement — signalant une destination dangereuse même si elle n’est pas la vôtre.',
  ],
};

const MAP: Record<Lang, VerifyDashboardLocale> = { en, es, fr };

export function getVerifyDashboard(lang: Lang): VerifyDashboardLocale {
  return MAP[lang] ?? MAP.en;
}
