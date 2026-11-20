import type { VerifyDashboardLocale } from '../../i18n/dashboard/verify';
import { fillTemplate } from '@/lib/verifyPublicCard';
import type { ProveGuide as Guide, ProveStepState } from '@/lib/verifyFirstRun';
import './ProveGuide.css';

/**
 * What the dashboard shows right after an account registers its first destination (Verify first
 * run, Part C). src/lib/verifyFirstRun.ts (proveGuideFor) decides what there is to say.
 *
 * A wallet address: the two proving steps, numbered, each with one line on what it costs and what
 * it earns. Step 1, the satoshi test, earns the row's Claimed badge. Step 2, a file on the owner's
 * website, earns Verified. The file can also prove an address that skipped step 1, so step 2 is
 * open from the start and a note says what skipping costs. Each button opens that proof on the
 * address's own row (`onStart`); the guide runs no proof of its own.
 *
 * A payment link or QR: it has no proving step of its own. The guide says what the account can do
 * with it now and what a payer sees until the account has proven a domain.
 *
 * Presentation only: the words are the dashboard locale's (the two marks are its own badge
 * labels), the look is ProveGuide.css, the buttons are the dashboard's (VerifyDashboard.css).
 */
export type ProveMethod = 'selfsend' | 'domain';

function Step({ n, state, title, body, cost, earns, button, doneWord, onStart }: {
  n: number; state: ProveStepState; title: string; body: string; cost: string; earns: string;
  button: string; doneWord: string; onStart: () => void;
}) {
  return (
    <li className={`vpg__step vpg__step--${state}`}>
      <div className="vpg__head">
        <span className="vpg__num" aria-hidden="true">{state === 'done' ? '✓' : n}</span>
        <h2 className="vpg__name">{title}</h2>
        {state === 'done' && <span className="vpg__done">{doneWord}</span>}
      </div>
      <p className="vpg__body">{body}</p>
      <p className="vpg__terms">
        <span className="vpg__cost">{cost}</span>
        <span className="vpg__earns">{earns}</span>
      </p>
      {state !== 'done' && (
        <button
          type="button"
          className={state === 'next' ? 'vd-prove__verify vpg__btn' : 'vd-prove__get vpg__btn'}
          onClick={onStart}
        >
          {button}
        </button>
      )}
    </li>
  );
}

export function ProveGuide({ t, guide, rail, onStart }: {
  t: VerifyDashboardLocale;
  guide: Guide;
  /** The registered destination's rail: 'url' is a payment link, any other QR rail a code. */
  rail: string;
  onStart: (method: ProveMethod) => void;
}) {
  if (guide.kind === 'qr') {
    return (
      <section className="vpg vpg--qr" aria-labelledby="vpg-title">
        <h1 id="vpg-title" className="vpg__title">{rail === 'url' ? t.guideQrTitleLink : t.guideQrTitleCode}</h1>
        <p className="vpg__body">{fillTemplate(t.guideQrNow, { tool: t.verifyTitle })}</p>
        <p className="vpg__body">{fillTemplate(t.guideQrPayer, { prove: t.proveBtn, domain: t.proveMethodDomain })}</p>
      </section>
    );
  }
  return (
    <section className="vpg" aria-labelledby="vpg-title">
      <h1 id="vpg-title" className="vpg__title">{t.guideAddressTitle}</h1>
      <ol className="vpg__steps">
        <Step
          n={1} state={guide.claim} title={t.guideClaimTitle} body={t.guideClaimBody}
          cost={t.guideClaimCost} earns={fillTemplate(t.guideClaimEarns, { status: t.statusClaimed })}
          button={t.guideClaimBtn} doneWord={t.guideStepDone} onStart={() => onStart('selfsend')}
        />
        <Step
          n={2} state={guide.list} title={t.guideListTitle} body={t.guideListBody}
          cost={t.guideListCost} earns={fillTemplate(t.guideListEarns, { status: t.statusProven })}
          button={t.guideListBtn} doneWord={t.guideStepDone} onStart={() => onStart('domain')}
        />
      </ol>
      {guide.claim !== 'done' && (
        <p className="vpg__note">
          {fillTemplate(t.guideOrderNote, { verified: t.statusProven, claimed: t.statusClaimed, lapsed: t.statusLapsed })}
        </p>
      )}
    </section>
  );
}
