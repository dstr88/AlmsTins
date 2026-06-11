import { getAuthSession } from './authSession';
import { getPostLoginRedirect } from './postLoginRedirect';

export interface LoginPageData {
  safeCallbackUrl: string;
  csrfToken: string;
  isLoggedIn: boolean;
  error: string | null;
  signup: string | null;
  verified: string | null;
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
    signup: searchParams.get('signup'),
    verified: searchParams.get('verified'),
  };
}
