import { useState, useCallback } from 'react';
import { verifyBundle, type VerifyOutcome, type PublishedKey } from '@/lib/recordProof/verify';
import type { ProofBundle } from '@/lib/recordProof/buildProof';
import './VerifyRecord.css';

const WELL_KNOWN = '/.well-known/almstins-signing-key.json';

type State =
  | { s: 'idle' }
  | { s: 'verifying' }
  | { s: 'done'; bundle: ProofBundle; outcome: VerifyOutcome; keySource: string }
  | { s: 'error'; message: string };

const VERDICT_COPY: Record<VerifyOutcome['verdict'], { icon: string; title: string; cls: string }> = {
  verified:     { icon: '✅', title: 'Genuine, unaltered Almstins record', cls: 'ok' },
  unverifiable: { icon: '⚠️', title: 'Intact, but origin not confirmed',    cls: 'warn' },
  tampered:     { icon: '❌', title: 'Does not verify — altered or corrupt', cls: 'err' },
};

const CODE_DETAIL: Record<VerifyOutcome['code'], string> = {
  ok: 'The Merkle root matches these entries and the signature is valid against the published Almstins key.',
  root_mismatch: 'The entries do not hash to the recorded Merkle root — at least one line was changed.',
  leaf_count_mismatch: 'The number of entries does not match the manifest.',
  bad_signature: 'The signature does not match the manifest under the published key.',
  unknown_key: 'Signed, but with a key id not in the published key list (provide the key, or it may be rotated/forged).',
  unsigned: 'No signature present — integrity holds, but origin cannot be attested.',
  malformed: 'This file is not a valid Almstins proof bundle.',
};

export default function VerifyRecord() {
  const [state, setState] = useState<State>({ s: 'idle' });
  const [pastedKey, setPastedKey] = useState('');

  const run = useCallback(async (text: string) => {
    setState({ s: 'verifying' });
    let bundle: ProofBundle;
    try {
      bundle = JSON.parse(text);
    } catch {
      setState({ s: 'error', message: 'That file is not valid JSON.' });
      return;
    }
    // Resolve published keys: a pasted key (full offline trust) wins; else fetch the well-known list.
    let keys: PublishedKey[] = [];
    let keySource = 'published key (almstins.com/.well-known)';
    const pk = pastedKey.trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(pk) && bundle?.signature?.key_id) {
      keys = [{ key_id: bundle.signature.key_id, public_key_hex: pk }];
      keySource = 'the public key you pasted';
    } else {
      try {
        const res = await fetch(WELL_KNOWN, { cache: 'no-store' });
        const data = await res.json();
        if (Array.isArray(data?.keys)) keys = data.keys.map((k: { key_id: string; public_key_hex: string }) => ({ key_id: k.key_id, public_key_hex: k.public_key_hex }));
      } catch { /* offline / unreachable — verify will report unknown_key */ }
    }
    try {
      const outcome = verifyBundle(bundle, keys);
      setState({ s: 'done', bundle, outcome, keySource });
    } catch {
      setState({ s: 'error', message: 'Could not verify this file.' });
    }
  }, [pastedKey]);

  const onFile = useCallback((file: File | undefined) => {
    if (!file) return;
    file.text().then(run).catch(() => setState({ s: 'error', message: 'Could not read that file.' }));
  }, [run]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    onFile(e.dataTransfer.files?.[0]);
  }, [onFile]);

  return (
    <div className="vr">
      <header className="vr__head">
        <h1 className="vr__title">Verify an Almstins record</h1>
        <p className="vr__sub">
          Upload the proof bundle (<code>almstins-&lt;year&gt;-proof.json</code>) from a Year-Summary. It is checked
          <strong> in your browser</strong> — no account, and you do not have to trust this site.
        </p>
      </header>

      <label
        className="vr__drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <input type="file" accept=".json,application/json" hidden
          onChange={(e) => onFile(e.target.files?.[0] ?? undefined)} />
        <span className="vr__drop-icon" aria-hidden="true">📄</span>
        <span className="vr__drop-text">Drop a <code>proof.json</code> here, or click to choose</span>
      </label>

      <details className="vr__adv">
        <summary>Advanced — verify against a key you paste (full offline trust)</summary>
        <input className="vr__key-input" placeholder="Almstins public key (64 hex chars)" spellCheck={false}
          value={pastedKey} onChange={(e) => setPastedKey(e.target.value)} />
        <p className="vr__hint">Leave blank to fetch the key from almstins.com/.well-known. For zero trust in this site, run the standalone offline verifier instead.</p>
      </details>

      {state.s === 'verifying' && <div className="vr__pending">Verifying…</div>}
      {state.s === 'error' && <div className="vr__result vr__result--err"><strong>{state.message}</strong></div>}

      {state.s === 'done' && <Result bundle={state.bundle} outcome={state.outcome} keySource={state.keySource} />}
    </div>
  );
}

function Result({ bundle, outcome, keySource }: { bundle: ProofBundle; outcome: VerifyOutcome; keySource: string }) {
  const v = VERDICT_COPY[outcome.verdict];
  const m = bundle.manifest;
  const [showCommit, setShowCommit] = useState(false);
  return (
    <div className="vr__out">
      <div className={`vr__result vr__result--${v.cls}`}>
        <span className="vr__result-icon" aria-hidden="true">{v.icon}</span>
        <div>
          <div className="vr__result-title">{v.title}</div>
          <div className="vr__result-detail">{CODE_DETAIL[outcome.code]}</div>
        </div>
      </div>

      <dl className="vr__facts">
        <div><dt>Period</dt><dd>{m.period} {m.record_type === 'year_summary' ? 'Year Summary' : m.record_type}</dd></div>
        <div><dt>Generated</dt><dd>{m.generated_at}</dd></div>
        <div><dt>Entries committed</dt><dd>{m.leaf_count} (short {m.counts.short_term} · long {m.counts.long_term} · income {m.counts.income} · held {m.counts.held} · review {m.counts.unsettled})</dd></div>
        <div><dt>Merkle root</dt><dd className="vr__mono">{m.merkle_root}</dd></div>
        <div><dt>Signed by</dt><dd>{bundle.signature ? `Almstins key ${bundle.signature.key_id}` : 'Unsigned'}</dd></div>
        <div><dt>Checked against</dt><dd>{keySource}</dd></div>
        {m.prev_root && <div><dt>Prior record</dt><dd className="vr__mono">{m.prev_root}</dd></div>}
      </dl>

      <button className="vr__toggle" onClick={() => setShowCommit((x) => !x)}>
        {showCommit ? 'Hide' : 'Show'} the {bundle.leaf_hashes.length} entry commitments (hashes only)
      </button>
      {showCommit && (
        <ul className="vr__commit">
          {bundle.leaf_hashes.map((h, i) => <li key={i} className="vr__mono">{h}</li>)}
        </ul>
      )}

      <p className="vr__disclaimer">{m.disclaimer}</p>
    </div>
  );
}
