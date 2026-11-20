/**
 * Almstins Verify: the address a visitor checked on the public Verify page, carried to the first
 * screen after sign-in (Verify first run, Part D).
 *
 * A business owner pastes the address they ask people to pay into the field on /verify, sees what
 * a payer sees, and presses "Prove it's yours, free". That leads to the Verify sign-in, and the
 * first-run card on /dashboard/verify should already hold the address they checked.
 *
 * Privacy is part of the product, so the value travels in one place only: this browser tab's
 * session storage.
 *   - It is never put in a link: the sign-in link is the same for everyone (verifyCheckFirst.ts).
 *   - It is never sent to the server by this file. Nothing here makes a request.
 *   - It is written only when the visitor presses the button, and it is one value: a new one
 *     replaces the old.
 *   - It is removed the moment the dashboard reads it (takeCarriedDestination reads and clears in
 *     one step, whoever the account is), when the visitor comes back to the Verify page or checks
 *     something else there (clearCarriedDestination), when the tab closes (session storage), and
 *     after CARRY_MAX_AGE_MS in any case, so a tab left open does not hand an old address to
 *     whoever signs in next.
 *
 * Session storage is per tab. A sign-in that returns in the same tab (Google, GitHub, a password)
 * finds the value; an emailed sign-in link opens a new tab and does not, and the card is then
 * simply empty.
 *
 * Browser-side and import-free. Every function takes the store and the clock as arguments, so a
 * test needs no browser; with no store (the server, or a browser that refuses storage) each one
 * does nothing.
 */

/** The one session-storage key. */
export const CARRY_KEY = 'almstins.verify.checked';
/** How long a carried value is good for: one hour. */
export const CARRY_MAX_AGE_MS = 60 * 60 * 1000;
/** The longest value carried: the public lookup's own cap for a payment link or code. */
export const CARRY_MAX_LENGTH = 1024;

/** The part of the Web Storage API this file uses. */
export type CarryStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** This tab's session storage, or null where there is none or the browser refuses it. */
function tabStore(): CarryStore | null {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

const CONTROL = /[\u0000-\u001f\u007f]/;

/** The value as it may be carried: trimmed, one line, within the cap. Null for anything else. */
function carriable(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > CARRY_MAX_LENGTH || CONTROL.test(v)) return null;
  return v;
}

/**
 * Keep what the visitor checked, in this tab only. Returns whether it was kept: a browser that
 * refuses storage is not an error, the first screen is just empty.
 */
export function carryDestination(value: string, store: CarryStore | null = tabStore(), now: number = Date.now()): boolean {
  const v = carriable(value);
  if (!store || !v) return false;
  try {
    store.setItem(CARRY_KEY, JSON.stringify({ v, t: now }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the carried value and remove it, in one step. The value is gone from the browser after
 * this call whether or not it was usable. Null when there is none, it is too old, or it is not
 * something carryDestination would have written.
 */
export function takeCarriedDestination(store: CarryStore | null = tabStore(), now: number = Date.now()): string | null {
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(CARRY_KEY);
    store.removeItem(CARRY_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; t?: unknown } | null;
    if (!parsed || typeof parsed.t !== 'number' || !Number.isFinite(parsed.t)) return null;
    const age = now - parsed.t;
    if (age < 0 || age > CARRY_MAX_AGE_MS) return null;
    return carriable(parsed.v);
  } catch {
    return null;
  }
}

/** Remove the carried value without reading it. */
export function clearCarriedDestination(store: CarryStore | null = tabStore()): void {
  if (!store) return;
  try {
    store.removeItem(CARRY_KEY);
  } catch {
    /* a browser that refuses storage has nothing to remove */
  }
}
