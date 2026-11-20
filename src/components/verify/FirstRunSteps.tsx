import type { VerifyDashboardLocale } from '../../i18n/dashboard/verify';
import './VerifyFirstRun.css';

/**
 * The three steps of Almstins Verify, shown above the first-run card and again above the proving
 * guide (Verify first run, Part C): register, prove, share. Presentation only: the words are the
 * dashboard locale's, the look is VerifyFirstRun.css (.vfr-steps).
 *
 * "Share" is the QR badge a proven address gets on its row, which opens the free scanner on that
 * address. A step before `current` reads as done; the one at `current` is marked for a screen
 * reader with aria-current.
 */
export type FirstRunStep = 'register' | 'prove' | 'share';

const ORDER: readonly FirstRunStep[] = ['register', 'prove', 'share'];

export function FirstRunSteps({ t, current }: { t: VerifyDashboardLocale; current: FirstRunStep }) {
  const steps: { id: FirstRunStep; title: string; body: string }[] = [
    { id: 'register', title: t.firstStepRegister, body: t.firstStepRegisterBody },
    { id: 'prove', title: t.firstStepProve, body: t.firstStepProveBody },
    { id: 'share', title: t.firstStepShare, body: t.firstStepShareBody },
  ];
  const at = ORDER.indexOf(current);
  return (
    <ol className="vfr-steps" aria-label={t.firstStepsAria}>
      {steps.map((s, i) => {
        const state = i < at ? 'done' : i === at ? 'current' : 'ahead';
        return (
          <li key={s.id} className={`vfr-steps__step vfr-steps__step--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="vfr-steps__num" aria-hidden="true">{state === 'done' ? '✓' : i + 1}</span>
            <span className="vfr-steps__text">
              <span className="vfr-steps__title">
                {s.title}
                {state === 'done' && <span className="vfr-sr"> ({t.guideStepDone})</span>}
              </span>
              <span className="vfr-steps__body">{s.body}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
