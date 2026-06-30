import { useEffect, useState } from 'react';
import { decodeQrFromImageFile } from '../../lib/qrScan';
import './VerifyScan.css';

/**
 * Public customer-scan. A customer scans (or pastes) the address from a merchant's
 * sign/QR and gets two independent answers, no account required:
 *  1. Verification — is this a PROVEN Almstins destination? (entity domain or a
 *     merchant's self-listed label, via /api/verify/lookup)
 *  2. Safety — is the address itself flagged? (scam/OFAC/honeypot, via /api/wallet-check)
 * Read-only: the scanned value is checked, never stored.
 */
type Lookup = { verified: boolean; source: 'entity' | 'merchant' | null; domain: string | null; label: string | null };
type Safety = 'idle' | 'checking' | 'clean' | 'caution' | 'danger' | 'unclear' | 'error';

export default function VerifyScan({ initialAddress = '' }: { initialAddress?: string }) {
  const [value, setValue] = useState(initialAddress);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [done, setDone] = useState(false);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [safety, setSafety] = useState<Safety>('idle');
  const [isUrl, setIsUrl] = useState(false);

  async function check(override?: string) {
    const q = (override ?? value).trim();
    if (!q) return;
    const url = /^https?:\/\//i.test(q);
    setIsUrl(url);
    setBusy(true); setDone(false); setLookup(null); setSafety('checking');
    try {
      // Safety screen depends on the input: a payment LINK goes to the phishing/site
      // checker (dapp-check), a crypto ADDRESS goes to the scam/sanctions checker.
      const [lk, sf] = await Promise.all([
        fetch(`/api/verify/lookup?address=${encodeURIComponent(q)}`).then((r) => r.json()).catch(() => null),
        url
          ? fetch(`/api/dapp-check?url=${encodeURIComponent(q)}`).then((r) => r.json()).catch(() => null)
          : fetch('/api/wallet-check', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: q }),
            }).then((r) => r.json()).catch(() => null),
      ]);
      setLookup(
        lk && lk.ok
          ? { verified: !!lk.verified, source: lk.source ?? null, domain: lk.domain ?? null, label: lk.label ?? null }
          : { verified: false, source: null, domain: null, label: null },
      );
      if (url) {
        // dapp-check returns verdict: 'red' | 'yellow' | 'green'
        const v = sf?.verdict;
        setSafety(v === 'red' ? 'danger' : v === 'green' ? 'clean' : v === 'yellow' ? 'unclear' : 'error');
      } else if (sf && sf.ok && sf.result) {
        const lvl = sf.result.scamLevel;
        setSafety(lvl === 'danger' ? 'danger' : lvl === 'caution' ? 'caution' : sf.result.partialCoverage ? 'unclear' : 'clean');
      } else setSafety('error');
    } catch {
      setLookup({ verified: false, source: null, domain: null, label: null });
      setSafety('error');
    } finally {
      setBusy(false); setDone(true);
    }
  }

  // Auto-check when arriving from a QR deep-link (?address=…).
  useEffect(() => {
    if (initialAddress.trim()) void check(initialAddress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function scan() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment');
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setScanning(true); setDone(false);
      try {
        const payload = await decodeQrFromImageFile(file);
        if (!payload) { setSafety('error'); setLookup(null); setDone(true); return; }
        // A QR is either a payment LINK (Stripe/checkout — keep it intact) or encodes a
        // crypto address (possibly inside an ethereum:/EIP-681 URI — pull it out).
        const scanned = /^https?:\/\//i.test(payload.trim())
          ? payload.trim()
          : (payload.match(/0x[a-fA-F0-9]{40}/)?.[0]) ?? payload.replace(/^[a-zA-Z][\w+.-]*:/, '').split(/[?@\s]/)[0].trim();
        setValue(scanned);
        await check(scanned);
      } catch {
        setSafety('error'); setDone(true);
      } finally {
        setScanning(false);
      }
    };
    input.click();
  }

  const who = lookup?.label || lookup?.domain || '';
  const noun = isUrl ? 'link' : 'address';
  const safetyText: Record<Safety, string> = {
    idle: '', checking: 'Checking…',
    clean: isUrl ? 'No phishing or scam-site flags.' : 'No scam, sanctions, or honeypot flags.',
    caution: `Caution — this ${noun} has risk flags. Double-check before paying.`,
    danger: `Danger — this ${noun} is flagged. Do not pay.`,
    unclear: `Not enough data to clear this ${noun}. Proceed carefully.`,
    error: "Couldn't run the safety check — try again.",
  };

  return (
    <main className="vs">
      <h1 className="vs__title">Verify before you pay</h1>
      <p className="vs__sub">Scan or paste the address from a sign, QR, or checkout. We confirm whether it’s a verified Almstins destination and screen it for scams — no account needed.</p>

      <form className="vs__row" onSubmit={(e) => { e.preventDefault(); void check(); }}>
        <input className="vs__input" value={value} onChange={(e) => setValue(e.target.value)}
          placeholder="Paste an address or payment link" spellCheck={false} autoComplete="off" />
        <button type="button" className="vs__scan" onClick={scan} disabled={scanning}>{scanning ? 'Scanning…' : '📷 Scan'}</button>
        <button type="submit" className="vs__btn" disabled={busy || !value.trim()}>{busy ? 'Checking…' : 'Check'}</button>
      </form>

      {done && lookup && (
        <div className={`vs__card ${lookup.verified ? 'vs__card--ok' : 'vs__card--warn'}`}>
          <div className="vs__verdict">{lookup.verified ? '✓ Verified destination' : '⚠ Not a verified destination'}</div>
          <p className="vs__detail">
            {lookup.verified
              ? (who
                  ? `Registered to ${who}${lookup.source === 'entity' ? ' (published on its domain)' : lookup.domain ? ` · verified via ${lookup.domain}` : ''}.`
                  : 'A proven Almstins destination.')
              : `No account has proven control of this ${noun} with Almstins. That doesn’t mean it’s unsafe — only that it isn’t verified here.`}
          </p>
        </div>
      )}

      {done && safety !== 'idle' && (
        <div className={`vs__card ${safety === 'clean' ? 'vs__card--ok' : safety === 'danger' ? 'vs__card--err' : 'vs__card--warn'}`}>
          <div className="vs__verdict">Safety screen</div>
          <p className="vs__detail">{safetyText[safety]}</p>
        </div>
      )}

      <p className="vs__foot">This confirms whether an address is a verified destination and screens it for known scams. It is not financial advice — always confirm the recipient yourself.</p>
    </main>
  );
}
