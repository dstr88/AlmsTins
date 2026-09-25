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

  const activeStep = !challenge ? 1 : 2;
  const progressTile = (
    <section className="rt-progress rt-tile">
      <h2 className="rt-how__title">{t.progressTitle}</h2>
      <ul className="rt-progress__list">
        {t.progressSteps.map((label, i) => {
          const step = i + 1;
          const active = step === activeStep;
          return (
            <li className={`rt-progress__item${active ? ' rt-progress__item--active' : ''}`} key={label}>
              <span className="rt-progress__num" aria-hidden="true">{String(step).padStart(2, '0')}</span>
              <span className="rt-progress__label">{label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );

  return (
    <div className="rt">
      <div className="rt-tiles">
        {!challenge ? (
          <div className="rt-step1-wrap">
            <div className="rt-step1-glow" aria-hidden="true" />
            <form className="rt-step1" onSubmit={(e) => { e.preventDefault(); void start(); }}>
              <label className="rt-step1__label" htmlFor="rt-domain">{t.stepOneLabel}</label>
              <input id="rt-domain" className="rt-step1__input" value={domain} onChange={(e) => setDomain(e.target.value)}
                placeholder={t.domainPlaceholder} spellCheck={false} autoComplete="url" inputMode="url" />
              <button type="submit" className="rt-step1__btn" disabled={starting || !domain.trim()}>
                {t.getChallengeBtn}
              </button>
              <p className="rt-step1__help">
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 7v4.2M8 4.8v.01" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                <span>{t.lightPathHint}</span>
              </p>
              {outcome && <div className={`rt-outcome ${outcome.ok ? 'rt-outcome--ok' : 'rt-outcome--warn'}`}>{outcome.text}</div>}
            </form>
          </div>
        ) : (
          <div className="rt-editor-wrap">
            <div className="rt-editor-glow" aria-hidden="true" />
            <div className="rt-editor">
              {cacheNote && <p className="rt-cache-note">{cacheNote}</p>}

              <section className="rt-editor__section">
                <label className="rt-editor__label">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
                  {t.addressesTitle}
                </label>
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
                </div>
              </section>

              <section className="rt-editor__section">
                <label className="rt-editor__label">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 17v-6"/><path d="m9 14 3-3 3 3"/></svg>
                  {t.csvImportBtn}
                </label>
                <button type="button" className="rt-csv-btn" onClick={() => fileInput.current?.click()}>
                  <span className="rt-csv-btn__icon">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 17v-6"/><path d="m9 14 3-3 3 3"/></svg>
                  </span>
                  <span>
                    <span className="rt-csv-btn__title">{t.csvImportBtn}</span>
                    <span className="rt-csv-btn__sub">{t.csvImportHint}</span>
                  </span>
                </button>
                <input ref={fileInput} type="file" accept=".csv,text/csv" className="rt-file-input" onChange={onCsvChange} />
                {csvError && <div className="rt-outcome rt-outcome--warn">{t.csvError}</div>}
              </section>

              <section className="rt-editor__encrypt">
                <button className="rt-editor__encrypt-btn" onClick={encryptAndDownload} disabled={encrypting}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  {encrypting ? t.encryptingBtn : t.encryptBtn}
                </button>
                <p className="rt-hint" style={{ textAlign: 'center' }}>{t.downloadHint}</p>
                {encryptError && <div className="rt-outcome rt-outcome--warn">{t.encryptError}</div>}
              </section>

              <div className="rt-dns rt-row">
                <a className="rt-btn rt-btn--primary" href={`/dashboard/verify/dns?domain=${encodeURIComponent(domain.trim())}`}>
                  {t.nextDnsLinkBtn}
                </a>
                <a className="rt-btn" href="/dashboard/verify/roster">{t.addAnotherWebpageLink}</a>
              </div>
            </div>
          </div>
        )}

        {progressTile}
      </div>

      <section className="rt-how-wide">
        <h2 className="rt-how__title">{t.howItWorksTitle}</h2>
        <div className="rt-how-wide__cols">
          {[t.howItWorksItems.slice(0, 2), t.howItWorksItems.slice(2, 4)].map((col, ci) => (
            <ul className="rt-how__list" key={ci}>
              {col.map((item, ii) => (
                <li className="rt-how__item" key={item.title}>
                  <span className="rt-how__num" aria-hidden="true">{String(ci * 2 + ii + 1).padStart(2, '0')}</span>
                  <div>
                    <p className="rt-how__item-title">{item.title}</p>
                    <p className="rt-how__item-desc">{item.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </section>
    </div>
  );
}
