/**
 * Password sign-in (the Auth.js Credentials provider's authorize), kept out of the route
 * file so it can be tested without Auth.js or a database.
 *
 * A password proves only that someone chose it. The sign-up form accepts any address, so
 * until the address is verified a password account proves nothing about who holds it, and
 * signing it in would hand a tenant to whoever typed the address. So:
 *   - wrong password or unknown address: null (Auth.js shows the generic failure). The
 *     password is checked FIRST, so nobody without it learns whether the address is verified;
 *   - right password, verified address: signed in;
 *   - right password, unverified address, password-only account: refused with
 *     EmailNotVerifiedError (?error=CredentialsSignin&code=email_unverified), and the
 *     verification email is re-sent (rate-limited), which is what the message tells them;
 *   - right password, unverified address, account ALSO has a Google/GitHub link: refused
 *     with UseProviderError (code=use_provider: "sign in with Google/GitHub"), and nothing
 *     is sent. That is the shape of a pre-registered password on someone else's address,
 *     and re-sending would put the link in the owner's inbox on the password holder's
 *     timing.
 */
import { CredentialsSignin } from '@auth/core/errors';
import { db } from './db';
import { verifyPassword } from './passwords';
import { normalizeLoginEmail } from './emailAddress';
import { isEmailVerifiedValue } from './sessionGate';
import { maybeResendSignupVerification } from './signupVerification';

/** The password was right but the address was never verified. */
export class EmailNotVerifiedError extends CredentialsSignin {
	code = 'email_unverified';
}

/** The password was right, the address was never verified, and the account signs in with Google/GitHub. */
export class UseProviderError extends CredentialsSignin {
	code = 'use_provider';
}

export type AuthorizedUser = { id: string; name: string | null; email: string | null };

const toBool = (v: unknown) => v === true || v === 1 || v === '1' || v === 't' || v === 'true';

export async function authorizeCredentials(
	credentials: Partial<Record<string, unknown>> | undefined,
	request?: Request,
): Promise<AuthorizedUser | null> {
	const email = normalizeLoginEmail(credentials?.email);
	const password = typeof credentials?.password === 'string' ? credentials.password : '';
	if (!email || !password) return null;

	const result = await db.execute({
		sql: `SELECT u.id, u.name, u.email, u.email_verified, c.password_hash,
		             EXISTS (SELECT 1 FROM auth_accounts a WHERE a.user_id = u.id) AS has_account
		      FROM auth_users u
		      JOIN auth_credentials c ON c.user_id = u.id
		      WHERE u.email = ? LIMIT 1`,
		args: [email],
	});
	const row = result.rows[0] as Record<string, unknown> | undefined;
	if (!row) return null;

	const ok = await verifyPassword(password, String(row.password_hash ?? ''));
	if (!ok) return null;

	const userId = String(row.id);
	if (!isEmailVerifiedValue(row.email_verified)) {
		if (toBool(row.has_account)) throw new UseProviderError();
		await maybeResendSignupVerification(userId, email, request);
		throw new EmailNotVerifiedError();
	}

	return {
		id: userId,
		name: row.name == null ? null : String(row.name),
		email: row.email == null ? null : String(row.email),
	};
}
