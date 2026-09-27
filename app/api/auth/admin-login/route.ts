import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

type LoginRequest = {
  email?: unknown;
};

function getCallbackUrl(request: NextRequest) {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const origin = configuredSiteUrl || request.nextUrl.origin;
  const callbackUrl = new URL('/auth/complete', origin);
  callbackUrl.searchParams.set('next', '/officer/admin');
  return callbackUrl.toString();
}

/**
 * Only an existing, active administrator may request an administrator Magic
 * Link. This keeps a rescuer from selecting the administrator option merely
 * to obtain an admin-branded sign-in flow.
 */
export async function POST(request: NextRequest) {
  let body: LoginRequest;

  try {
    body = await request.json() as LoginRequest;
  } catch {
    return NextResponse.json({ error: 'รูปแบบข้อมูลไม่ถูกต้อง' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'กรุณาระบุอีเมลให้ถูกต้อง' }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role,is_active')
    .eq('email', email)
    .maybeSingle();

  if (profileError) {
    console.error('Unable to verify administrator role', profileError);
    return NextResponse.json({ error: 'ไม่สามารถตรวจสอบสิทธิ์ผู้ดูแลระบบได้' }, { status: 500 });
  }

  if (profile?.role !== 'admin' || !profile.is_active) {
    return NextResponse.json({ error: 'อีเมลนี้ไม่ได้รับสิทธิ์เป็นผู้ดูแลระบบ' }, { status: 403 });
  }

  const { error: otpError } = await admin.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: getCallbackUrl(request) },
  });

  if (otpError) {
    console.error('Unable to send administrator Magic Link', otpError);
    return NextResponse.json({ error: 'ไม่สามารถส่งลิงก์เข้าสู่ระบบได้ กรุณาลองใหม่' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
