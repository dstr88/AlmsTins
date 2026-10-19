import { describe, it, expect } from 'vitest';
import { describeRefresh, passOf, DAILY_READ_COVERS } from '../../src/components/agentics/refresh';

/**
 * What "Read the chain now" says when it is done: a few plain sentences from the pass report, honest
 * about a wallet that could not be read and silent about anything outside the registry.
 */
const pass = (over: Record<string, unknown> = {}) => ({
  watchedDestinations: 3,
  notWatched: { overLimit: 0 },
  wallets: [{ status: 'complete' }],
  recorded: 0,
  ...over,
});

describe('passOf', () => {
  it('reads the report out of an answer, and only the parts the sentences use', () => {
    const body = { ok: true, pass: { tinId: 'x', startedAt: 't', watchedDestinations: 2, notWatched: { pending: 1, flagged: 1, overLimit: 4 }, wallets: [{ status: 'partial', address: '0xabc', matched: 9 }, { status: 'idle' }], recorded: 3 } };
    expect(passOf(body)).toEqual({ watchedDestinations: 2, notWatched: { overLimit: 4 }, wallets: [{ status: 'partial' }, { status: 'idle' }], recorded: 3 });
  });

  it('answers null when there is no report, and fills the gaps of a thin one with zeros', () => {
    for (const bad of [null, {}, { pass: null }, { pass: 'x' }]) expect(passOf(bad as never)).toBeNull();
    expect(passOf({ pass: {} })).toEqual({ watchedDestinations: 0, notWatched: { overLimit: 0 }, wallets: [], recorded: 0 });
  });

  it('turns a wallet with no status into one that failed, never into one that is fine', () => {
    expect(passOf({ pass: { wallets: [{}] } })?.wallets).toEqual([{ status: 'failed' }]);
  });
});

describe('describeRefresh', () => {
  it('says nothing was read when no address is trusted yet', () => {
    expect(describeRefresh(pass({ wallets: [], watchedDestinations: 0 }))).toEqual(['No registered address is trusted yet, so there is nothing to read.']);
  });

  it('says so when no wallet is on a chain with a trusted address', () => {
    expect(describeRefresh(pass({ wallets: [] }))).toEqual(["None of this agent's wallets is on the same chain as a trusted address, so there is nothing to read."]);
  });

  it('counts wallets by how far they were read, and says how many transfers were recorded', () => {
    expect(describeRefresh(pass({ wallets: [{ status: 'complete' }, { status: 'complete' }], recorded: 1 }))).toEqual([
      '2 wallets read up to the newest confirmed block.',
      '1 new transfer recorded.',
    ]);
    expect(describeRefresh(pass({ wallets: [{ status: 'complete' }], recorded: 0 }))).toEqual(['1 wallet read up to the newest confirmed block.', 'No new transfers.']);
    expect(describeRefresh(pass({ wallets: [{ status: 'complete' }], recorded: 7 }))[1]).toBe('7 new transfers recorded.');
  });

  it('is honest about a wallet that was read part of the way, one that could not be read and one that could not be saved', () => {
    const lines = describeRefresh(pass({ wallets: [{ status: 'partial' }, { status: 'unavailable' }, { status: 'failed' }, { status: 'idle' }, { status: 'complete' }], recorded: 2 }));
    expect(lines).toEqual([
      '1 wallet read up to the newest confirmed block.',
      '1 wallet read part of the way. The next read continues where this one ended.',
      '1 wallet could not be read just now, because the block explorer did not answer. Try again later.',
      '1 wallet could not be saved just now. Try again later.',
      '1 wallet had nothing new to read yet.',
      '2 new transfers recorded.',
    ]);
  });

  it('reports a status it does not know as a wallet that was not saved: nothing is hidden', () => {
    const lines = describeRefresh(pass({ wallets: [{ status: 'mystery' }, { status: 'complete' }] }));
    expect(lines).toContain('1 wallet could not be saved just now. Try again later.');
    expect(lines).toContain('1 wallet read up to the newest confirmed block.');
  });

  it('says how many trusted addresses the daily read does not cover for an account, and that they were not read', () => {
    expect(DAILY_READ_COVERS).toBe(15);
    expect(describeRefresh(pass({ notWatched: { overLimit: 1 } })).pop()).toBe('1 trusted address is past the 15 the daily read covers for an account, so it was not read.');
    expect(describeRefresh(pass({ notWatched: { overLimit: 3 } })).pop()).toBe('3 trusted addresses are past the 15 the daily read covers for an account, so they were not read.');
    expect(describeRefresh(pass({ notWatched: { overLimit: 0 } })).join(' ')).not.toMatch(/past the/);
  });

  it('says nothing about any address that is not in the registry', () => {
    const all = describeRefresh(pass({ wallets: [{ status: 'complete' }, { status: 'partial' }], recorded: 2, notWatched: { overLimit: 2 } })).join(' ');
    expect(all).not.toMatch(/unregistered|outside|other address|unknown address|not in the registry/i);
  });
});
