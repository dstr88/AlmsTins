/**
 * Result-card copy for the public /verify/scan page (src/components/verify/VerifyScan.tsx).
 * The page renders in English today; es/fr are kept complete so it can be localized by
 * passing `lang`. Sentences that name the scanned value come per noun (address / payment
 * link / payment code) because es/fr agree in gender with it.
 *
 * Rules for this copy: a freeform label is never shown; Claimed shows no name, and its
 * wording must hold for every Claimed row (a self-send, a stale domain listing, an older
 * claim), so it says "claimed", never "control proven"; "Listed on" only when the domain
 * publishes the value, else "verified via"; Verify verifies, warns and flags, and never
 * tells a payer a payment is blocked. Glyphs (✓ ◑ ⚠) are added by the component.
 */
export type ScanLang = 'en' | 'es' | 'fr';
export type ScanNoun = 'address' | 'link' | 'code';
type ByNoun = Record<ScanNoun, string>;

export interface VerifyScanCopy {
  verifiedTitle: string;
  /** Publisher line when the domain publishes the value, with a domain-derived name. {name}, {domain}. */
  listedBy: ByNoun;
  /** Same, without a name. {domain}. */
  listedOn: ByNoun;
  /** Publisher line when the domain is one the account proved (merchant hits), with a name. */
  viaBy: ByNoun;
  /** Same, without a name. {domain}. */
  viaOn: ByNoun;
  /** Verified with no domain to show (defensive; the lookup always sends one). */
  verifiedNoPublisher: string;
  verifiedSwap: ByNoun;
  verifiedSince: string;
  claimedTitle: ByNoun;
  /** Claimed body. Contains one [[term]] explained by accountableDomainTip. */
  claimedBody: ByNoun;
  claimedSince: string;
  accountableDomainTip: string;
  /** On the Verify card when the safety screen flagged the value (the warning leads). */
  flaggedNote: ByNoun;
  notVerifiedTitle: string;
  notVerifiedBody: ByNoun;
  safetyTitle: string;
  safetyChecking: string;
  safetyClean: { address: string; link: string };
  safetyCaution: ByNoun;
  safetyDanger: ByNoun;
  safetyUnclear: ByNoun;
  safetyError: string;
}

const en: VerifyScanCopy = {
  verifiedTitle: 'Verified destination',
  listedBy: {
    address: 'Listed by {name} on {domain}.',
    link: 'Registered by {name}, the verified owner of {domain}.',
    code: 'Registered by {name}, the verified owner of {domain}.',
  },
  listedOn: {
    address: 'Listed on {domain}.',
    link: 'Registered by the verified owner of {domain}.',
    code: 'Registered by the verified owner of {domain}.',
  },
  viaBy: {
    address: '{name}, verified via {domain}.',
    link: 'Registered by {name}, the verified owner of {domain}.',
    code: 'Registered by {name}, the verified owner of {domain}.',
  },
  viaOn: {
    address: 'Verified via {domain}.',
    link: 'Registered by the verified owner of {domain}.',
    code: 'Registered by the verified owner of {domain}.',
  },
  verifiedNoPublisher: 'Anchored to a proven domain.',
  verifiedSwap: {
    address: 'A swapped address on a spoofed page would fail this check.',
    link: 'A swapped link on a spoofed page would fail this check.',
    code: 'A swapped payment code on a spoofed page would fail this check.',
  },
  verifiedSince: 'Verified since {date}.',
  claimedTitle: {
    address: 'Claimed by an Almstins account',
    link: 'Registered with Almstins',
    code: 'Registered with Almstins',
  },
  claimedBody: {
    address: 'An Almstins account has claimed this address. No website vouches for it right now: no [[accountable domain]] has confirmed it recently. A claim isn’t proof it’s safe, because a scammer can claim their own address. Confirm the recipient another way before you send.',
    link: 'An Almstins account registered this link. No website vouches for it right now: no [[accountable domain]] has confirmed it recently. Registering a link isn’t proof of who owns it, and a scammer can register their own. Confirm the recipient another way before you send.',
    code: 'An Almstins account registered this payment code. No website vouches for it right now: no [[accountable domain]] has confirmed it recently. Registering a code isn’t proof of who owns it, and a scammer can register their own. Confirm the recipient another way before you send.',
  },
  claimedSince: 'Claimed since {date}.',
  accountableDomainTip: 'A domain the owner proved they control via a DNS record. It ties the address to a public, accountable website, so a swapped address on a fake page would fail the check. A claimed address has no recent confirmation from such a domain.',
  flaggedNote: {
    address: 'The safety screen flagged this address, and Almstins Verify doesn’t cancel that warning. Read it before you decide to pay.',
    link: 'The safety screen flagged this link, and Almstins Verify doesn’t cancel that warning. Read it before you decide to pay.',
    code: 'The safety screen flagged this payment code, and Almstins Verify doesn’t cancel that warning. Read it before you decide to pay.',
  },
  notVerifiedTitle: 'Not a verified destination',
  notVerifiedBody: {
    address: 'No account has proven control of this address with Almstins. That doesn’t mean it’s unsafe — only that it isn’t verified here.',
    link: 'No account has proven control of this link with Almstins. That doesn’t mean it’s unsafe — only that it isn’t verified here.',
    code: 'No account has proven control of this payment code with Almstins. That doesn’t mean it’s unsafe — only that it isn’t verified here.',
  },
  safetyTitle: 'Safety screen',
  safetyChecking: 'Checking…',
  safetyClean: {
    address: 'No scam, sanctions, or honeypot flags.',
    link: 'No phishing or scam-site flags.',
  },
  safetyCaution: {
    address: 'Caution — this address has risk flags. Double-check before paying.',
    link: 'Caution — this link has risk flags. Double-check before paying.',
    code: 'Caution — this payment code has risk flags. Double-check before paying.',
  },
  safetyDanger: {
    address: 'Danger — this address is flagged. Hold off and confirm the recipient another way before you pay.',
    link: 'Danger — this link is flagged. Hold off and confirm the recipient another way before you pay.',
    code: 'Danger — this payment code is flagged. Hold off and confirm the recipient another way before you pay.',
  },
  safetyUnclear: {
    address: 'Not enough data to clear this address. Proceed carefully.',
    link: 'Not enough data to clear this link. Proceed carefully.',
    code: 'Not enough data to clear this payment code. Proceed carefully.',
  },
  safetyError: 'Couldn’t run the safety check — try again.',
};

const es: VerifyScanCopy = {
  verifiedTitle: 'Destino verificado',
  listedBy: {
    address: 'Publicada por {name} en {domain}.',
    link: 'Registrado por {name}, propietario verificado de {domain}.',
    code: 'Registrado por {name}, propietario verificado de {domain}.',
  },
  listedOn: {
    address: 'Publicada en {domain}.',
    link: 'Registrado por el propietario verificado de {domain}.',
    code: 'Registrado por el propietario verificado de {domain}.',
  },
  viaBy: {
    address: '{name}, verificada mediante {domain}.',
    link: 'Registrado por {name}, propietario verificado de {domain}.',
    code: 'Registrado por {name}, propietario verificado de {domain}.',
  },
  viaOn: {
    address: 'Verificada mediante {domain}.',
    link: 'Registrado por el propietario verificado de {domain}.',
    code: 'Registrado por el propietario verificado de {domain}.',
  },
  verifiedNoPublisher: 'Vinculado a un dominio comprobado.',
  verifiedSwap: {
    address: 'Una dirección sustituida en una página falsa no pasaría esta comprobación.',
    link: 'Un enlace sustituido en una página falsa no pasaría esta comprobación.',
    code: 'Un código de pago sustituido en una página falsa no pasaría esta comprobación.',
  },
  verifiedSince: 'Verificado desde el {date}.',
  claimedTitle: {
    address: 'Reclamada por una cuenta de Almstins',
    link: 'Registrado en Almstins',
    code: 'Registrado en Almstins',
  },
  claimedBody: {
    address: 'Una cuenta de Almstins reclamó esta dirección. Ahora mismo ningún sitio web la respalda: ningún [[dominio responsable]] la ha confirmado recientemente. Un reclamo no prueba que sea segura, porque un estafador puede reclamar su propia dirección. Confirma al destinatario por otra vía antes de enviar.',
    link: 'Una cuenta de Almstins registró este enlace. Ahora mismo ningún sitio web lo respalda: ningún [[dominio responsable]] lo ha confirmado recientemente. Registrar un enlace no prueba quién es su dueño, y un estafador puede registrar el suyo. Confirma al destinatario por otra vía antes de enviar.',
    code: 'Una cuenta de Almstins registró este código de pago. Ahora mismo ningún sitio web lo respalda: ningún [[dominio responsable]] lo ha confirmado recientemente. Registrar un código no prueba quién es su dueño, y un estafador puede registrar el suyo. Confirma al destinatario por otra vía antes de enviar.',
  },
  claimedSince: 'Reclamado desde el {date}.',
  accountableDomainTip: 'Un dominio que el propietario demostró controlar mediante un registro DNS. Vincula la dirección a un sitio web público y responsable, de modo que una dirección sustituida en una página falsa no pasaría la comprobación. Una dirección reclamada no tiene una confirmación reciente de un dominio así.',
  flaggedNote: {
    address: 'La revisión de seguridad marcó esta dirección, y Almstins Verify no anula esa advertencia. Léela antes de decidir si pagas.',
    link: 'La revisión de seguridad marcó este enlace, y Almstins Verify no anula esa advertencia. Léela antes de decidir si pagas.',
    code: 'La revisión de seguridad marcó este código de pago, y Almstins Verify no anula esa advertencia. Léela antes de decidir si pagas.',
  },
  notVerifiedTitle: 'No es un destino verificado',
  notVerifiedBody: {
    address: 'Ninguna cuenta ha demostrado el control de esta dirección con Almstins. Eso no significa que no sea segura, solo que no está verificada aquí.',
    link: 'Ninguna cuenta ha demostrado el control de este enlace con Almstins. Eso no significa que no sea seguro, solo que no está verificado aquí.',
    code: 'Ninguna cuenta ha demostrado el control de este código de pago con Almstins. Eso no significa que no sea seguro, solo que no está verificado aquí.',
  },
  safetyTitle: 'Revisión de seguridad',
  safetyChecking: 'Comprobando…',
  safetyClean: {
    address: 'Sin alertas de estafa, sanciones ni honeypot.',
    link: 'Sin alertas de phishing ni de sitios fraudulentos.',
  },
  safetyCaution: {
    address: 'Precaución: esta dirección tiene indicadores de riesgo. Compruébala bien antes de pagar.',
    link: 'Precaución: este enlace tiene indicadores de riesgo. Compruébalo bien antes de pagar.',
    code: 'Precaución: este código de pago tiene indicadores de riesgo. Compruébalo bien antes de pagar.',
  },
  safetyDanger: {
    address: 'Peligro: esta dirección está señalada. Espera y confirma al destinatario por otra vía antes de pagar.',
    link: 'Peligro: este enlace está señalado. Espera y confirma al destinatario por otra vía antes de pagar.',
    code: 'Peligro: este código de pago está señalado. Espera y confirma al destinatario por otra vía antes de pagar.',
  },
  safetyUnclear: {
    address: 'No hay datos suficientes para dar por buena esta dirección. Procede con cuidado.',
    link: 'No hay datos suficientes para dar por bueno este enlace. Procede con cuidado.',
    code: 'No hay datos suficientes para dar por bueno este código de pago. Procede con cuidado.',
  },
  safetyError: 'No se pudo hacer la revisión de seguridad. Inténtalo de nuevo.',
};

const fr: VerifyScanCopy = {
  verifiedTitle: 'Destination vérifiée',
  listedBy: {
    address: 'Publiée par {name} sur {domain}.',
    link: 'Enregistré par {name}, propriétaire vérifié de {domain}.',
    code: 'Enregistré par {name}, propriétaire vérifié de {domain}.',
  },
  listedOn: {
    address: 'Publiée sur {domain}.',
    link: 'Enregistré par le propriétaire vérifié de {domain}.',
    code: 'Enregistré par le propriétaire vérifié de {domain}.',
  },
  viaBy: {
    address: '{name}, vérifiée via {domain}.',
    link: 'Enregistré par {name}, propriétaire vérifié de {domain}.',
    code: 'Enregistré par {name}, propriétaire vérifié de {domain}.',
  },
  viaOn: {
    address: 'Vérifiée via {domain}.',
    link: 'Enregistré par le propriétaire vérifié de {domain}.',
    code: 'Enregistré par le propriétaire vérifié de {domain}.',
  },
  verifiedNoPublisher: 'Rattachée à un domaine prouvé.',
  verifiedSwap: {
    address: 'Une adresse substituée sur une page usurpée échouerait à cette vérification.',
    link: 'Un lien substitué sur une page usurpée échouerait à cette vérification.',
    code: 'Un code de paiement substitué sur une page usurpée échouerait à cette vérification.',
  },
  verifiedSince: 'Vérifié depuis le {date}.',
  claimedTitle: {
    address: 'Revendiquée par un compte Almstins',
    link: 'Enregistré sur Almstins',
    code: 'Enregistré sur Almstins',
  },
  claimedBody: {
    address: 'Un compte Almstins a revendiqué cette adresse. Pour l’instant, aucun site web ne s’en porte garant : aucun [[domaine responsable]] ne l’a confirmée récemment. Une revendication ne prouve pas qu’elle est sûre, car un escroc peut revendiquer sa propre adresse. Confirmez le destinataire autrement avant d’envoyer.',
    link: 'Un compte Almstins a enregistré ce lien. Pour l’instant, aucun site web ne s’en porte garant : aucun [[domaine responsable]] ne l’a confirmé récemment. Enregistrer un lien ne prouve pas à qui il appartient, et un escroc peut enregistrer le sien. Confirmez le destinataire autrement avant d’envoyer.',
    code: 'Un compte Almstins a enregistré ce code de paiement. Pour l’instant, aucun site web ne s’en porte garant : aucun [[domaine responsable]] ne l’a confirmé récemment. Enregistrer un code ne prouve pas à qui il appartient, et un escroc peut enregistrer le sien. Confirmez le destinataire autrement avant d’envoyer.',
  },
  claimedSince: 'Revendiqué depuis le {date}.',
  accountableDomainTip: 'Un domaine dont le propriétaire a prouvé le contrôle via un enregistrement DNS. Il relie l’adresse à un site web public et responsable, de sorte qu’une adresse remplacée sur une fausse page échouerait à la vérification. Une adresse revendiquée n’a pas de confirmation récente d’un tel domaine.',
  flaggedNote: {
    address: 'Le contrôle de sécurité a signalé cette adresse, et Almstins Verify n’annule pas cet avertissement. Lisez-le avant de décider de payer.',
    link: 'Le contrôle de sécurité a signalé ce lien, et Almstins Verify n’annule pas cet avertissement. Lisez-le avant de décider de payer.',
    code: 'Le contrôle de sécurité a signalé ce code de paiement, et Almstins Verify n’annule pas cet avertissement. Lisez-le avant de décider de payer.',
  },
  notVerifiedTitle: 'Destination non vérifiée',
  notVerifiedBody: {
    address: 'Aucun compte n’a prouvé le contrôle de cette adresse avec Almstins. Cela ne veut pas dire qu’elle est dangereuse, seulement qu’elle n’est pas vérifiée ici.',
    link: 'Aucun compte n’a prouvé le contrôle de ce lien avec Almstins. Cela ne veut pas dire qu’il est dangereux, seulement qu’il n’est pas vérifié ici.',
    code: 'Aucun compte n’a prouvé le contrôle de ce code de paiement avec Almstins. Cela ne veut pas dire qu’il est dangereux, seulement qu’il n’est pas vérifié ici.',
  },
  safetyTitle: 'Contrôle de sécurité',
  safetyChecking: 'Vérification…',
  safetyClean: {
    address: 'Aucun signalement d’arnaque, de sanctions ou de honeypot.',
    link: 'Aucun signalement de phishing ou de site frauduleux.',
  },
  safetyCaution: {
    address: 'Prudence : cette adresse présente des signaux de risque. Revérifiez avant de payer.',
    link: 'Prudence : ce lien présente des signaux de risque. Revérifiez avant de payer.',
    code: 'Prudence : ce code de paiement présente des signaux de risque. Revérifiez avant de payer.',
  },
  safetyDanger: {
    address: 'Danger : cette adresse est signalée. Attendez et confirmez le destinataire autrement avant de payer.',
    link: 'Danger : ce lien est signalé. Attendez et confirmez le destinataire autrement avant de payer.',
    code: 'Danger : ce code de paiement est signalé. Attendez et confirmez le destinataire autrement avant de payer.',
  },
  safetyUnclear: {
    address: 'Pas assez de données pour valider cette adresse. Soyez prudent.',
    link: 'Pas assez de données pour valider ce lien. Soyez prudent.',
    code: 'Pas assez de données pour valider ce code de paiement. Soyez prudent.',
  },
  safetyError: 'Le contrôle de sécurité n’a pas pu être effectué. Réessayez.',
};

export const verifyScanCopy: Record<ScanLang, VerifyScanCopy> = { en, es, fr };
