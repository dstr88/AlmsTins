import { publisherText, fillTemplate, splitTip, type PublicVerifyCard } from '../../lib/verifyPublicCard';
import type { ScanSafety } from '../../lib/verifyScanCheck';
import type { ScanNoun, VerifyScanCopy } from '../../i18n/verifyScan';
import PoweredByGoPlus from '../PoweredByGoPlus';
import './ScanResultCards.css';

/**
 * The two result cards of the public scanner: the Verify card and the safety screen.
 *
 * They live in their own file so every place that shows a payer's answer renders the same cards
 * with the same words (src/i18n/verifyScan.ts): /verify/scan (VerifyScan.tsx) and the "see what a
 * payer sees" field on the public Verify page (VerifyCheckFirst.tsx). Keeping them out of
 * VerifyScan.tsx also keeps the camera QR reader off pages that only show a result.
 *
 * Presentation only. src/lib/verifyPublicCard.ts decides what a card may say: never a freeform
 * label, and no name at all on a Claimed result.
 */

/** Renders "text with an [[accountable domain]] in it" with the term explained on hover. */
function withTip(text: string, tip: string) {
  const parts = splitTip(text);
  if (!parts) return text;
  return (
    <>
      {parts.before}
      <span className="vs__tip" title={tip}>{parts.term}</span>
      {parts.after}
    </>
  );
}

/**
 * The Verify card for a finished scan. `card` comes from publicVerifyCard(); null means no
 * Verify hit. It never receives the lookup's label, so it cannot print a freeform one.
 */
export function ScanVerifyCard({ card, noun, t }: { card: PublicVerifyCard | null; noun: ScanNoun; t: VerifyScanCopy }) {
  if (!card) {
    return (
      <div className="vs__card vs__card--warn">
        <div className="vs__verdict">⚠ {t.notVerifiedTitle}</div>
        <p className="vs__detail">{t.notVerifiedBody[noun]}</p>
      </div>
    );
  }
  if (card.level === 'disputed') {
    // Two accounts stand behind the value (a platform's list and a merchant's proof, or two
    // lists). Nothing vouches for it until one withdraws: no name, no domain, no date.
    return (
      <div className="vs__card vs__card--warn">
        <div className="vs__verdict">◑ {t.disputedTitle[noun]}</div>
        <p className="vs__detail">{t.disputedBody[noun]}</p>
        {card.afterSafety && <p className="vs__detail vs__detail--spaced">{t.flaggedNote[noun]}</p>}
      </div>
    );
  }
  if (card.level === 'verified') {
    // Green only when the safety screen did not flag the value; otherwise neutral.
    return (
      <div className={`vs__card${card.tone === 'positive' ? ' vs__card--ok' : ''}`}>
        <div className="vs__verdict">{card.tone === 'positive' ? '✓ ' : ''}{t.verifiedTitle}</div>
        <p className="vs__detail">
          {`${publisherText(card.publisher, { listedBy: t.listedBy[noun], listedOn: t.listedOn[noun], viaBy: t.viaBy[noun], viaOn: t.viaOn[noun] }) ?? t.verifiedNoPublisher} ${t.verifiedSwap[noun]}`}
        </p>
        {card.afterSafety && <p className="vs__detail vs__detail--spaced">{t.flaggedNote[noun]}</p>}
        {card.since && (
          <p className="vs__detail vs__detail--spaced vs__detail--since">{fillTemplate(t.verifiedSince, { date: card.since })}</p>
        )}
      </div>
    );
  }
  const claimed = (
    <>
      <p className="vs__detail">{withTip(t.claimedBody[noun], t.accountableDomainTip)}</p>
      {card.afterSafety && <p className="vs__detail vs__detail--spaced">{t.flaggedNote[noun]}</p>}
      {card.since && (
        <p className="vs__detail vs__detail--spaced vs__detail--since">{fillTemplate(t.claimedSince, { date: card.since })}</p>
      )}
    </>
  );
  if (card.tone === 'caution') {
    // Caution-tape frame: "proceed with awareness," not a solid danger box. No name.
    return (
      <div className="vs__tape">
        <div className="vs__card vs__card--taped">
          <div className="vs__verdict">◑ {t.claimedTitle[noun]}</div>
          {claimed}
        </div>
      </div>
    );
  }
  // Claimed, and the safety screen flagged it: neutral card after the warning. No name.
  return (
    <div className="vs__card">
      <div className="vs__verdict">{t.claimedTitle[noun]}</div>
      {claimed}
    </div>
  );
}

/** The safety-screen card. A clean screen carries the "no flags is not safe" note, as on the checker. */
export function SafetyCard({ safety, text, isUrl, goplus, t }: {
  safety: ScanSafety; text: string; isUrl: boolean; goplus: boolean; t: VerifyScanCopy;
}) {
  return (
    <div className={`vs__card ${safety === 'clean' ? 'vs__card--ok' : safety === 'danger' ? 'vs__card--err' : 'vs__card--warn'}`}>
      <div className="vs__verdict">{t.safetyTitle}</div>
      <p className="vs__detail">{text}</p>
      {safety === 'clean' && (
        <p className="vs__detail vs__detail--spaced">{isUrl ? t.safetyCleanNote.link : t.safetyCleanNote.address}</p>
      )}
      {goplus && <PoweredByGoPlus label={t.poweredByGoPlus} />}
    </div>
  );
}

/** The safety screen's sentence for a verdict, in the scanner's own words. */
export function safetySentence(safety: ScanSafety, noun: ScanNoun, t: VerifyScanCopy): string {
  switch (safety) {
    case 'idle': return '';
    case 'checking': return t.safetyChecking;
    case 'clean': return noun === 'link' ? t.safetyClean.link : t.safetyClean.address;
    case 'caution': return t.safetyCaution[noun];
    case 'danger': return t.safetyDanger[noun];
    case 'unclear': return t.safetyUnclear[noun];
    case 'error': return t.safetyError;
  }
}
