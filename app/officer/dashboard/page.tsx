'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface SOSReport {
  id: string;
  full_name: string;
  phone: string;
  province: string;
  district: string;
  sub_district: string;
  address_details?: string;
  lat?: number;
  lng?: number;
  adult_count?: number;
  child_count?: number;
  elder_count?: number;
  urgency_level: 'low' | 'medium' | 'high' | 'critical';
  water_level?: number;
  special_needs?: string;
  needed_items?: string[];
  status: 'pending' | 'assigned' | 'rescued' | 'cannot_reach' | 'closed';
  created_at: string;
}

interface Profile {
  id: string;
  full_name: string;
  phone?: string;
  role: string;
  agency?: string;
  shelter_id?: string | null;
}

interface Shelter {
  id: string;
  name: string;
  address?: string;
  province?: string;
}

// สถานะ modal "ยืนยันผลการช่วยเหลือ" ที่กำลังเปิดอยู่ (เก็บข้อมูลเคสไว้ตั้งต้นค่า default)
interface OutcomeDraft {
  reportId: string;
  fullName: string;
  mode: 'rescued' | 'cannot_reach' | null;
  destinationType: 'shelter' | 'relative_home' | 'hotel' | 'other_safe' | null;
  destinationShelterId: string;
  destinationNote: string;
  confirmedAdult: number;
  confirmedChild: number;
  confirmedElder: number;
  cannotReachReason: 'no_access' | 'deceased' | null;
  notes: string;
}

const calcDistance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  if (!lat1 || !lng1 || !lat2 || !lng2) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(1);
};

// ── เปิด Google Maps นำทาง ──────────────────────────────────────
// ถ้าอยู่บนมือถือจะเปิด app Google Maps โดยตรง
// ถ้าอยู่บน desktop จะเปิด browser
const openNavigation = (lat: number, lng: number, label: string) => {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);

  if (isIOS) {
    // เปิด Apple Maps หรือ Google Maps app บน iOS
    window.open(`comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`, '_blank');
    // fallback ถ้าไม่มี Google Maps app
    setTimeout(() => {
      window.open(`https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`, '_blank');
    }, 500);
  } else if (isAndroid) {
    // เปิด Google Maps app บน Android โดยตรง
    window.open(`google.navigation:q=${lat},${lng}`, '_blank');
    // fallback
    setTimeout(() => {
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${encodeURIComponent(label)}&travelmode=driving`,
        '_blank'
      );
    }, 500);
  } else {
    // Desktop — เปิด browser
    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
      '_blank'
    );
  }
};

const URGENCY_LABEL: Record<string, string> = {
  low: 'ต่ำ', medium: 'กลาง', high: 'สูง', critical: 'วิกฤต',
};
const URGENCY_COLOR: Record<string, string> = {
  low: '#22C55E', medium: '#F59E0B', high: '#EF4444', critical: '#7C3AED',
};
const STATUS_LABEL: Record<string, string> = {
  pending: 'รอรับเรื่อง',
  assigned: 'กำลังช่วย',
  rescued: 'ช่วยสำเร็จ',
  cannot_reach: 'เข้าไม่ถึง',
  closed: 'ปิดเคส',
};

export default function OfficerDashboard() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [myCoords, setMyCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [reports, setReports] = useState<SOSReport[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterDistrict, setFilterDistrict] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  // เก็บ id ของงานที่เพิ่งกดรับ เพื่อแสดงปุ่มนำทาง
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  // เก็บขั้นตอนปัจจุบันของแต่ละงานจากตาราง assignments (accepted / en_route / on_scene)
  // ใช้แสดงผลว่าเจ้าหน้าที่กดปุ่ม "กำลังเดินทาง" / "ถึงที่เกิดเหตุ" ไปแล้วจริง
  const [jobStage, setJobStage] = useState<Record<string, string>>({});
  // รายชื่อศูนย์พักพิงทั้งหมด ไว้ให้เลือกตอนยืนยันผลว่าไปส่งศูนย์ไหน
  const [shelters, setShelters] = useState<Shelter[]>([]);
  // ข้อมูล modal "ยืนยันผลการช่วยเหลือ" ที่กำลังเปิดอยู่ (null = ปิดอยู่)
  const [outcomeDraft, setOutcomeDraft] = useState<OutcomeDraft | null>(null);
  const [outcomeSaving, setOutcomeSaving] = useState(false);
  // ข้อความแจ้งปัญหาสิทธิ์การเข้าใช้งาน (role/ศูนย์ยังไม่ถูกตั้งค่า) — โชว์ตรงๆ แทนการเด้งกลับ login แบบเงียบๆ
  // เพราะเคยทำให้ผู้ใช้เข้าใจผิดว่า session หลุด ทั้งที่จริงยัง login ค้างอยู่
  const [accessError, setAccessError] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/officer/login'); return; }

      const { data: prof, error: profErr } = await supabase
        .from('profiles').select('*').eq('id', user.id).single();

      let resolvedProfile: Profile | null = null;

      if (profErr || !prof) {
        const { data: created } = await supabase
          .from('profiles')
          .insert({ id: user.id, full_name: user.email ?? 'เจ้าหน้าที่', role: 'rescuer' })
          .select().single();
        resolvedProfile = created;
      } else {
        resolvedProfile = prof;
      }

      // หน้านี้เป็นของเจ้าหน้าที่กู้ภัย (rescuer) เท่านั้น
      // ถ้า role เป็นอย่างอื่น ให้เด้งไปหน้าที่ถูกต้องแทน กันเข้าหน้าผิดบทบาท
      if (resolvedProfile?.role === 'shelter_staff') {
        const shelterId = resolvedProfile.shelter_id;
        if (!shelterId) {
          // login ค้างอยู่ปกติ แค่ยังไม่ได้ผูกศูนย์พักพิงในระบบ — แจ้งตรงๆ ไม่เด้งกลับ login
          setAccessError('บัญชีนี้ถูกตั้งเป็น "เจ้าหน้าที่ศูนย์พักพิง" แล้ว แต่ยังไม่ได้ผูกกับศูนย์ไหนเลย กรุณาติดต่อแอดมินให้ตั้งค่า shelter_id ในระบบก่อนใช้งาน');
          setLoading(false);
          return;
        }
        router.push(`/officer/shelter/${shelterId}`);
        return;
      }
      if (resolvedProfile?.role === 'admin') {
        router.replace('/officer/admin');
        return;
      }

      setProfile(resolvedProfile);

      navigator.geolocation?.getCurrentPosition(
        ({ coords }) => setMyCoords({ lat: coords.latitude, lng: coords.longitude }),
        () => {}
      );
    };
    init();
  }, [router]);

  useEffect(() => {
    if (!profile) return;

    const fetchReports = async () => {
      const { data } = await supabase
        .from('sos_reports').select('*').order('created_at', { ascending: false });
      setReports((data as SOSReport[]) ?? []);
      setLoading(false);
    };

    // ดึงขั้นตอนล่าสุดของงานที่ยังไม่จบ (accepted/en_route/on_scene) มาแสดงตอนโหลดหน้า
    // กันปัญหา refresh หน้าแล้ว badge สถานะหาย ทั้งที่ DB มีค่าอยู่แล้ว
    const fetchJobStages = async () => {
      const { data } = await supabase
        .from('assignments')
        .select('sos_report_id, status')
        .in('status', ['accepted', 'en_route', 'on_scene']);
      if (data) {
        const map: Record<string, string> = {};
        data.forEach((a: any) => { map[a.sos_report_id] = a.status; });
        setJobStage(map);
      }
    };

    const fetchShelters = async () => {
      const { data } = await supabase
        .from('shelters').select('id, name, address, province')
        .eq('is_active', true).order('name');
      setShelters((data as Shelter[]) ?? []);
    };

    fetchReports();
    fetchJobStages();
    fetchShelters();

    const channel = supabase.channel('sos_realtime')
      .on('postgres_changes' as any,
        { event: '*', schema: 'public', table: 'sos_reports' },
        (payload: any) => {
          if (payload.eventType === 'INSERT')
            setReports(prev => [payload.new as SOSReport, ...prev]);
          else if (payload.eventType === 'UPDATE')
            setReports(prev => prev.map(r => r.id === payload.new.id ? payload.new as SOSReport : r));
          else if (payload.eventType === 'DELETE')
            setReports(prev => prev.filter(r => r.id !== payload.old.id));
        }
      ).subscribe();

    // ฟัง realtime การเปลี่ยนสถานะของ assignments ด้วย
    // ทำให้เจ้าหน้าที่คนอื่นที่เปิดหน้านี้อยู่เห็นขั้นตอนงานอัปเดตพร้อมกัน
    const assignChannel = supabase.channel('assignments_realtime')
      .on('postgres_changes' as any,
        { event: '*', schema: 'public', table: 'assignments' },
        (payload: any) => {
          const row = payload.new ?? payload.old;
          if (!row?.sos_report_id) return;
          setJobStage(prev => {
            const next = { ...prev };
            if (payload.eventType === 'DELETE' || ['completed', 'cannot_reach'].includes(row.status)) {
              delete next[row.sos_report_id];
            } else {
              next[row.sos_report_id] = row.status;
            }
            return next;
          });
        }
      ).subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(assignChannel);
    };
  }, [profile]);

  const acceptJob = async (reportId: string) => {
    if (!profile) return;
    setActionLoading(reportId);
    try {
      const { data: existing } = await supabase
        .from('assignments').select('id')
        .eq('rescuer_id', profile.id)
        .in('status', ['accepted', 'en_route', 'on_scene'])
        .maybeSingle();

      if (existing) {
        alert('⚠️ คุณมีงานที่กำลังดำเนินการอยู่แล้ว กรุณาปิดงานเดิมก่อน');
        return;
      }

      setReports(prev => prev.map(r => r.id === reportId ? { ...r, status: 'assigned' } : r));

      const { error: sosErr } = await supabase
        .from('sos_reports')
        .update({ status: 'assigned', updated_at: new Date().toISOString() })
        .eq('id', reportId);
      if (sosErr) throw sosErr;

      const { error: assignErr } = await supabase
        .from('assignments')
        .insert({
          sos_report_id: reportId,
          rescuer_id: profile.id,
          status: 'accepted',
          accepted_at: new Date().toISOString(),
        });
      if (assignErr) throw assignErr;

      await supabase.from('victim_status').upsert(
        { sos_report_id: reportId, status: 'rescue_assigned', updated_at: new Date().toISOString() },
        { onConflict: 'sos_report_id' }
      );

      // ← แสดงปุ่มนำทางทันทีหลังรับงาน + อัปเดต badge ขั้นตอนงาน
      setNavigatingId(reportId);
      setJobStage(prev => ({ ...prev, [reportId]: 'accepted' }));

    } catch (err: any) {
      alert(`รับงานไม่สำเร็จ: ${err.message}`);
      setReports(prev => prev.map(r => r.id === reportId ? { ...r, status: 'pending' } : r));
    } finally {
      setActionLoading(null);
    }
  };

  const updateAssignment = async (
    reportId: string,
    newSOSStatus: SOSReport['status'],
    newAssignStatus: 'en_route' | 'on_scene' | 'completed' | 'cannot_reach',
    notes?: string
  ) => {
    if (!profile) return;
    setActionLoading(reportId);
    try {
      setReports(prev => prev.map(r => r.id === reportId ? { ...r, status: newSOSStatus } : r));

      const { error: sosErr } = await supabase
        .from('sos_reports')
        .update({ status: newSOSStatus, updated_at: new Date().toISOString() })
        .eq('id', reportId);
      if (sosErr) throw sosErr;

      const updateData: any = { status: newAssignStatus };
      if (notes) updateData.notes = notes;
      if (newAssignStatus === 'completed') updateData.completed_at = new Date().toISOString();

      // กรองเฉพาะแถว assignment ที่ยัง active อยู่ กันไปทับสถานะของแถวประวัติเก่าที่ปิดเคสไปแล้ว
      // (เคยเกิดเคสที่กด "ลองเข้าใหม่" แล้วมี assignment มากกว่า 1 แถวต่อ report+rescuer เดิม)
      const { error: assignErr } = await supabase
        .from('assignments').update(updateData)
        .eq('sos_report_id', reportId).eq('rescuer_id', profile.id)
        .in('status', ['accepted', 'en_route', 'on_scene']);
      if (assignErr) throw assignErr;

      const victimMap: Record<string, string> = {
        rescued: 'rescued', cannot_reach: 'unknown', closed: 'unknown',
      };
      if (victimMap[newSOSStatus]) {
        await supabase.from('victim_status')
          .update({ status: victimMap[newSOSStatus], updated_at: new Date().toISOString() })
          .eq('sos_report_id', reportId);
      }

      // อัปเดต badge ขั้นตอนงานให้ตรงกับสถานะล่าสุดที่เพิ่งเซฟลง DB สำเร็จ
      if (newAssignStatus === 'en_route' || newAssignStatus === 'on_scene') {
        setJobStage(prev => ({ ...prev, [reportId]: newAssignStatus }));
      } else if (newAssignStatus === 'completed' || newAssignStatus === 'cannot_reach') {
        setJobStage(prev => {
          const next = { ...prev };
          delete next[reportId];
          return next;
        });
      }

      // ซ่อนปุ่มนำทางเมื่องานเสร็จ
      if (newAssignStatus === 'completed' || newAssignStatus === 'cannot_reach') {
        setNavigatingId(null);
      }
    } catch (err: any) {
      alert(`อัปเดตไม่สำเร็จ: ${err.message}`);
      window.location.reload();
    } finally {
      setActionLoading(null);
    }
  };

  // เปิด modal ยืนยันผลการช่วยเหลือ — ตั้งค่าเริ่มต้นจากเคสที่เลือก
  const openOutcomeModal = (report: SOSReport) => {
    setOutcomeDraft({
      reportId: report.id,
      fullName: report.full_name,
      mode: null,
      destinationType: null,
      destinationShelterId: '',
      destinationNote: '',
      confirmedAdult: report.adult_count ?? 0,
      confirmedChild: report.child_count ?? 0,
      confirmedElder: report.elder_count ?? 0,
      cannotReachReason: null,
      notes: '',
    });
  };

  // บันทึกผลการช่วยเหลือจริงลง DB ทีละตาราง (ตาม pattern เดิมของหน้านี้ ไม่ใช้ DB trigger)
  const confirmOutcome = async () => {
    if (!outcomeDraft || !profile) return;
    const d = outcomeDraft;

    if (d.mode === 'rescued' && !d.destinationType) {
      alert('กรุณาเลือกว่านำส่งไปที่ไหน'); return;
    }
    if (d.mode === 'rescued' && d.destinationType === 'shelter' && !d.destinationShelterId) {
      alert('กรุณาเลือกศูนย์พักพิงที่นำส่ง'); return;
    }
    if (d.mode === 'cannot_reach' && !d.cannotReachReason) {
      alert('กรุณาเลือกเหตุผลที่เข้าไม่ถึง'); return;
    }

    setOutcomeSaving(true);
    try {
      // เรียก Postgres function เดียว (atomic transaction) แทนการยิง 4 ครั้งแยกกัน
      // กันปัญหาข้อมูลค้างครึ่งๆ กลางๆ เวลาเน็ต/ขั้นตอนใดขั้นตอนหนึ่งสะดุดกลางทาง
      // ดู migration-06-confirm-rescue-outcome.sql
      const { error: rpcErr } = await supabase.rpc('confirm_rescue_outcome', {
        p_sos_report_id: d.reportId,
        p_mode: d.mode,
        p_destination_type: d.mode === 'rescued' ? d.destinationType : null,
        p_destination_shelter_id: d.mode === 'rescued' && d.destinationType === 'shelter' ? d.destinationShelterId : null,
        p_destination_note: d.mode === 'rescued' && d.destinationType !== 'shelter' ? d.destinationNote : null,
        p_confirmed_adult: d.mode === 'rescued' ? d.confirmedAdult : 0,
        p_confirmed_child: d.mode === 'rescued' ? d.confirmedChild : 0,
        p_confirmed_elder: d.mode === 'rescued' ? d.confirmedElder : 0,
        p_cannot_reach_reason: d.mode === 'cannot_reach' ? d.cannotReachReason : null,
        p_notes: d.notes || null,
      });
      if (rpcErr) throw rpcErr;

      // อัปเดต UI local state ให้ตรงกับ DB ทันที
      const newSOSStatus = d.mode === 'rescued' ? 'rescued' : 'cannot_reach';
      setReports(prev => prev.map(r => r.id === d.reportId ? { ...r, status: newSOSStatus as SOSReport['status'] } : r));
      setJobStage(prev => { const next = { ...prev }; delete next[d.reportId]; return next; });
      if (navigatingId === d.reportId) setNavigatingId(null);
      setOutcomeDraft(null);

    } catch (err: any) {
      alert(`บันทึกผลไม่สำเร็จ: ${err.message}`);
    } finally {
      setOutcomeSaving(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const filtered = reports
    .filter(r => filterStatus === 'all' || r.status === filterStatus)
    .filter(r => filterDistrict === 'all' || r.district === filterDistrict)
    .sort((a, b) => {
      if (!myCoords) return 0;
      const dA = parseFloat(calcDistance(myCoords.lat, myCoords.lng, a.lat ?? 0, a.lng ?? 0) ?? '999');
      const dB = parseFloat(calcDistance(myCoords.lat, myCoords.lng, b.lat ?? 0, b.lng ?? 0) ?? '999');
      return dA - dB;
    });

  const districts = [...new Set(reports.map(r => r.district).filter(Boolean))];

  if (accessError) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "var(--font-thai), 'Noto Sans Thai', sans-serif", padding: 20 }}>
      <div style={{ maxWidth: 380, textAlign: 'center', background: '#fff', borderRadius: 20, padding: 28, border: '1px solid #ECEEF5' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>⚠️</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 8 }}>ยังเข้าใช้งานไม่ได้</div>
        <div style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6, marginBottom: 20 }}>{accessError}</div>
        <button
          onClick={async () => { await supabase.auth.signOut(); router.push('/officer/login'); }}
          style={{ padding: '11px 20px', borderRadius: 12, border: '1px solid #ECEEF5', background: '#fff', color: '#6B7280', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          ออกจากระบบ
        </button>
      </div>
    </div>
  );

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "var(--font-thai), 'Noto Sans Thai', sans-serif", color: '#6B7280' }}>
      กำลังโหลด...
    </div>
  );

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes ping { 0%,100%{transform:scale(1);opacity:1} 70%{transform:scale(2);opacity:0} }
        @keyframes pulse-nav {
          0%,100% { box-shadow: 0 4px 20px rgba(239,68,68,0.4); }
          50% { box-shadow: 0 4px 32px rgba(239,68,68,0.7); }
        }
        @keyframes rise-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes gentle-glow { 0%,100% { opacity: .4; transform: scale(.96); } 50% { opacity: .75; transform: scale(1.06); } }
        .rescue-app { --navy:#264653; --teal:#2A9D8F; --saffron:#E9C46A; --sand:#F4A261; --coral:#E76F51; --surface:#FFFEFC; --muted:#6B7C84; min-height:100vh !important; background:#E0FBFC !important; color:var(--navy); font-family:var(--font-thai),"Noto Sans Thai",sans-serif !important; padding-left:84px; }
        .rescue-app::before { content:""; position:fixed; width:420px; height:420px; border-radius:50%; background:rgba(42,157,143,.13); filter:blur(8px); right:-180px; top:56px; pointer-events:none; animation:gentle-glow 8s ease-in-out infinite; }
        .rescue-rail { position:fixed; inset:0 auto 0 0; width:84px; z-index:80; background:#264653; display:flex; flex-direction:column; align-items:center; padding:18px 12px; box-shadow:12px 0 32px rgba(38,70,83,.12); }
        .rail-brand { width:46px; height:46px; border-radius:16px; background:linear-gradient(135deg,#E9C46A,#F4A261); color:#264653; display:grid; place-items:center; font-size:20px; font-weight:900; box-shadow:0 8px 16px rgba(0,0,0,.16); }
        .rail-menu { display:grid; gap:10px; margin-top:42px; }
        .rail-button { border:0; width:48px; height:48px; border-radius:15px; color:rgba(255,255,255,.72); background:transparent; cursor:pointer; font:700 19px/1 inherit; transition:transform .2s ease,background .2s ease,color .2s ease; }
        .rail-button:hover,.rail-button.active { background:#2A9D8F; color:#fff; transform:translateY(-2px); }.rail-button.exit{margin-top:auto;font-size:18px}
        .rescue-app > header { background:rgba(255,254,252,.82) !important; backdrop-filter:blur(18px); border-bottom:1px solid rgba(38,70,83,.08) !important; padding:15px 28px !important; }.rescue-app > header > div{max-width:1440px !important}.rescue-app > header button{border-color:rgba(38,70,83,.12) !important;color:#264653 !important;border-radius:12px !important;transition:background .2s ease,transform .2s ease !important}.rescue-app > header button:hover{background:#fff7ed !important;transform:translateY(-1px)}
        .rescue-app main { max-width:1440px !important; padding:28px !important; position:relative; z-index:1; }.legacy-summary{display:none !important}
        .dashboard-overview { display:grid; grid-template-columns:minmax(0,1.55fr) minmax(300px,.75fr); gap:18px; margin-bottom:18px; animation:rise-in .45s ease both; }.operation-hero{min-height:206px;overflow:hidden;position:relative;border-radius:26px;padding:28px;color:#fff;background:linear-gradient(125deg,#264653,#31677a);box-shadow:0 18px 42px rgba(38,70,83,.18)}.operation-hero::after{content:"";position:absolute;width:230px;height:230px;right:-72px;bottom:-102px;border:32px solid rgba(233,196,106,.38);border-radius:50%}.operation-kicker{display:flex;gap:8px;align-items:center;color:#E9C46A;font-size:12px;font-weight:800;letter-spacing:.08em}.operation-kicker i{width:8px;height:8px;border-radius:50%;background:#E9C46A;box-shadow:0 0 0 5px rgba(233,196,106,.14)}.operation-hero h1{font-size:clamp(23px,3vw,32px);letter-spacing:-.035em;line-height:1.22;margin:18px 0 7px;position:relative;z-index:1}.operation-hero p{color:rgba(255,255,255,.76);font-size:14px;position:relative;z-index:1}.operation-summary{display:flex;position:relative;z-index:1;gap:18px;margin-top:24px}.operation-summary span{display:grid;gap:2px;font-size:12px;color:rgba(255,255,255,.65)}.operation-summary b{color:#fff;font-size:20px;line-height:1}
        .metric-stack{display:grid;grid-template-columns:1fr 1fr;gap:12px}.metric-card{background:#FFFEFC;min-height:97px;padding:18px;border:1px solid rgba(38,70,83,.08);border-radius:22px;box-shadow:0 10px 24px rgba(38,70,83,.06);transition:transform .2s ease,box-shadow .2s ease}.metric-card:hover{transform:translateY(-3px);box-shadow:0 16px 28px rgba(38,70,83,.1)}.metric-card:nth-child(1){background:#fff8e7}.metric-card:nth-child(2){background:#ecf9f7}.metric-card:nth-child(3){background:#fff0ec}.metric-card:nth-child(4){background:#f5f8f9}.metric-label{font-size:12px;color:#6B7C84;font-weight:600}.metric-value{margin-top:6px;font-size:27px;line-height:1;font-weight:800;color:#264653}
        .filter-bar{background:rgba(255,254,252,.9) !important;border:1px solid rgba(38,70,83,.08) !important;border-radius:22px !important;padding:12px !important;margin-bottom:18px !important;box-shadow:0 9px 22px rgba(38,70,83,.05)}.filter-label{margin:0 6px 0 4px;color:#264653;font-size:13px;font-weight:800}.filter-button{background:#edf4f4 !important;color:#6B7C84 !important;border:1px solid transparent !important;border-radius:12px !important;padding:8px 13px !important;transition:all .2s ease !important}.filter-button:hover{background:#d8efeb !important;color:#2A9D8F !important;transform:translateY(-1px)}.filter-button.selected{background:#2A9D8F !important;color:#fff !important;box-shadow:0 5px 12px rgba(42,157,143,.2)}.district-filter{border-color:rgba(38,70,83,.1) !important;background:#fff !important;color:#264653;border-radius:12px !important;padding:8px 11px !important}
        .report-grid{gap:16px !important}.rescue-card{border:1px solid rgba(38,70,83,.09) !important;background:#FFFEFC !important;border-radius:22px !important;padding:18px !important;box-shadow:0 9px 24px rgba(38,70,83,.055) !important;transition:transform .22s ease,box-shadow .22s ease,border-color .22s ease !important;animation:rise-in .45s ease both}.rescue-card:hover{transform:translateY(-4px);border-color:rgba(42,157,143,.36) !important;box-shadow:0 18px 32px rgba(38,70,83,.11) !important}.rescue-card > div:nth-child(3){background:#f3f8f8 !important;border-color:#e1eeee !important;border-radius:14px !important}.rescue-card button{transition:transform .18s ease,filter .18s ease,box-shadow .18s ease !important}.rescue-card button:hover:not(:disabled){transform:translateY(-1px);filter:saturate(1.06);box-shadow:0 6px 14px rgba(38,70,83,.12)}.rescue-card button:active:not(:disabled){transform:scale(.98)}.rescue-card button[style*="EF4444"]{background:#E76F51 !important}.rescue-card button[style*="1D4ED8"]{background:#2A9D8F !important}.outcome-backdrop{background:rgba(38,70,83,.54) !important;backdrop-filter:blur(5px)}.outcome-sheet{border:1px solid rgba(38,70,83,.08);box-shadow:0 -12px 42px rgba(38,70,83,.17)}
        @media(max-width:760px){.rescue-app{padding-left:0;padding-bottom:72px}.rescue-rail{width:100%;height:64px;inset:auto 0 0;flex-direction:row;padding:8px 16px;justify-content:space-between}.rail-brand{width:38px;height:38px;border-radius:13px;font-size:16px}.rail-menu{margin:0;display:flex;gap:6px}.rail-button{width:40px;height:40px;font-size:17px;border-radius:13px}.rail-button.exit{margin:0}.rescue-app>header{padding:13px 16px !important}.rescue-app>header>div>div:last-child{gap:7px !important}.rescue-app>header button{padding:7px 9px !important;font-size:11px !important}.dashboard-overview{grid-template-columns:1fr}.operation-hero{min-height:192px;padding:22px}.rescue-app main{padding:17px 14px 24px !important}.filter-label{width:100%;margin:0 4px 2px}.district-filter{margin-left:0 !important;width:100%}}
      `}</style>

      <div className="rescue-app" style={{ minHeight: '100vh', background: '#F0F2FA', fontFamily: "var(--font-thai), 'Noto Sans Thai', sans-serif" }}>
        <nav className="rescue-rail" aria-label="Operation navigation">
          <div className="rail-brand" aria-hidden="true">N</div>
          <div className="rail-menu">
            <button className={`rail-button ${filterStatus === 'all' ? 'active' : ''}`} type="button" aria-label="Overview" onClick={() => setFilterStatus('all')}>⌂</button>
            <button className={`rail-button ${filterStatus === 'pending' ? 'active' : ''}`} type="button" aria-label="Pending requests" onClick={() => setFilterStatus('pending')}>!</button>
            <button className={`rail-button ${filterStatus === 'assigned' ? 'active' : ''}`} type="button" aria-label="Active missions" onClick={() => setFilterStatus('assigned')}>↗</button>
            <button className={`rail-button ${filterStatus === 'rescued' ? 'active' : ''}`} type="button" aria-label="Completed missions" onClick={() => setFilterStatus('rescued')}>✓</button>
          </div>
          <button className="rail-button exit" type="button" aria-label="Sign out" onClick={handleLogout}>↪</button>
        </nav>

        {/* Header */}
        <header style={{ background: '#fff', borderBottom: '1px solid #ECEEF5', padding: '14px 20px', position: 'sticky', top: 0, zIndex: 50 }}>
          <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 11, background: 'linear-gradient(135deg,#6D5EF9,#5046e5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L4 5v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V5L12 2z" fill="rgba(255,255,255,0.2)" stroke="white" strokeWidth="1.5"/>
                  <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>ศูนย์ปฏิบัติการกู้ภัย</div>
                <div style={{ fontSize: 11, color: '#9CA3AF' }}>{profile?.full_name} · {profile?.agency ?? 'ไม่ระบุหน่วยงาน'}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#22C55E', fontWeight: 600 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22C55E', display: 'inline-block', animation: 'ping 2s infinite' }} />
                ออนไลน์
              </div>
              <button onClick={handleLogout} style={{ padding: '7px 14px', borderRadius: 10, border: '1px solid #ECEEF5', background: '#fff', fontSize: 13, fontWeight: 600, color: '#6B7280', cursor: 'pointer' }}>
                ออกจากระบบ
              </button>
            </div>
          </div>
        </header>

        {/* ── Floating Navigation Banner ─────────────────────────────
            แสดงเฉพาะเมื่อกดรับงานแล้ว และงานนั้นยังไม่เสร็จ          */}
        {navigatingId && (() => {
          const job = reports.find(r => r.id === navigatingId);
          if (!job || !job.lat || !job.lng) return null;
          const dist = myCoords
            ? calcDistance(myCoords.lat, myCoords.lng, job.lat, job.lng)
            : null;
          const locationLabel = `${job.sub_district} ${job.district} ${job.province}`;
          return (
            <div style={{
              background: '#EF4444',
              padding: '12px 20px',
              display: 'flex', alignItems: 'center', gap: 12,
              flexWrap: 'wrap',
              animation: 'pulse-nav 2s infinite',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', fontWeight: 600 }}>
                  🚒 งานที่กำลังดำเนินการ
                </div>
                <div style={{ fontSize: 14, color: '#fff', fontWeight: 700, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {job.full_name} · {locationLabel}
                </div>
                {dist && (
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 2 }}>
                    ห่าง {dist} กม.
                  </div>
                )}
              </div>

              {/* ปุ่มนำทาง — เปิด Google Maps / Apple Maps ตาม platform */}
              <button
                onClick={() => openNavigation(job.lat!, job.lng!, locationLabel)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: '#fff', color: '#EF4444',
                  border: 'none', borderRadius: 12,
                  padding: '10px 18px',
                  fontSize: 14, fontWeight: 700,
                  cursor: 'pointer', flexShrink: 0,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                  fontFamily: 'inherit',
                }}
              >
                {/* Google Maps icon */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="#EF4444"/>
                  <circle cx="12" cy="9" r="2.5" fill="white"/>
                </svg>
                นำทางไปเลย
              </button>

              {/* ปุ่มซ่อน banner */}
              <button
                onClick={() => setNavigatingId(null)}
                style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          );
        })()}

        <main style={{ maxWidth: 960, margin: '0 auto', padding: '20px 16px 40px' }}>

          <section className="dashboard-overview" aria-label="Mission overview">
            <div className="operation-hero">
              <div className="operation-kicker"><i />NEXUS RESCUE · LIVE OPERATIONS</div>
              <h1>พร้อมประสานงาน<br />เพื่อทุกชีวิตที่รอความช่วยเหลือ</h1>
              <p>{new Intl.DateTimeFormat('th-TH', { dateStyle: 'full' }).format(new Date())}</p>
              <div className="operation-summary">
                <span><b>{reports.length}</b>เหตุการณ์ทั้งหมด</span>
                <span><b>{reports.filter(r => r.status === 'pending' || r.status === 'assigned').length}</b>ภารกิจที่ต้องดูแล</span>
              </div>
            </div>
            <div className="metric-stack">
              {[
                { label: 'รอรับเรื่อง', count: reports.filter(r => r.status === 'pending').length },
                { label: 'กำลังช่วยเหลือ', count: reports.filter(r => r.status === 'assigned').length },
                { label: 'ช่วยเหลือสำเร็จ', count: reports.filter(r => r.status === 'rescued').length },
                { label: 'ผู้ประสบภัยทั้งหมด', count: reports.reduce((total, report) => total + (report.adult_count ?? 0) + (report.child_count ?? 0) + (report.elder_count ?? 0), 0) },
              ].map(({ label, count }) => (
                <div className="metric-card" key={label}>
                  <div className="metric-label">{label}</div>
                  <div className="metric-value">{count}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Summary */}
          <div className="legacy-summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'รอรับเรื่อง', count: reports.filter(r => r.status === 'pending').length, color: '#EF4444' },
              { label: 'กำลังช่วย', count: reports.filter(r => r.status === 'assigned').length, color: '#F59E0B' },
              { label: 'ช่วยสำเร็จ', count: reports.filter(r => r.status === 'rescued').length, color: '#22C55E' },
              { label: 'เข้าไม่ถึง', count: reports.filter(r => r.status === 'cannot_reach').length, color: '#6D5EF9' },
            ].map(({ label, count, color }) => (
              <div key={label} style={{ background: '#fff', borderRadius: 16, padding: '14px 16px', border: '1px solid #ECEEF5', textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 800, color }}>{count}</div>
                <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="filter-bar" style={{ background: '#fff', borderRadius: 16, padding: '14px 16px', marginBottom: 16, border: '1px solid #ECEEF5', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="filter-label">จัดลำดับภารกิจ</span>
            {['all', 'pending', 'assigned', 'rescued', 'cannot_reach'].map(s => (
              <button className={`filter-button ${filterStatus === s ? 'selected' : ''}`} key={s} onClick={() => setFilterStatus(s)}
                style={{
                  padding: '6px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 600,
                  background: filterStatus === s ? '#6D5EF9' : '#F3F4F6',
                  color: filterStatus === s ? '#fff' : '#6B7280',
                  fontFamily: 'inherit',
                }}>
                {s === 'all' ? 'ทั้งหมด' : STATUS_LABEL[s]}
              </button>
            ))}
            <select className="district-filter" value={filterDistrict} onChange={e => setFilterDistrict(e.target.value)}
              style={{ marginLeft: 'auto', padding: '6px 12px', borderRadius: 10, border: '1px solid #ECEEF5', fontSize: 13, background: '#F9FAFB', cursor: 'pointer', fontFamily: 'inherit' }}>
              <option value="all">ทุกอำเภอ</option>
              {districts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          {/* Cards */}
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#9CA3AF', fontSize: 15 }}>
              ไม่พบรายการที่ตรงกับเงื่อนไข
            </div>
          ) : (
            <div className="report-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }}>
              {filtered.map(item => {
                const dist = myCoords ? calcDistance(myCoords.lat, myCoords.lng, item.lat ?? 0, item.lng ?? 0) : null;
                const isLoading = actionLoading === item.id;
                const urgColor = URGENCY_COLOR[item.urgency_level] ?? '#6B7280';
                const isMyJob = navigatingId === item.id;
                const locationLabel = `${item.sub_district} ${item.district} ${item.province}`;
                const stage = jobStage[item.id];

                return (
                  <div className="rescue-card" key={item.id} style={{
                    background: '#fff', borderRadius: 20, padding: 20,
                    border: `1.5px solid ${isMyJob ? '#EF4444' : item.status === 'pending' ? '#FECACA' : item.status === 'assigned' ? '#FDE68A' : '#ECEEF5'}`,
                    display: 'flex', flexDirection: 'column', gap: 12,
                    boxShadow: isMyJob ? '0 0 0 3px rgba(239,68,68,0.12)' : 'none',
                  }}>

                    {/* Status row */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 8, background: `${urgColor}18`, color: urgColor }}>
                        {URGENCY_LABEL[item.urgency_level]} · น้ำ {item.water_level ?? '-'}/5
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#6D5EF9', background: '#EDE9FE', padding: '3px 10px', borderRadius: 8 }}>
                        {STATUS_LABEL[item.status]}
                      </span>
                    </div>

                    {/* Name */}
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>{item.full_name}</div>
                      <div style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>📞 {item.phone}</div>
                    </div>

                    {/* Location info */}
                    <div style={{ background: '#F9FAFB', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#374151', lineHeight: 1.7, border: '1px solid #F3F4F6' }}>
                      <div>📍 {locationLabel}</div>
                      {item.address_details && <div style={{ color: '#6B7280' }}>{item.address_details}</div>}
                      {item.needed_items && item.needed_items.length > 0 && (
                        <div>📦 {item.needed_items.join(', ')}</div>
                      )}
                      {(item.adult_count !== undefined) && (
                        <div style={{ color: '#EF4444', fontWeight: 600, marginTop: 4 }}>
                          ผู้ใหญ่ {item.adult_count} · เด็ก {item.child_count} · สูงอายุ {item.elder_count}
                        </div>
                      )}
                    </div>

                    {/* Distance + inline navigation */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {dist && <span style={{ fontSize: 12, color: '#6D5EF9', fontWeight: 600 }}>ห่าง {dist} กม.</span>}
                      {item.lat && item.lng && (
                        /* ปุ่มนำทางเล็กใน card — ใช้ได้กับทุกเคส */
                        <button
                          onClick={() => openNavigation(item.lat!, item.lng!, locationLabel)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '4px 10px', borderRadius: 8, border: 'none',
                            background: '#EFF6FF', color: '#1D4ED8',
                            fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="#1D4ED8"/>
                            <circle cx="12" cy="9" r="2.5" fill="white"/>
                          </svg>
                          Maps
                        </button>
                      )}
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9CA3AF' }}>
                        {new Date(item.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    {/* ── Action Buttons ── */}
                    {item.status === 'pending' && (
                      <button onClick={() => acceptJob(item.id)} disabled={isLoading}
                        style={{
                          width: '100%', padding: '12px', borderRadius: 12, border: 'none',
                          background: isLoading ? '#E5E7EB' : '#EF4444', color: '#fff',
                          fontSize: 14, fontWeight: 700, cursor: isLoading ? 'not-allowed' : 'pointer',
                          fontFamily: 'inherit',
                        }}>
                        {isLoading ? 'กำลังรับงาน...' : '📥 รับงานนี้'}
                      </button>
                    )}

                    {item.status === 'assigned' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

                        {/* Badge บอกขั้นตอนปัจจุบันของงาน — มาจาก assignments.status จริง
                            เพื่อยืนยันว่ากดปุ่ม "กำลังเดินทาง" / "ถึงที่เกิดเหตุ" แล้วมีผลจริง */}
                        {stage && (
                          <div style={{
                            fontSize: 12, fontWeight: 700, textAlign: 'center',
                            padding: '7px 10px', borderRadius: 8,
                            background: stage === 'on_scene' ? '#FEF3C7' : stage === 'en_route' ? '#DBEAFE' : '#F3F4F6',
                            color: stage === 'on_scene' ? '#92400E' : stage === 'en_route' ? '#1D4ED8' : '#6B7280',
                          }}>
                            {stage === 'on_scene' ? '📍 ถึงที่เกิดเหตุแล้ว' : stage === 'en_route' ? '🚒 กำลังเดินทางไปที่เกิดเหตุ' : '📥 รับงานแล้ว รอออกเดินทาง'}
                          </div>
                        )}

                        {/* ปุ่มนำทางใหญ่ — แสดงเฉพาะงานที่ตัวเองรับ */}
                        {isMyJob && item.lat && item.lng && (
                          <button
                            onClick={() => openNavigation(item.lat!, item.lng!, locationLabel)}
                            style={{
                              width: '100%', padding: '13px', borderRadius: 12, border: 'none',
                              background: '#1D4ED8', color: '#fff',
                              fontSize: 14, fontWeight: 700, cursor: 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                              fontFamily: 'inherit',
                              boxShadow: '0 4px 16px rgba(29,78,216,0.35)',
                            }}
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="white"/>
                              <circle cx="12" cy="9" r="2.5" fill="#1D4ED8"/>
                            </svg>
                            เปิด Google Maps นำทาง
                          </button>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <button onClick={() => updateAssignment(item.id, 'assigned', 'en_route')} disabled={isLoading}
                            style={{
                              padding: '10px', borderRadius: 10, border: 'none',
                              background: stage === 'en_route' ? '#1D4ED8' : '#DBEAFE',
                              color: stage === 'en_route' ? '#fff' : '#1D4ED8',
                              fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                            }}>
                            {stage === 'en_route' ? '✓ ' : ''}🚒 กำลังเดินทาง
                          </button>
                          <button onClick={() => updateAssignment(item.id, 'assigned', 'on_scene')} disabled={isLoading}
                            style={{
                              padding: '10px', borderRadius: 10, border: 'none',
                              background: stage === 'on_scene' ? '#F59E0B' : '#FEF3C7',
                              color: stage === 'on_scene' ? '#fff' : '#92400E',
                              fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                            }}>
                            {stage === 'on_scene' ? '✓ ' : ''}📍 ถึงที่เกิดเหตุ
                          </button>
                        </div>
                        {/* เปิด modal ยืนยันผลการช่วยเหลือละเอียด แทนการกดจบงานตรงๆ
                            เพื่อบังคับให้ระบุปลายทาง (ศูนย์พักพิง/อื่นๆ) หรือเหตุผลที่เข้าไม่ถึง */}
                        <button onClick={() => openOutcomeModal(item)} disabled={isLoading}
                          style={{
                            width: '100%', padding: '12px', borderRadius: 10, border: 'none',
                            background: '#111827', color: '#fff',
                            fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                          }}>
                          📋 ยืนยันผลการช่วยเหลือ
                        </button>
                      </div>
                    )}

                    {item.status === 'rescued' && (
                      <div style={{ textAlign: 'center', padding: '10px', background: '#D1FAE5', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#065F46' }}>
                        ✅ ช่วยเหลือสำเร็จแล้ว
                      </div>
                    )}

                    {item.status === 'cannot_reach' && (
                      <button onClick={() => acceptJob(item.id)} disabled={isLoading}
                        style={{ width: '100%', padding: '10px', borderRadius: 10, border: 'none', background: '#F3F4F6', color: '#374151', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                        ↩️ ลองเข้าใหม่
                      </button>
                    )}

                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {/* ── Modal: ยืนยันผลการช่วยเหลือ ───────────────────────────── */}
      {outcomeDraft && (
        <div className="outcome-backdrop" style={{
          position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.55)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100,
        }}>
          <div className="outcome-sheet" style={{
            background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480,
            maxHeight: '90vh', overflowY: 'auto', padding: 20, fontFamily: "var(--font-thai), 'Noto Sans Thai', sans-serif",
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 2 }}>
              ยืนยันผลการช่วยเหลือ
            </div>
            <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 16 }}>
              {outcomeDraft.fullName}
            </div>

            {/* Step 1: ช่วยได้ไหม */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
              <button
                onClick={() => setOutcomeDraft({ ...outcomeDraft, mode: 'rescued' })}
                style={{
                  padding: '12px', borderRadius: 12, border: outcomeDraft.mode === 'rescued' ? '2px solid #22C55E' : '1px solid #E5E7EB',
                  background: outcomeDraft.mode === 'rescued' ? '#D1FAE5' : '#fff',
                  color: '#065F46', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                ✅ ช่วยเหลือได้
              </button>
              <button
                onClick={() => setOutcomeDraft({ ...outcomeDraft, mode: 'cannot_reach' })}
                style={{
                  padding: '12px', borderRadius: 12, border: outcomeDraft.mode === 'cannot_reach' ? '2px solid #7C3AED' : '1px solid #E5E7EB',
                  background: outcomeDraft.mode === 'cannot_reach' ? '#EDE9FE' : '#fff',
                  color: '#5B21B6', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                ❌ ช่วยเหลือไม่ได้
              </button>
            </div>

            {/* Step 2a: ช่วยได้ -> เลือกปลายทาง */}
            {outcomeDraft.mode === 'rescued' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>นำส่งไปที่ไหน?</div>
                <select
                  value={outcomeDraft.destinationType ?? ''}
                  onChange={e => setOutcomeDraft({ ...outcomeDraft, destinationType: e.target.value as any })}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #E5E7EB', fontSize: 14, fontFamily: 'inherit' }}
                >
                  <option value="">— เลือก —</option>
                  <option value="shelter">🏠 ศูนย์พักพิง</option>
                  <option value="relative_home">👨‍👩‍👧 บ้านญาติ</option>
                  <option value="hotel">🏨 โรงแรม</option>
                  <option value="other_safe">📍 ปลอดภัย แต่ไม่ได้อยู่ศูนย์ (อื่นๆ)</option>
                </select>

                {outcomeDraft.destinationType === 'shelter' && (
                  <>
                    <select
                      value={outcomeDraft.destinationShelterId}
                      onChange={e => setOutcomeDraft({ ...outcomeDraft, destinationShelterId: e.target.value })}
                      style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #E5E7EB', fontSize: 14, fontFamily: 'inherit' }}
                    >
                      <option value="">— เลือกศูนย์พักพิง —</option>
                      {shelters.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>

                    <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginTop: 4 }}>
                      ยืนยันจำนวนที่นำส่งจริง
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      {(['confirmedAdult', 'confirmedChild', 'confirmedElder'] as const).map((key, i) => (
                        <div key={key}>
                          <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>
                            {['ผู้ใหญ่', 'เด็ก', 'สูงอายุ'][i]}
                          </div>
                          <input
                            type="number" min={0}
                            value={outcomeDraft[key]}
                            onChange={e => setOutcomeDraft({ ...outcomeDraft, [key]: Number(e.target.value) })}
                            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 14, fontFamily: 'inherit' }}
                          />
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {outcomeDraft.destinationType && outcomeDraft.destinationType !== 'shelter' && (
                  <textarea
                    placeholder="ระบุรายละเอียด เช่น ชื่อ-ที่อยู่บ้านญาติ / ชื่อโรงแรม"
                    value={outcomeDraft.destinationNote}
                    onChange={e => setOutcomeDraft({ ...outcomeDraft, destinationNote: e.target.value })}
                    rows={2}
                    style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #E5E7EB', fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }}
                  />
                )}
              </div>
            )}

            {/* Step 2b: ช่วยไม่ได้ -> เลือกเหตุผล */}
            {outcomeDraft.mode === 'cannot_reach' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>เหตุผลที่เข้าไม่ถึง</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button
                    onClick={() => setOutcomeDraft({ ...outcomeDraft, cannotReachReason: 'no_access' })}
                    style={{
                      padding: '10px', borderRadius: 10, fontFamily: 'inherit', cursor: 'pointer',
                      border: outcomeDraft.cannotReachReason === 'no_access' ? '2px solid #F59E0B' : '1px solid #E5E7EB',
                      background: outcomeDraft.cannotReachReason === 'no_access' ? '#FEF3C7' : '#fff',
                      color: '#92400E', fontSize: 13, fontWeight: 700,
                    }}>
                    🌊 เข้าไม่ถึง (รอเข้าใหม่)
                  </button>
                  <button
                    onClick={() => setOutcomeDraft({ ...outcomeDraft, cannotReachReason: 'deceased' })}
                    style={{
                      padding: '10px', borderRadius: 10, fontFamily: 'inherit', cursor: 'pointer',
                      border: outcomeDraft.cannotReachReason === 'deceased' ? '2px solid #6B7280' : '1px solid #E5E7EB',
                      background: outcomeDraft.cannotReachReason === 'deceased' ? '#F3F4F6' : '#fff',
                      color: '#374151', fontSize: 13, fontWeight: 700,
                    }}>
                    🕯️ เสียชีวิต
                  </button>
                </div>
                <textarea
                  placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)"
                  value={outcomeDraft.notes}
                  onChange={e => setOutcomeDraft({ ...outcomeDraft, notes: e.target.value })}
                  rows={2}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #E5E7EB', fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }}
                />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
              <button
                onClick={() => setOutcomeDraft(null)}
                disabled={outcomeSaving}
                style={{ padding: '13px', borderRadius: 12, border: '1px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                ยกเลิก
              </button>
              <button
                onClick={confirmOutcome}
                disabled={outcomeSaving || !outcomeDraft.mode}
                style={{
                  padding: '13px', borderRadius: 12, border: 'none',
                  background: !outcomeDraft.mode ? '#E5E7EB' : '#111827',
                  color: '#fff', fontSize: 14, fontWeight: 700,
                  cursor: outcomeSaving || !outcomeDraft.mode ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                }}>
                {outcomeSaving ? 'กำลังบันทึก...' : 'ยืนยัน'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
