import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
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

/** Pull the value to check out of a decoded QR payload: keep a URL / EMV-PIX / UPI
 *  payload intact; otherwise extract a crypto address (maybe from an ethereum:/EIP-681 URI). */
function extractScanned(payload: string): string {
  const p = (payload ?? '').trim();
  const keepIntact = /^https?:\/\//i.test(p) || /^upi:\/\//i.test(p) || /^0002\d{2}/.test(p);
  return keepIntact
    ? p
    : (p.match(/0x[a-fA-F0-9]{40}/)?.[0]) ?? p.replace(/^[a-zA-Z][\w+.-]*:/, '').split(/[?@\s]/)[0].trim();
}

export default function VerifyScan({ initialAddress = '' }: { initialAddress?: string }) {
  const [value, setValue] = useState(initialAddress);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [done, setDone] = useState(false);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [safety, setSafety] = useState<Safety>('idle');
  const [isUrl, setIsUrl] = useState(false);
  const [isPaymentQr, setIsPaymentQr] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [scanError, setScanError] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  // Live camera QR scan — opens the webcam on desktop AND the camera on mobile (unlike a
  // file <input capture>, which silently falls back to the file picker on desktop). Runs
  // while cameraOn; tears the stream down on stop/unmount. Ported from WalletChecker.
  useEffect(() => {
    if (!cameraOn) return;
    let cancelled = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const tick = () => {
      if (cancelled) return;
      const video = videoRef.current;
      if (video && ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
          if (code?.data) {
            cancelled = true;
            const scanned = extractScanned(code.data);
            setValue(scanned);
            setCameraOn(false);
            void check(scanned);
            return;
          }
        } catch { /* getImageData can throw mid-teardown; ignore and keep looping */ }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCameraOn(false); };
    window.addEventListener('keydown', onKey);

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setScanError('This browser can’t open the camera. Upload a photo of the QR instead.');
        setCameraOn(false);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
          rafRef.current = requestAnimationFrame(tick);
        }
      } catch (err: any) {
        const name = err?.name;
        setScanError(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'Camera permission was denied. Allow it, or upload a photo of the QR instead.'
            : name === 'NotFoundError'
            ? 'No camera found. Upload a photo of the QR instead.'
            : 'Couldn’t open the camera. Upload a photo of the QR instead.',
        );
        setCameraOn(false);
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn]);

  async function check(override?: string) {
    const q = (override ?? value).trim();
    if (!q) return;
    const url = /^https?:\/\//i.test(q);
    // EMV/PIX TLV or a UPI intent URI — verification is by exact match; there is no
    // phishing/sanctions list for these, so the MATCH is the safety (no extra screen).
    const paymentQr = /^upi:\/\//i.test(q) || /^0002\d{2}/.test(q);
    setIsUrl(url); setIsPaymentQr(paymentQr);
    setBusy(true); setDone(false); setLookup(null); setSafety(paymentQr ? 'idle' : 'checking');
    try {
      // Safety screen: a payment LINK → phishing/site checker; a crypto ADDRESS →
      // scam/sanctions checker; a PIX/UPI QR → none (the match itself is the safety).
      const safetyFetch = paymentQr
        ? Promise.resolve(null)
        : url
          ? fetch(`/api/dapp-check?url=${encodeURIComponent(q)}`).then((r) => r.json()).catch(() => null)
          : fetch('/api/wallet-check', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: q }),
            }).then((r) => r.json()).catch(() => null);
      const [lk, sf] = await Promise.all([
        fetch(`/api/verify/lookup?address=${encodeURIComponent(q)}`).then((r) => r.json()).catch(() => null),
        safetyFetch,
      ]);
      setLookup(
        lk && lk.ok
          ? { verified: !!lk.verified, source: lk.source ?? null, domain: lk.domain ?? null, label: lk.label ?? null }
          : { verified: false, source: null, domain: null, label: null },
      );
      if (paymentQr) {
        setSafety('idle'); // no safety card — the match is the safety
      } else if (url) {
        // dapp-check returns verdict: 'red' | 'yellow' | 'green'
        const v = sf?.verdict;
        setSafety(v === 'red' ? 'danger' : v === 'green' ? 'clean' : v === 'yellow' ? 'unclear' : 'error');
      } else if (sf && sf.ok && sf.result) {
        const lvl = sf.result.scamLevel;
        setSafety(lvl === 'danger' ? 'danger' : lvl === 'caution' ? 'caution' : sf.result.partialCoverage ? 'unclear' : 'clean');
      } else setSafety('error');
    } catch {
      setLookup({ verified: false, source: null, domain: null, label: null });
      setSafety(paymentQr ? 'idle' : 'error');
    } finally {
      setBusy(false); setDone(true);
    }
  }

  // Auto-check when arriving from a QR deep-link (?address=…).
  useEffect(() => {
    if (initialAddress.trim()) void check(initialAddress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Upload a photo/screenshot of the QR (no `capture` — this is the explicit file path).
  function uploadFile() {
    setCameraOn(false);
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setScanning(true); setDone(false); setScanError('');
      try {
        const payload = await decodeQrFromImageFile(file);
        if (!payload) { setScanError('No QR code found in that image. Try another photo, or paste the value.'); return; }
        const scanned = extractScanned(payload);
        setValue(scanned);
        await check(scanned);
      } catch {
        setScanError('Couldn’t read that image. Try another, or paste the value.');
      } finally {
        setScanning(false);
      }
    };
    input.click();
  }

  const who = lookup?.label || lookup?.domain || '';
  const noun = isUrl ? 'link' : isPaymentQr ? 'payment code' : 'address';
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
        <button type="button" className="vs__scan" onClick={() => { setScanError(''); setCameraOn((o) => !o); }}>
          {cameraOn ? '✕ Stop' : '📷 Camera'}
        </button>
        <button type="button" className="vs__scan" onClick={uploadFile} disabled={scanning}>
          {scanning ? 'Reading…' : '📁 Upload'}
        </button>
        <button type="submit" className="vs__btn" disabled={busy || !value.trim()}>{busy ? 'Checking…' : 'Check'}</button>
      </form>

      {cameraOn && (
        <div style={{ marginTop: '0.75rem', textAlign: 'center' }}>
          <video ref={videoRef} playsInline muted
            style={{ width: '100%', maxWidth: '360px', borderRadius: '12px', background: '#000' }} />
          <p className="vs__foot" style={{ marginTop: '0.4rem' }}>Point your camera at the QR — it scans automatically. (Esc to cancel.)</p>
        </div>
      )}
      {scanError && <p className="vs__foot" style={{ color: 'var(--loss)' }}>{scanError}</p>}

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
