import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SOURCE = 'https://raw.githubusercontent.com/kongvut/thai-province-data/refs/heads/master/api/latest';
type Province = { id: number; name_th: string; name_en?: string | null };
type District = Province & { province_id: number };
type Subdistrict = Province & { district_id: number; zip_code?: string | number | null; lat?: number | null; long?: number | null };

function chunks<T>(items: T[], size = 500) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

async function requireAdmin(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const client = createSupabaseServerClient(request, response);
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;
  const { data: profile } = await client.from('profiles').select('role,is_active').eq('id', user.id).maybeSingle();
  return profile?.role === 'admin' && profile.is_active ? response : null;
}

function isCronRequest(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  // Vercel Cron uses the same secret as Push dispatch. An administrator can
  // also press the manual refresh button without exposing this endpoint.
  const response = isCronRequest(request) ? NextResponse.json({ ok: true }) : await requireAdmin(request);
  if (!response) return NextResponse.json({ error: 'เฉพาะผู้ดูแลระบบที่เปิดใช้งานเท่านั้น' }, { status: 403 });

  const admin = createSupabaseAdminClient();
  const { data: run, error: runError } = await admin.from('thai_address_sync_runs')
    .insert({ source: SOURCE, status: 'running' }).select('id').single();
  if (runError || !run) return NextResponse.json({ error: runError?.message ?? 'สร้างประวัติการซิงก์ไม่สำเร็จ' }, { status: 500 });

  try {
    const [provinceResponse, districtResponse, subdistrictResponse] = await Promise.all([
      fetch(`${SOURCE}/province.json`, { cache: 'no-store' }),
      fetch(`${SOURCE}/district.json`, { cache: 'no-store' }),
      fetch(`${SOURCE}/sub_district.json`, { cache: 'no-store' }),
    ]);
    if (![provinceResponse, districtResponse, subdistrictResponse].every((item) => item.ok)) throw new Error('ไม่สามารถดาวน์โหลดข้อมูลที่อยู่จากแหล่งต้นทางได้');
    const [provinces, districts, subdistricts] = await Promise.all([
      provinceResponse.json() as Promise<Province[]>, districtResponse.json() as Promise<District[]>, subdistrictResponse.json() as Promise<Subdistrict[]>,
    ]);
    if (![provinces, districts, subdistricts].every(Array.isArray)) throw new Error('รูปแบบข้อมูลจากแหล่งต้นทางไม่ถูกต้อง');

    for (const batch of chunks(provinces.map(({ id, name_th, name_en }) => ({ id, name_th, name_en: name_en ?? null })))) {
      const { error } = await admin.from('thai_address_provinces').upsert(batch, { onConflict: 'id' }); if (error) throw error;
    }
    for (const batch of chunks(districts.map(({ id, province_id, name_th, name_en }) => ({ id, province_id, name_th, name_en: name_en ?? null })))) {
      const { error } = await admin.from('thai_address_districts').upsert(batch, { onConflict: 'id' }); if (error) throw error;
    }
    for (const batch of chunks(subdistricts.map(({ id, district_id, name_th, name_en, zip_code, lat, long }) => ({
      id, district_id, name_th, name_en: name_en ?? null, zip_code: zip_code ? String(zip_code) : null, latitude: lat ?? null, longitude: long ?? null,
    })))) {
      const { error } = await admin.from('thai_address_subdistricts').upsert(batch, { onConflict: 'id' }); if (error) throw error;
    }
    await admin.from('thai_address_sync_runs').update({
      status: 'succeeded', finished_at: new Date().toISOString(), province_count: provinces.length, district_count: districts.length, subdistrict_count: subdistricts.length,
    }).eq('id', run.id);
    return response;
  } catch (syncError: unknown) {
    const message = syncError instanceof Error ? syncError.message : 'เกิดข้อผิดพลาดระหว่างซิงก์ข้อมูล';
    await admin.from('thai_address_sync_runs').update({ status: 'failed', finished_at: new Date().toISOString(), error_message: message }).eq('id', run.id);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
