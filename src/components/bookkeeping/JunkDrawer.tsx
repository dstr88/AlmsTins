/**
 * JunkDrawer.tsx — review the tokens filtered as spam/scam, and override them.
 *
 * Auditable + actionable: "here is what was set aside, and why" plus three actions —
 * Not junk (false positive → re-include everywhere), Income (a real airdrop), and
 * Confirm junk. SECURITY: token names/symbols are attacker-controlled (drainer bait
 * embeds URLs). They render as React text (auto-escaped) and NEVER as links.
 */
import { useEffect, useState } from 'react';

type JunkToken = {
  symbol: string; name: string | null; contract: string | null; chain: string;
  amount: number | null; valueUsd: number | null; reason: string;
  source: 'wallet' | 'nft'; override: 'junk' | null;
};

type Decision = 'include' | 'junk' | 'income';

const STR: Record<string, Record<string, string>> = {
  en: { button: 'Filtered items', title: 'Filtered items', close: 'Close',
    sub: 'Spam and scam-airdrop tokens set aside — never counted in your holdings, gains, or tax totals. Names are shown as plain text and links are inert for your safety.',
    empty: 'Nothing filtered — your token list is clean.', loading: 'Loading…', reason: 'Filtered because',
    nft: 'NFT', wallet: 'Wallet', include: 'Not junk', income: 'Income', junk: 'Confirm junk',
    confirmed: 'Confirmed junk', undo: 'Undo',
    incomeHint: 'Marked as income — enter its fair market value at receipt in your records.',
    includeHint: 'Restored — it will reappear in your holdings.' },
  es: { button: 'Elementos filtrados', title: 'Elementos filtrados', close: 'Cerrar',
    sub: 'Tokens de spam y airdrops fraudulentos apartados — nunca se cuentan en tus tenencias, ganancias ni totales fiscales. Los nombres se muestran como texto y los enlaces están inertes por tu seguridad.',
    empty: 'Nada filtrado — tu lista de tokens está limpia.', loading: 'Cargando…', reason: 'Filtrado porque',
    nft: 'NFT', wallet: 'Billetera', include: 'No es basura', income: 'Ingreso', junk: 'Confirmar basura',
    confirmed: 'Basura confirmada', undo: 'Deshacer',
    incomeHint: 'Marcado como ingreso — registra su valor de mercado al momento de recepción.',
    includeHint: 'Restaurado — reaparecerá en tus tenencias.' },
  fr: { button: 'Éléments filtrés', title: 'Éléments filtrés', close: 'Fermer',
    sub: 'Tokens de spam et airdrops frauduleux mis de côté — jamais comptés dans vos avoirs, gains ou totaux fiscaux. Les noms sont affichés en texte brut et les liens sont inertes pour votre sécurité.',
    empty: 'Rien de filtré — votre liste de tokens est propre.', loading: 'Chargement…', reason: 'Filtré car',
    nft: 'NFT', wallet: 'Portefeuille', include: 'Pas un déchet', income: 'Revenu', junk: 'Confirmer déchet',
    confirmed: 'Déchet confirmé', undo: 'Annuler',
    incomeHint: 'Marqué comme revenu — saisissez sa juste valeur au moment de la réception.',
    includeHint: 'Restauré — il réapparaîtra dans vos avoirs.' },
};

export default function JunkDrawer({ lang = 'en' }: { lang?: string }) {
  const t = STR[lang] ?? STR.en;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<JunkToken[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [flash, setFlash] = useState<{ idx: number; msg: string } | null>(null);

  useEffect(() => {
    if (!open || items) return;
    setLoading(true);
    fetch('/api/tokens/junk')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setItems(Array.isArray(d.items) ? d.items : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open, items]);

  const post = (it: JunkToken, decision: Decision) =>
    fetch('/api/tokens/override', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain: it.chain, contract: it.contract, symbol: it.symbol, decision }),
    });

  async function act(idx: number, it: JunkToken, decision: Decision) {
    setBusy(idx);
    try {
      const r = await post(it, decision);
      if (!r.ok) throw new Error();
      if (decision === 'junk') {
        setItems((prev) => (prev ?? []).map((x, i) => (i === idx ? { ...x, override: 'junk' } : x)));
      } else {
        setFlash({ idx, msg: decision === 'income' ? t.incomeHint : t.includeHint });
        setTimeout(() => {
          setItems((prev) => (prev ?? []).filter((_, i) => i !== idx));
          setFlash(null);
        }, 1400);
      }
    } catch { /* leave as-is */ } finally { setBusy(null); }
  }

  async function undo(idx: number, it: JunkToken) {
    setBusy(idx);
    try {
      const q = new URLSearchParams();
      if (it.chain) q.set('chain', it.chain);
      if (it.contract) q.set('contract', it.contract);
      if (it.symbol) q.set('symbol', it.symbol);
      await fetch(`/api/tokens/override?${q.toString()}`, { method: 'DELETE' });
      setItems((prev) => (prev ?? []).map((x, i) => (i === idx ? { ...x, override: null } : x)));
    } catch { /* noop */ } finally { setBusy(null); }
  }

  const fUsd = (v: number | null) => (v == null ? '' : `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
  const btn = (bg: string, fg: string): React.CSSProperties => ({
    padding: '0.25rem 0.6rem', borderRadius: 8, border: `1px solid ${fg}44`,
    background: bg, color: fg, fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
  });

  return (
    <>
      <button onClick={() => setOpen(true)} style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
        padding: '0.4rem 0.85rem', borderRadius: 10, border: '1px solid var(--border-bright)',
        background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.82rem', cursor: 'pointer',
      }}>
        {t.button}{items ? ` (${items.length})` : ''}
      </button>

      {open && (
        <div role="dialog" aria-modal="true" aria-label={t.title}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div onClick={() => setOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} />
          <div style={{
            position: 'relative', zIndex: 1, background: 'var(--surface-bg)',
            border: '1px solid var(--border-bright)', borderRadius: 16, padding: '1.75rem',
            width: '100%', maxWidth: 640, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>{t.title}</div>
              <button onClick={() => setOpen(false)} aria-label={t.close}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '1.25rem', cursor: 'pointer', padding: 4 }}>✕</button>
            </div>
            <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', lineHeight: 1.55, color: 'var(--text-secondary)' }}>{t.sub}</p>

            {loading && <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{t.loading}</p>}
            {!loading && items && items.length === 0 && (
              <p style={{ color: 'var(--gain)', fontSize: '0.9rem' }}>✓ {t.empty}</p>
            )}
            {!loading && items && items.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {items.map((it, idx) => (
                  <div key={idx} style={{ background: 'var(--surface-card-2)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '0.6rem 0.8rem', opacity: it.override === 'junk' ? 0.6 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {/* attacker-controlled → React-escaped text, never a link */}
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem', wordBreak: 'break-word' }}>{it.name || it.symbol}</span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {it.source === 'nft' ? t.nft : t.wallet} · {it.chain}{it.valueUsd ? ` · ${fUsd(it.valueUsd)}` : ''}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                      {t.reason}: <span style={{ color: 'var(--loss)' }}>{it.reason}</span>
                    </div>

                    {flash && flash.idx === idx ? (
                      <div style={{ fontSize: '0.76rem', color: 'var(--gain)', marginTop: '0.4rem' }}>✓ {flash.msg}</div>
                    ) : it.override === 'junk' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.45rem' }}>
                        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>✓ {t.confirmed}</span>
                        <button disabled={busy === idx} onClick={() => undo(idx, it)} style={btn('transparent', 'var(--text-secondary)')}>{t.undo}</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.45rem', flexWrap: 'wrap' }}>
                        <button disabled={busy === idx} onClick={() => act(idx, it, 'include')} style={btn('var(--gain-bg)', 'var(--gain)')}>{t.include}</button>
                        <button disabled={busy === idx} onClick={() => act(idx, it, 'income')} style={btn('var(--accent-soft)', 'var(--accent)')}>{t.income}</button>
                        <button disabled={busy === idx} onClick={() => act(idx, it, 'junk')} style={btn('transparent', 'var(--text-secondary)')}>{t.junk}</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
