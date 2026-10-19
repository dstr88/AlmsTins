/**
 * The first visit of an account that has the Agent Vault.
 *
 * /dashboard/agentics is two pages at one address (src/pages/dashboard/agentics/index.astro): the
 * door's welcome letter for an account without the Vault, and the Vault's home for one with it. The
 * letter page records the signup and sends the welcome letter once. Once the Vault is open to every
 * account, a new account is handed straight to the Vault's home, so the same work has to run on that
 * path too, or no signup would be recorded and the welcome email the privacy policy promises would
 * never go out.
 *
 * It runs behind the page, never before it: the Vault's home does not wait for a mail server, and
 * welcomeOnFirstVisit never throws (a failure is logged by name and code only). The deployment owner is
 * not a signup: while the Vault is private it is the only account that reaches this path, and it has
 * never had a row or a letter, so it is left out here, by asking the access module who it is (that
 * module stays the one place in the front end that knows).
 */
import { isInternalAgenticsViewer, type AgenticsViewer } from '@/lib/agenticsAccess';
import { welcomeOnFirstVisit } from '@/lib/agenticsSignup';
import { cleanSource } from '@/lib/agenticsSource';
import { getAuthSession } from '@/lib/authSession';

/** Records the signup and sends the welcome letter, once, in the background. Returns at once. */
export function recordVaultFirstVisit(request: Request, session: AgenticsViewer, src: string | null): void {
  const tenantId = session?.tenantId;
  if (!tenantId || session?.isDemo || isInternalAgenticsViewer(session)) return;
  void (async () => {
    const auth = await getAuthSession(request).catch(() => null);
    await welcomeOnFirstVisit({ tenantId, email: auth?.user?.email ?? null, source: cleanSource(src) });
  })().catch(() => {
    // welcomeOnFirstVisit does not throw; this is for the session lookup. The next visit tries again.
  });
}
