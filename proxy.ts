import { NextRequest, NextResponse } from 'next/server';
import { OFFICER_SESSION_COOKIE } from './lib/auth-cookie';
import {
  clearOfficerSessionCookie,
  copyResponseCookies,
  createSupabaseServerClient,
} from './lib/supabase-server';

function redirectToLogin(request: NextRequest, response: NextResponse) {
  const loginUrl = new URL('/officer/login', request.url);
  loginUrl.searchParams.set('redirect', request.nextUrl.pathname);
  return copyResponseCookies(response, NextResponse.redirect(loginUrl));
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isLoginPage = pathname === '/officer/login';
  const isProtectedRoute = pathname.startsWith('/officer') && !isLoginPage;
  const hasActiveOfficerSession = request.cookies.has(OFFICER_SESSION_COOKIE);
  const authCode = request.nextUrl.searchParams.get('code');

  // Keep the already allow-listed dashboard URL as the Magic Link target.
  // Supabase appends the PKCE code there, then proxy forwards it to the
  // server callback where the code is exchanged and the cookies are created.
  if (authCode) {
    const callbackUrl = new URL('/auth/callback', request.url);
    callbackUrl.searchParams.set('code', authCode);
    callbackUrl.searchParams.set(
      'next',
      pathname.startsWith('/officer') && !isLoginPage
        ? pathname
        : '/officer/dashboard',
    );
    return NextResponse.redirect(callbackUrl);
  }

  // This server-only cookie is the fixed 30-day session window. It prevents
  // automatic token refreshes from extending a rescuer login indefinitely.
  if (!hasActiveOfficerSession) {
    if (isProtectedRoute) return redirectToLogin(request, NextResponse.next());
    return NextResponse.next();
  }

  const response = NextResponse.next();
  const supabase = createSupabaseServerClient(request, response);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    clearOfficerSessionCookie(response);
    if (isProtectedRoute) return redirectToLogin(request, response);
    return response;
  }

  if (isLoginPage) {
    return copyResponseCookies(
      response,
      NextResponse.redirect(new URL('/officer/dashboard', request.url)),
    );
  }

  return response;
}

export const config = {
  matcher: ['/', '/officer/:path*'],
};
