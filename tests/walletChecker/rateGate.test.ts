import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRateGate, RateGateTimeout } from '../../src/lib/rateGate';

/**
 * The gate that keeps the wallet checker under Etherscan's free-plan limit (3 calls per
 * second per key; an extra call is answered with an error, not a delay). Pure timing, so
 * fake timers: no network.
 */

describe('createRateGate', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const task = (log: string[], name: string) => async () => { log.push(name); return name; };

  it('starts at most `limit` calls per window and queues the rest', async () => {
    const gate = createRateGate({ limit: 2, intervalMs: 1000 });
    const log: string[] = [];
    const done = ['a', 'b', 'c', 'd', 'e'].map((n) => gate.schedule(task(log, n)));

    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['a', 'b']);
    await vi.advanceTimersByTimeAsync(999);
    expect(log).toEqual(['a', 'b']);
    await vi.advanceTimersByTimeAsync(1);
    expect(log).toEqual(['a', 'b', 'c', 'd']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(log).toEqual(['a', 'b', 'c', 'd', 'e']);
    await expect(Promise.all(done)).resolves.toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('runs a lower priority number first among calls requested in the same tick', async () => {
    const gate = createRateGate({ limit: 1, intervalMs: 100 });
    const log: string[] = [];
    void gate.schedule(task(log, 'activity-1'), { priority: 1 });
    void gate.schedule(task(log, 'activity-2'), { priority: 1 });
    void gate.schedule(task(log, 'safety'), { priority: 0 });

    await vi.advanceTimersByTimeAsync(500);
    expect(log).toEqual(['safety', 'activity-1', 'activity-2']);
  });

  it('rejects a call that cannot start before its wait limit, and keeps serving the others', async () => {
    const gate = createRateGate({ limit: 1, intervalMs: 1000 });
    const log: string[] = [];
    const first = gate.schedule(task(log, 'first'));
    const impatient = gate.schedule(task(log, 'impatient'), { maxWaitMs: 300 });
    const patient = gate.schedule(task(log, 'patient'));
    const rejected = expect(impatient).rejects.toBeInstanceOf(RateGateTimeout);

    await vi.advanceTimersByTimeAsync(300);
    await rejected;
    await vi.advanceTimersByTimeAsync(700);
    await expect(first).resolves.toBe('first');
    await expect(patient).resolves.toBe('patient');
    expect(log).toEqual(['first', 'patient']);
  });

  it('passes a failing call through as a rejection', async () => {
    const gate = createRateGate({ limit: 3, intervalMs: 1000 });
    const failing = gate.schedule(async () => { throw new Error('upstream 500'); });
    const rejected = expect(failing).rejects.toThrow('upstream 500');
    await vi.advanceTimersByTimeAsync(0);
    await rejected;
  });

  it('refuses a limit below one', () => {
    expect(() => createRateGate({ limit: 0, intervalMs: 1000 })).toThrow();
  });
});
