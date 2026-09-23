import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
}

async function dispatch(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com';
  if (!publicKey || !privateKey) {
    return NextResponse.json({ error: 'VAPID keys are not configured' }, { status: 503 });
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const admin = createSupabaseAdminClient();
  const { data: outbox, error } = await admin
    .from('notification_outbox')
    .select('id, recipient_id, event_type, title, body, target_url, attempts')
    .is('sent_at', null)
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sent = 0;
  for (const item of outbox ?? []) {
    const { data: subscriptions } = await admin
      .from('notification_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('profile_id', item.recipient_id);
    if (!subscriptions?.length) continue;

    const result = await Promise.allSettled(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, JSON.stringify({ title: item.title, body: item.body, url: item.target_url, tag: item.event_type }));
      } catch (pushError: unknown) {
        const statusCode = typeof pushError === 'object' && pushError && 'statusCode' in pushError
          ? Number((pushError as { statusCode: unknown }).statusCode) : 0;
        if (statusCode === 404 || statusCode === 410) {
          await admin.from('notification_subscriptions').delete().eq('id', subscription.id);
          return;
        }
        throw pushError;
      }
    }));
    const failure = result.find((entry) => entry.status === 'rejected');
    if (failure && failure.status === 'rejected') {
      await admin.from('notification_outbox').update({
        attempts: item.attempts + 1,
        last_error: failure.reason instanceof Error ? failure.reason.message : 'Push delivery failed',
      }).eq('id', item.id);
    } else {
      await admin.from('notification_outbox').update({ sent_at: new Date().toISOString(), attempts: item.attempts + 1, last_error: null }).eq('id', item.id);
      sent += 1;
    }
  }
  return NextResponse.json({ ok: true, sent, queued: outbox?.length ?? 0 });
}

export async function GET(request: NextRequest) { return dispatch(request); }
export async function POST(request: NextRequest) { return dispatch(request); }
