import { useState, useEffect } from 'react';
import type { VerifyRosterLocale } from '@/i18n/dashboard/verifyRoster';
import './RosterEditor.css';

export default function RosterDns({ t }: { t: VerifyRosterLocale }) {
  const [domain, setDomain] = useState('');
  const [checking, setChecking] = useState(false);
  const [outcome, setOutcome] = useState<{ text: string; ok: boolean } | null>(null);

  // Arriving from the roster page's "Next: point your DNS" link carries the domain
  // already typed there. Editable anyway (not read-only) so this page also works for
  // anyone who lands here directly to re-check a domain they set up earlier.
  useEffect(() => {
    const fromQuery = new URLSearchParams(window.location.search).get('domain');
    if (fromQuery) setDomain(fromQuery);
  }, []);

  const outcomeString = (code: string): string => ({
    proven: t.outcomeProven,
    address_not_listed: t.outcomeNotListed,
    unreachable: t.outcomeUnreachable,
    malformed: t.outcomeMalformed,
    challenge_mismatch: t.outcomeChallengeMismatch,
    invalid_domain: t.outcomeInvalidDomain,
    no_pointer: t.outcomeUnreachable,
    not_configured: t.outcomeUnreachable,
    decrypt_failed: t.outcomeMalformed,
  } as Record<string, string>)[code] ?? t.outcomeUnreachable;

  async function checkNow() {
    const dom = domain.trim();
    if (!dom) return;
    setChecking(true); setOutcome(null);
    try {
      const res = await fetch('/api/verify/roster/check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain: dom }),
      });
      const data = await res.json();
      setOutcome({ text: outcomeString(data.outcome), ok: data.outcome === 'proven' });
    } catch {
      setOutcome({ text: t.outcomeUnreachable, ok: false });
    } finally { setChecking(false); }
  }

  const dnsRecord = `_almstins-verify.${domain.trim() || 'yourdomain.com'}`;

  return (
    <div className="rt">
      <div className="rt-start">
        <label className="rt-label" htmlFor="rt-domain">{t.domainLabel}</label>
        <div className="rt-row">
          <input id="rt-domain" className="rt-input" value={domain} onChange={(e) => setDomain(e.target.value)}
            placeholder={t.domainPlaceholder} spellCheck={false} autoComplete="off"
            onKeyDown={(e) => { if (e.key === 'Enter') void checkNow(); }} />
        </div>
      </div>

      <div className="rt-dns">
        <h3 className="rt-section-title rt-section-title--sm">{t.dnsStepTitle}</h3>
        <p className="rt-hint">{t.dnsStepBody.replace('{record}', '')}<code className="rt-code">{dnsRecord}</code></p>
        <p className="rt-hint">{t.dnsStepValue}</p>
      </div>

      <div className="rt-row" style={{ marginTop: '0.75rem' }}>
        <button className="rt-btn rt-btn--primary" onClick={checkNow} disabled={checking || !domain.trim()}>
          {checking ? t.checkingBtn : t.checkNowBtn}
        </button>
      </div>
      {outcome && <div className={`rt-outcome ${outcome.ok ? 'rt-outcome--ok' : 'rt-outcome--warn'}`}>{outcome.text}</div>}

      <div className="rt-dns rt-row">
        <a className="rt-btn" href="/dashboard/verify/roster">{t.addAnotherWebpageLink}</a>
      </div>
    </div>
  );
}
