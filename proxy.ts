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

  // รองรับ Magic Link รุ่นเดิมที่ชี้มาหน้า dashboard โดยพาไปแลก PKCE code
  // ที่ server callback ก่อนสร้างคุกกี้ session. ลิงก์ใหม่ชี้ callback โดยตรง.
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

  if (isProtectedRoute) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role,shelter_id,is_active')
      .eq('id', user.id)
      .maybeSingle();

    const isActive = Boolean(profile?.is_active);
    const role = profile?.role;
    const shelterId = profile?.shelter_id;
    const adminUrl = new URL('/officer/admin', request.url);
    const dashboardUrl = new URL('/officer/dashboard', request.url);

    if (pathname.startsWith('/officer/admin') && (!isActive || role !== 'admin')) {
      return copyResponseCookies(
        response,
        NextResponse.redirect(isActive && role === 'shelter_staff' && shelterId
          ? new URL(`/officer/shelter/${shelterId}`, request.url)
          : dashboardUrl),
      );
    }

    if (pathname.startsWith('/officer/dashboard') && isActive && role === 'admin') {
      return copyResponseCookies(response, NextResponse.redirect(adminUrl));
    }

    if (pathname.startsWith('/officer/dashboard') && isActive && role === 'shelter_staff' && shelterId) {
      return copyResponseCookies(response, NextResponse.redirect(new URL(`/officer/shelter/${shelterId}`, request.url)));
    }

    if (pathname.startsWith('/officer/shelter') && (!isActive || (role !== 'admin' && role !== 'shelter_staff'))) {
      return copyResponseCookies(response, NextResponse.redirect(dashboardUrl));
    }
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
