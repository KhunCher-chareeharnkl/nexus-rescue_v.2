import { NextRequest, NextResponse } from 'next/server';
import { dispatchPendingPushNotifications } from '@/lib/push-dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
}

async function dispatch(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await dispatchPendingPushNotifications();
  return result.ok
    ? NextResponse.json(result)
    : NextResponse.json({ error: result.error }, { status: result.status });
}

export async function GET(request: NextRequest) { return dispatch(request); }
export async function POST(request: NextRequest) { return dispatch(request); }
