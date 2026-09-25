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
  // Three-tier destination labels: Registered (asserted, no proof) → Claimed (control
  // proven, no domain) → Verified (control + published on a proven domain).
  statusRegistered: string;
  statusClaimed: string;
  // "Prove ownership" panel
  proveBtn: string;
  proveHint: string;
  proveDomainPlaceholder: string;
  proveGetFileBtn: string;
  proveStep1: string; // "… ({url}) …"
  proveCopyBtn: string;
  proveVerifyBtn: string;
  proveRosterLink: string;
  proveVerifyingBtn: string;
  proveError: string;
  // Level 1 → Level 2: add a domain to an address already proven by self-send (Claimed →
  // Verified). Only the published file can do it, so the panel opens on the domain method.
  anchorBtn: string;
  anchorHint: string;
  proofAnchored: string;
  proofOtherDomain: string;
  // The wallet's claim was made under the old self-send check (any outgoing transaction
  // counted), so no domain can verify it until the satoshi test proves it again. The owner
  // takes the test again on the same row ("Prove again"); it stays Claimed meanwhile. Copy
  // never tells them to remove the wallet: that would release the claim.
  proofReproveRequired: string;
  reproveBtn: string;
  reproveHint: string;
  // Self-send proof of control: the satoshi test (rule bound_v1). The merchant sends an
  // exact amount FROM their address TO the same address. Copy never shows an address to
  // send to: only the first 6 / last 4 of their own, to check against their wallet.
  proveMethodSelfSend: string;
  proveMethodDomain: string;
  ssIntro: string;
  ssReadyBtn: string;
  ssIssuingBtn: string;
  ssHeading: string;
  ssAddressStep: string; // "… {first} … {last} …"
  ssAmountLabel: string;
  ssCopyAmountBtn: string;
  ssBaseUnits: string; // "… {n} {unit} …"
  ssCommaNote: string;
  ssFeeNote: string; // "… {coin} …"
  ssNeverNote: string;
  ssEvmNote: string; // "… {chain} …"
  ssValidUntil: string; // "… {time} …"
  ssSentBtn: string;
  ssCheckingBtn: string;
  ssCheckAgainBtn: string;
  ssWaiting: string; // "… {chain} … {time} …"
  ssDontResend: string;
  ssStopped: string; // "… {time} …"
  ssNewAmountBtn: string;
  ssOffline: string;
  ssLate: string; // "… {time} …" (checking continues until then)
  ssRateLimited: string; // "… {time} …" (a new amount can be drawn then)
  ssIssueUnavailable: string; // "… {chain} …"
  ssBusy: string;
  // Outcomes of a check (deposit-verify codes).
  ssProven: string;
  ssNotYet: string; // "… {chain} … {last} …"
  ssExpired: string;
  ssWrongAmount: string; // "… {amount} {unit} …"
  ssWrongRecipient: string;
  ssSentToNotFrom: string;
  ssClaimedElsewhere: string;
  ssUnsupported: string;
  ssUnavailable: string; // "… {chain} …"
  // Shareable verified-address QR badge.
  qrBadgeBtn: string;
  paymentQrBtn: string;
  paymentQrHint: string;
  qrBadgeHint: string;
  qrBadgeDownload: string;
  provenBy: string; // "… ({domain})"
  // F12: the badge follows the same 24h freshness rule as the public answer.
  lastConfirmed: string; // "Last confirmed {time}"
  confirmationLapsed: string; // shown instead of lastConfirmed once it drops to Claimed
  timeAgoJustNow: string;
  timeAgoMinutes: string; // "{n}m ago"
  timeAgoHours: string; // "{n}h ago"
  timeAgoDays: string; // "{n}d ago"
  // SD1: where a lapse/swap alert goes.
  alertsGoTo: string; // "Alerts go to {email}"
  alertsChange: string;
  alertsSave: string;
  alertsCancel: string;
  alertsUseSignIn: string;
  alertsSaved: string;
  alertsPlaceholder: string;
  alertsInvalid: string;
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
  // Platform lists are by approval during early access (verifyEntityAccess.ts).
  entApprovalNotice: string; // "… {email} …", rendered as a mailto link
  entNotApproved: string;
  entNotPublished: string; // badge on a list whose account is not approved
  // Demo mode (seeded sample vendor account) — banner + how-to guide.
  demoBanner: string;
  demoSignupCta: string;
  /** Demo-mode banner on /dashboard/verify (plain text), in place of the tracker copy. */
  demoBannerText: string;
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
  notice: "Almstins Verify is in beta — and free. You're welcome to register up to 3 destinations, and one of them can be a payment QR code instead of a wallet address (so: 2 wallets + 1 QR). Once a destination is proven, anyone can check it, and its label can be shown publicly, so don't use a personal name as a label. Paid plans coming soon.",
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
  statusRegistered: 'Registered',
  statusClaimed: 'Claimed',
  proveBtn: 'Prove',
  proveHint: 'Prove you control the domain — that attaches your verified business name. Two ways: publish a small file on your site (best if you also want the domain to vouch for your addresses), or add a DNS TXT record (easiest on Shopify/Wix/Squarespace). Do either.',
  proveDomainPlaceholder: 'yourdomain.com',
  proveGetFileBtn: 'Get file',
  proveStep1: 'Publish this exact file at {url}, then verify:',
  proveCopyBtn: 'Copy',
  proveVerifyBtn: 'Verify now',
  proveRosterLink: 'Several addresses? Publish an encrypted roster instead →',
  proveVerifyingBtn: 'Verifying…',
  proveError: 'Something went wrong. Try again.',
  anchorBtn: 'Verify domain',
  anchorHint: 'Your self-send proved you control this wallet, so it shows as Claimed. To show it as Verified, list it in your domain’s verification file: enter your domain, publish the file we give you, then verify. If the file stops listing it later, it goes back to Claimed.',
  proofAnchored: '✓ Verified. Your domain’s file lists this address, so scans now show it with your domain.',
  proofOtherDomain: '⚠ This address is already verified through a different domain. To move it, remove it from that domain’s file first, then verify here again after our next check.',
  proofReproveRequired: '⚠ This wallet was claimed with our earlier self-send check, which didn’t ask for an exact amount, so no domain can verify it yet. Take the satoshi test on it once, with “Prove again” on its row. It stays Claimed while you do. Your domain file stays valid, so verify the domain again after that.',
  reproveBtn: 'Prove again',
  reproveHint: 'This wallet was claimed with our earlier self-send check, which didn’t ask for an exact amount. Before a domain can verify it, take the satoshi test on it once. It stays Claimed while you do.',
  proveMethodSelfSend: 'Satoshi test (self-send)',
  proveMethodDomain: 'Domain',
  ssIntro: 'Claim this address with the satoshi test (a self-send). From your own wallet app, you send a tiny, exact amount from this address back to itself. The coins stay in your wallet, and you pay only the normal network fee. When you tap below, we give you the exact amount. It is valid for 24 hours.',
  ssReadyBtn: 'I’m ready to send',
  ssIssuingBtn: 'Getting your amount…',
  ssHeading: 'Take the satoshi test (a self-send)',
  ssAddressStep: 'In your wallet app, tap Send and paste your own address. Copy it from your wallet’s Receive screen, not from this page. It starts with {first} and ends with {last}.',
  ssAmountLabel: 'Amount:',
  ssCopyAmountBtn: 'Copy amount',
  ssBaseUnits: 'That is {n} {unit}.',
  ssCommaNote: 'The amount copies with a dot. If your wallet uses a comma for decimals, type it with a comma.',
  ssFeeNote: 'The coins come straight back to you. You pay only the normal network fee, in {coin}. Send it in {coin}, not USDT or another token.',
  ssNeverNote: 'Almstins never asks you to connect a wallet or sign anything for us, and we will never give you an address to send to.',
  ssEvmNote: 'Send it on {chain}. Turn off gasless or sponsored-fee mode for this send.',
  ssValidUntil: 'This amount is valid until {time}.',
  ssSentBtn: 'I’ve sent it',
  ssCheckingBtn: 'Checking…',
  ssCheckAgainBtn: 'Check again',
  ssWaiting: 'Checking {chain} for your test. Last checked {time}.',
  ssDontResend: 'Don’t send it again, even if your wallet still shows pending.',
  ssStopped: 'We stopped checking automatically. If you sent it, tap Check again. Your amount is valid until {time}.',
  ssNewAmountBtn: 'Get a new amount',
  ssOffline: 'You seem to be offline. We’ll check again when you’re back.',
  ssLate: 'The 24 hours for this amount are up. If you already sent it, we’ll keep checking until {time}, so don’t send it again. If you haven’t sent it, get a new amount.',
  ssRateLimited: 'You’ve asked for several new amounts for this address today. You can get another after {time}.',
  ssIssueUnavailable: 'We couldn’t reach {chain} just now, so we haven’t given you an amount yet. Try again in a moment.',
  ssBusy: 'We couldn’t give you an amount just now. Try again later.',
  ssProven: '✓ Claimed. You proved you control this address.',
  ssNotYet: 'Nothing from this address yet. If you just sent it, give it a few minutes. Check that your wallet is on {chain} and that the account shown ends in {last}.',
  ssExpired: 'Your test amount expired before we saw it. If you already sent it, the coins are still in your wallet; only the fee was spent.',
  ssWrongAmount: 'We found a transaction from this address, but it wasn’t the exact test. Send exactly {amount} {unit} to the same address, in {unit}, not USDT or another token.',
  ssWrongRecipient: 'We saw the exact amount leave this address, but it went to a different address. The test only counts when you send to this same address.',
  ssSentToNotFrom: 'The test amount arrived at this address, but your wallet paid it from other coins or another address. Use coin control to spend from this exact address, or send from the wallet that holds it.',
  ssClaimedElsewhere: 'Another account already claimed this address. If it’s yours, don’t send again. Contact us and we’ll review it.',
  ssUnsupported: 'The satoshi test isn’t available for this network yet.',
  ssUnavailable: 'We couldn’t reach {chain} just now. Your test is still valid, so don’t send again. Check again in a moment.',
  qrBadgeBtn: '📱 QR badge',
  paymentQrBtn: '📥 Download QR',
  paymentQrHint: 'A printable QR of this receiving destination — put it on your counter, invoice, or checkout. Customers scan it to pay, and can check it against Almstins before they send. (Prove the destination so the check shows “verified.”)',
  qrBadgeHint: 'Customers scan this to confirm this address is really yours. Print it or add it to your sign, invoice, or checkout.',
  qrBadgeDownload: 'Download PNG',
  provenBy: 'Published by {domain}',
  lastConfirmed: 'Last confirmed {time}',
  confirmationLapsed: 'Confirmation lapsed — waiting on the next check',
  timeAgoJustNow: 'just now',
  timeAgoMinutes: '{n}m ago',
  timeAgoHours: '{n}h ago',
  timeAgoDays: '{n}d ago',
  alertsGoTo: 'Alerts go to {email}',
  alertsChange: 'Change',
  alertsSave: 'Save',
  alertsCancel: 'Cancel',
  alertsUseSignIn: 'Use my sign-in email instead',
  alertsSaved: 'Saved.',
  alertsPlaceholder: 'you@example.com',
  alertsInvalid: 'Enter a valid email address.',
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
  entApprovalNotice: 'Platform lists are by approval during early access. To request access, contact {email}.',
  entNotApproved: '⚠ Platform lists are by approval during early access. Contact support@almstins.com to request access.',
  entNotPublished: 'Not published (approval required)',
  demoBanner: 'This is a demo vendor account — the destinations below are samples. Try “Verify a sign” to check one, then see how to register your own.',
  demoSignupCta: 'Sign up free →',
  demoBannerText: "You're in the vendor demo. Sign in to register and prove your own addresses.",
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
    'Here, under Payment QR, paste that URL and Register it. Registering a link while signed in to your own account is the proof it’s yours — so it’s locked to your account the moment you save it (claimed once, no one else can list it), and customers see it as Verified once your domain is proven.',
    'You never log in to Stripe through us, and we never ask for keys. We never see your balance, payouts, customers, or payment rails — there is nothing connected to expose.',
    'Now a customer who scans that QR sees that it’s registered to your account: ✓ Verified with your verified domain once your domain is proven, or Registered with Almstins, with no name, until then. The label you type isn’t shown on the scan card. If a scammer swaps your sticker for a different link, their scan shows ⚠ Not a verified destination, a warning to hold off before paying.',
  ],
  howToExchangeTitle: 'Publishing many addresses? (exchanges & platforms)',
  howToExchangeSteps: [
    'During early access, platform lists are by approval. Email support@almstins.com to request access.',
    'Publish your official address list on your own domain, and prove the domain once by hosting a single Almstins file on it.',
    'Connect a read-only API endpoint that returns the list, plus a key — we only ever read it, and never move funds.',
    'We keep the list in sync, so any customer can verify an official address against your domain before they send.',
  ],
  howToCustomerTitle: 'What your customers see',
  howToCustomerSteps: [
    'Your customer scans the QR or address on your sign, invoice, or checkout.',
    'If it matches a destination you’ve proven, they see ✓ Verified with your verified domain (and your business name, when it matches that domain): a payment link once your domain is proven, an address once your domain’s verification file lists it. Until then they see Claimed, with no name. The label you type isn’t shown on the scan card.',
    'If your QR was swapped for someone else’s address, it shows ⚠ Not a verified destination, a warning to hold off before paying a scammer.',
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
  notice: 'Almstins Verify está en beta — y es gratis. Puedes registrar hasta 3 destinos, y uno de ellos puede ser un código QR de pago en lugar de una dirección de billetera (es decir: 2 billeteras + 1 QR). Cuando un destino queda demostrado, cualquiera puede consultarlo y su etiqueta puede mostrarse públicamente, así que no uses un nombre personal como etiqueta. Precios próximamente.',
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
  statusRegistered: 'Registrado',
  statusClaimed: 'Control confirmado',
  proveBtn: 'Probar',
  proveHint: 'Demuestra que controlas el dominio — eso adjunta tu nombre de negocio verificado. Dos formas: publica un archivo pequeño en tu sitio (mejor si además quieres que el dominio respalde tus direcciones), o añade un registro DNS TXT (lo más fácil en Shopify/Wix/Squarespace). Haz cualquiera de las dos.',
  proveDomainPlaceholder: 'tudominio.com',
  proveGetFileBtn: 'Obtener archivo',
  proveStep1: 'Publica este archivo exacto en {url} y luego verifica:',
  proveCopyBtn: 'Copiar',
  proveVerifyBtn: 'Verificar ahora',
  proveRosterLink: '¿Varias direcciones? Publica una lista cifrada en su lugar →',
  proveVerifyingBtn: 'Verificando…',
  proveError: 'Algo salió mal. Inténtalo de nuevo.',
  anchorBtn: 'Verificar dominio',
  anchorHint: 'Tu autoenvío demostró que controlas esta billetera, así que aparece como «Control confirmado». Para que aparezca como «Verificado», inclúyela en el archivo de verificación de tu dominio: escribe tu dominio, publica el archivo que te damos y luego verifica. Si el archivo deja de incluirla, vuelve a «Control confirmado».',
  proofAnchored: '✓ Verificada. El archivo de tu dominio incluye esta dirección, así que los escaneos ahora la muestran con tu dominio.',
  proofOtherDomain: '⚠ Esta dirección ya está verificada con otro dominio. Para moverla, quítala primero del archivo de ese dominio y vuelve a verificar aquí después de nuestra próxima comprobación.',
  proofReproveRequired: '⚠ Esta billetera se reclamó con nuestra comprobación de autoenvío anterior, que no pedía una cantidad exacta, así que ningún dominio puede verificarla todavía. Haz una vez la prueba del satoshi con ella, con «Volver a demostrar» en su fila. Mientras tanto sigue en «Control confirmado». El archivo de tu dominio sigue siendo válido, así que después vuelve a verificar el dominio.',
  reproveBtn: 'Volver a demostrar',
  reproveHint: 'Esta billetera se reclamó con nuestra comprobación de autoenvío anterior, que no pedía una cantidad exacta. Antes de que un dominio pueda verificarla, haz una vez la prueba del satoshi con ella. Mientras tanto sigue en «Control confirmado».',
  proveMethodSelfSend: 'Prueba del satoshi (autoenvío)',
  proveMethodDomain: 'Dominio',
  ssIntro: 'Reclama esta dirección con la prueba del satoshi (un autoenvío). Desde tu propia app de billetera, envías una cantidad pequeña y exacta desde esta dirección a sí misma. Las monedas se quedan en tu billetera y solo pagas la comisión normal de la red. Cuando toques abajo, te daremos la cantidad exacta. Es válida por 24 horas.',
  ssReadyBtn: 'Estoy listo para enviar',
  ssIssuingBtn: 'Obteniendo tu cantidad…',
  ssHeading: 'Haz la prueba del satoshi (un autoenvío)',
  ssAddressStep: 'En tu app de billetera, toca Enviar y pega tu propia dirección. Cópiala desde la pantalla Recibir de tu billetera, no desde esta página. Empieza con {first} y termina con {last}.',
  ssAmountLabel: 'Cantidad:',
  ssCopyAmountBtn: 'Copiar cantidad',
  ssBaseUnits: 'Son {n} {unit}.',
  ssCommaNote: 'La cantidad se copia con punto. Si tu billetera usa coma para los decimales, escríbela con coma.',
  ssFeeNote: 'Las monedas vuelven directamente a ti. Solo pagas la comisión normal de la red, en {coin}. Envíala en {coin}, no en USDT ni en otro token.',
  ssNeverNote: 'Almstins nunca te pide conectar una billetera ni firmar nada para nosotros, y nunca te daremos una dirección a la que enviar.',
  ssEvmNote: 'Envíala en {chain}. Desactiva el modo sin gas o de comisión patrocinada para este envío.',
  ssValidUntil: 'Esta cantidad es válida hasta {time}.',
  ssSentBtn: 'Ya lo envié',
  ssCheckingBtn: 'Comprobando…',
  ssCheckAgainBtn: 'Comprobar de nuevo',
  ssWaiting: 'Buscando tu prueba en {chain}. Última comprobación: {time}.',
  ssDontResend: 'No lo envíes otra vez, aunque tu billetera todavía lo muestre como pendiente.',
  ssStopped: 'Dejamos de comprobar automáticamente. Si ya lo enviaste, toca Comprobar de nuevo. Tu cantidad es válida hasta {time}.',
  ssNewAmountBtn: 'Obtener una cantidad nueva',
  ssOffline: 'Parece que no tienes conexión. Volveremos a comprobar cuando vuelvas.',
  ssLate: 'Se acabaron las 24 horas de esta cantidad. Si ya la enviaste, seguiremos comprobando hasta {time}, así que no la envíes otra vez. Si no la has enviado, obtén una cantidad nueva.',
  ssRateLimited: 'Hoy ya pediste varias cantidades nuevas para esta dirección. Podrás obtener otra después de {time}.',
  ssIssueUnavailable: 'No pudimos acceder a {chain} en este momento, así que todavía no te dimos una cantidad. Inténtalo de nuevo en un momento.',
  ssBusy: 'No pudimos darte una cantidad en este momento. Inténtalo más tarde.',
  ssProven: '✓ Control confirmado. Demostraste que controlas esta dirección.',
  ssNotYet: 'Todavía no hay nada desde esta dirección. Si acabas de enviarlo, espera unos minutos. Comprueba que tu billetera esté en {chain} y que la cuenta que muestra termine en {last}.',
  ssExpired: 'Tu cantidad de prueba venció antes de que la viéramos. Si ya la enviaste, las monedas siguen en tu billetera; solo se gastó la comisión.',
  ssWrongAmount: 'Encontramos una transacción desde esta dirección, pero no era la prueba exacta. Envía exactamente {amount} {unit} a la misma dirección, en {unit}, no en USDT ni en otro token.',
  ssWrongRecipient: 'Vimos salir la cantidad exacta de esta dirección, pero fue a otra dirección. La prueba solo cuenta cuando envías a esta misma dirección.',
  ssSentToNotFrom: 'La cantidad de prueba llegó a esta dirección, pero tu billetera la pagó con otras monedas o desde otra dirección. Usa el control de monedas para gastar desde esta dirección exacta, o envía desde la billetera que la tiene.',
  ssClaimedElsewhere: 'Otra cuenta ya reclamó esta dirección. Si es tuya, no vuelvas a enviar. Contáctanos y la revisaremos.',
  ssUnsupported: 'La prueba del satoshi aún no está disponible para esta red.',
  ssUnavailable: 'No pudimos acceder a {chain} en este momento. Tu prueba sigue siendo válida, así que no vuelvas a enviar. Comprueba de nuevo en un momento.',
  qrBadgeBtn: '📱 Código QR',
  paymentQrBtn: '📥 Descargar QR',
  paymentQrHint: 'Un QR imprimible de este destino de cobro — ponlo en tu mostrador, factura o pantalla de pago. Los clientes lo escanean para pagar, y pueden comprobarlo contra Almstins antes de enviar. (Demuestra el destino para que la comprobación muestre «verificado».)',
  qrBadgeHint: 'Los clientes lo escanean para confirmar que esta dirección es realmente tuya. Imprímelo o añádelo a tu letrero, factura o pantalla de pago.',
  qrBadgeDownload: 'Descargar PNG',
  provenBy: 'Publicado por {domain}',
  lastConfirmed: 'Última confirmación: {time}',
  confirmationLapsed: 'La confirmación caducó — esperando la próxima comprobación',
  timeAgoJustNow: 'justo ahora',
  timeAgoMinutes: 'hace {n} min',
  timeAgoHours: 'hace {n} h',
  timeAgoDays: 'hace {n} d',
  alertsGoTo: 'Las alertas se envían a {email}',
  alertsChange: 'Cambiar',
  alertsSave: 'Guardar',
  alertsCancel: 'Cancelar',
  alertsUseSignIn: 'Usar mi correo de acceso',
  alertsSaved: 'Guardado.',
  alertsPlaceholder: 'tu@ejemplo.com',
  alertsInvalid: 'Introduce una dirección de correo válida.',
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
  entApprovalNotice: 'Las listas de plataformas requieren aprobación durante el acceso anticipado. Para solicitar acceso, escribe a {email}.',
  entNotApproved: '⚠ Las listas de plataformas requieren aprobación durante el acceso anticipado. Escribe a support@almstins.com para solicitar acceso.',
  entNotPublished: 'No publicada (requiere aprobación)',
  demoBanner: 'Esta es una cuenta de comercio de demostración — los destinos de abajo son ejemplos. Prueba “Verifica un letrero” para comprobar uno y luego mira cómo registrar los tuyos.',
  demoSignupCta: 'Regístrate gratis →',
  demoBannerText: 'Estás en la demo para comercios. Inicia sesión para registrar y demostrar tus propias direcciones.',
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
    'Aquí, en QR de pago, pega esa URL y Regístrala. Registrar un enlace con tu sesión iniciada en tu propia cuenta es la prueba de que es tuyo — así que queda vinculado a tu cuenta en el momento en que lo guardas (reclamado una sola vez, nadie más puede listarlo), y tus clientes lo ven como Verificado cuando tu dominio quede demostrado.',
    'Nunca inicias sesión en Stripe a través de nosotros y nunca te pedimos claves. Nunca vemos tu saldo, tus pagos, tus clientes ni tus medios de cobro — no hay nada conectado que exponer.',
    'Ahora, un cliente que escanea ese QR ve que está registrado en tu cuenta: ✓ Verificado con tu dominio verificado cuando tu dominio quede demostrado, o Registrado en Almstins, sin nombre, hasta entonces. La etiqueta que escribes no se muestra en la tarjeta del escaneo. Si un estafador sustituye tu calcomanía por otro enlace, su escaneo muestra ⚠ Destino no verificado, una advertencia para esperar antes de pagar.',
  ],
  howToExchangeTitle: '¿Publicas muchas direcciones? (exchanges y plataformas)',
  howToExchangeSteps: [
    'Durante el acceso anticipado, las listas de plataformas requieren aprobación. Escribe a support@almstins.com para solicitar acceso.',
    'Publica tu lista oficial de direcciones en tu propio dominio y demuestra el dominio una vez alojando en él un único archivo de Almstins.',
    'Conecta un endpoint de API de solo lectura que devuelva la lista, más una clave — solo la leemos y nunca movemos fondos.',
    'Mantenemos la lista sincronizada, para que cualquier cliente verifique una dirección oficial contra tu dominio antes de enviar.',
  ],
  howToCustomerTitle: 'Lo que ven tus clientes',
  howToCustomerSteps: [
    'Tu cliente escanea el QR o la dirección de tu letrero, factura o checkout.',
    'Si coincide con un destino que demostraste, ve ✓ Verificada con tu dominio verificado (y el nombre de tu negocio, cuando coincide con ese dominio): un enlace de pago cuando tu dominio quede demostrado, y una dirección cuando el archivo de verificación de tu dominio la incluya. Hasta entonces ve Reclamada, sin nombre. La etiqueta que escribes no se muestra en la tarjeta del escaneo.',
    'Si sustituyeron tu QR por otra dirección, muestra ⚠ Destino no verificado, una advertencia para esperar antes de pagarle a un estafador.',
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
  notice: 'Almstins Verify est en bêta — et gratuit. Vous pouvez enregistrer jusqu’à 3 destinations, et l’une d’elles peut être un QR code de paiement au lieu d’une adresse de portefeuille (soit : 2 portefeuilles + 1 QR). Une fois une destination prouvée, n’importe qui peut la vérifier et son libellé peut être affiché publiquement : n’utilisez donc pas un nom personnel comme libellé. Tarifs bientôt disponibles.',
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
  statusRegistered: 'Enregistré',
  statusClaimed: 'Contrôle confirmé',
  proveBtn: 'Prouver',
  proveHint: 'Prouvez que vous contrôlez le domaine — cela rattache votre nom d’entreprise vérifié. Deux façons : publiez un petit fichier sur votre site (mieux si vous voulez aussi que le domaine atteste vos adresses), ou ajoutez un enregistrement DNS TXT (le plus simple sur Shopify/Wix/Squarespace). Au choix.',
  proveDomainPlaceholder: 'votredomaine.com',
  proveGetFileBtn: 'Obtenir le fichier',
  proveStep1: 'Publiez ce fichier exact à {url}, puis vérifiez :',
  proveCopyBtn: 'Copier',
  proveVerifyBtn: 'Vérifier maintenant',
  proveRosterLink: 'Plusieurs adresses ? Publiez une liste chiffrée à la place →',
  proveVerifyingBtn: 'Vérification…',
  proveError: 'Une erreur s’est produite. Réessayez.',
  anchorBtn: 'Vérifier le domaine',
  anchorHint: 'Votre auto-envoi a prouvé que vous contrôlez ce portefeuille, il apparaît donc comme « Contrôle confirmé ». Pour qu’il apparaisse comme « Vérifié », listez-le dans le fichier de vérification de votre domaine : saisissez votre domaine, publiez le fichier que nous vous donnons, puis vérifiez. Si le fichier cesse de le lister, il repasse en « Contrôle confirmé ».',
  proofAnchored: '✓ Vérifié. Le fichier de votre domaine liste cette adresse, les scans l’affichent donc maintenant avec votre domaine.',
  proofOtherDomain: '⚠ Cette adresse est déjà vérifiée via un autre domaine. Pour la déplacer, retirez-la d’abord du fichier de ce domaine, puis revérifiez ici après notre prochain contrôle.',
  proofReproveRequired: '⚠ Ce portefeuille a été revendiqué avec notre ancienne vérification par auto-envoi, qui ne demandait pas de montant exact : aucun domaine ne peut donc encore le vérifier. Faites une fois le test du satoshi avec lui, avec « Prouver de nouveau » sur sa ligne. Il reste en « Contrôle confirmé » pendant ce temps. Le fichier de votre domaine reste valable : revérifiez ensuite le domaine.',
  reproveBtn: 'Prouver de nouveau',
  reproveHint: 'Ce portefeuille a été revendiqué avec notre ancienne vérification par auto-envoi, qui ne demandait pas de montant exact. Avant qu’un domaine puisse le vérifier, faites une fois le test du satoshi avec lui. Il reste en « Contrôle confirmé » pendant ce temps.',
  proveMethodSelfSend: 'Test du satoshi (auto-envoi)',
  proveMethodDomain: 'Domaine',
  ssIntro: 'Revendiquez cette adresse avec le test du satoshi (un auto-envoi). Depuis votre propre application de portefeuille, vous envoyez un petit montant exact de cette adresse vers elle-même. Les fonds restent dans votre portefeuille et vous ne payez que les frais de réseau habituels. Quand vous appuyez ci-dessous, nous vous donnons le montant exact. Il est valable 24 heures.',
  ssReadyBtn: 'Je suis prêt à envoyer',
  ssIssuingBtn: 'Obtention de votre montant…',
  ssHeading: 'Passez le test du satoshi (un auto-envoi)',
  ssAddressStep: 'Dans votre application de portefeuille, appuyez sur Envoyer et collez votre propre adresse. Copiez-la depuis l’écran Recevoir de votre portefeuille, pas depuis cette page. Elle commence par {first} et se termine par {last}.',
  ssAmountLabel: 'Montant :',
  ssCopyAmountBtn: 'Copier le montant',
  ssBaseUnits: 'Soit {n} {unit}.',
  ssCommaNote: 'Le montant est copié avec un point. Si votre portefeuille utilise une virgule pour les décimales, tapez-le avec une virgule.',
  ssFeeNote: 'Les fonds vous reviennent directement. Vous ne payez que les frais de réseau habituels, en {coin}. Envoyez-le en {coin}, pas en USDT ni dans un autre jeton.',
  ssNeverNote: 'Almstins ne vous demande jamais de connecter un portefeuille ni de signer quoi que ce soit pour nous, et nous ne vous donnerons jamais d’adresse vers laquelle envoyer.',
  ssEvmNote: 'Envoyez-le sur {chain}. Désactivez le mode sans gaz ou à frais sponsorisés pour cet envoi.',
  ssValidUntil: 'Ce montant est valable jusqu’au {time}.',
  ssSentBtn: 'C’est envoyé',
  ssCheckingBtn: 'Vérification…',
  ssCheckAgainBtn: 'Vérifier à nouveau',
  ssWaiting: 'Nous cherchons votre test sur {chain}. Dernière vérification : {time}.',
  ssDontResend: 'Ne l’envoyez pas une deuxième fois, même si votre portefeuille l’affiche encore en attente.',
  ssStopped: 'Nous avons arrêté de vérifier automatiquement. Si vous l’avez envoyé, appuyez sur Vérifier à nouveau. Votre montant est valable jusqu’au {time}.',
  ssNewAmountBtn: 'Obtenir un nouveau montant',
  ssOffline: 'Vous semblez hors ligne. Nous vérifierons à nouveau à votre retour.',
  ssLate: 'Les 24 heures de ce montant sont écoulées. Si vous l’avez déjà envoyé, nous continuerons à vérifier jusqu’au {time}, donc ne l’envoyez pas une deuxième fois. Si vous ne l’avez pas envoyé, obtenez un nouveau montant.',
  ssRateLimited: 'Vous avez déjà demandé plusieurs nouveaux montants pour cette adresse aujourd’hui. Vous pourrez en obtenir un autre après le {time}.',
  ssIssueUnavailable: 'Impossible d’accéder à {chain} pour le moment, donc nous ne vous avons pas encore donné de montant. Réessayez dans un instant.',
  ssBusy: 'Nous n’avons pas pu vous donner de montant pour le moment. Réessayez plus tard.',
  ssProven: '✓ Contrôle confirmé. Vous avez prouvé que vous contrôlez cette adresse.',
  ssNotYet: 'Rien depuis cette adresse pour l’instant. Si vous venez de l’envoyer, attendez quelques minutes. Vérifiez que votre portefeuille est sur {chain} et que le compte affiché se termine par {last}.',
  ssExpired: 'Votre montant de test a expiré avant que nous le voyions. Si vous l’avez déjà envoyé, les fonds sont toujours dans votre portefeuille ; seuls les frais ont été dépensés.',
  ssWrongAmount: 'Nous avons trouvé une transaction depuis cette adresse, mais ce n’était pas le test exact. Envoyez exactement {amount} {unit} vers la même adresse, en {unit}, pas en USDT ni dans un autre jeton.',
  ssWrongRecipient: 'Nous avons vu le montant exact quitter cette adresse, mais il est allé vers une autre adresse. Le test ne compte que si vous envoyez vers cette même adresse.',
  ssSentToNotFrom: 'Le montant du test est arrivé à cette adresse, mais votre portefeuille l’a payé avec d’autres fonds ou depuis une autre adresse. Utilisez le contrôle des pièces (coin control) pour dépenser depuis cette adresse exacte, ou envoyez depuis le portefeuille qui la détient.',
  ssClaimedElsewhere: 'Un autre compte a déjà revendiqué cette adresse. Si elle est à vous, n’envoyez rien de plus. Contactez-nous et nous l’examinerons.',
  ssUnsupported: 'Le test du satoshi n’est pas encore disponible pour ce réseau.',
  ssUnavailable: 'Impossible d’accéder à {chain} pour le moment. Votre test reste valable, donc ne renvoyez rien. Vérifiez à nouveau dans un instant.',
  qrBadgeBtn: '📱 Badge QR',
  paymentQrBtn: '📥 Télécharger le QR',
  paymentQrHint: 'Un QR imprimable de cette destination de réception — mettez-le sur votre comptoir, facture ou page de paiement. Les clients le scannent pour payer, et peuvent le vérifier auprès d’Almstins avant d’envoyer. (Prouvez la destination pour que la vérification affiche « vérifié ».)',
  qrBadgeHint: 'Les clients le scannent pour confirmer que cette adresse est bien la vôtre. Imprimez-le ou ajoutez-le à votre panneau, facture ou page de paiement.',
  qrBadgeDownload: 'Télécharger le PNG',
  provenBy: 'Publié par {domain}',
  lastConfirmed: 'Dernière confirmation : {time}',
  confirmationLapsed: 'Confirmation expirée — en attente de la prochaine vérification',
  timeAgoJustNow: 'à l’instant',
  timeAgoMinutes: 'il y a {n} min',
  timeAgoHours: 'il y a {n} h',
  timeAgoDays: 'il y a {n} j',
  alertsGoTo: 'Les alertes sont envoyées à {email}',
  alertsChange: 'Modifier',
  alertsSave: 'Enregistrer',
  alertsCancel: 'Annuler',
  alertsUseSignIn: 'Utiliser mon e-mail de connexion',
  alertsSaved: 'Enregistré.',
  alertsPlaceholder: 'vous@exemple.com',
  alertsInvalid: 'Saisissez une adresse e-mail valide.',
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
  entError: 'Une erreur s’est produite. Réessayez.',
  entApprovalNotice: 'Pendant l’accès anticipé, les listes de plateformes sont soumises à approbation. Pour demander l’accès, écrivez à {email}.',
  entNotApproved: '⚠ Pendant l’accès anticipé, les listes de plateformes sont soumises à approbation. Écrivez à support@almstins.com pour demander l’accès.',
  entNotPublished: 'Non publiée (approbation requise)',
  demoBanner: 'Ceci est un compte marchand de démonstration — les destinations ci-dessous sont des exemples. Essayez « Vérifier un panneau » pour en vérifier une, puis voyez comment enregistrer les vôtres.',
  demoSignupCta: 'Inscrivez-vous gratuitement →',
  demoBannerText: 'Vous êtes dans la démo commerçant. Connectez-vous pour enregistrer et prouver vos propres adresses.',
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
    'Ici, sous QR de paiement, collez cette URL et Enregistrez-la. Enregistrer un lien en étant connecté à votre propre compte est la preuve qu’il est à vous — il est donc rattaché à votre compte dès que vous l’enregistrez (revendiqué une seule fois, personne d’autre ne peut le lister), et vos clients le voient comme Vérifié une fois votre domaine prouvé.',
    'Vous ne vous connectez jamais à Stripe via nous et nous ne demandons jamais de clés. Nous ne voyons jamais votre solde, vos versements, vos clients ni vos canaux de paiement — il n’y a rien de connecté à exposer.',
    'Désormais, un client qui scanne ce QR voit qu’il est enregistré sur votre compte : ✓ Vérifié avec votre domaine vérifié une fois votre domaine prouvé, ou Enregistré sur Almstins, sans nom, d’ici là. Le libellé que vous saisissez n’apparaît pas sur la carte du scan. Si un fraudeur remplace votre autocollant par un autre lien, son scan affiche ⚠ Destination non vérifiée, un avertissement pour attendre avant de payer.',
  ],
  howToExchangeTitle: 'Vous publiez de nombreuses adresses ? (exchanges et plateformes)',
  howToExchangeSteps: [
    'Pendant l’accès anticipé, les listes de plateformes sont soumises à approbation. Écrivez à support@almstins.com pour demander l’accès.',
    'Publiez votre liste officielle d’adresses sur votre propre domaine et prouvez le domaine une fois en y hébergeant un seul fichier Almstins.',
    'Connectez un point de terminaison d’API en lecture seule qui renvoie la liste, plus une clé — nous la lisons seulement et ne déplaçons jamais de fonds.',
    'Nous gardons la liste synchronisée, pour que tout client vérifie une adresse officielle par rapport à votre domaine avant d’envoyer.',
  ],
  howToCustomerTitle: 'Ce que voient vos clients',
  howToCustomerSteps: [
    'Votre client scanne le QR ou l’adresse sur votre panneau, facture ou page de paiement.',
    'Si cela correspond à une destination que vous avez prouvée, il voit ✓ Vérifiée avec votre domaine vérifié (et le nom de votre entreprise, s’il correspond à ce domaine) : un lien de paiement une fois votre domaine prouvé, une adresse une fois que le fichier de vérification de votre domaine la liste. D’ici là, il voit Revendiquée, sans nom. Le libellé que vous saisissez n’apparaît pas sur la carte du scan.',
    'Si votre QR a été remplacé par une autre adresse, il affiche ⚠ Destination non vérifiée, un avertissement pour attendre avant de payer un fraudeur.',
    'Chaque scan lance aussi un contrôle de sécurité gratuit — listes d’arnaques, sanctions et honeypots pour une adresse ; listes de phishing et de sites frauduleux pour un lien de paiement — signalant une destination dangereuse même si elle n’est pas la vôtre.',
  ],
};

const MAP: Record<Lang, VerifyDashboardLocale> = { en, es, fr };

export function getVerifyDashboard(lang: Lang): VerifyDashboardLocale {
  return MAP[lang] ?? MAP.en;
}
