import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readDestinationInput, choicesFor, registrationFor } from '../../src/lib/verifyDestinationInput';
import { registerDestination, registerErrorText } from '../../src/lib/verifyRegister';
import { VERIFY_ADDRESS_RAILS } from '../../src/lib/chains';
import { en } from '../../src/i18n/dashboard/verify';

/**
 * Verify first run, Part C: the first-run card has one field. It takes a wallet address, a payment
 * link or the text of a payment QR (src/lib/verifyDestinationInput.ts reads which), and registers
 * it through the dashboard's one registration call (src/lib/verifyRegister.ts).
 *
 * Every address and link here is made up: right shape, no real wallet or business.
 */

const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BODY = 'TestAddressMadeUpForVitestXyz23'; // 31 base58 characters
const EVM = `0x${'ab12'.repeat(10)}`;
const BTC_SEGWIT = `bc1q${BECH32}`;
const LTC_SEGWIT = `ltc1q${BECH32}`;
const BTC_LEGACY = `1${BODY}`;
const P2SH = `3${BODY}`;
const LTC_LEGACY = `L${BODY}`;
const SOLANA = `MadeUpSo${'x9Yz'.repeat(9)}`; // 44 base58 characters
const LINK = 'https://buy.example.com/test_made_up_123';
const PIX = '00020126360014br.gov.bcb.pix0114+5500000000005204000053039865802BR5909Loja Demo6009Sao Paulo6304ABCD';
const UPI = 'upi://pay?pa=loja@examplebank&pn=Loja%20Demo';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('readDestinationInput: a wallet address, and the network its shape settles', () => {
  it.each([
    [BTC_SEGWIT, 'bitcoin'],
    [BTC_SEGWIT.toUpperCase(), 'bitcoin'], // the form a QR carries
    [BTC_LEGACY, 'bitcoin'],
    [LTC_SEGWIT, 'litecoin'],
    [LTC_LEGACY, 'litecoin'],
    [`M${BODY}`, 'litecoin'],
    [SOLANA, 'solana'],
  ])('%s is one network: %s', (value, rail) => {
    const input = readDestinationInput(value);
    expect(input).toEqual({ kind: 'address', value, rails: [rail] });
    expect(choicesFor(input)).toEqual([]);
    expect(registrationFor(input, '')).toEqual({ kind: 'address', rail, value, label: null });
  });

  it('a 0x address is the same key on three networks, so the card asks which', () => {
    const input = readDestinationInput(EVM);
    expect(input).toEqual({ kind: 'address', value: EVM, rails: ['ethereum', 'polygon', 'avalanche'] });
    expect(choicesFor(input)).toEqual(['ethereum', 'polygon', 'avalanche']);
    expect(registrationFor(input, '')).toBeNull(); // nothing is preselected
    expect(registrationFor(input, 'polygon')).toEqual({ kind: 'address', rail: 'polygon', value: EVM, label: null });
    expect(registrationFor(input, 'bitcoin')).toBeNull(); // not one of its networks
    expect(registrationFor(input, 'qr')).toBeNull();
  });

  it('a "3…" address fits Bitcoin and Litecoin', () => {
    const input = readDestinationInput(P2SH);
    expect(choicesFor(input)).toEqual(['bitcoin', 'litecoin']);
    expect(registrationFor(input, 'litecoin')).toMatchObject({ kind: 'address', rail: 'litecoin', value: P2SH });
  });

  it('a payment URI gives its bare address, and its scheme settles the network', () => {
    expect(readDestinationInput(`bitcoin:${BTC_SEGWIT}?amount=0.01`)).toEqual({ kind: 'address', value: BTC_SEGWIT, rails: ['bitcoin'] });
    expect(readDestinationInput(`litecoin:${P2SH}`)).toEqual({ kind: 'address', value: P2SH, rails: ['litecoin'] });
    expect(readDestinationInput(`ethereum:${EVM}@137`)).toMatchObject({ kind: 'address', value: EVM });
  });

  it('surrounding spaces are dropped; a mixed-case segwit address is not an address', () => {
    expect(readDestinationInput(`  ${SOLANA}\n`)).toMatchObject({ kind: 'address', value: SOLANA });
    expect(readDestinationInput(`bc1Q${BECH32}`).kind).toBe('unknown');
  });
});

describe('readDestinationInput: a payment link or QR can be the first destination', () => {
  it('an https link registers as a payment link, with no network to choose', () => {
    const input = readDestinationInput(LINK);
    expect(input).toEqual({ kind: 'qr', what: 'link', value: LINK });
    expect(choicesFor(input)).toEqual([]);
    expect(registrationFor(input, '')).toEqual({ kind: 'qr', rail: 'url', value: LINK, label: null });
  });

  it('a link pasted without https:// gets it, so it matches the same link read from a QR', () => {
    expect(readDestinationInput('buy.example.com/test_made_up_123')).toEqual({ kind: 'qr', what: 'link', value: LINK });
  });

  it('a link that carries a 0x address is still a link', () => {
    expect(readDestinationInput(`https://pay.example.com/to/${EVM}`).kind).toBe('qr');
  });

  it.each([['PIX', PIX], ['UPI', UPI]])('the text of a %s payment QR registers as a payment QR code', (_name, value) => {
    const input = readDestinationInput(value);
    expect(input).toEqual({ kind: 'qr', what: 'code', value });
    expect(registrationFor(input, '')).toEqual({ kind: 'qr', rail: 'url', value, label: null });
  });
});

describe('readDestinationInput: nothing typed, or something this file does not know', () => {
  it('an empty field registers nothing', () => {
    expect(readDestinationInput('   ')).toEqual({ kind: 'empty' });
    expect(registrationFor(readDestinationInput(''), '')).toBeNull();
  });

  it.each([
    ['an address on a network Verify does not take', `T${'ronLikeMadeUpAddressForVitest2345'}`],
    ['a name-service handle', 'madeupshop.eth'],
    ['plain words', 'pay me here'],
  ])('%s is unknown: the owner chooses a network or "payment link or QR"', (_what, value) => {
    const input = readDestinationInput(value);
    expect(input).toEqual({ kind: 'unknown', value });
    expect(choicesFor(input)).toEqual([...VERIFY_ADDRESS_RAILS, 'qr']);
    expect(registrationFor(input, '')).toBeNull();
    expect(registrationFor(input, 'solana')).toEqual({ kind: 'address', rail: 'solana', value, label: null });
    expect(registrationFor(input, 'qr')).toEqual({ kind: 'qr', rail: 'url', value, label: null });
  });
});

describe('registerDestination: the one registration call', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const answer = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  const LIMIT = 'the plan limit, in the caller’s words';

  it('posts kind, rail, value and label to /api/verify/destinations and returns the stored row', async () => {
    const fetchMock = answer({ ok: true, destination: { id: 'd-1', kind: 'qr', rail: 'url', value: LINK } });
    vi.stubGlobal('fetch', fetchMock);
    const registration = registrationFor(readDestinationInput(LINK), '')!;
    const res = await registerDestination(registration, en, LIMIT);
    expect(res).toEqual({ ok: true, destination: { id: 'd-1', kind: 'qr', rail: 'url', value: LINK } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/verify/destinations');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ kind: 'qr', rail: 'url', value: LINK, label: null });
  });

  it.each([
    ['limit_reached', LIMIT],
    ['duplicate', en.addErrDuplicate],
    ['invalid', en.addErrInvalid],
    ['claimed_elsewhere', en.addErrClaimed],
    ['name_taken', en.addErrNameTaken],
  ])('a refusal of %s reads as the dashboard has always worded it', async (error, text) => {
    vi.stubGlobal('fetch', answer({ ok: false, error, message: 'the server’s own sentence' }, 400));
    expect(await registerDestination({ kind: 'address', rail: 'bitcoin', value: BTC_SEGWIT, label: null }, en, LIMIT))
      .toEqual({ ok: false, text });
  });

  it('any other refusal reads as the server’s message, or the plain sentence without one', () => {
    expect(registerErrorText({ error: 'demo_readonly', message: 'Read-only in the demo.' }, en, LIMIT)).toBe('Read-only in the demo.');
    expect(registerErrorText({ error: 'demo_readonly' }, en, LIMIT)).toBe(en.addError);
    expect(registerErrorText(null, en, LIMIT)).toBe(en.addError);
  });

  it('a request that never reaches the server reads as the plain sentence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    expect(await registerDestination({ kind: 'address', rail: 'solana', value: SOLANA, label: null }, en, LIMIT))
      .toEqual({ ok: false, text: en.addError });
  });

  it('there is no second registration call: both forms and the card go through this one', () => {
    const island = read('src/components/verify/VerifyDashboard.tsx');
    const card = read('src/components/verify/FirstRunCard.tsx');
    // The only POST to the registration route in the browser code is the one in verifyRegister.ts.
    expect(island).not.toMatch(/fetch\('\/api\/verify\/destinations',\s*\{/);
    expect(card).not.toContain('fetch(');
    expect(island).toContain('registerDestination({ kind, rail, value: value.trim(), label: label.trim() || null }, t, limitText)');
    expect(card).toContain('registerDestination(registration, t, limitText(registration.kind))');
  });
});
