'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { PROJECT_NAME } from '@/lib/brand';

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
  const [filterStatus, setFilterStatus] = useState<string>('active');
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
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
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

  const urgencyRank: Record<SOSReport['urgency_level'], number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  const statusRank: Record<SOSReport['status'], number> = {
    pending: 5,
    assigned: 4,
    cannot_reach: 3,
    rescued: 2,
    closed: 1,
  };
  const filtered = reports
    .filter(r => filterStatus === 'active'
      ? r.status === 'pending' || r.status === 'assigned'
      : filterStatus === 'all' || r.status === filterStatus)
    .filter(r => filterDistrict === 'all' || r.district === filterDistrict)
    .sort((a, b) => {
      const urgencyDifference = urgencyRank[b.urgency_level] - urgencyRank[a.urgency_level];
      if (urgencyDifference !== 0) return urgencyDifference;
      const statusDifference = statusRank[b.status] - statusRank[a.status];
      if (statusDifference !== 0) return statusDifference;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

  const districts = [...new Set(reports.map(r => r.district).filter(Boolean))];
  const selectedReport = reports.find(report => report.id === selectedReportId) ?? null;

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
        .rescue-app > header { background:rgba(255,254,252,.82) !important; backdrop-filter:blur(18px); border-bottom:1px solid rgba(38,70,83,.08) !important; padding:15px 28px !important; }.rescue-app > header > div{max-width:1440px !important}.rescue-app > header button{border-color:rgba(38,70,83,.12) !important;color:#264653 !important;border-radius:12px !important;transition:background .2s ease,transform .2s ease !important}.rescue-app > header button:hover{background:#fff7ed !important;transform:translateY(-1px)}
        .rescue-app main { max-width:1440px !important; padding:28px !important; position:relative; z-index:1; }.legacy-summary{display:none !important}
        .dashboard-overview { display:grid; grid-template-columns:minmax(0,1.55fr) minmax(300px,.75fr); gap:18px; margin-bottom:18px; animation:rise-in .45s ease both; }.operation-hero{min-height:206px;overflow:hidden;position:relative;border-radius:26px;padding:28px;color:#fff;background:linear-gradient(125deg,#264653,#31677a);box-shadow:0 18px 42px rgba(38,70,83,.18)}.operation-hero::after{content:"";position:absolute;width:230px;height:230px;right:-72px;bottom:-102px;border:32px solid rgba(233,196,106,.38);border-radius:50%}.operation-kicker{display:flex;gap:8px;align-items:center;color:#E9C46A;font-size:12px;font-weight:800;letter-spacing:.08em}.operation-kicker i{width:8px;height:8px;border-radius:50%;background:#E9C46A;box-shadow:0 0 0 5px rgba(233,196,106,.14)}.operation-hero h1{font-size:clamp(23px,3vw,32px);letter-spacing:-.035em;line-height:1.22;margin:18px 0 7px;position:relative;z-index:1}.operation-hero p{color:rgba(255,255,255,.76);font-size:14px;position:relative;z-index:1}.operation-summary{display:flex;position:relative;z-index:1;gap:18px;margin-top:24px}.operation-summary span{display:grid;gap:2px;font-size:12px;color:rgba(255,255,255,.65)}.operation-summary b{color:#fff;font-size:20px;line-height:1}
        .metric-stack{display:grid;grid-template-columns:1fr 1fr;gap:12px}.metric-card{background:#FFFEFC;min-height:97px;padding:18px;border:1px solid rgba(38,70,83,.08);border-radius:22px;box-shadow:0 10px 24px rgba(38,70,83,.06);transition:transform .2s ease,box-shadow .2s ease}.metric-card:hover{transform:translateY(-3px);box-shadow:0 16px 28px rgba(38,70,83,.1)}.metric-card:nth-child(1){background:#fff8e7}.metric-card:nth-child(2){background:#ecf9f7}.metric-card:nth-child(3){background:#fff0ec}.metric-card:nth-child(4){background:#f5f8f9}.metric-label{font-size:12px;color:#6B7C84;font-weight:600}.metric-value{margin-top:6px;font-size:27px;line-height:1;font-weight:800;color:#264653}
        .filter-bar{background:rgba(255,254,252,.9) !important;border:1px solid rgba(38,70,83,.08) !important;border-radius:22px !important;padding:12px !important;margin-bottom:18px !important;box-shadow:0 9px 22px rgba(38,70,83,.05)}.filter-label{margin:0 6px 0 4px;color:#264653;font-size:13px;font-weight:800}.filter-button{background:#edf4f4 !important;color:#6B7C84 !important;border:1px solid transparent !important;border-radius:12px !important;padding:8px 13px !important;transition:all .2s ease !important}.filter-button:hover{background:#d8efeb !important;color:#2A9D8F !important;transform:translateY(-1px)}.filter-button.selected{background:#2A9D8F !important;color:#fff !important;box-shadow:0 5px 12px rgba(42,157,143,.2)}.district-filter{border-color:rgba(38,70,83,.1) !important;background:#fff !important;color:#264653;border-radius:12px !important;padding:8px 11px !important}
        .report-grid{gap:16px !important}.rescue-card{border:1px solid rgba(38,70,83,.09) !important;background:#FFFEFC !important;border-radius:22px !important;padding:18px !important;box-shadow:0 9px 24px rgba(38,70,83,.055) !important;transition:transform .22s ease,box-shadow .22s ease,border-color .22s ease !important;animation:rise-in .45s ease both}.rescue-card:hover{transform:translateY(-4px);border-color:rgba(42,157,143,.36) !important;box-shadow:0 18px 32px rgba(38,70,83,.11) !important}.rescue-card > div:nth-child(3){background:#f3f8f8 !important;border-color:#e1eeee !important;border-radius:14px !important}.rescue-card button{transition:transform .18s ease,filter .18s ease,box-shadow .18s ease !important}.rescue-card button:hover:not(:disabled){transform:translateY(-1px);filter:saturate(1.06);box-shadow:0 6px 14px rgba(38,70,83,.12)}.rescue-card button:active:not(:disabled){transform:scale(.98)}.rescue-card button[style*="EF4444"]{background:#E76F51 !important}.rescue-card button[style*="1D4ED8"]{background:#2A9D8F !important}.outcome-backdrop{background:rgba(38,70,83,.54) !important;backdrop-filter:blur(5px)}.outcome-sheet{border:1px solid rgba(38,70,83,.08);box-shadow:0 -12px 42px rgba(38,70,83,.17)}
        /* Blue minimal operations workspace */
        .rescue-app{--blue:#0466C8;--blue-strong:#0353A4;--blue-deep:#023E7D;--navy:#002855;--ink:#001845;--midnight:#001233;--slate:#33415C;--muted:#7D8597;--line:#DDE3EC;padding-left:0!important;background:linear-gradient(145deg,#FAFCFF,#F2F6FB 55%,#EAF1F9)!important;color:var(--ink)}
        .rescue-app::before{background:rgba(4,102,200,.08)}
        .rescue-app>header{border-top:4px solid var(--blue)!important;background:rgba(255,255,255,.9)!important}.rescue-app>header>div{max-width:1160px!important}.rescue-app>header button{color:var(--slate)!important;border-color:var(--line)!important}.rescue-app main{max-width:1160px!important}
        .rescue-header-mark{flex:0 0 40px;background:linear-gradient(135deg,var(--blue),var(--blue-deep))!important}.rescue-header-title{max-width:520px;color:var(--ink)!important;font-size:16px!important;line-height:1.35}.rescue-header-user{color:var(--muted)!important;font-size:12px!important}.rescue-online{color:var(--blue)!important}.rescue-online>span{background:var(--blue)!important}.rescue-logout:hover{color:var(--blue)!important;background:#F1F6FC!important}
        .navigation-banner{background:linear-gradient(90deg,var(--blue-deep),var(--blue))!important;animation:none!important;box-shadow:0 9px 24px rgba(0,24,69,.13)}.navigation-banner>button{color:var(--blue-deep)!important}.navigation-banner>button:last-child{color:#fff!important;background:rgba(255,255,255,.13)!important}
        .operation-hero{background:linear-gradient(125deg,var(--navy),var(--blue-deep));box-shadow:0 18px 42px rgba(0,24,69,.17)}.operation-hero::after{border-color:rgba(4,102,200,.35)}.operation-kicker{color:#A9CDEC}.operation-kicker i{background:#70AEE7;box-shadow:0 0 0 5px rgba(4,102,200,.18)}
        .metric-card{border-color:rgba(51,65,92,.1);background:#fff!important;box-shadow:0 9px 25px rgba(0,24,69,.05)}.metric-card:nth-child(1){background:#EAF3FC!important}.metric-card:nth-child(2){background:#EEF2F7!important}.metric-value{color:var(--ink)}
        .filter-bar{border-color:rgba(51,65,92,.1)!important;background:rgba(255,255,255,.9)!important}.filter-label{color:var(--ink)}.filter-button{min-height:40px;background:#EEF2F7!important;color:var(--slate)!important}.filter-button:hover{color:var(--blue)!important;background:#EAF3FC!important}.filter-button.selected{color:#fff!important;background:var(--blue)!important;box-shadow:0 5px 13px rgba(4,102,200,.2)}.district-filter{min-height:40px;color:var(--slate)!important;border-color:var(--line)!important}
        .mission-list{display:grid;gap:9px}.mission-row{position:relative;display:grid;grid-template-columns:minmax(0,1fr) 112px;gap:8px;overflow:hidden;border:1px solid rgba(51,65,92,.11);border-radius:17px;background:rgba(255,255,255,.92);box-shadow:0 7px 20px rgba(0,24,69,.04);transition:.2s}.mission-row::before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:var(--muted)}.mission-row.urgency-critical::before{background:var(--midnight)}.mission-row.urgency-high::before{background:var(--blue-strong)}.mission-row.urgency-medium::before{background:var(--slate)}.mission-row:hover{transform:translateY(-2px);border-color:#BED0E2;box-shadow:0 12px 27px rgba(0,24,69,.08)}
        .mission-open{min-width:0;display:flex;align-items:center;padding:17px 12px 17px 20px;border:0;color:var(--ink);background:transparent;font:inherit;text-align:left;cursor:pointer}.mission-name{min-width:0}.mission-name strong{display:block;overflow:hidden;font-size:16px;text-overflow:ellipsis;white-space:nowrap}.mission-map{margin:8px;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid #B8CEE4;border-radius:12px;color:var(--blue-strong);background:#F2F7FC;font:700 13px/1 inherit;cursor:pointer}.mission-map:hover{color:#fff;background:var(--blue)}.mission-map:disabled{color:var(--pale);border-color:var(--line);background:#F1F3F6;cursor:not-allowed}.mission-empty{padding:60px 20px;text-align:center;color:var(--muted);font-size:15px}
        .mission-modal-backdrop{--blue:#0466C8;--blue-strong:#0353A4;--blue-deep:#023E7D;--navy:#002855;--ink:#001845;--midnight:#001233;--slate:#33415C;--muted:#7D8597;--line:#DDE3EC;position:fixed;inset:0;z-index:110;display:grid;place-items:center;padding:20px;background:rgba(0,18,51,.58);backdrop-filter:blur(7px)}.mission-modal{position:relative;width:min(100%,620px);max-height:min(88vh,760px);overflow:auto;border:1px solid rgba(255,255,255,.13);border-radius:25px;background:#fff;box-shadow:0 28px 80px rgba(0,18,51,.28);animation:rise-in .25s ease}.mission-modal-close{position:absolute;z-index:3;right:14px;top:14px;width:38px;height:38px;border:1px solid rgba(255,255,255,.25);border-radius:12px;color:#fff;background:rgba(255,255,255,.12);font:500 24px/1 inherit;cursor:pointer}.mission-modal-hero{padding:27px 64px 24px 25px;color:#fff;background:linear-gradient(135deg,#002855,#023E7D)}.mission-modal-kicker{color:#A9CDEC;font-size:11px;font-weight:750;letter-spacing:.08em}.mission-modal h2{margin:7px 0 3px;color:#fff!important;font-size:25px}.mission-modal-hero p{color:rgba(255,255,255,.72);font-size:13px}.mission-modal-body{display:grid;gap:13px;padding:21px}.mission-modal-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.mission-modal-grid>div{padding:12px;border:1px solid var(--line);border-radius:12px;background:#F8FAFD}.mission-modal-grid .wide{grid-column:1/-1}.mission-modal-grid .important{border-left:3px solid var(--blue);background:#EAF3FC}.mission-modal-grid span,.mission-modal-grid strong,.mission-modal-grid small{display:block}.mission-modal-grid span{color:var(--muted);font-size:11px}.mission-modal-grid strong{margin-top:3px;color:var(--slate);font-size:14px;line-height:1.5}.mission-modal-grid small{margin-top:2px;color:var(--muted);font-size:12px}.mission-modal-map,.mission-modal-primary{min-height:48px;border-radius:12px;font:750 14px/1 inherit;cursor:pointer}.mission-modal-map{border:1px solid #B8CEE4;color:var(--blue);background:#F1F6FC}.mission-modal-primary{border:0;color:#fff;background:linear-gradient(135deg,var(--blue),var(--blue-strong));box-shadow:0 7px 17px rgba(4,102,200,.17)}.mission-modal-primary.dark{background:var(--midnight)}.mission-modal-actions{display:grid;gap:9px}.mission-stage{padding:10px;border-radius:11px;color:var(--blue-deep);background:#EAF3FC;text-align:center;font-size:13px;font-weight:700}.mission-stage-buttons{display:grid;grid-template-columns:1fr 1fr;gap:8px}.mission-stage-buttons button{min-height:44px;border:1px solid var(--line);border-radius:11px;color:var(--slate);background:#F5F8FC;font:700 13px/1 inherit;cursor:pointer}.mission-stage-buttons button.active{color:#fff;border-color:var(--blue);background:var(--blue)}
        .outcome-backdrop{align-items:center!important;padding:20px}.outcome-sheet{border-radius:22px!important;max-height:88vh!important;box-shadow:0 25px 70px rgba(0,18,51,.3)!important}
        @media(max-width:760px){.rescue-app{padding-left:0;padding-bottom:0}.rescue-app>header{padding:13px 14px!important}.rescue-app>header>div>div:last-child{gap:7px!important}.rescue-app>header button{padding:8px 9px!important;font-size:12px!important}.dashboard-overview{grid-template-columns:1fr}.operation-hero{min-height:192px;padding:22px}.rescue-app main{padding:17px 13px 28px!important}.filter-label{width:100%;margin:0 4px 2px}.district-filter{margin-left:0!important;width:100%}.mission-row{grid-template-columns:minmax(0,1fr) 86px}.mission-open{padding-left:16px}.mission-map{font-size:12px}.mission-modal-backdrop{padding:11px}.mission-modal{max-height:92vh;border-radius:20px}.mission-modal-grid{grid-template-columns:1fr}.mission-modal-grid .wide{grid-column:auto}}
      `}</style>

      <div className="rescue-app" style={{ minHeight: '100vh', background: '#F0F2FA', fontFamily: "var(--font-thai), 'Noto Sans Thai', sans-serif" }}>
        {/* Header */}
        <header style={{ background: '#fff', borderBottom: '1px solid #ECEEF5', padding: '14px 20px', position: 'sticky', top: 0, zIndex: 50 }}>
          <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="rescue-header-mark" style={{ width: 40, height: 40, borderRadius: 11, background: 'linear-gradient(135deg,#6D5EF9,#5046e5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L4 5v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V5L12 2z" fill="rgba(255,255,255,0.2)" stroke="white" strokeWidth="1.5"/>
                  <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div>
                <div className="rescue-header-title" style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>{PROJECT_NAME}</div>
                <div className="rescue-header-user" style={{ fontSize: 11, color: '#9CA3AF' }}>{profile?.full_name} · {profile?.agency ?? 'ไม่ระบุหน่วยงาน'}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="rescue-online" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#22C55E', fontWeight: 600 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22C55E', display: 'inline-block', animation: 'ping 2s infinite' }} />
                ออนไลน์
              </div>
              <button className="rescue-logout" onClick={handleLogout} style={{ padding: '7px 14px', borderRadius: 10, border: '1px solid #ECEEF5', background: '#fff', fontSize: 13, fontWeight: 600, color: '#6B7280', cursor: 'pointer' }}>
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
            <div className="navigation-banner" style={{
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
            {['active', 'pending', 'assigned', 'rescued', 'cannot_reach', 'all'].map(s => (
              <button className={`filter-button ${filterStatus === s ? 'selected' : ''}`} key={s} onClick={() => setFilterStatus(s)}
                style={{
                  padding: '6px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 600,
                  background: filterStatus === s ? '#6D5EF9' : '#F3F4F6',
                  color: filterStatus === s ? '#fff' : '#6B7280',
                  fontFamily: 'inherit',
                }}>
                {s === 'active' ? 'งานที่ต้องดูแล' : s === 'all' ? 'ทั้งหมด' : STATUS_LABEL[s]}
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
            <div className="mission-empty">ไม่พบรายการที่ตรงกับเงื่อนไข</div>
          ) : (
            <div className="mission-list" aria-label="รายการคำขอเรียงตามความรุนแรง">
              {filtered.map((item) => {
                const locationLabel = `${item.sub_district} ${item.district} ${item.province}`;
                return (
                  <article className={`mission-row urgency-${item.urgency_level}`} key={item.id}>
                    <button className="mission-open" type="button" onClick={() => setSelectedReportId(item.id)}>
                      <span className="mission-name">
                        <strong>{item.full_name}</strong>
                      </span>
                    </button>
                    <button
                      className="mission-map"
                      type="button"
                      disabled={!item.lat || !item.lng}
                      onClick={() => item.lat && item.lng && openNavigation(item.lat, item.lng, locationLabel)}
                      aria-label={`เปิดแผนที่ของ ${item.full_name}`}
                    >
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="currentColor" />
                        <circle cx="12" cy="9" r="2.5" fill="white" />
                      </svg>
                      <span>แผนที่</span>
                    </button>
                  </article>
                );
              })}
            </div>
          )}

        </main>
      </div>

      {selectedReport && (() => {
        const item = selectedReport;
        const isLoading = actionLoading === item.id;
        const locationLabel = `${item.sub_district} ${item.district} ${item.province}`;
        const stage = jobStage[item.id];
        const totalPeople = (item.adult_count ?? 0) + (item.child_count ?? 0) + (item.elder_count ?? 0);

        return (
          <div className="mission-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedReportId(null); }}>
            <section className="mission-modal" role="dialog" aria-modal="true" aria-labelledby="mission-modal-title">
              <button className="mission-modal-close" type="button" onClick={() => setSelectedReportId(null)} aria-label="ปิดรายละเอียด">×</button>
              <div className="mission-modal-hero">
                <span className="mission-modal-kicker">ลำดับความเร่งด่วน · {URGENCY_LABEL[item.urgency_level]}</span>
                <h2 id="mission-modal-title">{item.full_name}</h2>
                <p>{STATUS_LABEL[item.status]} · แจ้งเมื่อ {new Date(item.created_at).toLocaleString('th-TH')}</p>
              </div>

              <div className="mission-modal-body">
                <div className="mission-modal-grid">
                  <div><span>เบอร์โทร</span><strong>{item.phone}</strong></div>
                  <div><span>ผู้ประสบภัย</span><strong>{totalPeople} คน</strong></div>
                  <div className="wide"><span>พื้นที่</span><strong>{locationLabel}</strong><small>{item.address_details || 'ไม่ระบุจุดสังเกตเพิ่มเติม'}</small></div>
                  <div><span>ระดับน้ำ</span><strong>{item.water_level ?? '-'} เมตร</strong></div>
                  <div><span>กลุ่มคน</span><strong>ผู้ใหญ่ {item.adult_count ?? 0} · เด็ก {item.child_count ?? 0} · สูงอายุ {item.elder_count ?? 0}</strong></div>
                  <div className="wide"><span>สิ่งของที่ต้องการ</span><strong>{item.needed_items?.length ? item.needed_items.join(', ') : 'ไม่ได้ระบุ'}</strong></div>
                  {item.special_needs && <div className="wide important"><span>หมายเหตุสำคัญ</span><strong>{item.special_needs}</strong></div>}
                </div>

                {item.lat && item.lng && (
                  <button className="mission-modal-map" type="button" onClick={() => openNavigation(item.lat!, item.lng!, locationLabel)}>
                    เปิด Google Maps นำทาง
                  </button>
                )}

                {item.status === 'pending' && (
                  <button className="mission-modal-primary" type="button" onClick={() => acceptJob(item.id)} disabled={isLoading}>
                    {isLoading ? 'กำลังรับงาน...' : 'รับงานนี้'}
                  </button>
                )}

                {item.status === 'assigned' && (
                  <div className="mission-modal-actions">
                    <div className="mission-stage">{stage === 'on_scene' ? 'ถึงที่เกิดเหตุแล้ว' : stage === 'en_route' ? 'กำลังเดินทาง' : 'รับงานแล้ว'}</div>
                    <div className="mission-stage-buttons">
                      <button className={stage === 'en_route' ? 'active' : ''} type="button" onClick={() => updateAssignment(item.id, 'assigned', 'en_route')} disabled={isLoading}>กำลังเดินทาง</button>
                      <button className={stage === 'on_scene' ? 'active' : ''} type="button" onClick={() => updateAssignment(item.id, 'assigned', 'on_scene')} disabled={isLoading}>ถึงที่เกิดเหตุ</button>
                    </div>
                    <button className="mission-modal-primary dark" type="button" onClick={() => { setSelectedReportId(null); openOutcomeModal(item); }} disabled={isLoading}>ยืนยันผลการช่วยเหลือ</button>
                  </div>
                )}

                {item.status === 'cannot_reach' && (
                  <button className="mission-modal-primary" type="button" onClick={() => acceptJob(item.id)} disabled={isLoading}>ลองเข้าพื้นที่ใหม่</button>
                )}
              </div>
            </section>
          </div>
        );
      })()}

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
