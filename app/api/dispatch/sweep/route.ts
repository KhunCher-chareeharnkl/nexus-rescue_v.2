import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { dispatchPendingPushNotifications } from '@/lib/push-dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
}

async function sweep(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('expire_stale_rescue_dispatches');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const push = await dispatchPendingPushNotifications();
  return NextResponse.json({ ok: true, result: data, push });
}

export async function GET(request: NextRequest) { return sweep(request); }
export async function POST(request: NextRequest) { return sweep(request); }
