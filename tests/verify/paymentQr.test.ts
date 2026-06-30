import { describe, it, expect } from 'vitest';
import { emvCrc, parseEmv, parseUpi, isEmvPayload, paymentFormat } from '../../src/lib/paymentQr';
import { normalizeDestinationValue } from '../../src/lib/verifyRegistry';

// Build a valid EMVCo TLV field (2-digit length, max 99 — per spec).
const tlv = (tag: string, v: string) => tag + String(v.length).padStart(2, '0') + v;
function buildEmv(mai: string, opts: { name?: string } = {}): string {
  const body =
    tlv('00', '01') +
    tlv('26', mai) +
    tlv('52', '0000') +
    tlv('53', '986') +
    tlv('58', 'BR') +
    tlv('59', opts.name ?? 'Joe Crabshack') +
    tlv('60', 'BRASILIA') +
    tlv('62', tlv('05', '***'));
  const withTag = body + '6304';
  return withTag + emvCrc(withTag);
}

describe('EMV CRC-16/CCITT-FALSE', () => {
  it('matches the EMVCo spec known-answer vector (A13A)', () => {
    const payload =
      '00020101021229300012D156000000000510A93FO3230Q31280012D15600000001030812345678520441115802CN5914BEST TRANSPORT6007BEIJING64200002ZH0104最佳运输0202北京540523.7253031565502016233030412340603***0708A60086670902ME91320016A011223344998877070812345678' +
      '6304';
    expect(emvCrc(payload)).toBe('A13A');
  });
});

describe('EMV / PIX parsing', () => {
  const pix = buildEmv(tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', 'test@example.com'));

  it('detects + parses a PIX QR and namespaces the identifier', () => {
    expect(isEmvPayload(pix)).toBe(true);
    expect(paymentFormat(pix)).toBe('emv');
    const r = parseEmv(pix);
    expect(r.ok).toBe(true);
    if (r.ok && r.kind === 'static') {
      expect(r.scheme).toBe('pix');
      expect(r.identifier).toBe('br.gov.bcb.pix|test@example.com');
      expect(r.merchantName).toBe('Joe Crabshack');
    } else {
      throw new Error('expected a static PIX parse');
    }
  });

  it('rejects a tampered CRC (swap protection at the format layer)', () => {
    expect(parseEmv(pix.slice(0, -1) + (pix.slice(-1) === '0' ? '1' : '0')).ok).toBe(false);
  });

  it('parses a DYNAMIC PIX QR — extracts the location URL (scheme prepended)', () => {
    const dyn = buildEmv(tlv('00', 'BR.GOV.BCB.PIX') + tlv('25', 'pix.example.com/qr/v2/abc'));
    const r = parseEmv(dyn);
    expect(r.ok).toBe(true);
    if (r.ok && r.kind === 'dynamic') {
      expect(r.url).toBe('https://pix.example.com/qr/v2/abc');
      expect(r.scheme).toBe('pix');
    } else {
      throw new Error('expected a dynamic PIX parse');
    }
  });
});

describe('UPI parsing', () => {
  it('extracts and lowercases the VPA, and keeps the payee name', () => {
    expect(parseUpi('upi://pay?pa=Merchant@OkHdfcBank&pn=Joe%20Shop&am=10'))
      .toEqual({ vpa: 'merchant@okhdfcbank', name: 'Joe Shop' });
    expect(paymentFormat('upi://pay?pa=x@y')).toBe('upi');
  });
  it('returns null without a pa= VPA', () => {
    expect(parseUpi('upi://pay?pn=NoVpa&am=5')).toBeNull();
    expect(parseUpi('https://not-upi')).toBeNull();
  });
});

describe('normalizeDestinationValue — hashed canonical (registration ↔ scan match)', () => {
  const pix = buildEmv(tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', 'test@example.com'));

  it('hashes PIX/UPI — the raw key/VPA is never the stored value', () => {
    const v = normalizeDestinationValue(pix);
    expect(v).toMatch(/^emvqr:[0-9a-f]{64}$/);
    expect(v).not.toContain('test@example.com');
    const u = normalizeDestinationValue('upi://pay?pa=merchant@okhdfcbank');
    expect(u).toMatch(/^upi:[0-9a-f]{64}$/);
  });

  it('is idempotent — re-normalizing the stored hash returns it unchanged (so lookup matches)', () => {
    const v = normalizeDestinationValue(pix);
    expect(normalizeDestinationValue(v)).toBe(v);
  });

  it('same PIX key in differently-formatted QRs → same hash (a swap to a different key would not)', () => {
    const a = buildEmv(tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', 'test@example.com'), { name: 'Joe Crabshack' });
    const b = buildEmv(tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', 'test@example.com'), { name: 'Joes Shack LLC' });
    expect(normalizeDestinationValue(a)).toBe(normalizeDestinationValue(b));
    const evil = buildEmv(tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', 'scammer@evil.com'));
    expect(normalizeDestinationValue(evil)).not.toBe(normalizeDestinationValue(a));
  });

  it('an invalid EMV (bad CRC) normalizes to empty → registration rejects it', () => {
    expect(normalizeDestinationValue(pix.slice(0, -1) + 'Z')).toBe('');
  });

  it('dynamic PIX normalizes to its location URL — and matches that URL pasted directly', () => {
    const dyn = buildEmv(tlv('00', 'BR.GOV.BCB.PIX') + tlv('25', 'pix.example.com/qr/v2/abc'));
    const norm = normalizeDestinationValue(dyn);
    expect(norm).toBe('https://pix.example.com/qr/v2/abc');
    expect(normalizeDestinationValue('https://pix.example.com/qr/v2/abc/')).toBe(norm); // idempotent w/ trailing slash
  });
});
