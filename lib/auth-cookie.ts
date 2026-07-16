export const OFFICER_SESSION_MAX_AGE = 60 * 60 * 24 * 30;
export const OFFICER_SESSION_COOKIE = 'nexus_rescue_officer_session';

export const authCookieOptions = {
  maxAge: OFFICER_SESSION_MAX_AGE,
  path: '/',
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
};
