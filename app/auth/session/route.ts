import { NextRequest, NextResponse } from 'next/server';
import {
  createSupabaseServerClient,
  setOfficerSessionCookie,
} from '@/lib/supabase-server';

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const supabase = createSupabaseServerClient(request, response);
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) return NextResponse.json({ ok: false }, { status: 401 });

  setOfficerSessionCookie(response);
  return response;
}
