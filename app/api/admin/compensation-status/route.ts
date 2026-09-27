import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

type ClaimStatus = 'pending' | 'verified' | 'approved' | 'rejected';
type Payload = { reportId?: string; status?: ClaimStatus; reason?: string };

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const sessionClient = createSupabaseServerClient(request, response);
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });

  const { data: profile } = await sessionClient.from('profiles').select('role,is_active').eq('id', user.id).maybeSingle();
  if (profile?.role !== 'admin' || !profile.is_active) {
    return NextResponse.json({ error: 'เฉพาะผู้ดูแลระบบที่เปิดใช้งานเท่านั้น' }, { status: 403 });
  }

  const payload = await request.json().catch(() => null) as Payload | null;
  const reportId = payload?.reportId;
  const status = payload?.status;
  const reason = payload?.reason?.trim() || null;
  if (!reportId || !status || !['verified', 'approved', 'rejected'].includes(status)) {
    return NextResponse.json({ error: 'ข้อมูลสถานะคำร้องไม่ถูกต้อง' }, { status: 400 });
  }
  if (status === 'rejected' && !reason) {
    return NextResponse.json({ error: 'กรุณาระบุเหตุผลเมื่อไม่อนุมัติ' }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: current, error: findError } = await admin
    .from('damage_reports').select('id,status,victim_confirmed').eq('id', reportId).maybeSingle();
  if (findError || !current) return NextResponse.json({ error: findError?.message ?? 'ไม่พบคำร้อง' }, { status: 404 });
  if (!current.victim_confirmed && ['verified', 'approved'].includes(status)) {
    return NextResponse.json({ error: 'ผู้ประสบภัยยังไม่ได้ยืนยันข้อมูลคำร้อง' }, { status: 400 });
  }
  const canTransition = (current.status === 'pending' && ['verified', 'rejected'].includes(status))
    || (current.status === 'verified' && ['approved', 'rejected'].includes(status));
  if (!canTransition) return NextResponse.json({ error: 'ไม่สามารถเปลี่ยนจากสถานะปัจจุบันได้' }, { status: 400 });

  const { error: updateError } = await admin.from('damage_reports').update({ status }).eq('id', reportId);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  // Newer installations already have this general-purpose audit table. The
  // update must remain usable on older installations even if an audit insert is
  // unavailable, hence it never blocks the claim decision.
  await admin.from('operation_audit_logs').insert({
    actor_id: user.id,
    entity_type: 'damage_reports',
    entity_id: reportId,
    action: 'compensation_status_updated',
    before_data: { status: current.status },
    after_data: { status, reason },
  });

  return NextResponse.json({ ok: true, status });
}
