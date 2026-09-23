import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

type PushSubscriptionBody = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const sessionClient = createSupabaseServerClient(request, response);
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบก่อนเปิดการแจ้งเตือน' }, { status: 401 });

  const payload = await request.json().catch(() => null) as PushSubscriptionBody | null;
  const endpoint = payload?.endpoint?.trim();
  const p256dh = payload?.keys?.p256dh?.trim();
  const auth = payload?.keys?.auth?.trim();
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'ข้อมูลการสมัครรับการแจ้งเตือนไม่ครบ' }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('notification_subscriptions').upsert({
    profile_id: user.id,
    endpoint,
    p256dh,
    auth,
    user_agent: request.headers.get('user-agent'),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return response;
}
