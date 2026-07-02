/**
 * JunkDrawer.tsx — read-only view of tokens filtered out as spam/scam.
 *
 * Makes the silent spam filtering auditable for a tax preparer: "here is what was
 * set aside, and why." SECURITY: token names/symbols are attacker-controlled (drainer
 * bait embeds URLs). They are rendered as React text (auto-escaped) and NEVER as
 * links — no <a>, no href — so the drawer can't become a phishing surface.
 */
import { useEffect, useState } from 'react';

type JunkToken = {
  symbol: string; name: string | null; contract: string | null; chain: string;
  amount: number | null; valueUsd: number | null; reason: string; source: 'wallet' | 'nft';
};

const STR: Record<string, Record<string, string>> = {
  en: { button: 'Junk drawer', title: 'Filtered tokens', close: 'Close',
    sub: 'Spam and scam-airdrop tokens set aside — never counted in your holdings, gains, or tax totals. Names are shown as plain text and links are inert for your safety.',
    empty: 'Nothing filtered — your token list is clean.', loading: 'Loading…',
    reason: 'Filtered because', nft: 'NFT', wallet: 'Wallet' },
  es: { button: 'Cajón de basura', title: 'Tokens filtrados', close: 'Cerrar',
    sub: 'Tokens de spam y airdrops fraudulentos apartados — nunca se cuentan en tus tenencias, ganancias ni totales fiscales. Los nombres se muestran como texto y los enlaces están inertes por tu seguridad.',
    empty: 'Nada filtrado — tu lista de tokens está limpia.', loading: 'Cargando…',
    reason: 'Filtrado porque', nft: 'NFT', wallet: 'Billetera' },
  fr: { button: 'Tiroir à déchets', title: 'Tokens filtrés', close: 'Fermer',
    sub: 'Tokens de spam et airdrops frauduleux mis de côté — jamais comptés dans vos avoirs, gains ou totaux fiscaux. Les noms sont affichés en texte brut et les liens sont inertes pour votre sécurité.',
    empty: 'Rien de filtré — votre liste de tokens est propre.', loading: 'Chargement…',
    reason: 'Filtré car', nft: 'NFT', wallet: 'Portefeuille' },
};

export default function JunkDrawer({ lang = 'en' }: { lang?: string }) {
  const t = STR[lang] ?? STR.en;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<JunkToken[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || items) return;
    setLoading(true);
    fetch('/api/tokens/junk')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setItems(Array.isArray(d.items) ? d.items : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open, items]);

  const fUsd = (v: number | null) => (v == null ? '' : `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
          padding: '0.4rem 0.85rem', borderRadius: 10,
          border: '1px solid var(--border-bright)', background: 'transparent',
          color: 'var(--text-secondary)', fontSize: '0.82rem', cursor: 'pointer',
        }}
      >
        🗑 {t.button}{items ? ` (${items.length})` : ''}
      </button>

      {open && (
        <div role="dialog" aria-modal="true" aria-label={t.title}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div onClick={() => setOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} />
          <div style={{
            position: 'relative', zIndex: 1, background: 'var(--surface-bg)',
            border: '1px solid var(--border-bright)', borderRadius: 16, padding: '1.75rem',
            width: '100%', maxWidth: 620, maxHeight: '85vh', overflowY: 'auto',
            boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
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
                  <div key={idx} style={{ background: 'var(--surface-card-2)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '0.6rem 0.8rem' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {/* React escapes these — attacker-controlled, rendered as inert text */}
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem', wordBreak: 'break-word' }}>{it.name || it.symbol}</span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {it.source === 'nft' ? t.nft : t.wallet} · {it.chain}{it.valueUsd ? ` · ${fUsd(it.valueUsd)}` : ''}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                      {t.reason}: <span style={{ color: 'var(--loss)' }}>{it.reason}</span>
                    </div>
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
