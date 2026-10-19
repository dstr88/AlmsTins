/**
 * How many addresses an account may have the Vault check in a minute. Every check an owner starts
 * from the Vault (adding an address, checking it again) asks the same screening sources the public
 * wallet checker asks, with the app's own keys, and those sources have a small budget shared with
 * everything else on the site. The public checker holds a visitor to 10 checks a minute and keeps an
 * answer for five; the Vault holds an account to a budget of its own and reuses the same answers.
 *
 * The budget is counted in addresses, not requests: a paste of ten addresses costs ten, one address
 * checked again costs one. A person who keeps ten addresses and looks at each of them never nears
 * it; a script that adds and removes addresses in a loop does within seconds. Counted per account in
 * this process only (it resets on a restart), like the report and export limits: it blunts bursts, it
 * is not a durable quota.
 *
 * An account on a plan without a cap on addresses (today: the deployment owner's) is not held to it.
 * Paid plans that come later get a budget of their own in the same place.
 */

/** Addresses one account may have checked in one window. Fifteen addresses on the Free plan, checked twice over, still fit. */
export const CHECKS_PER_WINDOW = 30;
export const CHECK_WINDOW_MS = 60_000;

export interface CheckBudget {
  /**
   * Takes `n` checks from the account's window. False, with nothing taken, when that would pass the
   * window's maximum; the caller then refuses the request before it writes or asks anyone anything.
   */
  spend(tenantId: string, n: number, now?: number): boolean;
  /**
   * Gives back `n` checks that were paid for and not made (an address that was already registered, a
   * line that did not fit the plan). `spentAt` is the time they were paid for (the `now` given to
   * `spend`), and they are given back only if the account's window is still the one they were taken
   * from: a request that ends after a newer window has opened must not refund into it, or the new
   * window would pass its maximum. Never below none used.
   */
  refund(tenantId: string, n: number, spentAt: number): void;
}

export function createCheckBudget(opts: { windowMs?: number; max?: number; maxKeys?: number } = {}): CheckBudget {
  const windowMs = opts.windowMs ?? CHECK_WINDOW_MS;
  const max = opts.max ?? CHECKS_PER_WINDOW;
  const maxKeys = opts.maxKeys ?? 10_000;
  const windows = new Map<string, { used: number; resetAt: number }>();

  const prune = (now: number) => {
    for (const [k, w] of windows) if (now >= w.resetAt) windows.delete(k);
    // Still over the bound: drop the oldest windows (a Map iterates in insertion order).
    for (const k of windows.keys()) {
      if (windows.size <= maxKeys) break;
      windows.delete(k);
    }
  };

  return {
    spend(tenantId, n, now = Date.now()) {
      if (!(n > 0)) return true;
      let w = windows.get(tenantId);
      if (!w || now >= w.resetAt) {
        if (w) windows.delete(tenantId);
        w = { used: 0, resetAt: now + windowMs };
        windows.set(tenantId, w);
        if (windows.size > maxKeys) prune(now);
      }
      if (w.used + n > max) return false;
      w.used += n;
      return true;
    },
    refund(tenantId, n, spentAt) {
      const w = windows.get(tenantId);
      if (!w || !(n > 0) || !Number.isFinite(spentAt)) return;
      // The window the checks were paid in began when its first spend did and ends windowMs later. A charge
      // from an earlier window went with that window; giving it back to this one would buy room the
      // account did not have.
      if (spentAt < w.resetAt - windowMs || spentAt >= w.resetAt) return;
      w.used = Math.max(0, w.used - n);
    },
  };
}

/** The one budget the running server shares between everything that checks addresses for an account. */
export const defaultCheckBudget: CheckBudget = createCheckBudget();
