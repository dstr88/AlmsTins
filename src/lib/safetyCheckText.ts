/**
 * Copy and verdict text for the <safety-check> element (src/lib/safetyCheck.ts), kept apart
 * from the element so it can be tested without a DOM.
 *
 * A clean result means no source we checked has flagged the address or link yet, never
 * "safe" (the checker wording from the 2026-10-11 code review). So a clean result carries
 * the "clean is not safe" note, an address scan that could not run every check reads as a
 * limited check (never green), and the link verdict comes from the same siteVerdictText()
 * as /wallet-checker. The link note is the wallet checker's own cleanNotSafe sentence
 * (src/i18n/walletChecker.ts), repeated here so the element does not load that whole module.
 */
import { siteVerdictText } from '@/lib/siteVerdict';

export type SafetyCheckLang = 'en' | 'es' | 'fr';

export type SafetyCheckStrings = {
  placeholder: string;
  scan: string;
  check: string;
  paste: string;
  decoding: string;
  noQr: string;
  checking: string;
  unrecognized: string;
  failed: string;
  addr: { danger: string; caution: string; clean: string; limited: string };
  url: { red: string; yellow: string; green: string; limited: string };
  /** Shown under a clean result: no flag is not a clean bill. */
  cleanNote: { address: string; link: string };
  /** Shown under an address scan that could not run every check. */
  limitedNote: string;
  identified: string;
  fraud: (n: number) => string;
  flags: Record<string, string>;
};

export const SAFETY_CHECK_I18N: Record<SafetyCheckLang, SafetyCheckStrings> = {
  en: {
    placeholder: 'Paste or type an address or URL',
    scan: '📷 Scan',
    check: 'Check',
    paste: 'Paste from clipboard',
    decoding: 'Decoding QR…',
    noQr: 'No QR code found (or cancelled). Paste the address/URL instead.',
    checking: 'Checking…',
    unrecognized: 'Not a recognizable wallet address or URL.',
    failed: 'Check failed. Try again.',
    addr: { danger: '🛑 Dangerous address', caution: '⚠ Use caution', clean: '🛡 No flags found', limited: '⚠ Limited check' },
    url: { red: '🛑 Flagged as dangerous', yellow: '⚠ Insufficient data', green: '✓ No flags found', limited: '⚠ Limited check' },
    cleanNote: {
      address: 'A clean result means no source we checked has flagged this address yet, not that it is safe. Lists are incomplete and can lag. You are responsible for the decision to send.',
      link: 'A clean result means no source we checked has flagged this site yet, not that it is safe. Lists are incomplete and can lag behind new scam sites. You are responsible for the decision to connect your wallet.',
    },
    limitedNote: 'Some checks could not run for this address, so the absence of a flag here is not a clean result. Verify the address independently before you send.',
    identified: 'Identified: ',
    fraud: (n) => `⚠ Marked fraudulent by ${n} in your community`,
    flags: {
      blacklisted: 'On a scam blacklist',
      sanctioned: 'OFAC sanctioned',
      phishing: 'Linked to phishing',
      honeypotRelated: 'Honeypot-related',
      stealingAttack: 'Stealing attack',
      darkwebTransactions: 'Dark-web activity',
      cybercrime: 'Cybercrime',
      moneyLaundering: 'Money laundering',
      financialCrime: 'Financial crime',
      blackmail: 'Blackmail',
      mixer: 'Mixer / Tornado Cash',
    },
  },
  es: {
    placeholder: 'Pega o escribe una dirección o URL',
    scan: '📷 Escanear',
    check: 'Verificar',
    paste: 'Pegar del portapapeles',
    decoding: 'Decodificando QR…',
    noQr: 'No se encontró ningún código QR (o se canceló). Pega la dirección/URL.',
    checking: 'Verificando…',
    unrecognized: 'No es una dirección de billetera ni una URL reconocible.',
    failed: 'La verificación falló. Inténtalo de nuevo.',
    addr: { danger: '🛑 Dirección peligrosa', caution: '⚠ Ten precaución', clean: '🛡 Sin alertas', limited: '⚠ Comprobación limitada' },
    url: { red: '🛑 Marcada como peligrosa', yellow: '⚠ Datos insuficientes', green: '✓ Sin alertas', limited: '⚠ Comprobación limitada' },
    cleanNote: {
      address: 'Un resultado limpio significa que ninguna fuente consultada ha señalado esta dirección todavía, no que sea segura. Las listas son incompletas y pueden ir con retraso. La decisión de enviar es tu responsabilidad.',
      link: 'Un resultado limpio significa que ninguna fuente consultada ha señalado este sitio todavía, no que sea seguro. Las listas son incompletas y pueden ir con retraso frente a los sitios de estafa nuevos. La decisión de conectar tu billetera es tu responsabilidad.',
    },
    limitedNote: 'Algunas comprobaciones no se pudieron hacer para esta dirección, así que la ausencia de una alerta aquí no es un resultado limpio. Verifica la dirección de forma independiente antes de enviar.',
    identified: 'Identificada: ',
    fraud: (n) => `⚠ Marcada como fraudulenta por ${n} en tu comunidad`,
    flags: {
      blacklisted: 'En una lista negra de estafas',
      sanctioned: 'Sancionada por la OFAC',
      phishing: 'Vinculada a phishing',
      honeypotRelated: 'Relacionada con honeypot',
      stealingAttack: 'Ataque de robo',
      darkwebTransactions: 'Actividad en la dark web',
      cybercrime: 'Cibercrimen',
      moneyLaundering: 'Lavado de dinero',
      financialCrime: 'Delito financiero',
      blackmail: 'Extorsión',
      mixer: 'Mezclador / Tornado Cash',
    },
  },
  fr: {
    placeholder: 'Collez ou saisissez une adresse ou une URL',
    scan: '📷 Scanner',
    check: 'Vérifier',
    paste: 'Coller depuis le presse-papiers',
    decoding: 'Décodage du QR…',
    noQr: 'Aucun code QR trouvé (ou annulé). Collez plutôt l’adresse / l’URL.',
    checking: 'Vérification…',
    unrecognized: 'Ni une adresse de portefeuille ni une URL reconnaissable.',
    failed: 'Échec de la vérification. Réessayez.',
    addr: { danger: '🛑 Adresse dangereuse', caution: '⚠ Soyez prudent', clean: '🛡 Aucune alerte', limited: '⚠ Vérification limitée' },
    url: { red: '🛑 Signalée comme dangereuse', yellow: '⚠ Données insuffisantes', green: '✓ Aucune alerte', limited: '⚠ Vérification limitée' },
    cleanNote: {
      address: 'Un résultat vierge signifie qu’aucune source consultée n’a encore signalé cette adresse, pas qu’elle est sûre. Les listes sont incomplètes et peuvent être en retard. La décision d’envoyer relève de votre responsabilité.',
      link: 'Un résultat vierge signifie qu’aucune source consultée n’a encore signalé ce site, pas que ce site est sûr. Les listes sont incomplètes et peuvent être en retard sur les nouveaux sites d’arnaque. La décision de connecter votre portefeuille relève de votre responsabilité.',
    },
    limitedNote: 'Certaines vérifications n’ont pas pu être faites pour cette adresse ; l’absence de signalement ici n’est donc pas un résultat vierge. Vérifiez l’adresse de manière indépendante avant d’envoyer.',
    identified: 'Identifiée : ',
    fraud: (n) => `⚠ Signalée comme frauduleuse par ${n} dans votre communauté`,
    flags: {
      blacklisted: 'Sur une liste noire d’arnaques',
      sanctioned: 'Sanctionnée par l’OFAC',
      phishing: 'Liée à du phishing',
      honeypotRelated: 'Liée à un honeypot',
      stealingAttack: 'Attaque de vol',
      darkwebTransactions: 'Activité sur le dark web',
      cybercrime: 'Cybercriminalité',
      moneyLaundering: 'Blanchiment d’argent',
      financialCrime: 'Crime financier',
      blackmail: 'Chantage',
      mixer: 'Mixeur / Tornado Cash',
    },
  },
};

/** What the element shows for a verdict: the box tone, its title, and an optional note. */
export type SafetyCheckVerdict = { tone: 'bad' | 'warn' | 'ok'; title: string; note: string | null };

/**
 * An /api/wallet-check result. 'clean' means no flag at all (calculateScamScore). A clean scan
 * that could not run every check (partialCoverage, e.g. any Solana, Bitcoin or Sui address) is
 * a limited check, never green. An unknown level is a failed check, never a pass.
 */
export function addressVerdict(
  r: { scamLevel?: unknown; partialCoverage?: unknown },
  t: SafetyCheckStrings,
): SafetyCheckVerdict {
  if (r.scamLevel === 'danger') return { tone: 'bad', title: t.addr.danger, note: null };
  if (r.scamLevel === 'caution') return { tone: 'warn', title: t.addr.caution, note: null };
  if (r.scamLevel !== 'clean') return { tone: 'warn', title: t.failed, note: null };
  if (r.partialCoverage === true) return { tone: 'warn', title: t.addr.limited, note: t.limitedNote };
  return { tone: 'ok', title: t.addr.clean, note: t.cleanNote.address };
}

/** An /api/dapp-check answer; null when it carries no verdict (a failed check, never a pass). */
export function urlVerdict(
  data: { verdict?: unknown; limited?: unknown } | null | undefined,
  t: SafetyCheckStrings,
): SafetyCheckVerdict | null {
  const shown = siteVerdictText(data, {
    verdictDanger: t.url.red,
    verdictCaution: t.url.yellow,
    verdictSafe: t.url.green,
    verdictLimited: t.url.limited,
    cleanNotSafe: t.cleanNote.link,
  });
  if (!shown) return null;
  const tone = shown.tone === 'red' ? 'bad' : shown.tone === 'yellow' ? 'warn' : 'ok';
  return { tone, title: shown.label, note: shown.cleanNote };
}
