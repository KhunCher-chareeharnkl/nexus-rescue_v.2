import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

type LoginRequest = {
  email?: unknown;
};

/**
 * Verify the role before the browser asks Supabase to send the Magic Link.
 * The browser must send it itself because this app intentionally uses the
 * implicit flow, which lets the device opening an email link establish its
 * own session without a PKCE verifier from a different device.
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

  return NextResponse.json({ ok: true });
}
