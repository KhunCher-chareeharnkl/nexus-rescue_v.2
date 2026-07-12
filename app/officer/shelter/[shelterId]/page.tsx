'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface Profile {
  id: string;
  full_name: string;
  role: string;
  shelter_id?: string | null;
}

interface Shelter {
  id: string;
  name: string;
  address?: string;
  province?: string;
  capacity?: number;
}

interface OccupancySummary {
  shelter_id: string;
  name: string;
  capacity: number | null;
  current_total: number;
  current_adults: number;
  current_children: number;
  current_elders: number;
  from_rescuer: number;
  self_registered: number;
}

interface Occupant {
  id: string;
  full_name: string;
  phone?: string | null;
  adult_count: number;
  child_count: number;
  elder_count: number;
  entry_source: 'rescuer' | 'self_registered';
  status: 'in_shelter' | 'exited';
  entry_date: string;
  exit_date?: string | null;
  exit_destination?: string | null;
  exit_note?: string | null;
}

interface AddDraft {
  fullName: string;
  phone: string;
  adult: number;
  child: number;
  elder: number;
}

interface ExitDraft {
  occupantId: string;
  fullName: string;
  destination: 'home' | 'relative_home' | 'other_shelter' | 'other' | null;
  note: string;
  exitDate: string; // yyyy-mm-dd จาก <input type="date">
}

const EXIT_LABEL: Record<string, string> = {
  home: '🏠 กลับบ้าน',
  relative_home: '👨‍👩‍👧 บ้านญาติ',
  other_shelter: '🏕️ ย้ายศูนย์อื่น',
  other: '📍 อื่นๆ',
};

export default function ShelterStaffDashboard() {
  const router = useRouter();
  const params = useParams();
  const shelterIdFromUrl = params?.shelterId as string;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [shelter, setShelter] = useState<Shelter | null>(null);
  const [summary, setSummary] = useState<OccupancySummary | null>(null);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [tab, setTab] = useState<'in_shelter' | 'exited'>('in_shelter');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [addDraft, setAddDraft] = useState<AddDraft>({ fullName: '', phone: '', adult: 1, child: 0, elder: 0 });

  const [exitDraft, setExitDraft] = useState<ExitDraft | null>(null);

  // ── ตรวจสิทธิ์: ต้อง login และเป็น shelter_staff/admin ของศูนย์นี้เท่านั้น ──
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/officer/login'); return; }

      const { data: prof } = await supabase
        .from('profiles').select('*').eq('id', user.id).single();

      if (!prof) { router.push('/officer/login'); return; }

      if (prof.role === 'rescuer') { router.push('/officer/dashboard'); return; }
      if (prof.role === 'admin') { /* แอดมินดูได้ทุกศูนย์ */ }
      else if (prof.role === 'shelter_staff' && prof.shelter_id !== shelterIdFromUrl) {
        // เจ้าหน้าที่ศูนย์คนนี้ผูกกับศูนย์อื่น ไม่ใช่ศูนย์ตาม URL
        router.push(`/officer/shelter/${prof.shelter_id}`);
        return;
      }

      setProfile(prof);
    };
    init();
  }, [router, shelterIdFromUrl]);

  // ── โหลดข้อมูลศูนย์ + สรุปยอด + รายชื่อ ──
  useEffect(() => {
    if (!profile || !shelterIdFromUrl) return;

    const fetchAll = async () => {
      const { data: sh } = await supabase
        .from('shelters').select('id, name, address, province, capacity')
        .eq('id', shelterIdFromUrl).single();
      setShelter(sh);

      const { data: sum } = await supabase
        .from('shelter_occupancy_summary').select('*')
        .eq('shelter_id', shelterIdFromUrl).single();
      setSummary(sum);

      const { data: occ } = await supabase
        .from('shelter_occupants').select('*')
        .eq('shelter_id', shelterIdFromUrl)
        .order('entry_date', { ascending: false });
      setOccupants((occ as Occupant[]) ?? []);

      setLoading(false);
    };
    fetchAll();

    // realtime: อัปเดตทันทีเมื่อกู้ภัยพาคนมาส่ง หรือมีการเพิ่ม/ยืนยันคนออก
    const channel = supabase.channel(`shelter_occupants_${shelterIdFromUrl}`)
      .on('postgres_changes' as any,
        { event: '*', schema: 'public', table: 'shelter_occupants', filter: `shelter_id=eq.${shelterIdFromUrl}` },
        () => { fetchAll(); }
      ).subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile, shelterIdFromUrl]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  // ── เพิ่มผู้ลี้ภัยที่มาลงทะเบียนเอง (ไม่ผ่านกู้ภัย) ──
  const submitAddOccupant = async () => {
    if (!profile || !addDraft.fullName.trim()) {
      alert('กรุณากรอกชื่อ-นามสกุล'); return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('shelter_occupants').insert({
        shelter_id: shelterIdFromUrl,
        full_name: addDraft.fullName.trim(),
        phone: addDraft.phone.trim() || null,
        adult_count: addDraft.adult,
        child_count: addDraft.child,
        elder_count: addDraft.elder,
        entry_source: 'self_registered',
        registered_by: profile.id,
      });
      if (error) throw error;

      setAddDraft({ fullName: '', phone: '', adult: 1, child: 0, elder: 0 });
      setShowAddForm(false);
    } catch (err: any) {
      alert(`เพิ่มรายชื่อไม่สำเร็จ: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ── ยืนยันคนออกจากศูนย์ ──
  const submitExit = async () => {
    if (!exitDraft || !exitDraft.destination) {
      alert('กรุณาเลือกว่าออกไปที่ไหน'); return;
    }
    if (!exitDraft.exitDate) {
      alert('กรุณาเลือกวันที่ออก'); return;
    }
    setSaving(true);
    try {
      // ใช้เวลาเที่ยงวันของวันที่เลือก กัน timezone แปลงแล้ววันเพี้ยนไป 1 วัน
      const exitDateTime = new Date(`${exitDraft.exitDate}T12:00:00`).toISOString();
      const { error } = await supabase
        .from('shelter_occupants')
        .update({
          status: 'exited',
          exit_date: exitDateTime,
          exit_destination: exitDraft.destination,
          exit_note: exitDraft.note || null,
        })
        .eq('id', exitDraft.occupantId);
      if (error) throw error;
      setExitDraft(null);
    } catch (err: any) {
      alert(`บันทึกไม่สำเร็จ: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const filteredOccupants = occupants.filter(o => o.status === tab);

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Sarabun',sans-serif", color: '#6B7280' }}>
      กำลังโหลด...
    </div>
  );

  return (
    <>
      <style>{`* { box-sizing: border-box; margin: 0; padding: 0; }`}</style>

      <div style={{ minHeight: '100vh', background: '#F0F2FA', fontFamily: "'Sarabun',sans-serif" }}>

        {/* Header */}
        <header style={{ background: '#fff', borderBottom: '1px solid #ECEEF5', padding: '14px 20px', position: 'sticky', top: 0, zIndex: 50 }}>
          <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 11, background: 'linear-gradient(135deg,#6D5EF9,#5046e5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                🏠
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>{shelter?.name ?? 'ศูนย์พักพิง'}</div>
                <div style={{ fontSize: 11, color: '#9CA3AF' }}>{profile?.full_name}</div>
              </div>
            </div>
            <button onClick={handleLogout} style={{ padding: '7px 14px', borderRadius: 10, border: '1px solid #ECEEF5', background: '#fff', fontSize: 13, fontWeight: 600, color: '#6B7280', cursor: 'pointer' }}>
              ออกจากระบบ
            </button>
          </div>
        </header>

        <main style={{ maxWidth: 960, margin: '0 auto', padding: '20px' }}>

          {/* ── สรุปยอด ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
            <SummaryCard label="อยู่ในศูนย์ทั้งหมด" value={summary?.current_total ?? 0} color="#5046e5" big />
            <SummaryCard label="ผู้ใหญ่" value={summary?.current_adults ?? 0} color="#374151" />
            <SummaryCard label="เด็ก" value={summary?.current_children ?? 0} color="#F59E0B" />
            <SummaryCard label="สูงอายุ" value={summary?.current_elders ?? 0} color="#7C3AED" />
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 20, fontSize: 12, color: '#6B7280' }}>
            <span>🚑 กู้ภัยพามา {summary?.from_rescuer ?? 0} คน</span>
            <span>·</span>
            <span>🚶 มาลงทะเบียนเอง {summary?.self_registered ?? 0} คน</span>
            {shelter?.capacity ? (
              <>
                <span>·</span>
                <span>ความจุ {shelter.capacity} คน</span>
              </>
            ) : null}
          </div>

          {/* ── ปุ่มเพิ่มผู้ลี้ภัยที่มาเอง ── */}
          <button
            onClick={() => setShowAddForm(v => !v)}
            style={{
              width: '100%', padding: '13px', borderRadius: 14, border: 'none',
              background: showAddForm ? '#E5E7EB' : 'linear-gradient(135deg,#6D5EF9,#5046e5)',
              color: showAddForm ? '#374151' : '#fff', fontSize: 14, fontWeight: 700,
              cursor: 'pointer', marginBottom: showAddForm ? 12 : 20,
            }}
          >
            {showAddForm ? '✕ ยกเลิก' : '+ เพิ่มผู้ลี้ภัยที่มาลงทะเบียนเอง'}
          </button>

          {showAddForm && (
            <div style={{ background: '#fff', borderRadius: 16, padding: 16, marginBottom: 20, border: '1px solid #ECEEF5' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input
                  placeholder="ชื่อ-นามสกุล *" value={addDraft.fullName}
                  onChange={e => setAddDraft({ ...addDraft, fullName: e.target.value })}
                  style={inputStyle}
                />
                <input
                  placeholder="เบอร์โทร" value={addDraft.phone}
                  onChange={e => setAddDraft({ ...addDraft, phone: e.target.value })}
                  style={inputStyle}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {(['adult', 'child', 'elder'] as const).map((key, i) => (
                    <div key={key}>
                      <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>
                        {['ผู้ใหญ่', 'เด็ก', 'สูงอายุ'][i]}
                      </div>
                      <input
                        type="number" min={0} value={addDraft[key]}
                        onChange={e => setAddDraft({ ...addDraft, [key]: Number(e.target.value) })}
                        style={inputStyle}
                      />
                    </div>
                  ))}
                </div>
                <button
                  onClick={submitAddOccupant} disabled={saving}
                  style={{ padding: '12px', borderRadius: 12, border: 'none', background: '#111827', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
                >
                  {saving ? 'กำลังบันทึก...' : 'บันทึกรายชื่อ'}
                </button>
              </div>
            </div>
          )}

          {/* ── Tabs ── */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <TabButton active={tab === 'in_shelter'} onClick={() => setTab('in_shelter')} label={`อยู่ในศูนย์ (${occupants.filter(o => o.status === 'in_shelter').length})`} />
            <TabButton active={tab === 'exited'} onClick={() => setTab('exited')} label={`ออกแล้ว (${occupants.filter(o => o.status === 'exited').length})`} />
          </div>

          {/* ── รายชื่อ ── */}
          {filteredOccupants.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#9CA3AF', fontSize: 13 }}>
              ไม่มีรายชื่อในหมวดนี้
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filteredOccupants.map(o => (
                <div key={o.id} style={{ background: '#fff', borderRadius: 14, padding: 14, border: '1px solid #ECEEF5' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{o.full_name}</div>
                      <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>
                        {o.phone ?? 'ไม่มีเบอร์โทร'} · ผู้ใหญ่ {o.adult_count} เด็ก {o.child_count} สูงอายุ {o.elder_count}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                          background: o.entry_source === 'rescuer' ? '#EDE9FE' : '#F3F4F6',
                          color: o.entry_source === 'rescuer' ? '#5B21B6' : '#374151',
                        }}>
                          {o.entry_source === 'rescuer' ? '🚑 กู้ภัยพามา' : '🚶 มาเอง'}
                        </span>
                        {o.status === 'exited' && o.exit_destination && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#F3F4F6', color: '#374151' }}>
                            {EXIT_LABEL[o.exit_destination] ?? o.exit_destination}
                            {o.exit_date ? ` · ${new Date(o.exit_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    {o.status === 'in_shelter' && (
                      <button
                        onClick={() => setExitDraft({
                          occupantId: o.id, fullName: o.full_name, destination: null, note: '',
                          exitDate: new Date().toISOString().slice(0, 10),
                        })}
                        style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid #ECEEF5', background: '#fff', color: '#374151', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                      >
                        ยืนยันคนออก
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* ── Modal: ยืนยันคนออก ── */}
      {exitDraft && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, padding: 20, fontFamily: "'Sarabun',sans-serif" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 2 }}>ยืนยันคนออกจากศูนย์</div>
            <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 16 }}>{exitDraft.fullName}</div>

            <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8 }}>ออกวันไหน?</div>
            <input
              type="date"
              value={exitDraft.exitDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={e => setExitDraft({ ...exitDraft, exitDate: e.target.value })}
              style={{ ...inputStyle, marginBottom: 16 }}
            />

            <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8 }}>ออกไปที่ไหน?</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              {(['home', 'relative_home', 'other_shelter', 'other'] as const).map(dest => (
                <button
                  key={dest}
                  onClick={() => setExitDraft({ ...exitDraft, destination: dest })}
                  style={{
                    padding: '10px', borderRadius: 10, fontFamily: 'inherit', cursor: 'pointer',
                    border: exitDraft.destination === dest ? '2px solid #5046e5' : '1px solid #E5E7EB',
                    background: exitDraft.destination === dest ? '#EEF2FF' : '#fff',
                    color: '#374151', fontSize: 13, fontWeight: 700,
                  }}
                >
                  {EXIT_LABEL[dest]}
                </button>
              ))}
            </div>

            <textarea
              placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)"
              value={exitDraft.note}
              onChange={e => setExitDraft({ ...exitDraft, note: e.target.value })}
              rows={2}
              style={{ ...inputStyle, width: '100%', resize: 'vertical', marginBottom: 16 }}
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                onClick={() => setExitDraft(null)} disabled={saving}
                style={{ padding: '13px', borderRadius: 12, border: '1px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                ยกเลิก
              </button>
              <button
                onClick={submitExit} disabled={saving || !exitDraft.destination}
                style={{
                  padding: '13px', borderRadius: 12, border: 'none',
                  background: !exitDraft.destination ? '#E5E7EB' : '#111827',
                  color: '#fff', fontSize: 14, fontWeight: 700,
                  cursor: saving || !exitDraft.destination ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                }}
              >
                {saving ? 'กำลังบันทึก...' : 'ยืนยัน'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '10px 12px', borderRadius: 10, border: '1px solid #E5E7EB',
  fontSize: 14, fontFamily: 'inherit', width: '100%',
};

function SummaryCard({ label, value, color, big }: { label: string; value: number; color: string; big?: boolean }) {
  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: '14px 12px', border: '1px solid #ECEEF5', textAlign: 'center' }}>
      <div style={{ fontSize: big ? 26 : 20, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '10px', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: 'pointer',
        border: active ? 'none' : '1px solid #ECEEF5',
        background: active ? '#111827' : '#fff',
        color: active ? '#fff' : '#6B7280',
      }}
    >
      {label}
    </button>
  );
}
