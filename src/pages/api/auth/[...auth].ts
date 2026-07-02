import type { APIRoute } from 'astro';
import { Auth } from '@auth/core';
import Email from '@auth/core/providers/email';
import Credentials from '@auth/core/providers/credentials';
import GitHub from '@auth/core/providers/github';
import Google from '@auth/core/providers/google';
import { db } from '../../../lib/db';
import { authAdapter } from '../../../lib/authAdapter';
import { verifyPassword } from '../../../lib/passwords';
import { getPostLoginRedirect } from '../../../lib/postLoginRedirect';
import { ensureTenantForUser, resolveActiveTenantId } from '../../../lib/tenants';
import { isEmailDomainBlocked } from '../../../lib/blockedEmailDomains';

const providers = [];

if (process.env.GOOGLE_ID && process.env.GOOGLE_SECRET) {
	providers.push(
		Google({
			clientId: process.env.GOOGLE_ID,
			clientSecret: process.env.GOOGLE_SECRET,
			allowDangerousEmailAccountLinking: true,
		}),
	);
}

if (process.env.GITHUB_ID && process.env.GITHUB_SECRET) {
	providers.push(
		GitHub({
			clientId: process.env.GITHUB_ID,
			clientSecret: process.env.GITHUB_SECRET,
			allowDangerousEmailAccountLinking: true,
			// Request user:email so GitHub returns the primary verified email
			// even when the user has it set to private.  Without this scope
			// GitHub omits the email field entirely, making it impossible to
			// deduplicate accounts or link OAuth logins to an existing tenant.
			authorization: {
				params: { scope: 'read:user user:email' },
			},
		}),
	);
}

if (process.env.EMAIL_SERVER && process.env.EMAIL_FROM) {
	providers.push(
		Email({
			server: process.env.EMAIL_SERVER,
			from: process.env.EMAIL_FROM,
		}),
	);
}

providers.push(
	Credentials({
		name: 'Credentials',
		credentials: {
			email: { label: 'Email', type: 'email' },
			password: { label: 'Password', type: 'password' },
		},
		async authorize(credentials) {
			const email = typeof credentials?.email === 'string' ? credentials.email.toLowerCase() : '';
			const password = typeof credentials?.password === 'string' ? credentials.password : '';
			if (!email || !password) {
				return null;
			}

			const userResult = await db.execute({
				sql: `SELECT u.id, u.name, u.email, c.password_hash
          FROM auth_users u
          JOIN auth_credentials c ON c.user_id = u.id
          WHERE u.email = ? LIMIT 1`,
				args: [email],
			});
			if (!userResult.rows.length) {
				return null;
			}
			const row = userResult.rows[0] as Record<string, any>;
			const ok = await verifyPassword(password, String(row.password_hash ?? ''));
			if (!ok) {
				return null;
			}

			return { id: String(row.id), name: row.name ?? null, email: row.email ?? null };
		},
	}),
);

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

const authConfig = {
	basePath: '/api/auth',
	providers,
	adapter: authAdapter(),
	secret: process.env.AUTH_SECRET,
	trustHost: true,
	debug: process.env.AUTH_DEBUG === '1',
	session: { strategy: 'jwt' as const, maxAge: SESSION_MAX_AGE_SECONDS },
	jwt: { maxAge: SESSION_MAX_AGE_SECONDS },
	pages: {
		signIn: '/login',
		error: '/login',
	},
	callbacks: {
		async signIn({ user, account, profile }: { user?: any; account?: any; profile?: any }) {
			// ── Blocked email-domain screen (sanctions supplement; weak signal) ────
			// Reject any sign-in / sign-up whose email domain is on the blocklist.
			// The IP geo-block (src/middleware/geoblock.ts) is the primary control.
			const screenEmail = (profile?.email || user?.email || '') as string;
			if (screenEmail && isEmailDomainBlocked(screenEmail)) {
				console.warn('[auth] sign-in blocked — email domain on blocklist');
				return false;
			}

			// ── OAuth / OIDC account linking ───────────────────────────────────────
			// If a social sign-in (OAuth or OIDC) arrives for an email that already
			// exists via a different provider (e.g. credentials), pre-emptively link
			// the account so Auth.js never hits OAuthAccountNotLinked.
			// NOTE: Google is type 'oidc', GitHub is type 'oauth' — handle both.
			// Prefer profile.email (raw provider data) over user.email (adapter user,
			// which may have a stale/empty email if the DB record predates OAuth).
			const providerEmail = (profile?.email || user?.email || '') as string;
			if (account?.type === 'oauth' || account?.type === 'oidc') {
				// ── Layer 1: email-based deduplication (credentials-only accounts only) ──
				// If a user with this email exists AND they only have credentials (no OAuth),
				// link them to this OAuth provider so they don't need separate passwords.
				// Do NOT link if they already have OAuth accounts from other services —
				// that means they intentionally use different services (almstins vs tradifitins).
				if (providerEmail) {
					try {
						const existing = await db.execute({
							sql: 'SELECT id FROM auth_users WHERE email = ? LIMIT 1',
							args: [providerEmail.toLowerCase()],
						});
						if (existing.rows.length) {
							const existingId = String((existing.rows[0] as Record<string, any>).id);
							if (existingId !== String(user.id ?? '')) {
								// Check if this existing user has ANY OAuth accounts
								const existingOAuthAccounts = await db.execute({
									sql: `SELECT COUNT(*) as cnt FROM auth_accounts
										  WHERE user_id = ? AND (type = 'oauth' OR type = 'oidc')`,
									args: [existingId],
								});
								const hasOAuthAccounts = Number((existingOAuthAccounts.rows[0] as Record<string, any>)?.cnt ?? 0) > 0;

								// Only link if they have NO OAuth accounts (credentials-only signup)
								if (!hasOAuthAccounts) {
									user.id = existingId;
									await db.execute({
										sql: `INSERT INTO auth_accounts
											(id, user_id, type, provider, provider_account_id,
											 access_token, token_type, scope, expires_at, refresh_token, id_token, session_state)
											VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT DO NOTHING`,
										args: [
											crypto.randomUUID(),
											existingId,
											account.type,
											account.provider,
											account.providerAccountId,
											account.access_token ?? null,
											account.token_type ?? null,
											account.scope ?? null,
											account.expires_at ?? null,
											account.refresh_token ?? null,
											account.id_token ?? null,
											account.session_state ?? null,
										],
									});
									console.log('[auth][signIn] linked OAuth account to credentials-only user via email', {
										existingId,
										provider: account.provider,
									});
								} else {
									// User has OAuth accounts from other services — allow new separate account
									console.log('[auth][signIn] email exists but user has OAuth accounts, allowing separate signup', {
										existingId,
										provider: account.provider,
									});
								}
							}
						}
					} catch (error) {
						console.warn('[auth][signIn] email-based account linking failed — continuing', {
							error: error instanceof Error ? error.message : String(error),
						});
					}
				}

				// ── Layer 2: provider_account_id-based deduplication ────────────────
				// Fallback for when the provider returns no email (e.g. GitHub with a
				// private email before user:email scope was added, or a misconfiguration).
				// If we already have an auth_accounts row for this provider + ID, adopt
				// that existing user rather than creating a new orphan tenant.
				if (!providerEmail && account.providerAccountId) {
					try {
						const existingAccount = await db.execute({
							sql: `SELECT user_id FROM auth_accounts
							      WHERE provider = ? AND provider_account_id = ?
							      LIMIT 1`,
							args: [account.provider, String(account.providerAccountId)],
						});
						if (existingAccount.rows.length) {
							const existingUserId = String((existingAccount.rows[0] as Record<string, any>).user_id);
							if (existingUserId !== String(user.id ?? '')) {
								user.id = existingUserId;
								console.log('[auth][signIn] linked OAuth account to existing user via provider_account_id', {
									existingUserId,
									provider: account.provider,
									providerAccountId: account.providerAccountId,
								});
							}
						}
					} catch (error) {
						console.warn('[auth][signIn] provider_account_id-based linking failed — continuing', {
							error: error instanceof Error ? error.message : String(error),
						});
					}
				}
			}

			if (user?.id) {
				const userId = String(user.id);
				try {
					const exists = await db.execute({
						sql: 'SELECT id FROM auth_users WHERE id = ? LIMIT 1',
						args: [userId],
					});
					if (!exists.rows.length) {
						console.warn('[auth][signIn] user missing in auth_users', {
							userId,
							email: providerEmail || null,
							provider: account?.provider ?? null,
						});
						return true;
					}
				} catch (error) {
					console.error('[auth][signIn] auth_users lookup failed', {
						userId,
						email: providerEmail || null,
						provider: account?.provider ?? null,
						error: error instanceof Error ? error.message : String(error),
					});
					throw error;
				}
				try {
					await ensureTenantForUser(userId);
				} catch (error) {
					console.error('[auth][signIn] ensureTenantForUser failed', {
						userId,
						email: providerEmail || null,
						provider: account?.provider ?? null,
						error: error instanceof Error ? error.message : String(error),
					});
					throw error;
				}
				// Stamp last_login and backfill email/name if the DB record has none.
				// Uses the raw provider profile email which is available even when the
				// adapter user object has a stale/empty email.
				try {
					if (providerEmail) {
						await db.execute({
							sql: `UPDATE auth_users
								SET last_login = ?,
								    email = CASE WHEN (email IS NULL OR email = '') THEN ? ELSE email END,
								    name  = CASE WHEN (name  IS NULL OR name  = '') THEN ? ELSE name  END
								WHERE id = ?`,
							args: [
								new Date().toISOString(),
								providerEmail,
								(profile?.name ?? user?.name ?? null),
								userId,
							],
						});
					} else {
						await db.execute({
							sql: `UPDATE auth_users SET last_login = ? WHERE id = ?`,
							args: [new Date().toISOString(), userId],
						});
					}
				} catch (error) {
					console.warn('[auth][signIn] last_login/email update failed', {
						userId,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			}
			return true;
		},
		async jwt({ token, user }: { token: any; user?: any }) {
			if (user?.id) {
				// ── First sign-in: user object is present ────────────────────────
				token.sub = String(user.id);
				// Explicitly carry fields — Auth.js defaults are unreliable with
				// a custom adapter + JWT strategy combination.
				if (user.email) token.email = String(user.email);
				if (user.name) token.name = String(user.name);
				if (user.image) token.picture = String(user.image);
				token.tenantId = await ensureTenantForUser(String(user.id));
			} else if (token.sub) {
				// ── Token refresh: no user object ────────────────────────────────
				if (!token.tenantId) {
					token.tenantId = await resolveActiveTenantId(String(token.sub));
				}
				// Backfill email from DB on every refresh so sessions issued before
				// explicit email-setting still pick it up without requiring re-login.
				if (!token.email) {
					try {
						const row = await db.execute({
							sql: 'SELECT email FROM auth_users WHERE id = ? LIMIT 1',
							args: [String(token.sub)],
						});
						const email = row.rows[0] ? String((row.rows[0] as Record<string, any>).email ?? '') : '';
						if (email) token.email = email;
					} catch { /* non-fatal */ }
				}
			}
			return token;
		},
		async session({ session, token }: { session: any; token: any }) {
			if (session.user && token.sub) {
				(session.user as Record<string, any>).id = String(token.sub);
			}
			(session as Record<string, any>).tenantId = token.tenantId ?? null;
			return session;
		},
		redirect({ url, baseUrl }: { url: string; baseUrl: string }) {
			const fallback = getPostLoginRedirect(null);
			if (url === baseUrl || url === `${baseUrl}/`) {
				return new URL(fallback, baseUrl).toString();
			}
			if (url.startsWith('/')) {
				return new URL(url, baseUrl).toString();
			}
			if (url.startsWith(baseUrl)) {
				return url;
			}
			return new URL(fallback, baseUrl).toString();
		},
	},
};

const ensureAbsoluteUrl = (request: Request) => {
	const base = new URL(request.url.startsWith('http') ? request.url : `https://placeholder${request.url}`);

	// AUTH_URL is the canonical deployed origin and the source of truth for OAuth
	// callback URLs. Behind Render's proxy the reconstructed request can carry the
	// internal http scheme or localhost host — under @astrojs/node 9 it arrived as
	// http://localhost:10000, under @astrojs/node 10 as http://<host> — either of
	// which yields an http:// (or localhost) redirect_uri that OAuth providers reject
	// against their registered https callback. When AUTH_URL is set we use it verbatim
	// so the scheme/host is never inferred from a proxied request.
	const authUrl = process.env.AUTH_URL;
	if (authUrl) {
		const origin = /^https?:\/\//i.test(authUrl) ? authUrl.replace(/\/$/, '') : `https://${authUrl}`;
		return `${origin}${base.pathname}${base.search}`;
	}

	// No AUTH_URL configured — fall back to the request's own origin, but never an
	// internal localhost host (which would produce an unusable callback).
	const isRenderInternal = base.hostname === 'localhost' || base.hostname === '127.0.0.1';
	if (isRenderInternal) {
		console.error('[auth] AUTH_URL env var is not set — OAuth callbacks will fail. Set AUTH_URL to your deployed domain.');
		throw new Error('AUTH_URL is not configured.');
	}
	return `${base.protocol}//${base.host}${base.pathname}${base.search}`;
};

const buildAuthRequest = (request: Request) => {
	const rawUrl = ensureAbsoluteUrl(request);
	// GitHub recently added an `iss` parameter to their OAuth callback response
	// (RFC 9207). oauth4webapi rejects it as unexpected for non-OIDC providers.
	// Strip it ONLY for GitHub — Google OIDC legitimately uses `iss` and must
	// keep it so oauth4webapi can validate it against the discovery metadata.
	const urlObj = new URL(rawUrl);
	const isGitHubCallback = urlObj.pathname.includes('/callback/github');
	if (isGitHubCallback) {
		urlObj.searchParams.delete('iss');
	}
	const url = urlObj.toString();
	const init: RequestInit = {
		method: request.method,
		headers: request.headers,
	};
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		init.body = request.body;
		(init as RequestInit & { duplex?: 'half' }).duplex = 'half';
	}
	return new Request(url, init);
};

const safeAbsoluteUrl = (request: Request): string => {
	try {
		return ensureAbsoluteUrl(request);
	} catch {
		// AUTH_URL missing — fall back to raw request URL for logging/redirect purposes
		return request.url;
	}
};

const logAuthError = (request: Request, error: unknown) => {
	const err = error instanceof Error ? error : null;
	console.error('[auth] request failed', {
		method: request.method,
		url: safeAbsoluteUrl(request),
		error: err?.message ?? String(error),
		stack: err?.stack,
		cause: err?.cause ? String(err.cause) : null,
	});
};

const buildAuthFailureResponse = (request: Request) => {
	const rawUrl = safeAbsoluteUrl(request);
	const url = new URL(rawUrl.startsWith('http') ? rawUrl : `https://placeholder${rawUrl}`);
	const isCallbackRoute = url.pathname.includes('/api/auth/callback/');
	if (isCallbackRoute) {
		const origin = process.env.AUTH_URL
			? (/^https?:\/\//i.test(process.env.AUTH_URL)
				? process.env.AUTH_URL.replace(/\/$/, '')
				: `https://${process.env.AUTH_URL}`)
			: url.origin;
		return Response.redirect(new URL('/login?error=oauth', origin), 303);
	}
	return new Response('Internal Server Error', { status: 500 });
};

const logAuthEnvCheck = () => {
	if (process.env.AUTH_DEBUG !== '1') return;
	console.log('[auth] env check', {
		hasSecret: Boolean(process.env.AUTH_SECRET),
		secretLen: process.env.AUTH_SECRET?.length ?? 0,
		hasAuthUrl: Boolean(process.env.AUTH_URL),
		hasGithub: Boolean(process.env.GITHUB_ID && process.env.GITHUB_SECRET),
		hasGoogle: Boolean(process.env.GOOGLE_ID && process.env.GOOGLE_SECRET),
		hasEmail: Boolean(process.env.EMAIL_SERVER && process.env.EMAIL_FROM),
	});
};

const getLoginOrigin = () => {
	const authUrl = process.env.AUTH_URL ?? '';
	if (!authUrl) return null;
	return /^https?:\/\//i.test(authUrl) ? authUrl.replace(/\/$/, '') : `https://${authUrl}`;
};

const earlyConfigCheck = (): Response | null => {
	const secret = process.env.AUTH_SECRET;
	if (!secret || secret.length < 16) {
		console.error('[auth] AUTH_SECRET is missing or too short — cannot initialize Auth.js', {
			hasSecret: Boolean(secret),
			secretLen: secret?.length ?? 0,
		});
		const origin = getLoginOrigin();
		if (origin) return Response.redirect(`${origin}/login?error=Configuration`, 303);
		return new Response('Server configuration error', { status: 500 });
	}
	return null;
};

export const GET: APIRoute = async ({ request }) => {
	logAuthEnvCheck();
	const configError = earlyConfigCheck();
	if (configError) return configError;
	try {
		return await Auth(buildAuthRequest(request), authConfig);
	} catch (error) {
		logAuthError(request, error);
		return buildAuthFailureResponse(request);
	}
};

export const POST: APIRoute = async ({ request }) => {
	logAuthEnvCheck();
	const configError = earlyConfigCheck();
	if (configError) return configError;
	try {
		return await Auth(buildAuthRequest(request), authConfig);
	} catch (error) {
		logAuthError(request, error);
		return buildAuthFailureResponse(request);
	}
};
