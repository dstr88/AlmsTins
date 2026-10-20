/**
 * The answer to a write the page sent to the PetroTins API.
 *
 * The register used to ignore the server's answer. A save the server refused closed the edit
 * box and reloaded the old figure, so a failed save looked like the figure snapping back, with
 * nothing said. This turns every answer into a result the page can show.
 */
export type WriteOutcome = { ok: true } | { ok: false; message: string };

function refusal(status: number, detail: string | null): WriteOutcome {
  // 404 is what the owner-only gate answers once the session is gone.
  if (status === 401 || status === 404) {
    return { ok: false, message: 'Your session has ended, so your change was not saved. Sign in again.' };
  }
  if (status === 403 && detail === 'upgrade_required') {
    return { ok: false, message: 'That needs a paid plan, so your change was not saved.' };
  }
  const why = detail ? `: ${detail}` : '';
  return {
    ok: false,
    message: `Your change was not saved (the server answered ${status}${why}). Try again; if it keeps happening, the problem is on the server, not in what you typed.`,
  };
}

export async function writeToApi(
  url: string,
  init: RequestInit,
  send: typeof fetch = fetch,
): Promise<WriteOutcome> {
  let res: Response;
  try {
    res = await send(url, init);
  } catch {
    return { ok: false, message: 'Could not reach the server, so your change was not saved. Check your connection and try again.' };
  }

  if (res.ok) {
    // The API answers a refusal with a 4xx; a 200 that says { ok: false } is a refusal too.
    try {
      const body = await res.clone().json();
      if (body && body.ok === false) return refusal(res.status, typeof body.error === 'string' ? body.error : null);
    } catch {
      /* not JSON: a 200 is a save */
    }
    return { ok: true };
  }

  let detail: string | null = null;
  try {
    const body = await res.json();
    if (body && typeof body.error === 'string') detail = body.error;
  } catch {
    /* no body */
  }
  return refusal(res.status, detail);
}
