import { useEffect, useRef, useState } from 'react';
import { decodeQrFromImageData, decodeQrFromImageFile } from '../../lib/qrScan';
import { publicVerifyCard, safetyFlagged } from '../../lib/verifyPublicCard';
import { runScanCheck, scanValueKind, type ScanLookup, type ScanSafety } from '../../lib/verifyScanCheck';
import { verifyScanCopy, type ScanLang, type ScanNoun } from '../../i18n/verifyScan';
import { ScanVerifyCard, SafetyCard, safetySentence } from './ScanResultCards';
import './VerifyScan.css';
import { findEvmAddress } from '@/lib/addressFormats';

/**
 * Public customer-scan. A customer scans (or pastes) the address from a merchant's
 * sign/QR and gets two independent answers, no account required:
 *  1. Verification — is this a PROVEN Almstins destination? (via /api/verify/lookup;
 *     src/lib/verifyPublicCard.ts decides what the card may say: never a freeform label,
 *     no name at all on a Claimed result)
 *  2. Safety — is the address itself flagged? (scam/OFAC/honeypot, via /api/wallet-check)
 * When the safety screen flags the value, the warning leads and the Verify fact follows
 * in a neutral style. Read-only: the scanned value is checked, never stored.
 *
 * The check itself is src/lib/verifyScanCheck.ts and the two result cards are
 * ./ScanResultCards.tsx, shared with the public Verify page's "see what a payer sees" field.
 */
// The result cards moved to ./ScanResultCards.tsx; they are still exported from here.
export { ScanVerifyCard, SafetyCard };

/** Pull the value to check out of a decoded QR payload: keep a URL / EMV-PIX / UPI
 *  payload intact; otherwise extract a crypto address (maybe from an ethereum:/EIP-681 URI). */
function extractScanned(payload: string): string {
  const p = (payload ?? '').trim();
  const keepIntact = /^https?:\/\//i.test(p) || /^upi:\/\//i.test(p) || /^0002\d{2}/.test(p);
  return keepIntact
    ? p
    : findEvmAddress(p) ?? p.replace(/^[a-zA-Z][\w+.-]*:/, '').split(/[?@\s]/)[0].trim();
}

export default function VerifyScan({ initialAddress = '', lang = 'en' }: { initialAddress?: string; lang?: ScanLang }) {
  const t = verifyScanCopy[lang] ?? verifyScanCopy.en;
  const [value, setValue] = useState(initialAddress);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [done, setDone] = useState(false);
  const [lookup, setLookup] = useState<ScanLookup | null>(null);
  const [safety, setSafety] = useState<ScanSafety>('idle');
  // True when GoPlus answered for the safety screen (credited under the card; see lib/goplusCredit.ts).
  const [goplus, setGoplus] = useState(false);
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
          const payload = decodeQrFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
          if (payload) {
            cancelled = true;
            const scanned = extractScanned(payload);
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
    const kind = scanValueKind(q);
    setIsUrl(kind.isUrl); setIsPaymentQr(kind.isPaymentQr);
    setBusy(true); setDone(false); setLookup(null); setSafety(kind.isPaymentQr ? 'idle' : 'checking'); setGoplus(false);
    // The one check (src/lib/verifyScanCheck.ts): the Verify lookup and the safety screen.
    const res = await runScanCheck(q);
    setLookup(res.lookup); setSafety(res.safety); setGoplus(res.goplus);
    setBusy(false); setDone(true);
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

  const noun: ScanNoun = isUrl ? 'link' : isPaymentQr ? 'code' : 'address';
  // What the Verify card may say, and whether the safety warning leads (it does when flagged).
  const card = done && lookup ? publicVerifyCard(lookup, safety) : null;

  const verifyCard = done && lookup ? <ScanVerifyCard card={card} noun={noun} t={t} /> : null;

  const safetyCard = done && safety !== 'idle' ? (
    <SafetyCard safety={safety} text={safetySentence(safety, noun, t)} isUrl={isUrl} goplus={goplus} t={t} />
  ) : null;
  // A flagged safety verdict always leads, whatever the Verify result.
  const safetyLeads = done && safetyFlagged(safety);

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

      {safetyLeads ? <>{safetyCard}{verifyCard}</> : <>{verifyCard}{safetyCard}</>}

      <p className="vs__foot">This confirms whether an address is a verified destination and screens it for known scams. It is not financial advice — always confirm the recipient yourself.</p>
    </main>
  );
}
