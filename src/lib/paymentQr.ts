/**
 * Almstins Verify — non-URL payment-QR parsers (EMVCo/PIX + UPI).
 *
 * Merchant-presented QRs across most of the world are NOT URLs:
 *  - EMVCo Merchant-Presented Mode (Brazil PIX, Thailand PromptPay, Singapore PayNow,
 *    Indonesia QRIS, Malaysia DuitNow, India BharatQR…) — a structured TLV string ending
 *    in a CRC16 checksum.
 *  - India UPI — a `upi://pay?pa=<VPA>&…` intent URI.
 *
 * These pure parsers extract a stable MERCHANT IDENTIFIER. The registry then HASHES it
 * (verifyRegistry.normalizeDestinationValue) — the raw identifier can be a CPF / phone /
 * email (PII), which Almstins never stores. No I/O; fully unit-testable.
 */

// ── EMVCo CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), over UTF-8 BYTES ─────────
function crc16ccitt(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/** The 4-hex EMV CRC of a string (UTF-8 bytes — correct for accented merchant names). */
export function emvCrc(str: string): string {
  return crc16ccitt(new TextEncoder().encode(str)).toString(16).toUpperCase().padStart(4, '0');
}

interface Tlv { tag: string; value: string }
function parseTlv(s: string): Tlv[] {
  const out: Tlv[] = [];
  let i = 0;
  while (i + 4 <= s.length) {
    const tag = s.slice(i, i + 2);
    const len = parseInt(s.slice(i + 2, i + 4), 10);
    if (!Number.isInteger(len) || len < 0) break;
    const value = s.slice(i + 4, i + 4 + len);
    if (value.length < len) break; // truncated
    out.push({ tag, value });
    i += 4 + len;
  }
  return out;
}

/** Cheap shape check — does this look like an EMVCo merchant QR? (Routing only.) */
export function isEmvPayload(s: string): boolean {
  const t = (s ?? '').trim();
  return /^0002\d{2}/.test(t) && t.length >= 20 && t.includes('6304');
}

export interface EmvParse {
  ok: true;
  identifier: string;          // "<gui>|<account-id>" — namespaced, stable per merchant account
  merchantName: string | null; // EMV tag 59 (public display name)
  scheme: 'pix' | 'emv';
}
export type EmvResult = EmvParse | { ok: false };

/**
 * Parse + validate an EMVCo merchant QR. Verifies the CRC, then extracts the first
 * merchant-account-information template (tags 26–51): its GUI (sub-tag 00) + primary
 * account id (sub-tag 01). Rejects dynamic-only QRs (no static id) and bad CRCs.
 */
export function parseEmv(raw: string): EmvResult {
  const s = (raw ?? '').trim();
  if (!isEmvPayload(s)) return { ok: false };
  // CRC tag is "6304" + 4 hex, at the very end; CRC covers everything up to & incl "6304".
  if (s.lastIndexOf('6304') !== s.length - 8) return { ok: false };
  if (emvCrc(s.slice(0, -4)) !== s.slice(-4).toUpperCase()) return { ok: false };

  const top = parseTlv(s);
  const mai = top.find((t) => { const n = parseInt(t.tag, 10); return n >= 26 && n <= 51; });
  if (!mai) return { ok: false };
  const sub = parseTlv(mai.value);
  const gui = (sub.find((x) => x.tag === '00')?.value ?? '').trim();
  const id = (sub.find((x) => x.tag === '01')?.value ?? '').trim();
  if (!id) return { ok: false }; // dynamic-only (URL in sub-tag 25) → out of scope v1
  const merchantName = top.find((t) => t.tag === '59')?.value?.trim() || null;
  const scheme: 'pix' | 'emv' = /br\.gov\.bcb\.pix/i.test(gui) ? 'pix' : 'emv';
  return { ok: true, identifier: `${gui.toLowerCase()}|${id.toLowerCase()}`, merchantName, scheme };
}

/** Extract the VPA (`pa`) from a UPI intent URI. Lowercased — VPAs are case-insensitive. */
export function parseUpi(raw: string): { vpa: string } | null {
  const m = (raw ?? '').trim().match(/^upi:\/\/[^?]*\?(.*)$/i);
  if (!m) return null;
  let vpa: string | null = null;
  try { vpa = new URLSearchParams(m[1]).get('pa'); } catch { return null; }
  if (!vpa || !vpa.trim()) return null;
  return { vpa: vpa.trim().toLowerCase() };
}

/** Format of a raw scanned/pasted payment value. */
export function paymentFormat(raw: string): 'url' | 'emv' | 'upi' | 'unknown' {
  const s = (raw ?? '').trim();
  if (/^https?:\/\//i.test(s)) return 'url';
  if (/^upi:\/\//i.test(s)) return 'upi';
  if (isEmvPayload(s)) return 'emv';
  return 'unknown';
}
