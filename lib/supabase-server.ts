import { createServerClient } from '@supabase/auth-helpers-nextjs';
import type { SetAllCookies } from '@supabase/auth-helpers-nextjs/dist/module/types';
import type { NextRequest, NextResponse } from 'next/server';
import {
  authCookieOptions,
  OFFICER_SESSION_COOKIE,
  OFFICER_SESSION_MAX_AGE,
} from './auth-cookie';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables.');
}

const resolvedSupabaseUrl = supabaseUrl;
const resolvedSupabaseKey = supabaseKey;

export function createSupabaseServerClient(
  request: NextRequest,
  response: NextResponse,
) {
  return createServerClient(resolvedSupabaseUrl, resolvedSupabaseKey, {
    cookieOptions: authCookieOptions,
    cookies: {
      getAll() {
        return request.cookies.getAll().map(({ name, value }) => ({ name, value }));
      },
      setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, {
            ...options,
            ...authCookieOptions,
            maxAge: value ? OFFICER_SESSION_MAX_AGE : 0,
          });
        });
      },
    },
  });
}

export function setOfficerSessionCookie(response: NextResponse) {
  response.cookies.set(OFFICER_SESSION_COOKIE, 'active', {
    ...authCookieOptions,
    httpOnly: true,
  });
}

export function clearOfficerSessionCookie(response: NextResponse) {
  response.cookies.set(OFFICER_SESSION_COOKIE, '', {
    ...authCookieOptions,
    httpOnly: true,
    maxAge: 0,
  });
}

export function copyResponseCookies(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  return target;
}
