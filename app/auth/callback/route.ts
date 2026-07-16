import { NextRequest, NextResponse } from 'next/server';
import {
  createSupabaseServerClient,
  setOfficerSessionCookie,
} from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const requestedNext = searchParams.get('next');
  const nextPath = requestedNext?.startsWith('/') && !requestedNext.startsWith('//')
    ? requestedNext
    : '/officer/dashboard';

  if (code) {
    const response = NextResponse.redirect(new URL(nextPath, origin));
    const supabase = createSupabaseServerClient(request, response);
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      setOfficerSessionCookie(response);
      return response;
    }
  }

  return NextResponse.redirect(`${origin}/officer/login?error=auth_failed`);
}
