import { useState, useRef, useEffect, type ChangeEvent, type ClipboardEvent } from 'react';
import { encryptRosterPayload } from '@/lib/verifyEncryption';
import type { VerifyRosterLocale } from '@/i18n/dashboard/verifyRoster';
import './RosterEditor.css';

interface Row { id: string; address: string; label: string }

let rowSeq = 0;
const newRow = (address = '', label = ''): Row => ({ id: `r${++rowSeq}`, address, label });

/** Very simple CSV: comma-split, tolerant header detection, no quoted-field escaping
 *  (addresses/labels aren't expected to contain literal commas — a real limit, not
 *  a silent one). Falls back to column position (address, then label) with no header. */
function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  let addrCol = 0;
  let labelCol: number | null = 1;
  const first = lines[0].split(',').map((c) => c.trim().toLowerCase());
  const looksLikeHeader = first.some((c) => /^(address|wallet|addr)/.test(c));
  let dataLines = lines;
  if (looksLikeHeader) {
    dataLines = lines.slice(1);
    const addrIdx = first.findIndex((c) => /^(address|wallet|addr)/.test(c));
    const labelIdx = first.findIndex((c) => /^(label|name)/.test(c));
    if (addrIdx >= 0) addrCol = addrIdx;
    labelCol = labelIdx >= 0 ? labelIdx : null;
  }
  return dataLines
    .map((line) => line.split(',').map((c) => c.trim()))
    .filter((cells) => cells[addrCol])
    .map((cells) => newRow(cells[addrCol], labelCol != null ? (cells[labelCol] ?? '') : ''));
}

function download(filename: string, contents: string) {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function RosterEditor({ t }: { t: VerifyRosterLocale }) {
  const [domain, setDomain] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [csvError, setCsvError] = useState(false);
  const [encrypting, setEncrypting] = useState(false);
  const [encryptError, setEncryptError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [outcome, setOutcome] = useState<{ text: string; ok: boolean } | null>(null);
  const [cacheNote, setCacheNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Arriving from the dashboard's "publish a roster instead" link carries the domain
  // already typed there — issuing a challenge is idempotent (same one comes back if
  // it already exists), so starting automatically here just saves a redundant click.
  // Runs once, on the query param specifically — NOT tied to the domain input's own
  // state, which changes on every keystroke while someone types it in manually.
  useEffect(() => {
    const fromQuery = new URLSearchParams(window.location.search).get('domain');
    if (fromQuery) { setDomain(fromQuery); void start(fromQuery); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function start(domainOverride?: string) {
    const dom = (domainOverride ?? domain).trim();
    if (!dom) return;
    setStarting(true); setOutcome(null);
    try {
      const res = await fetch('/api/verify/roster/challenge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain: dom }),
      });
      const data = await res.json();
      if (!data.ok || !data.challenge) { setOutcome({ text: t.outcomeInvalidDomain, ok: false }); return; }
      setChallenge(data.challenge);

      const cacheRes = await fetch(`/api/verify/roster?domain=${encodeURIComponent(dom)}`);
      const cacheData = await cacheRes.json().catch(() => null);
      if (cacheData?.cached?.addresses?.length) {
        setRows(cacheData.cached.addresses.map((e: { address: string; label: string | null }) => newRow(e.address, e.label ?? '')));
        setCacheNote(t.loadedFromCache.replace('{time}', new Date(cacheData.cached.cachedAt).toLocaleString()));
      }
    } catch {
      setOutcome({ text: t.outcomeInvalidDomain, ok: false });
    } finally { setStarting(false); }
  }

  function updateRow(id: string, field: 'address' | 'label', value: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  // Paste replaces the whole field, regardless of cursor position — an address field
  // only ever holds one value, so inserting at the cursor (the browser's default)
  // is never the right behavior here.
  function onAddressPaste(e: ClipboardEvent<HTMLInputElement>, id: string) {
    e.preventDefault();
    updateRow(id, 'address', e.clipboardData.getData('text').trim());
  }

  function onCsvChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError(false);
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result ?? ''));
      if (!parsed.length) { setCsvError(true); return; }
      setRows((rs) => [...rs.filter((r) => r.address.trim() || r.label.trim()), ...parsed]);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function encryptAndDownload() {
    if (!challenge) return;
    const cleaned = rows.filter((r) => r.address.trim());
    setEncrypting(true); setEncryptError(false);
    try {
      const keyRes = await fetch('/.well-known/almstins-verify-encryption-key.json');
      const keyData = await keyRes.json();
      const jwk = keyData?.keys?.[0]?.jwk;
      if (!jwk) { setEncryptError(true); return; }

      const payload = JSON.stringify({
        almstins: {
          version: 1,
          challenge,
          addresses: cleaned.map((r) => ({ address: r.address.trim(), label: r.label.trim() || null })),
        },
      });
      const envelope = await encryptRosterPayload(payload, jwk);
      download('almstins-roster.enc.json', JSON.stringify(envelope));
      setRows(cleaned.length ? cleaned : [newRow()]); // empty rows are swept out now, at save time
    } catch {
      setEncryptError(true);
    } finally { setEncrypting(false); }
  }

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
      {!challenge ? (
        <div className="rt-start">
          <label className="rt-label" htmlFor="rt-domain">{t.domainLabel}</label>
          <div className="rt-row">
            <input id="rt-domain" className="rt-input" value={domain} onChange={(e) => setDomain(e.target.value)}
              placeholder={t.domainPlaceholder} spellCheck={false} autoComplete="off"
              onKeyDown={(e) => { if (e.key === 'Enter') void start(); }} />
            <button className="rt-btn rt-btn--primary" onClick={() => void start()} disabled={starting || !domain.trim()}>
              {t.getChallengeBtn}
            </button>
          </div>
          {outcome && <div className={`rt-outcome ${outcome.ok ? 'rt-outcome--ok' : 'rt-outcome--warn'}`}>{outcome.text}</div>}
        </div>
      ) : (
        <>
          {cacheNote && <p className="rt-cache-note">{cacheNote}</p>}

          <h2 className="rt-section-title">{t.addressesTitle}</h2>
          <div className="rt-rows">
            {rows.map((r) => (
              <div className="rt-editrow" key={r.id}>
                <input className="rt-input rt-input--addr" value={r.address}
                  onChange={(e) => updateRow(r.id, 'address', e.target.value)}
                  onPaste={(e) => onAddressPaste(e, r.id)}
                  placeholder={t.addressPlaceholder} spellCheck={false} autoComplete="off" />
                <input className="rt-input rt-input--label" value={r.label}
                  onChange={(e) => updateRow(r.id, 'label', e.target.value)}
                  placeholder={t.labelPlaceholder} spellCheck={false} autoComplete="off" />
                <button type="button" className="rt-row-del" aria-label={t.removeRowAria}
                  onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}>✕</button>
              </div>
            ))}
          </div>

          <div className="rt-row">
            <button type="button" className="rt-btn" onClick={() => setRows((rs) => [...rs, newRow()])}>{t.addRowBtn}</button>
            <button type="button" className="rt-btn" onClick={() => fileInput.current?.click()}>{t.csvImportBtn}</button>
            <input ref={fileInput} type="file" accept=".csv,text/csv" className="rt-file-input" onChange={onCsvChange} />
          </div>
          <p className="rt-hint">{t.csvImportHint}</p>
          {csvError && <div className="rt-outcome rt-outcome--warn">{t.csvError}</div>}

          <div className="rt-row" style={{ marginTop: '0.75rem' }}>
            <button className="rt-btn rt-btn--primary" onClick={encryptAndDownload} disabled={encrypting}>
              {encrypting ? t.encryptingBtn : t.encryptBtn}
            </button>
          </div>
          <p className="rt-hint">{t.downloadHint}</p>
          {encryptError && <div className="rt-outcome rt-outcome--warn">{t.encryptError}</div>}

          <div className="rt-dns">
            <h3 className="rt-section-title rt-section-title--sm">{t.dnsStepTitle}</h3>
            <p className="rt-hint">{t.dnsStepBody.replace('{record}', '')}<code className="rt-code">{dnsRecord}</code></p>
            <p className="rt-hint">{t.dnsStepValue}</p>
          </div>

          <div className="rt-row" style={{ marginTop: '0.75rem' }}>
            <button className="rt-btn rt-btn--primary" onClick={checkNow} disabled={checking}>
              {checking ? t.checkingBtn : t.checkNowBtn}
            </button>
          </div>
          {outcome && <div className={`rt-outcome ${outcome.ok ? 'rt-outcome--ok' : 'rt-outcome--warn'}`}>{outcome.text}</div>}
        </>
      )}
    </div>
  );
}
