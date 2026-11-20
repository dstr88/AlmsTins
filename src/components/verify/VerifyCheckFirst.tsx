import { useEffect, useRef, useState } from 'react';
import { publicVerifyCard, safetyFlagged, fillTemplate } from '../../lib/verifyPublicCard';
import { runScanCheck, scanValueKind, type ScanCheckResult } from '../../lib/verifyScanCheck';
import { ownerNextStep, VERIFY_SIGNIN_HREF } from '../../lib/verifyCheckFirst';
import { carryDestination, clearCarriedDestination } from '../../lib/carriedDestination';
import { VERIFY_PLANS } from '../../lib/verifyPlans';
import { verifyScanCopy, type ScanLang, type VerifyScanCopy } from '../../i18n/verifyScan';
import type { VerifyCopy } from '../../i18n/verify';
import { ScanVerifyCard, SafetyCard, safetySentence } from './ScanResultCards';
import './VerifyCheckFirst.css';

/**
 * The field near the top of the public Verify page (Verify first run, Part D): "Paste the address
 * you ask people to pay. See what a payer sees today."
 *
 * A business owner sees the answer for their own address before being asked to sign up. It is the
 * public scanner's check and the public scanner's cards, not a second implementation: the check
 * is src/lib/verifyScanCheck.ts and the cards are ./ScanResultCards.tsx, with the scanner's own
 * words (src/i18n/verifyScan.ts) in the page's language. Like the scanner, it takes a wallet
 * address, a payment link, or the text of a payment QR.
 *
 * One thing is added, by the rule in src/lib/verifyCheckFirst.ts: when nobody has proven the
 * value, one action, "Prove it's yours, free", leading to the Verify sign-in. A value an account
 * has already claimed or verified gets the scanner's normal answer and nothing else.
 *
 * The action's link is the same for everyone. What the visitor checked is kept in this browser
 * tab only (src/lib/carriedDestination.ts), written when they press the action, so the first
 * screen after sign-in can fill it in.
 *
 * Presentation only: the words are the page's (src/i18n/verify.ts, `checkFirst`) and the look is
 * VerifyCheckFirst.css.
 */
export type CheckFirstCopy = VerifyCopy['checkFirst'];

/** A finished check: the exact text that was checked, and the scanner's answer for it. */
export interface CheckFirstAnswer {
  checked: string;
  result: ScanCheckResult;
}

/** What the visitor sees for a finished check: the scanner's cards, then the one action if any. */
export function CheckFirstResult({ answer, t, scan, onProve }: {
  answer: CheckFirstAnswer;
  t: CheckFirstCopy;
  scan: VerifyScanCopy;
  /** The visitor pressed "Prove it's yours, free" (the link itself then navigates). */
  onProve: () => void;
}) {
  const { checked, result } = answer;
  // The lookup gave no answer (not a complete address, too many requests, a failed request):
  // there is nothing a payer would see to show, and nothing to offer.
  if (!result.lookupAnswered) {
    return (
      <div className="vcf__result">
        <p className="vcf__could-not" role="alert">{t.couldNotCheck}</p>
      </div>
    );
  }

  const { noun, isUrl } = scanValueKind(checked);
  const flagged = safetyFlagged(result.safety);
  const verifyCard = <ScanVerifyCard card={publicVerifyCard(result.lookup, result.safety)} noun={noun} t={scan} />;
  const safetyCard = result.safety !== 'idle'
    ? <SafetyCard safety={result.safety} text={safetySentence(result.safety, noun, scan)} isUrl={isUrl} goplus={result.goplus} t={scan} />
    : null;
  const free = VERIFY_PLANS.free.limits;

  return (
    <div className="vcf__result">
      <h3 className="vcf__seen">{t.resultLabel}</h3>
      {/* A flagged safety verdict always leads, as on the scanner. */}
      {flagged ? <>{safetyCard}{verifyCard}</> : <>{verifyCard}{safetyCard}</>}
      {t.scannerLangNote && <p className="vcf__lang-note">{t.scannerLangNote}</p>}

      {ownerNextStep(result) === 'prove' && (
        <div className="vcf__next">
          <p className="vcf__next-lead">{t.unproven[noun]}</p>
          <a className="vcf__prove" href={VERIFY_SIGNIN_HREF} onClick={onProve}>{t.proveCta}</a>
          <p className="vcf__next-how">
            {fillTemplate(t.proveHow[noun], {
              claimed: scan.claimedTitle[noun], verified: scan.verifiedTitle, notVerified: scan.notVerifiedTitle,
            })}
          </p>
          <p className="vcf__next-how">
            {fillTemplate(t.freePlan, { addresses: String(free.address), qr: String(free.qr) })}
          </p>
          {flagged && <p className="vcf__next-how">{t.proveFlagged}</p>}
          <p className="vcf__next-carry">{t.carryNote}</p>
        </div>
      )}
    </div>
  );
}

export default function VerifyCheckFirst({ lang = 'en', t }: { lang?: ScanLang; t: CheckFirstCopy }) {
  const scan = verifyScanCopy[lang] ?? verifyScanCopy.en;
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<CheckFirstAnswer | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  // Counts checks, so an answer that arrives after the field changed is dropped.
  const run = useRef(0);

  // Coming back to this page drops anything carried from an earlier visit: the visitor did not
  // go on to sign in with it.
  useEffect(() => { clearCarriedDestination(); }, []);

  async function check() {
    // Read the field itself: text typed before this island loaded is in it, not yet in state.
    const q = (field.current?.value ?? value).trim();
    if (!q || busy) return;
    clearCarriedDestination();
    const id = ++run.current;
    setBusy(true); setAnswer(null);
    const result = await runScanCheck(q);
    if (id !== run.current) return;
    setAnswer({ checked: q, result });
    setBusy(false);
  }

  return (
    <section className="vcf" aria-labelledby="vcf-title">
      <h2 id="vcf-title" className="vcf__title">{t.title}</h2>
      <form className="vcf__row" onSubmit={(e) => { e.preventDefault(); void check(); }}>
        <label className="vcf__sr" htmlFor="vcf-value">{t.fieldLabel}</label>
        <input
          id="vcf-value"
          ref={field}
          className="vcf__value"
          value={value}
          onChange={(e) => { run.current++; setValue(e.target.value); setAnswer(null); setBusy(false); }}
          placeholder={t.placeholder}
          aria-describedby="vcf-hint"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
        />
        <button className="vcf__btn" type="submit" disabled={busy}>{busy ? t.checking : t.button}</button>
      </form>
      <p id="vcf-hint" className="vcf__hint">{t.hint}</p>

      <div aria-live="polite">
        {answer && (
          <CheckFirstResult
            answer={answer} t={t} scan={scan}
            onProve={() => { carryDestination(answer.checked); }}
          />
        )}
      </div>
    </section>
  );
}
