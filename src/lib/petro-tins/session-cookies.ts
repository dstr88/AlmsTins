// Session cookie names cleared when entering the PetroTins demo, so a logged-in
// user isn't bounced into their own dashboard instead of the demo. Centralized
// here so any future "switch to demo" / "exit demo" flow reuses the same list.

export const SESSION_COOKIE_NAMES = [
  'next-auth.session-token',
  'authjs.session-token',
  '__Secure-next-auth.session-token',
  '__Secure-authjs.session-token',
] as const;

/** Append an expired Set-Cookie header for every known session cookie. */
export function clearSessionCookies(headers: Headers): void {
  for (const name of SESSION_COOKIE_NAMES) {
    headers.append(
      'Set-Cookie',
      `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`,
    );
  }
}
