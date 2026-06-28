import { describe, it, expect } from 'vitest';
import { analyzePublishedHtml } from '../../src/lib/verifyPublishedSource';

/**
 * The watchman alerts on 'swapped' only — the registered value gone AND a conflicting
 * same-kind value present. Everything ambiguous is 'missing' (recorded, never alerted).
 * These assert that line for each rail + the URL/payment-link case.
 */
describe('verify published-source swap analysis', () => {
  const EVM = '0xAbC0000000000000000000000000000000001234';
  const evmPage = (s: string) => `<html><body><p>Pay to ${s}</p></body></html>`;

  it('EVM: registered address present (any case) → present', () => {
    expect(analyzePublishedHtml('address', 'ethereum', EVM, evmPage(EVM)).outcome).toBe('present');
    // checksummed on the page, registered lower — still matches
    expect(analyzePublishedHtml('address', 'ethereum', EVM.toLowerCase(), evmPage(EVM)).outcome).toBe('present');
  });

  it('EVM: registered gone + a different 0x address present → swapped', () => {
    const evil = '0xdead000000000000000000000000000000009999';
    const r = analyzePublishedHtml('address', 'ethereum', EVM, evmPage(evil));
    expect(r.outcome).toBe('swapped');
    expect(r.found).toContain(evil.toLowerCase());
  });

  it('EVM: registered gone, no other address → missing (no alert)', () => {
    expect(analyzePublishedHtml('address', 'ethereum', EVM, '<p>nothing here</p>').outcome).toBe('missing');
  });

  it('Bitcoin bech32: present, and swap detection', () => {
    const me = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
    const evil = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
    expect(analyzePublishedHtml('address', 'bitcoin', me, `send to ${me}`).outcome).toBe('present');
    const r = analyzePublishedHtml('address', 'bitcoin', me, `send to ${evil}`);
    expect(r.outcome).toBe('swapped');
    expect(r.found).toContain(evil);
  });

  it('Solana (noisy base58): registered gone → missing, never a false swap', () => {
    const me = 'So11111111111111111111111111111111111111112';
    const other = '4Nd1mYh8aQwFyz8tV9oP2qReSt3uV4wX5yZ6aB7cD8e';
    expect(analyzePublishedHtml('address', 'solana', me, `pay ${other}`).outcome).toBe('missing');
  });

  it('Payment link: exact link present → present', () => {
    const link = 'https://buy.stripe.com/abc123';
    const page = `<a href="${link}">Pay now</a>`;
    expect(analyzePublishedHtml('qr', 'url', link, page).outcome).toBe('present');
    // trailing slash / utm on the page still match the canonical registered link
    expect(analyzePublishedHtml('qr', 'url', link, `<a href="${link}/?utm=x">Pay</a>`).outcome).toBe('present');
  });

  it('Payment link: different link on the SAME host → swapped', () => {
    const mine = 'https://buy.stripe.com/abc123';
    const evil = 'https://buy.stripe.com/EVIL999';
    const r = analyzePublishedHtml('qr', 'url', mine, `<a href="${evil}">Pay</a>`);
    expect(r.outcome).toBe('swapped');
    expect(r.found.length).toBe(1);
  });

  it('Payment link: only an unrelated host present → missing (no alert)', () => {
    const mine = 'https://buy.stripe.com/abc123';
    expect(analyzePublishedHtml('qr', 'url', mine, '<a href="https://paypal.me/evil">Pay</a>').outcome).toBe('missing');
  });

  it('blank inputs are safe', () => {
    expect(analyzePublishedHtml('address', 'ethereum', '', 'anything').outcome).toBe('missing');
    expect(analyzePublishedHtml('address', 'ethereum', EVM, '').outcome).toBe('missing');
  });
});

describe('verify published-source — hardening / edge cases', () => {
  const EVM = '0xAbC0000000000000000000000000000000001234';
  // Real, checksum-valid Bitcoin legacy addresses.
  const BTC_P2PKH = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';   // genesis (version 0x00)
  const BTC_P2SH = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy';    // P2SH (version 0x05)
  const BTC_BAD = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb';     // genesis w/ corrupted checksum

  it('EVM address inside an href attribute is found (present + swap)', () => {
    expect(analyzePublishedHtml('address', 'ethereum', EVM, `<a href="ethereum:${EVM}">Pay</a>`).outcome).toBe('present');
    const evil = '0xdead000000000000000000000000000000009999';
    expect(analyzePublishedHtml('address', 'ethereum', EVM, `<a href="ethereum:${evil}">Pay</a>`).outcome).toBe('swapped');
  });

  it('registered address appearing multiple times → present', () => {
    expect(analyzePublishedHtml('address', 'ethereum', EVM, `${EVM} ... again ${EVM}`).outcome).toBe('present');
  });

  it('BTC legacy: checksum-validated swap detection', () => {
    expect(analyzePublishedHtml('address', 'bitcoin', BTC_P2PKH, `pay ${BTC_P2PKH}`).outcome).toBe('present');
    const r = analyzePublishedHtml('address', 'bitcoin', BTC_P2PKH, `pay ${BTC_P2SH}`);
    expect(r.outcome).toBe('swapped');
    expect(r.found).toContain(BTC_P2SH);
  });

  it('BTC legacy: a checksum-INVALID lookalike is not a conflict → missing (no false alert)', () => {
    expect(analyzePublishedHtml('address', 'bitcoin', BTC_P2PKH, `pay ${BTC_BAD}`).outcome).toBe('missing');
  });

  it('cross-chain guard: a BTC legacy address is not treated as a Litecoin conflict', () => {
    const ltc = 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6';
    expect(analyzePublishedHtml('address', 'litecoin', ltc, `pay ${BTC_P2PKH}`).outcome).toBe('missing');
  });

  it('Solana: a DIFFERENT valid pubkey is never a conflict (no checksum → presence-only)', () => {
    const wsol = 'So11111111111111111111111111111111111111112';
    const usdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    // Both are valid 32-byte pubkeys; registered one absent, other present → still missing.
    expect(analyzePublishedHtml('address', 'solana', wsol, `pay ${usdc}`).outcome).toBe('missing');
  });
});
