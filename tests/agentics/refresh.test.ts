import { describe, it, expect } from 'vitest';
import { describeRefresh, passOf } from '../../src/components/agentics/refresh';

/**
 * What "Read the chain now" says when it is done: a few plain sentences from the pass report, honest
 * about a wallet that could not be read, and about the transfers that went to or came from an address
 * not on the list (slice 8: they are recorded and counted, never hidden).
 */
const pass = (over: Record<string, unknown> = {}) => ({
  wallets: [{ status: 'complete' }],
  recorded: 0,
  unregistered: 0,
  unmatched: 0,
  ...over,
});

describe('passOf', () => {
  it('reads the report out of an answer, and only the parts the sentences use', () => {
    const body = { ok: true, pass: { tinId: 'x', startedAt: 't', registered: { trusted: 2, pending: 1, flagged: 1 }, wallets: [{ status: 'partial', address: '0xabc', transfers: 9 }, { status: 'idle' }], recorded: 3, unregistered: 2, unmatched: 1 } };
    expect(passOf(body)).toEqual({ wallets: [{ status: 'partial' }, { status: 'idle' }], recorded: 3, unregistered: 2, unmatched: 1 });
  });

  it('answers null when there is no report, and fills the gaps of a thin one with zeros', () => {
    for (const bad of [null, {}, { pass: null }, { pass: 'x' }]) expect(passOf(bad as never)).toBeNull();
    expect(passOf({ pass: {} })).toEqual({ wallets: [], recorded: 0, unregistered: 0, unmatched: 0 });
    expect(passOf({ pass: { unregistered: 'many', unmatched: Number.NaN } })).toMatchObject({ unregistered: 0, unmatched: 0 });
  });

  it('turns a wallet with no status into one that failed, never into one that is fine', () => {
    expect(passOf({ pass: { wallets: [{}] } })?.wallets).toEqual([{ status: 'failed' }]);
  });
});

describe('describeRefresh', () => {
  it('says nothing was read when the agent has no wallet', () => {
    expect(describeRefresh(pass({ wallets: [] }))).toEqual(['This agent has no wallet yet, so there is nothing to read.']);
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

  it('says how many transfers read went to or came from an address not on the list, and how many of those were unmatched outflows', () => {
    expect(describeRefresh(pass({ unregistered: 1 })).pop()).toBe('1 transfer read was to or from an address not on the list.');
    expect(describeRefresh(pass({ unregistered: 3, unmatched: 1 })).pop()).toBe('3 transfers read were to or from an address not on the list; 1 was an outflow with no check before it (unmatched).');
    expect(describeRefresh(pass({ unregistered: 4, unmatched: 2 })).pop()).toBe('4 transfers read were to or from an address not on the list; 2 were outflows with no check before them (unmatched).');
    expect(describeRefresh(pass({ unregistered: 0 })).join(' ')).not.toMatch(/not on the list/);
  });

  it('never calls anything safe, and never says Almstins stopped or held a payment', () => {
    const all = describeRefresh(pass({ wallets: [{ status: 'complete' }, { status: 'partial' }], recorded: 2, unregistered: 2, unmatched: 1 })).join(' ');
    expect(all).not.toMatch(/\bsafe\b|\bstopped\b|\bblocked\b|\bheld\b/i);
  });
});
