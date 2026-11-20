import { useState } from 'react';
import type { VerifyDashboardLocale } from '../../i18n/dashboard/verify';
import { CHAINS, VERIFY_ADDRESS_RAILS } from '@/lib/chains';
import { fillTemplate } from '@/lib/verifyPublicCard';
import {
  choicesFor, readDestinationInput, registrationFor,
  type DestinationInput, type InputChoice, type VerifyRail,
} from '@/lib/verifyDestinationInput';
import { registerDestination } from '@/lib/verifyRegister';
import { FirstRunSteps } from './FirstRunSteps';
import './VerifyFirstRun.css';

/**
 * The first-run screen of the Verify dashboard (Verify first run, Part C): the three steps, then
 * one card with one sentence, one field and one button. src/lib/verifyFirstRun.ts decides who
 * sees it; nothing else of the dashboard renders beside it.
 *
 * The one field takes a wallet address, a payment link or the text of a payment QR.
 * src/lib/verifyDestinationInput.ts reads what was pasted, and the card says what it read. A
 * select appears only when the field cannot settle it (a 0x address fits three networks). The
 * registration is the dashboard's own (src/lib/verifyRegister.ts), with the same refusals.
 *
 * Presentation only: the words are the dashboard locale's, the look is VerifyFirstRun.css, and
 * the button and the refusal line reuse the dashboard's own classes (VerifyDashboard.css).
 */

const chainName = (rail: VerifyRail): string => CHAINS[rail].name;

/** The sentence under the field that says what the card read in it; null while it is empty. */
export function inputReadout(input: DestinationInput, t: VerifyDashboardLocale): string | null {
  switch (input.kind) {
    case 'empty': return null;
    case 'qr': return input.what === 'link' ? t.firstReadLink : t.firstReadCode;
    case 'address':
      return input.rails.length === 1
        ? fillTemplate(t.firstReadAddress, { chain: chainName(input.rails[0]) })
        : t.firstReadNetworks;
    case 'unknown': return t.firstReadUnknown;
  }
}

export function FirstRunCard({ t, limitText, onRegistered }: {
  t: VerifyDashboardLocale;
  /** The plan-limit sentence for a kind (the dashboard words it for the account's plan). */
  limitText: (kind: 'address' | 'qr') => string;
  /** The destination the server stored, as POST /api/verify/destinations returned it. */
  onRegistered: (destination: unknown) => void;
}) {
  const [value, setValue] = useState('');
  const [choice, setChoice] = useState<InputChoice>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const input = readDestinationInput(value);
  const choices = choicesFor(input);
  const registration = registrationFor(input, choice);
  const readout = inputReadout(input, t);
  // An address whose network is open lists networks by name; an unrecognized value says what
  // each choice would register it as.
  const optionLabel = (c: InputChoice): string =>
    c === 'qr' ? t.firstOptionQr
    : c === '' ? ''
    : input.kind === 'unknown' ? fillTemplate(t.firstOptionAddress, { chain: chainName(c) })
    : chainName(c);
  const choosePrompt = input.kind === 'unknown' ? t.firstChooseKind : t.firstChooseNetwork;

  async function submit() {
    if (!registration || busy) return;
    setBusy(true); setErr(null);
    const res = await registerDestination(registration, t, limitText(registration.kind));
    setBusy(false);
    if (res.ok) onRegistered(res.destination);
    else setErr(res.text);
  }

  return (
    <section className="vfr-card" aria-labelledby="vfr-card-title">
      <h1 id="vfr-card-title" className="vfr-card__title">{t.firstCardTitle}</h1>
      <form className="vfr-card__form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="vfr-sr" htmlFor="vfr-card-value">{t.firstFieldLabel}</label>
        <div className="vfr-card__row">
          <input
            id="vfr-card-value"
            className="vfr-card__value"
            value={value}
            onChange={(e) => { setValue(e.target.value); setChoice(''); setErr(null); }}
            placeholder={t.firstFieldPlaceholder}
            aria-describedby="vfr-card-help"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
          />
          <button className="vd-add__btn vfr-card__btn" type="submit" disabled={busy || !registration}>
            {busy ? t.addingBtn : t.registerBtn}
          </button>
        </div>
        {readout && (
          <div className="vfr-card__read">
            <p className="vfr-card__readout" role="status">{readout}</p>
            {choices.length > 0 && (
              <select
                className="vfr-card__choice"
                value={choice}
                onChange={(e) => setChoice(e.target.value as InputChoice)}
                aria-label={choosePrompt}
              >
                <option value="" disabled>{choosePrompt}</option>
                {choices.map((c) => <option key={c} value={c}>{optionLabel(c)}</option>)}
              </select>
            )}
          </div>
        )}
        {err && <p className="vd-add__err vfr-card__err" role="alert">{err}</p>}
      </form>
      <p id="vfr-card-help" className="vfr-card__help">
        {fillTemplate(t.firstFieldHelp, { chains: VERIFY_ADDRESS_RAILS.map(chainName).join(', ') })}
      </p>
      <p className="vfr-card__note">{t.firstNote}</p>
    </section>
  );
}

/** The whole first-run screen: the product's name, the three steps, the card. */
export function VerifyFirstRun({ t, limitText, onRegistered }: {
  t: VerifyDashboardLocale;
  limitText: (kind: 'address' | 'qr') => string;
  onRegistered: (destination: unknown) => void;
}) {
  return (
    <div className="vfr">
      <p className="vfr__kicker">{t.heroKicker}</p>
      <FirstRunSteps t={t} current="register" />
      <FirstRunCard t={t} limitText={limitText} onRegistered={onRegistered} />
    </div>
  );
}
