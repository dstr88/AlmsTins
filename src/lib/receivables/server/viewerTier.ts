/**
 * Which detail tier a signed-in viewer gets on the duplicate check (S3): the full answer (basis,
 * financed and settled booleans, the viewer's own matching records) for a verified account, and
 * the state alone for any other. Verified means isVerifiedUser: a verified email, or a Google or
 * GitHub sign-in. requireTenantSession returns only the tenant, so this reads the session a second
 * time, the way the send route does.
 *
 * Fail closed: any error reads as not verified. Route tests mock this module.
 */
import { getAuthSession } from '@/lib/authSession';
import { isVerifiedUser } from '@/lib/sessionGate';

export async function isVerifiedViewer(request: Request): Promise<boolean> {
	try {
		const auth = await getAuthSession(request);
		return await isVerifiedUser(auth?.user?.id);
	} catch {
		return false;
	}
}
