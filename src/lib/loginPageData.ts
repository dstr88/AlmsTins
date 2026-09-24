import { getAuthSession } from './authSession';
import { getPostLoginRedirect } from './postLoginRedirect';
import type { LoginPageLocale } from '../i18n/loginPage';

export interface LoginPageData {
  safeCallbackUrl: string;
  csrfToken: string;
  isLoggedIn: boolean;
  error: string | null;
  /** Auth.js CredentialsSignin code (?code=), e.g. 'email_unverified', 'use_provider' or 'rate_limited'. */
  code: string | null;
  signup: string | null;
  verified: string | null;
}

export interface LoginAlert {
  /** Error text; 'LOCKED_OUT' is a sentinel the component renders as its own panel. */
  message: string;
  notice: string;
  hasAlert: boolean;
}

/**
 * The specific message for a sign-in error the verified-email rules produce, or null for
 * anything else (the caller shows its generic text). Shared by every sign-in page.
 */
export function signInErrorMessage(t: LoginPageLocale, error: string | null, code: string | null): string | null {
  const credentialsCode = error === 'CredentialsSignin' ? code : null;
  return (
    credentialsCode === 'email_unverified' ? t.errors.emailUnverified :
    credentialsCode === 'use_provider'     ? t.errors.useProvider :
    credentialsCode === 'verify_required'  ? t.errors.verifyRequired :
    credentialsCode === 'rate_limited'     ? t.errors.rateLimited :
    error === 'rate_limited'               ? t.errors.rateLimited :
    error === 'provider_unverified'        ? t.errors.providerUnverified :
    null
  );
}

/** The error / notice the login pages show for this request's query string. */
export function resolveLoginAlert(
  t: LoginPageLocale,
  data: Pick<LoginPageData, 'error' | 'code' | 'signup' | 'verified'>,
): LoginAlert {
  const { error, code } = data;
  const message =
    error === 'missing'                   ? '' :
    error === 'Configuration'             ? t.errors.configuration :
    error === 'OAuthAccountNotLinked'     ? 'LOCKED_OUT' :
    signInErrorMessage(t, error, code) ??
    (error                                ? t.errors.generic : '');

  const notice =
    data.signup   === 'success' ? t.notices.signupSuccess :
    data.verified === 'success' ? t.notices.verifiedSuccess :
    data.verified === 'expired' ? t.notices.verifiedExpired :
    data.verified === 'failed'  ? t.notices.verifiedFailed : '';

  const hasAlert = error === 'missing' || (!!message && message !== 'LOCKED_OUT') || !!notice;
  return { message, notice, hasAlert };
}

export async function getLoginPageData(request: Request, url: URL): Promise<LoginPageData> {
  const { searchParams } = url;
  const error = searchParams.get('error');
  const next = searchParams.get('next');
  const callbackParam = searchParams.get('callbackUrl');
  const nextPath =
    typeof next === 'string' ? next :
    typeof callbackParam === 'string' ? callbackParam :
    null;

  const callbackUrl = getPostLoginRedirect(nextPath);
  const safeCallbackUrl = callbackUrl.startsWith('/') ? callbackUrl : '/dashboard/vault';

  const session = await getAuthSession(request);

  let csrfToken = '';
  try {
    const authBase = process.env.AUTH_URL
      ? (/^https?:\/\//i.test(process.env.AUTH_URL)
          ? process.env.AUTH_URL.replace(/\/$/, '')
          : `https://${process.env.AUTH_URL}`)
      : url.origin;
    const csrfResponse = await fetch(`${authBase}/api/auth/csrf`, {
      headers: { cookie: request.headers.get('cookie') ?? '' },
    });
    if (csrfResponse.ok) {
      const data = await csrfResponse.json();
      csrfToken = data?.csrfToken ?? '';
    }
  } catch {
    // non-fatal — client-side CSRF refresh in the page script takes over
  }

  return {
    safeCallbackUrl,
    csrfToken,
    isLoggedIn: !!session?.user?.id,
    error,
    code: searchParams.get('code'),
    signup: searchParams.get('signup'),
    verified: searchParams.get('verified'),
  };
}
