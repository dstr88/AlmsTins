/**
 * <safety-check> — dedicated, importable wallet + URL safety-check component.
 *
 * Calls the scanner (promptScan from qrScan), classifies the payload (crypto
 * address vs URL/domain), runs the existing PUBLIC safety endpoints
 * (/api/wallet-check, /api/dapp-check), and renders a verdict. Self-contained:
 * shadow DOM + the app's design tokens (CSS custom properties pierce the shadow
 * boundary, so it inherits the theme wherever it's dropped). Login-free.
 *
 * Language — reads the `lang` attribute ('en' | 'es' | 'fr'). An explicit value
 * always wins ("choose English → see English"); when omitted it falls back to
 * the visitor's own browser language (navigator.language), so a Spanish device
 * gets Spanish and a French device gets French automatically. Defaults to en.
 *
 *   import '@/lib/safetyCheck';
 *   <safety-check></safety-check>            <!-- auto: follows browser language -->
 *   <safety-check lang="es"></safety-check>  <!-- force Spanish -->
 *   <safety-check lang="fr"></safety-check>  <!-- force French  -->
 *
 * Or use the logic directly:
 *   import { checkAddress, checkUrl, classifyPayload } from '@/lib/safetyCheck';
 */
import { promptScan } from '@/lib/qrScan';

// ── Classification ────────────────────────────────────────────────────────────
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const BTC_RE = /^(bc1[0-9a-z]{6,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/;
const LTC_RE = /^(ltc1[0-9a-z]{6,87}|[LM3][a-km-zA-HJ-NP-Z1-9]{26,33})$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type Classified = { kind: 'address' | 'url' | 'unknown'; value: string };

/** Decide whether a scanned/pasted string is a crypto address or a URL/domain. */
export function classifyPayload(raw: string): Classified {
  let s = (raw ?? '').trim();
  if (!s) return { kind: 'unknown', value: '' };

  // Crypto payment URI (ethereum:0x…?value=…) -> extract the address.
  const uri = /^(ethereum|bitcoin|litecoin|solana|polygon|bnb):([^?]+)/i.exec(s);
  if (uri) {
    try { s = decodeURIComponent(uri[2].trim()); } catch { s = uri[2].trim(); }
  }

  if (EVM_RE.test(s) || BTC_RE.test(s) || LTC_RE.test(s) || SOL_RE.test(s)) {
    return { kind: 'address', value: s };
  }
  if (/^https?:\/\//i.test(s) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(s)) {
    return { kind: 'url', value: s };
  }
  return { kind: 'unknown', value: s };
}

// ── Checks (reuse the existing public endpoints) ──────────────────────────────
export async function checkAddress(address: string): Promise<any> {
  const res = await fetch('/api/wallet-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  return res.json();
}

export async function checkUrl(url: string): Promise<any> {
  const res = await fetch('/api/dapp-check?url=' + encodeURIComponent(url));
  return res.json();
}

// ── i18n ──────────────────────────────────────────────────────────────────────
type Lang = 'en' | 'es' | 'fr';

type Strings = {
  placeholder: string;
  scan: string;
  check: string;
  paste: string;
  decoding: string;
  noQr: string;
  checking: string;
  unrecognized: string;
  failed: string;
  addr: { danger: string; caution: string; clean: string };
  url: { red: string; yellow: string; green: string };
  identified: string;
  fraud: (n: number) => string;
  flags: Record<string, string>;
};

const I18N: Record<Lang, Strings> = {
  en: {
    placeholder: 'Paste or type an address or URL',
    scan: '📷 Scan',
    check: 'Check',
    paste: 'Paste from clipboard',
    decoding: 'Decoding QR…',
    noQr: 'No QR code found (or cancelled). Paste the address/URL instead.',
    checking: 'Checking…',
    unrecognized: 'Not a recognizable wallet address or URL.',
    failed: 'Check failed. Try again.',
    addr: { danger: '🛑 Dangerous address', caution: '⚠ Use caution', clean: '🛡 No major flags' },
    url: { red: '🛑 Flagged as dangerous', yellow: '⚠ Insufficient data', green: '✓ Looks clear' },
    identified: 'Identified: ',
    fraud: (n) => `⚠ Marked fraudulent by ${n} in your community`,
    flags: {
      blacklisted: 'On a scam blacklist',
      sanctioned: 'OFAC sanctioned',
      phishing: 'Linked to phishing',
      honeypotRelated: 'Honeypot-related',
      stealingAttack: 'Stealing attack',
      darkwebTransactions: 'Dark-web activity',
      cybercrime: 'Cybercrime',
      moneyLaundering: 'Money laundering',
      financialCrime: 'Financial crime',
      blackmail: 'Blackmail',
      mixer: 'Mixer / Tornado Cash',
    },
  },
  es: {
    placeholder: 'Pega o escribe una dirección o URL',
    scan: '📷 Escanear',
    check: 'Verificar',
    paste: 'Pegar del portapapeles',
    decoding: 'Decodificando QR…',
    noQr: 'No se encontró ningún código QR (o se canceló). Pega la dirección/URL.',
    checking: 'Verificando…',
    unrecognized: 'No es una dirección de billetera ni una URL reconocible.',
    failed: 'La verificación falló. Inténtalo de nuevo.',
    addr: { danger: '🛑 Dirección peligrosa', caution: '⚠ Ten precaución', clean: '🛡 Sin alertas importantes' },
    url: { red: '🛑 Marcada como peligrosa', yellow: '⚠ Datos insuficientes', green: '✓ Parece segura' },
    identified: 'Identificada: ',
    fraud: (n) => `⚠ Marcada como fraudulenta por ${n} en tu comunidad`,
    flags: {
      blacklisted: 'En una lista negra de estafas',
      sanctioned: 'Sancionada por la OFAC',
      phishing: 'Vinculada a phishing',
      honeypotRelated: 'Relacionada con honeypot',
      stealingAttack: 'Ataque de robo',
      darkwebTransactions: 'Actividad en la dark web',
      cybercrime: 'Cibercrimen',
      moneyLaundering: 'Lavado de dinero',
      financialCrime: 'Delito financiero',
      blackmail: 'Extorsión',
      mixer: 'Mezclador / Tornado Cash',
    },
  },
  fr: {
    placeholder: 'Collez ou saisissez une adresse ou une URL',
    scan: '📷 Scanner',
    check: 'Vérifier',
    paste: 'Coller depuis le presse-papiers',
    decoding: 'Décodage du QR…',
    noQr: 'Aucun code QR trouvé (ou annulé). Collez plutôt l’adresse / l’URL.',
    checking: 'Vérification…',
    unrecognized: 'Ni une adresse de portefeuille ni une URL reconnaissable.',
    failed: 'Échec de la vérification. Réessayez.',
    addr: { danger: '🛑 Adresse dangereuse', caution: '⚠ Soyez prudent', clean: '🛡 Aucune alerte majeure' },
    url: { red: '🛑 Signalée comme dangereuse', yellow: '⚠ Données insuffisantes', green: '✓ Semble sûre' },
    identified: 'Identifiée : ',
    fraud: (n) => `⚠ Signalée comme frauduleuse par ${n} dans votre communauté`,
    flags: {
      blacklisted: 'Sur une liste noire d’arnaques',
      sanctioned: 'Sanctionnée par l’OFAC',
      phishing: 'Liée à du phishing',
      honeypotRelated: 'Liée à un honeypot',
      stealingAttack: 'Attaque de vol',
      darkwebTransactions: 'Activité sur le dark web',
      cybercrime: 'Cybercriminalité',
      moneyLaundering: 'Blanchiment d’argent',
      financialCrime: 'Crime financier',
      blackmail: 'Chantage',
      mixer: 'Mixeur / Tornado Cash',
    },
  },
};

/** Explicit `lang` attribute wins; otherwise follow the browser; default to en. */
function pickLang(attr: string | null): Lang {
  const a = (attr || '').toLowerCase();
  if (a.startsWith('es')) return 'es';
  if (a.startsWith('fr')) return 'fr';
  if (a.startsWith('en')) return 'en';
  const nav = ((typeof navigator !== 'undefined' && navigator.language) || '').toLowerCase();
  if (nav.startsWith('es')) return 'es';
  if (nav.startsWith('fr')) return 'fr';
  return 'en';
}

const STYLE = `
  :host { display: block; }
  .sc { display: flex; flex-direction: column; gap: .6rem; }
  .sc__row { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
  .sc__field { position: relative; flex: 1 1 200px; min-width: 0; }
  .sc__input { width: 100%; box-sizing: border-box; background: var(--surface-card-2); border: 1px solid var(--border-subtle); border-radius: 8px; padding: .55rem 2.2rem .55rem .7rem; color: var(--text-primary); font-size: .9rem; font-family: inherit; }
  .sc__input:focus { outline: none; border-color: var(--border-bright); }
  .sc__paste { position: absolute; right: .3rem; top: 50%; transform: translateY(-50%); background: transparent; border: none; cursor: pointer; font-size: 1rem; line-height: 1; padding: .2rem .3rem; color: var(--text-muted); border-radius: 6px; }
  .sc__paste:hover { color: var(--accent); background: var(--surface-hover); }
  .sc__btn { background: transparent; border: 1px solid var(--border-bright); color: var(--text-secondary); border-radius: 8px; padding: .55rem .9rem; font-size: .9rem; cursor: pointer; white-space: nowrap; font-family: inherit; }
  .sc__btn:hover { background: var(--surface-hover); }
  .sc__btn--primary { background: var(--accent); border-color: var(--accent); color: var(--surface-bg); font-weight: 600; }
  .sc__result { border-radius: 10px; padding: .9rem; border: 1px solid var(--border-subtle); background: var(--surface-card-2); color: var(--text-secondary); font-size: .9rem; }
  .sc__result--ok { border-color: var(--gain-border); background: var(--gain-bg); }
  .sc__result--bad { border-color: var(--loss-border); background: var(--loss-bg); }
  .sc__result--warn { border-color: var(--accent-glow); background: var(--accent-soft); }
  .sc__result-title { font-weight: 700; font-size: 1rem; color: var(--text-primary); margin-bottom: .2rem; }
  .sc__result--ok .sc__result-title { color: var(--gain); }
  .sc__result--bad .sc__result-title { color: var(--loss); }
  .sc__result-sub { font-family: ui-monospace, monospace; font-size: .75rem; color: var(--text-muted); word-break: break-all; }
  .sc__flags { margin: .5rem 0 0; padding-left: 1.1rem; color: var(--text-secondary); font-size: .85rem; }
  .sc__flags li { margin: .12rem 0; }
  .sc__note { margin-top: .4rem; font-size: .85rem; color: var(--text-secondary); }
  .sc__note--bad { color: var(--loss); }
`;

class SafetyCheck extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const t = I18N[pickLang(this.getAttribute('lang'))];
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style>
      <div class="sc">
        <div class="sc__row">
          <button class="sc__btn sc__btn--primary" data-scan>${t.scan}</button>
          <div class="sc__field">
            <input class="sc__input" type="text" data-input placeholder="${t.placeholder}" autocomplete="off" spellcheck="false" />
            <button class="sc__paste" data-paste type="button" title="${t.paste}" aria-label="${t.paste}">📋</button>
          </div>
          <button class="sc__btn" data-check>${t.check}</button>
        </div>
        <div class="sc__result" data-result hidden></div>
      </div>`;

    const input = root.querySelector('[data-input]') as HTMLInputElement;
    const result = root.querySelector('[data-result]') as HTMLElement;

    const state = (cls: string, msg: string) => {
      result.hidden = false;
      result.className = 'sc__result sc__result--' + cls;
      result.textContent = msg;
    };

    const renderAddress = (data: any) => {
      if (!data || !data.ok || !data.result) { state('warn', (data && data.error) || t.failed); return; }
      const r = data.result;
      const cls = r.scamLevel === 'danger' ? 'bad' : r.scamLevel === 'caution' ? 'warn' : 'ok';
      result.hidden = false;
      result.className = 'sc__result sc__result--' + cls;
      result.innerHTML = '';
      const title = document.createElement('div');
      title.className = 'sc__result-title';
      title.textContent = r.scamLevel === 'danger' ? t.addr.danger
        : r.scamLevel === 'caution' ? t.addr.caution : t.addr.clean;
      result.appendChild(title);
      const sub = document.createElement('div');
      sub.className = 'sc__result-sub';
      sub.textContent = String(r.address ?? '');
      result.appendChild(sub);
      const active = Object.keys(t.flags).filter((k) => r.flags && r.flags[k]);
      if (active.length) {
        const ul = document.createElement('ul');
        ul.className = 'sc__flags';
        for (const k of active) {
          const li = document.createElement('li');
          li.textContent = t.flags[k];
          ul.appendChild(li);
        }
        result.appendChild(ul);
      }
      if (r.entityLabel && r.entityLabel.name) {
        const e = document.createElement('div');
        e.className = 'sc__note';
        e.textContent = t.identified + String(r.entityLabel.name);
        result.appendChild(e);
      }
      if (typeof r.fraudReportsCount === 'number' && r.fraudReportsCount > 0) {
        const f = document.createElement('div');
        f.className = 'sc__note sc__note--bad';
        f.textContent = t.fraud(r.fraudReportsCount);
        result.appendChild(f);
      }
    };

    const renderUrl = (data: any) => {
      if (!data || !data.verdict) { state('warn', (data && data.message) || t.failed); return; }
      const cls = data.verdict === 'red' ? 'bad' : data.verdict === 'yellow' ? 'warn' : 'ok';
      result.hidden = false;
      result.className = 'sc__result sc__result--' + cls;
      result.innerHTML = '';
      const title = document.createElement('div');
      title.className = 'sc__result-title';
      title.textContent = data.verdict === 'red' ? t.url.red
        : data.verdict === 'yellow' ? t.url.yellow : t.url.green;
      result.appendChild(title);
      const sub = document.createElement('div');
      sub.className = 'sc__result-sub';
      sub.textContent = String(data.domain ?? data.url ?? '');
      result.appendChild(sub);
      const flagged = (data.sources || []).filter((s: any) => s && s.verdict === 'flagged');
      if (flagged.length) {
        const ul = document.createElement('ul');
        ul.className = 'sc__flags';
        for (const s of flagged) {
          const li = document.createElement('li');
          li.textContent = String(s.name) + (s.detail ? ' — ' + String(s.detail) : '');
          ul.appendChild(li);
        }
        result.appendChild(ul);
      }
    };

    const run = async (raw: string) => {
      const c = classifyPayload(raw);
      if (c.kind === 'unknown') { state('warn', t.unrecognized); return; }
      state('warn', t.checking);
      try {
        if (c.kind === 'address') renderAddress(await checkAddress(c.value));
        else renderUrl(await checkUrl(c.value));
      } catch {
        state('warn', t.failed);
      }
    };

    root.querySelector('[data-scan]')!.addEventListener('click', async () => {
      state('warn', t.decoding);
      const payload = await promptScan();
      if (!payload) { state('warn', t.noQr); return; }
      input.value = payload;
      run(payload);
    });
    root.querySelector('[data-check]')!.addEventListener('click', () => run(input.value.trim()));
    input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') run(input.value.trim()); });
    root.querySelector('[data-paste]')!.addEventListener('click', async () => {
      try {
        const text = ((await navigator.clipboard.readText()) || '').trim();
        if (text) { input.value = text; run(text); } else input.focus();
      } catch {
        input.focus(); // clipboard blocked — let them paste manually
      }
    });
  }
}

if (typeof window !== 'undefined' && !customElements.get('safety-check')) {
  customElements.define('safety-check', SafetyCheck);
}
