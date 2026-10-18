import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The Vault's own sender (src/lib/agentVault/mailer.ts). The shared mailer logs "skipping send" and
 * returns when no mail transport is configured, which reads as a sent message to a job that stores
 * that it sent one. This sender throws instead, and gives one send 20 seconds. Nothing real is
 * called: the shared mailer is replaced. Every address is invented.
 */
const shared = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('@/lib/email', () => shared);

const MAIL = { to: 'operator@example.test', subject: 'A subject', text: 'A body' };

let mailer: typeof import('../../src/lib/agentVault/mailer');

beforeEach(async () => {
  vi.resetModules();
  shared.sendMail.mockReset().mockResolvedValue(undefined);
  vi.stubEnv('EMAIL_SERVER', 'smtp://mail.example.test:587');
  mailer = await import('../../src/lib/agentVault/mailer');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('with no mail transport', () => {
  it.each([['not set', undefined], ['empty', '']])('a send throws (EMAIL_SERVER %s) and the shared mailer is never called', async (_name, value) => {
    if (value === undefined) delete process.env.EMAIL_SERVER;
    else vi.stubEnv('EMAIL_SERVER', value);
    const error = await mailer.sendVaultMail(MAIL).catch((e) => e);
    expect(error).toBeInstanceOf(mailer.MailUnavailableError);
    expect(error).toMatchObject({ name: 'MailUnavailableError', code: 'E_NO_MAIL_TRANSPORT' });
    expect(shared.sendMail).not.toHaveBeenCalled();
  });

  it('the error names no one: the address and the text are not in it', async () => {
    delete process.env.EMAIL_SERVER;
    const error = (await mailer.sendVaultMail(MAIL).catch((e) => e)) as Error;
    expect(`${error.name} ${error.message} ${String((error as { code?: unknown }).code)}`).not.toMatch(/operator@|example\.test|A subject|A body/);
  });
});

describe('with a mail transport', () => {
  it('hands the mail to the shared mailer, unchanged, and resolves when it does', async () => {
    await expect(mailer.sendVaultMail(MAIL)).resolves.toBeUndefined();
    expect(shared.sendMail).toHaveBeenCalledTimes(1);
    expect(shared.sendMail).toHaveBeenCalledWith(MAIL);
  });

  it('passes a refusal from the mail server on as it is', async () => {
    const refusal = Object.assign(new Error('550 mailbox unavailable'), { name: 'SmtpError', code: 'EENVELOPE' });
    shared.sendMail.mockRejectedValue(refusal);
    await expect(mailer.sendVaultMail(MAIL)).rejects.toBe(refusal);
  });

  it('leaves no timer behind after a send that finished', async () => {
    vi.useFakeTimers();
    await mailer.sendVaultMail(MAIL);
    expect(vi.getTimerCount()).toBe(0);
    shared.sendMail.mockRejectedValue(new Error('refused'));
    await mailer.sendVaultMail(MAIL).catch(() => {});
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('a send that hangs', () => {
  it('is given twenty seconds, then fails as a timeout (not a hang)', async () => {
    expect(mailer.SEND_TIMEOUT_MS).toBe(20_000);
    vi.useFakeTimers();
    shared.sendMail.mockReturnValue(new Promise(() => {})); // the server accepts the connection and says nothing
    let settled: 'pending' | 'resolved' | 'rejected' = 'pending';
    let error: unknown;
    const sending = mailer.sendVaultMail(MAIL).then(
      () => { settled = 'resolved'; },
      (e) => { settled = 'rejected'; error = e; },
    );
    await vi.advanceTimersByTimeAsync(19_999);
    expect(settled).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    await sending;
    expect(settled).toBe('rejected');
    expect(error).toBeInstanceOf(mailer.MailTimeoutError);
    expect(error).toMatchObject({ name: 'MailTimeoutError', code: 'E_MAIL_TIMEOUT' });
  });

  it('a send that finishes at nineteen seconds is a success', async () => {
    vi.useFakeTimers();
    shared.sendMail.mockReturnValue(new Promise<void>((resolve) => setTimeout(resolve, 19_000)));
    const sending = mailer.sendVaultMail(MAIL);
    await vi.advanceTimersByTimeAsync(19_000);
    await expect(sending).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(5_000); // the timeout's moment passes with nothing left to fail
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a refusal that arrives after the timeout is not left as an unhandled rejection', async () => {
    vi.useFakeTimers();
    let refuse!: (e: Error) => void;
    shared.sendMail.mockReturnValue(new Promise((_, reject) => { refuse = reject; }));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const sending = mailer.sendVaultMail(MAIL).catch((e) => e);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await sending).toBeInstanceOf(mailer.MailTimeoutError);
      refuse(new Error('too late'));
      await vi.advanceTimersByTimeAsync(10);
      await Promise.resolve();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
