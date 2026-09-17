import { createBrowserClient } from '@supabase/auth-helpers-nextjs';
import type { SetAllCookies } from '@supabase/auth-helpers-nextjs/dist/module/types';
import { authCookieOptions, OFFICER_SESSION_MAX_AGE } from './auth-cookie';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('กรุณาตั้งค่า NEXT_PUBLIC_SUPABASE_URL และ NEXT_PUBLIC_SUPABASE_ANON_KEY ในไฟล์ .env.local');
}

const readBrowserCookies = () => {
  if (typeof document === 'undefined') return [];

  return document.cookie
    .split('; ')
    .filter(Boolean)
    .map((cookie) => {
      const separator = cookie.indexOf('=');
      return {
        name: cookie.slice(0, separator),
        value: decodeURIComponent(cookie.slice(separator + 1)),
      };
    });
};

const writeBrowserCookies: SetAllCookies = (cookiesToSet) => {
  if (typeof document === 'undefined') return;

  cookiesToSet.forEach(({ name, value, options }) => {
    const maxAge = value ? OFFICER_SESSION_MAX_AGE : 0;
    const sameSite = typeof options.sameSite === 'string'
      ? options.sameSite
      : authCookieOptions.sameSite;
    const parts = [
      `${name}=${encodeURIComponent(value)}`,
      `Max-Age=${maxAge}`,
      `Path=${options.path ?? authCookieOptions.path}`,
      `SameSite=${sameSite}`,
    ];

    if (options.secure ?? authCookieOptions.secure) parts.push('Secure');
    document.cookie = parts.join('; ');
  });
};

export const supabase = createBrowserClient(supabaseUrl, supabaseKey, {
  // Magic Links are frequently opened from iOS Mail/Safari rather than the
  // browser that requested them. PKCE needs a verifier from that first browser;
  // implicit flow lets the callback establish its session on the device opening
  // the link instead.
  auth: {
    flowType: 'implicit',
  },
  cookieOptions: authCookieOptions,
  cookies: {
    getAll: readBrowserCookies,
    setAll: writeBrowserCookies,
  },
});
