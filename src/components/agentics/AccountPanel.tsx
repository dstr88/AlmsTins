/**
 * The account page's body: who is signed in, the plan, and deleting the account. Deleting asks once more
 * in place (the same ConfirmRemove the rest of Agentics uses, so focus is kept), then calls the app's
 * one delete-account request (POST /api/account/delete). On success the browser leaves for the Agentics
 * page; otherwise it says what is known, in plain words, and never says "not deleted" for a request that
 * may have finished (a dropped connection, a host error, a wait that ran out).
 *
 * The email comes from the signed-in session on the server and is rendered as text by React.
 */
import { useState } from 'react';
import { deleteOutcome, withWait } from './account';
import { send } from './client';
import { copy } from './copy';
import { AFTER_DELETE_PATH } from './paths';
import { ConfirmRemove, Status } from './ui';

export interface AccountPanelProps {
  /** The address the person signed in with, or null when the sign-in has none. */
  email: string | null;
  /** The plan the account is on. */
  plan?: 'free' | 'unlimited';
}

export default function AccountPanel({ email, plan = 'free' }: AccountPanelProps) {
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function deleteAccount() {
    if (working) return;
    setWorking(true);
    setMessage(null);
    const outcome = deleteOutcome(await withWait(send('POST', '/api/account/delete')));
    if (outcome.kind === 'deleted') {
      window.location.assign(AFTER_DELETE_PATH);
      return;
    }
    setMessage(outcome.text);
    setWorking(false);
  }

  return (
    <div className="ag-page">
      <header className="ag-hero">
        <p className="ag-kicker">{copy.account.kicker}</p>
        <h1 className="ag-title">{copy.account.title}</h1>
        <p className="ag-sub">{copy.account.lede}</p>
      </header>

      <section className="ag-card" aria-labelledby="ag-account-h">
        <div className="ag-card__head">
          <h2 className="ag-card__title" id="ag-account-h">
            {copy.account.emailLabel}
          </h2>
        </div>
        <p className="ag-hint">{email ?? copy.account.noEmail}</p>
        <p className="ag-hint">
          {copy.account.planLabel}: {plan === 'unlimited' ? copy.account.planUnlimited : copy.account.plan}
        </p>
      </section>

      <section className="ag-card" aria-labelledby="ag-delete-h">
        <div className="ag-card__head">
          <h2 className="ag-card__title" id="ag-delete-h">
            {copy.account.deleteTitle}
          </h2>
        </div>
        {copy.account.deleteLede.map((p) => (
          <p className="ag-hint" key={p}>
            {p}
          </p>
        ))}
        <div className="ag-form">
          <ConfirmRemove
            label={copy.account.deleteButton}
            question={copy.account.deleteQuestion}
            yes={copy.account.deleteYes}
            yesWorking={copy.account.deleteWorking}
            keep={copy.account.deleteKeep}
            working={working}
            onConfirm={() => void deleteAccount()}
          />
        </div>
        <Status kind="bad">{message}</Status>
      </section>
    </div>
  );
}
