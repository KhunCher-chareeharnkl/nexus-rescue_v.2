'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface Profile {
  id: string;
  full_name: string;
  phone?: string | null;
  role: string;
  agency?: string | null;
  is_active: boolean;
  shelter_id?: string | null;
  created_at: string;
}

interface Shelter {
  id: string;
  name: string;
  address?: string | null;
  province?: string | null;
  capacity: number;
  current_occupancy: number;
  contact_phone?: string | null;
  is_active: boolean;
}

interface SOSReport {
  id: string;
  full_name: string;
  phone: string;
  province: string;
  district: string;
  status: string;
  urgency_level: string;
  adult_count: number;
  child_count: number;
  elder_count: number;
  created_at: string;
}

interface DamageReport {
  id: string;
  full_name: string;
  phone: string;
  province: string;
  district: string;
  sub_district: string;
  address_details?: string | null;
  damage_type?: string | null;
  damage_value?: number | null;
  description?: string | null;
  image_urls: string[];
  home_status?: string | null;
  status: 'pending' | 'verified' | 'approved' | 'rejected';
  incident_date?: string | null;
  id_card_number?: string | null;
  id_card_image_url?: string | null;
  victim_confirmed: boolean;
  created_at: string;
}

type Tab = 'overview' | 'users' | 'shelters' | 'victims' | 'compensation';

const ROLE_LABEL: Record<string, string> = {
  rescuer: '🚑 กู้ภัย',
  shelter_staff: '🏠 เจ้าหน้าที่ศูนย์',
  admin: '🛡️ แอดมิน',
  gov: '🏛️ หน่วยงานรัฐ',
};

const DAMAGE_TYPE_LABEL: Record<string, string> = {
  housing: '🏠 ที่อยู่อาศัย',
  vehicle: '🚗 ยานพาหนะ',
  agriculture: '🌾 พืชผล/ปศุสัตว์',
  property: '📦 ทรัพย์สินอื่น',
  other: '📋 อื่นๆ',
};

const CLAIM_STATUS_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  pending: { text: 'รอตรวจสอบ', color: '#92400E', bg: '#FEF3C7' },
  verified: { text: 'ตรวจสอบแล้ว', color: '#1D4ED8', bg: '#DBEAFE' },
  approved: { text: 'อนุมัติแล้ว', color: '#15803D', bg: '#DCFCE7' },
  rejected: { text: 'ไม่อนุมัติ', color: '#B91C1C', bg: '#FEE2E2' },
};

const SOS_STATUS_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  pending: { text: 'รอรับเรื่อง', color: '#92400E', bg: '#FEF3C7' },
  assigned: { text: 'กำลังช่วยเหลือ', color: '#1D4ED8', bg: '#DBEAFE' },
  rescued: { text: 'ช่วยเหลือสำเร็จ', color: '#15803D', bg: '#DCFCE7' },
  cannot_reach: { text: 'เข้าไม่ถึง', color: '#B91C1C', bg: '#FEE2E2' },
  closed: { text: 'ปิดเคส', color: '#374151', bg: '#F3F4F6' },
};

const inputStyle: React.CSSProperties = {
  padding: '10px 12px', borderRadius: 10, border: '1px solid #E5E7EB',
  fontSize: 13, fontFamily: 'inherit', width: '100%',
};

export default function AdminPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/officer/login'); return; }

      const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (!prof) { router.push('/officer/login'); return; }

      if (prof.role === 'rescuer') { router.push('/officer/dashboard'); return; }
      if (prof.role === 'shelter_staff') { router.push(`/officer/shelter/${prof.shelter_id ?? ''}`); return; }
      if (prof.role !== 'admin') {
        setAccessError('บัญชีนี้ไม่มีสิทธิ์เข้าหน้าแอดมิน');
        setLoading(false);
        return;
      }

      setProfile(prof);
      setLoading(false);
    };
    init();
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  if (accessError) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Sarabun',sans-serif", padding: 20 }}>
      <div style={{ maxWidth: 380, textAlign: 'center', background: '#fff', borderRadius: 20, padding: 28, border: '1px solid #ECEEF5' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>⛔</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 8 }}>ไม่มีสิทธิ์เข้าถึง</div>
        <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 20 }}>{accessError}</div>
        <button onClick={handleLogout} style={{ padding: '11px 20px', borderRadius: 12, border: '1px solid #ECEEF5', background: '#fff', color: '#6B7280', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          ออกจากระบบ
        </button>
      </div>
    </div>
  );

  if (loading || !profile) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Sarabun',sans-serif", color: '#6B7280' }}>
      กำลังโหลด...
    </div>
  );

  return (
    <>
      <style>{`* { box-sizing: border-box; margin: 0; padding: 0; }`}</style>
      <div style={{ minHeight: '100vh', background: '#F0F2FA', fontFamily: "'Sarabun',sans-serif" }}>

        <header style={{ background: '#fff', borderBottom: '1px solid #ECEEF5', padding: '14px 20px', position: 'sticky', top: 0, zIndex: 50 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 11, background: 'linear-gradient(135deg,#111827,#374151)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                🛡️
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>แผงควบคุมแอดมิน</div>
                <div style={{ fontSize: 11, color: '#9CA3AF' }}>{profile.full_name}</div>
              </div>
            </div>
            <button onClick={handleLogout} style={{ padding: '7px 14px', borderRadius: 10, border: '1px solid #ECEEF5', background: '#fff', fontSize: 13, fontWeight: 600, color: '#6B7280', cursor: 'pointer' }}>
              ออกจากระบบ
            </button>
          </div>
        </header>

        <main style={{ maxWidth: 1100, margin: '0 auto', padding: 20 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
            <TabButton active={tab === 'overview'} onClick={() => setTab('overview')} label="📊 ภาพรวม" />
            <TabButton active={tab === 'users'} onClick={() => setTab('users')} label="👥 ผู้ใช้งาน" />
            <TabButton active={tab === 'shelters'} onClick={() => setTab('shelters')} label="🏠 ศูนย์พักพิง" />
            <TabButton active={tab === 'victims'} onClick={() => setTab('victims')} label="🆘 ผู้ประสบภัย" />
            <TabButton active={tab === 'compensation'} onClick={() => setTab('compensation')} label="💰 เยียวยา" />
          </div>

          {tab === 'overview' && <OverviewTab />}
          {tab === 'users' && <UsersTab />}
          {tab === 'shelters' && <SheltersTab />}
          {tab === 'victims' && <VictimsTab />}
          {tab === 'compensation' && <CompensationTab />}
        </main>
      </div>
    </>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '10px 18px', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: 'pointer',
        border: active ? 'none' : '1px solid #ECEEF5',
        background: active ? '#111827' : '#fff',
        color: active ? '#fff' : '#6B7280',
      }}
    >
      {label}
    </button>
  );
}

// ==========================================================
// TAB: ผู้ใช้งาน (กู้ภัย / เจ้าหน้าที่ศูนย์ / แอดมิน)
// ==========================================================
function UsersTab() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const fetchAll = async () => {
    const [{ data: u }, { data: s }] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('shelters').select('id, name').order('name'),
    ]);
    setUsers((u as Profile[]) ?? []);
    setShelters((s as Shelter[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const updateUser = async (id: string, patch: Partial<Profile>) => {
    setSavingId(id);
    try {
      const { error } = await supabase.from('profiles').update(patch).eq('id', id);
      if (error) throw error;
      setUsers(prev => prev.map(u => u.id === id ? { ...u, ...patch } : u));
    } catch (err: any) {
      alert(`บันทึกไม่สำเร็จ: ${err.message}`);
    } finally {
      setSavingId(null);
    }
  };

  const counts = users.reduce<Record<string, number>>((acc, u) => {
    acc[u.role] = (acc[u.role] ?? 0) + 1;
    return acc;
  }, {});

  const filtered = users.filter(u => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false;
    if (search && !u.full_name.toLowerCase().includes(search.toLowerCase()) && !(u.phone ?? '').includes(search)) return false;
    return true;
  });

  if (loading) return <div style={{ color: '#9CA3AF', fontSize: 13 }}>กำลังโหลด...</div>;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        {(['rescuer', 'shelter_staff', 'admin', 'gov'] as const).map(r => (
          <div key={r} style={{ background: '#fff', borderRadius: 14, padding: '14px 12px', border: '1px solid #ECEEF5', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#111827' }}>{counts[r] ?? 0}</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{ROLE_LABEL[r]}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input placeholder="🔍 ค้นหาชื่อหรือเบอร์โทร" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, maxWidth: 240 }} />
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} style={{ ...inputStyle, maxWidth: 180 }}>
          <option value="all">ทุกบทบาท</option>
          {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #ECEEF5', overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>ไม่พบผู้ใช้งาน</div>
        ) : filtered.map((u, i) => (
          <div key={u.id} style={{ padding: 14, borderBottom: i < filtered.length - 1 ? '1px solid #F3F4F6' : 'none', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 180px', minWidth: 160 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{u.full_name}</div>
              <div style={{ fontSize: 11, color: '#9CA3AF' }}>{u.phone ?? 'ไม่มีเบอร์โทร'} {u.agency ? `· ${u.agency}` : ''}</div>
            </div>

            <select
              value={u.role}
              onChange={e => updateUser(u.id, { role: e.target.value, shelter_id: e.target.value === 'shelter_staff' ? u.shelter_id : null })}
              disabled={savingId === u.id}
              style={{ ...inputStyle, width: 170 }}
            >
              {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>

            {u.role === 'shelter_staff' && (
              <select
                value={u.shelter_id ?? ''}
                onChange={e => updateUser(u.id, { shelter_id: e.target.value || null })}
                disabled={savingId === u.id}
                style={{ ...inputStyle, width: 180 }}
              >
                <option value="">-- เลือกศูนย์ --</option>
                {shelters.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}

            <button
              onClick={() => updateUser(u.id, { is_active: !u.is_active })}
              disabled={savingId === u.id}
              style={{
                padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border: '1px solid #ECEEF5',
                background: u.is_active ? '#F0FDF4' : '#FEF2F2',
                color: u.is_active ? '#15803D' : '#B91C1C',
              }}
            >
              {u.is_active ? '✅ ใช้งานอยู่' : '⛔ ถูกระงับ'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ==========================================================
// TAB: ศูนย์พักพิง (CRUD)
// ==========================================================
function SheltersTab() {
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ name: '', address: '', province: 'สงขลา', capacity: '', contact_phone: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Shelter>>({});

  const fetchShelters = async () => {
    const { data } = await supabase.from('shelters').select('*').order('name');
    setShelters((data as Shelter[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { fetchShelters(); }, []);

  const addShelter = async () => {
    if (!draft.name.trim()) { alert('กรุณากรอกชื่อศูนย์'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('shelters').insert({
        name: draft.name.trim(),
        address: draft.address.trim() || null,
        province: draft.province.trim() || null,
        capacity: draft.capacity ? Number(draft.capacity) : 0,
        contact_phone: draft.contact_phone.trim() || null,
      });
      if (error) throw error;
      setDraft({ name: '', address: '', province: 'สงขลา', capacity: '', contact_phone: '' });
      setShowAdd(false);
      fetchShelters();
    } catch (err: any) {
      alert(`เพิ่มไม่สำเร็จ: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    try {
      const { error } = await supabase.from('shelters').update(editDraft).eq('id', id);
      if (error) throw error;
      setEditingId(null);
      fetchShelters();
    } catch (err: any) {
      alert(`บันทึกไม่สำเร็จ: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (s: Shelter) => {
    await supabase.from('shelters').update({ is_active: !s.is_active }).eq('id', s.id);
    fetchShelters();
  };

  const deleteShelter = async (s: Shelter) => {
    if (!confirm(`ลบศูนย์ "${s.name}" ใช่ไหม? (ถ้ามีข้อมูลผูกอยู่ ระบบจะบล็อกการลบ)`)) return;
    const { error } = await supabase.from('shelters').delete().eq('id', s.id);
    if (error) {
      alert(`ลบไม่สำเร็จ: มีข้อมูลผูกกับศูนย์นี้อยู่ (เช่น ผู้พักพิง/เจ้าหน้าที่) — แนะนำให้กด "ปิดใช้งาน" แทนการลบ`);
      return;
    }
    fetchShelters();
  };

  if (loading) return <div style={{ color: '#9CA3AF', fontSize: 13 }}>กำลังโหลด...</div>;

  return (
    <div>
      <button
        onClick={() => setShowAdd(v => !v)}
        style={{
          width: '100%', padding: 13, borderRadius: 14, border: 'none', marginBottom: showAdd ? 12 : 16,
          background: showAdd ? '#E5E7EB' : 'linear-gradient(135deg,#6D5EF9,#5046e5)',
          color: showAdd ? '#374151' : '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
        }}
      >
        {showAdd ? '✕ ยกเลิก' : '+ เพิ่มศูนย์พักพิงใหม่'}
      </button>

      {showAdd && (
        <div style={{ background: '#fff', borderRadius: 16, padding: 16, marginBottom: 16, border: '1px solid #ECEEF5', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input placeholder="ชื่อศูนย์ *" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} style={inputStyle} />
          <input placeholder="ที่อยู่" value={draft.address} onChange={e => setDraft({ ...draft, address: e.target.value })} style={inputStyle} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input placeholder="จังหวัด" value={draft.province} onChange={e => setDraft({ ...draft, province: e.target.value })} style={inputStyle} />
            <input placeholder="ความจุ (คน)" type="number" value={draft.capacity} onChange={e => setDraft({ ...draft, capacity: e.target.value })} style={inputStyle} />
          </div>
          <input placeholder="เบอร์ติดต่อ" value={draft.contact_phone} onChange={e => setDraft({ ...draft, contact_phone: e.target.value })} style={inputStyle} />
          <button onClick={addShelter} disabled={saving} style={{ padding: 12, borderRadius: 12, border: 'none', background: '#111827', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            {saving ? 'กำลังบันทึก...' : 'บันทึกศูนย์ใหม่'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {shelters.map(s => (
          <div key={s.id} style={{ background: '#fff', borderRadius: 14, padding: 14, border: '1px solid #ECEEF5' }}>
            {editingId === s.id ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input defaultValue={s.name} onChange={e => setEditDraft({ ...editDraft, name: e.target.value })} style={inputStyle} />
                <input defaultValue={s.address ?? ''} onChange={e => setEditDraft({ ...editDraft, address: e.target.value })} style={inputStyle} placeholder="ที่อยู่" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input defaultValue={s.capacity} type="number" onChange={e => setEditDraft({ ...editDraft, capacity: Number(e.target.value) })} style={inputStyle} placeholder="ความจุ" />
                  <input defaultValue={s.contact_phone ?? ''} onChange={e => setEditDraft({ ...editDraft, contact_phone: e.target.value })} style={inputStyle} placeholder="เบอร์ติดต่อ" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button onClick={() => setEditingId(null)} style={{ padding: 10, borderRadius: 10, border: '1px solid #E5E7EB', background: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>ยกเลิก</button>
                  <button onClick={() => saveEdit(s.id)} disabled={saving} style={{ padding: 10, borderRadius: 10, border: 'none', background: '#111827', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>บันทึก</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>
                    {s.name} {!s.is_active && <span style={{ fontSize: 10, color: '#B91C1C', fontWeight: 700 }}>(ปิดใช้งาน)</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>
                    {s.address ?? 'ไม่ระบุที่อยู่'} · {s.current_occupancy}/{s.capacity} คน
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => { setEditingId(s.id); setEditDraft({}); }} style={{ padding: '7px 12px', borderRadius: 10, border: '1px solid #ECEEF5', background: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>แก้ไข</button>
                  <button onClick={() => toggleActive(s)} style={{ padding: '7px 12px', borderRadius: 10, border: '1px solid #ECEEF5', background: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    {s.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                  </button>
                  <button onClick={() => deleteShelter(s)} style={{ padding: '7px 12px', borderRadius: 10, border: '1px solid #FEE2E2', background: '#FEF2F2', color: '#B91C1C', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>ลบ</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ==========================================================
// TAB: ผู้ประสบภัย (ดูภาพรวม sos_reports ทั้งหมด)
// ==========================================================
function VictimsTab() {
  const [reports, setReports] = useState<SOSReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const fetchReports = async () => {
      const { data } = await supabase.from('sos_reports').select('*').order('created_at', { ascending: false }).limit(200);
      setReports((data as SOSReport[]) ?? []);
      setLoading(false);
    };
    fetchReports();
  }, []);

  const filtered = reports.filter(r => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (search && !r.full_name.toLowerCase().includes(search.toLowerCase()) && !r.phone.includes(search)) return false;
    return true;
  });

  if (loading) return <div style={{ color: '#9CA3AF', fontSize: 13 }}>กำลังโหลด...</div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input placeholder="🔍 ค้นหาชื่อหรือเบอร์โทร" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, maxWidth: 240 }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inputStyle, maxWidth: 180 }}>
          <option value="all">ทุกสถานะ</option>
          {Object.entries(SOS_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}
        </select>
      </div>

      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #ECEEF5', overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>ไม่พบข้อมูล</div>
        ) : filtered.map((r, i) => {
          const st = SOS_STATUS_LABEL[r.status] ?? SOS_STATUS_LABEL.pending;
          return (
            <div key={r.id} style={{ padding: 14, borderBottom: i < filtered.length - 1 ? '1px solid #F3F4F6' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{r.full_name}</div>
                <div style={{ fontSize: 11, color: '#9CA3AF' }}>
                  {r.phone} · {r.district} {r.province} · ผู้ใหญ่ {r.adult_count} เด็ก {r.child_count} สูงอายุ {r.elder_count}
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, color: st.color, background: st.bg }}>
                {st.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ==========================================================
// TAB: ภาพรวม/สถิติ
// ==========================================================
function OverviewTab() {
  const [loading, setLoading] = useState(true);
  const [sosCounts, setSosCounts] = useState<Record<string, number>>({});
  const [roleCounts, setRoleCounts] = useState<Record<string, number>>({});
  const [claimCounts, setClaimCounts] = useState<Record<string, number>>({});
  const [approvedValue, setApprovedValue] = useState(0);
  const [shelterTotals, setShelterTotals] = useState({ occupancy: 0, capacity: 0, count: 0 });
  const [totalVictims, setTotalVictims] = useState(0);
  const [pendingUrgent, setPendingUrgent] = useState(0);

  useEffect(() => {
    const load = async () => {
      const [{ data: sos }, { data: profiles }, { data: claims }, { data: shelters }] = await Promise.all([
        supabase.from('sos_reports').select('status, urgency_level'),
        supabase.from('profiles').select('role'),
        supabase.from('damage_reports').select('status, damage_value'),
        supabase.from('shelters').select('current_occupancy, capacity'),
      ]);

      const sc: Record<string, number> = {};
      (sos ?? []).forEach((r: any) => { sc[r.status] = (sc[r.status] ?? 0) + 1; });
      setSosCounts(sc);
      setTotalVictims((sos ?? []).length);
      setPendingUrgent((sos ?? []).filter((r: any) => r.status === 'pending' && (r.urgency_level === 'high' || r.urgency_level === 'critical')).length);

      const rc: Record<string, number> = {};
      (profiles ?? []).forEach((p: any) => { rc[p.role] = (rc[p.role] ?? 0) + 1; });
      setRoleCounts(rc);

      const cc: Record<string, number> = {};
      let approvedSum = 0;
      (claims ?? []).forEach((c: any) => {
        cc[c.status] = (cc[c.status] ?? 0) + 1;
        if (c.status === 'approved' && c.damage_value) approvedSum += Number(c.damage_value);
      });
      setClaimCounts(cc);
      setApprovedValue(approvedSum);

      const totals = (shelters ?? []).reduce((acc: any, s: any) => ({
        occupancy: acc.occupancy + (s.current_occupancy ?? 0),
        capacity: acc.capacity + (s.capacity ?? 0),
        count: acc.count + 1,
      }), { occupancy: 0, capacity: 0, count: 0 });
      setShelterTotals(totals);

      setLoading(false);
    };
    load();
  }, []);

  if (loading) return <div style={{ color: '#9CA3AF', fontSize: 13 }}>กำลังโหลด...</div>;

  return (
    <div>
      {pendingUrgent > 0 && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FEE2E2', borderRadius: 14, padding: 14, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🚨</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#B91C1C' }}>
            มีเคสเร่งด่วน (สูง/วิกฤต) ที่ยังรอรับเรื่องอยู่ {pendingUrgent} เคส
          </span>
        </div>
      )}

      <SectionLabel text="ผู้ประสบภัย (sos_reports)" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 20 }}>
        <StatCard label="ทั้งหมด" value={totalVictims} color="#111827" big />
        <StatCard label="รอรับเรื่อง" value={sosCounts.pending ?? 0} color="#92400E" />
        <StatCard label="กำลังช่วย" value={sosCounts.assigned ?? 0} color="#1D4ED8" />
        <StatCard label="สำเร็จแล้ว" value={sosCounts.rescued ?? 0} color="#15803D" />
        <StatCard label="เข้าไม่ถึง" value={sosCounts.cannot_reach ?? 0} color="#B91C1C" />
      </div>

      <SectionLabel text="กำลังคน" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
        <StatCard label="🚑 กู้ภัย" value={roleCounts.rescuer ?? 0} color="#111827" />
        <StatCard label="🏠 เจ้าหน้าที่ศูนย์" value={roleCounts.shelter_staff ?? 0} color="#111827" />
        <StatCard label="🛡️ แอดมิน" value={roleCounts.admin ?? 0} color="#111827" />
      </div>

      <SectionLabel text="ศูนย์พักพิง" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
        <StatCard label="จำนวนศูนย์" value={shelterTotals.count} color="#111827" />
        <StatCard label="คนในศูนย์รวม" value={shelterTotals.occupancy} color="#5046e5" />
        <StatCard label="ความจุรวม" value={shelterTotals.capacity} color="#9CA3AF" />
      </div>

      <SectionLabel text="คำขอเยียวยา (damage_reports)" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 10 }}>
        <StatCard label="รอตรวจสอบ" value={claimCounts.pending ?? 0} color="#92400E" />
        <StatCard label="ตรวจสอบแล้ว" value={claimCounts.verified ?? 0} color="#1D4ED8" />
        <StatCard label="อนุมัติแล้ว" value={claimCounts.approved ?? 0} color="#15803D" />
        <StatCard label="ไม่อนุมัติ" value={claimCounts.rejected ?? 0} color="#B91C1C" />
      </div>
      <div style={{ background: '#fff', borderRadius: 14, padding: 14, border: '1px solid #ECEEF5' }}>
        <div style={{ fontSize: 12, color: '#9CA3AF' }}>มูลค่าที่อนุมัติเยียวยาแล้วรวม</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#15803D' }}>{approvedValue.toLocaleString('th-TH')} บาท</div>
      </div>
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <div style={{ fontSize: 12, fontWeight: 700, color: '#9CA3AF', marginBottom: 8, marginTop: 4 }}>{text}</div>;
}

function StatCard({ label, value, color, big }: { label: string; value: number; color: string; big?: boolean }) {
  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: '14px 12px', border: '1px solid #ECEEF5', textAlign: 'center' }}>
      <div style={{ fontSize: big ? 24 : 19, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{label}</div>
    </div>
  );
}

// ==========================================================
// TAB: เยียวยา (ตรวจสอบ/อนุมัติ/ปฏิเสธคำขอ damage_reports)
// ==========================================================
function CompensationTab() {
  const [claims, setClaims] = useState<DamageReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const fetchClaims = async () => {
    const { data } = await supabase.from('damage_reports').select('*').order('created_at', { ascending: false });
    setClaims((data as DamageReport[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { fetchClaims(); }, []);

  const updateStatus = async (id: string, status: DamageReport['status']) => {
    setSavingId(id);
    try {
      const { error } = await supabase.from('damage_reports').update({ status }).eq('id', id);
      if (error) throw error;
      setClaims(prev => prev.map(c => c.id === id ? { ...c, status } : c));
    } catch (err: any) {
      alert(`บันทึกไม่สำเร็จ: ${err.message}`);
    } finally {
      setSavingId(null);
    }
  };

  const counts = claims.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});

  const filtered = claims.filter(c => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (search && !c.full_name.toLowerCase().includes(search.toLowerCase()) && !c.phone.includes(search)) return false;
    return true;
  });

  if (loading) return <div style={{ color: '#9CA3AF', fontSize: 13 }}>กำลังโหลด...</div>;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        {(['pending', 'verified', 'approved', 'rejected'] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              background: statusFilter === s ? CLAIM_STATUS_LABEL[s].bg : '#fff',
              border: statusFilter === s ? `2px solid ${CLAIM_STATUS_LABEL[s].color}` : '1px solid #ECEEF5',
              borderRadius: 14, padding: '14px 12px', textAlign: 'center', cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, color: CLAIM_STATUS_LABEL[s].color }}>{counts[s] ?? 0}</div>
            <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>{CLAIM_STATUS_LABEL[s].text}</div>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input placeholder="🔍 ค้นหาชื่อหรือเบอร์โทร" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, maxWidth: 240 }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inputStyle, maxWidth: 180 }}>
          <option value="all">ทุกสถานะ</option>
          {Object.entries(CLAIM_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#9CA3AF', fontSize: 13, background: '#fff', borderRadius: 14, border: '1px solid #ECEEF5' }}>
            ไม่พบคำขอในหมวดนี้
          </div>
        ) : filtered.map(c => {
          const st = CLAIM_STATUS_LABEL[c.status];
          const expanded = expandedId === c.id;
          return (
            <div key={c.id} style={{ background: '#fff', borderRadius: 14, border: '1px solid #ECEEF5', padding: 14 }}>
              <div
                onClick={() => setExpandedId(expanded ? null : c.id)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', gap: 10, flexWrap: 'wrap' }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>
                    {c.full_name} {!c.victim_confirmed && <span style={{ fontSize: 10, color: '#B91C1C' }}>(ยังไม่ยืนยันตัวตน)</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#9CA3AF' }}>
                    {DAMAGE_TYPE_LABEL[c.damage_type ?? ''] ?? 'ยังไม่ระบุประเภท'} · {c.phone} · {new Date(c.created_at).toLocaleDateString('th-TH')}
                  </div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, color: st.color, background: st.bg }}>
                  {st.text}
                </span>
              </div>

              {expanded && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #F3F4F6', fontSize: 12, color: '#374151', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div>📍 {c.address_details ?? '-'} {c.sub_district} {c.district} {c.province}</div>
                  <div>🪪 เลขบัตร ปชช.: {c.id_card_number ?? 'ยังไม่ได้ยืนยัน'}</div>
                  <div>📅 วันที่เกิดเหตุ: {c.incident_date ? new Date(c.incident_date).toLocaleDateString('th-TH') : '-'}</div>
                  <div>💵 มูลค่าความเสียหาย: {c.damage_value ? `${Number(c.damage_value).toLocaleString('th-TH')} บาท` : 'ไม่ระบุ'}</div>
                  <div>📝 รายละเอียด: {c.description ?? '-'}</div>
                  {c.id_card_image_url && (
                    <a href={c.id_card_image_url} target="_blank" rel="noreferrer" style={{ color: '#2563EB', fontWeight: 700 }}>
                      📎 ดูรูปบัตรประชาชน
                    </a>
                  )}
                  {c.image_urls?.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                      {c.image_urls.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noreferrer">
                          <img src={url} alt={`damage-${i}`} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid #E5E7EB' }} />
                        </a>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 8 }}>
                    <button
                      onClick={() => updateStatus(c.id, 'verified')}
                      disabled={savingId === c.id || !c.victim_confirmed}
                      title={!c.victim_confirmed ? 'ผู้ประสบภัยยังไม่ได้ยืนยันตัวตน' : ''}
                      style={{ padding: 9, borderRadius: 10, border: '1px solid #DBEAFE', background: '#EFF6FF', color: '#1D4ED8', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: !c.victim_confirmed ? 0.5 : 1 }}
                    >
                      ตรวจสอบแล้ว
                    </button>
                    <button
                      onClick={() => updateStatus(c.id, 'approved')}
                      disabled={savingId === c.id || !c.victim_confirmed}
                      style={{ padding: 9, borderRadius: 10, border: '1px solid #DCFCE7', background: '#F0FDF4', color: '#15803D', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: !c.victim_confirmed ? 0.5 : 1 }}
                    >
                      ✅ อนุมัติ
                    </button>
                    <button
                      onClick={() => updateStatus(c.id, 'rejected')}
                      disabled={savingId === c.id}
                      style={{ padding: 9, borderRadius: 10, border: '1px solid #FEE2E2', background: '#FEF2F2', color: '#B91C1C', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                    >
                      ❌ ไม่อนุมัติ
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
