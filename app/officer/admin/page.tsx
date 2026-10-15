'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { PROJECT_NAME } from '@/lib/brand';
import { BrandLogo } from '@/components/brand-logo';
import AdminRescuerMapPanel from '@/components/admin-rescuer-map-panel';

interface Profile {
  id: string;
  full_name: string;
  email?: string | null;
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
  sub_district?: string | null;
  address_details?: string | null;
  status: string;
  urgency_level: string;
  adult_count: number;
  child_count: number;
  elder_count: number;
  water_level?: number | null;
  needed_items?: string[] | null;
  special_needs?: string | null;
  lat?: number | null;
  lng?: number | null;
  created_at: string;
  updated_at?: string | null;
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
  claim_category?: string | null;
  housing_tenure?: string | null;
  damage_end_date?: string | null;
  damage_duration_days?: number | null;
  status: 'pending' | 'verified' | 'approved' | 'rejected';
  incident_date?: string | null;
  id_card_number?: string | null;
  id_card_image_url?: string | null;
  bank_book_image_url?: string | null;
  rental_agreement_image_url?: string | null;
  house_registration_image_url?: string | null;
  victim_confirmed: boolean;
  created_at: string;
}

interface ClaimStatusAudit {
  id: string;
  old_status: DamageReport['status'];
  new_status: DamageReport['status'];
  reason?: string | null;
  created_at: string;
  actor?: { full_name?: string | null } | null;
}

const ADMIN_PAGE_SIZE = 25;

type Tab = 'overview' | 'rescue_map' | 'users' | 'shelters' | 'victims' | 'compensation' | 'governance';

const TAB_META: Record<Tab, { title: string; description: string }> = {
  rescue_map: { title: 'แผนที่ทีมกู้ภัย', description: 'ติดตามตำแหน่งล่าสุดของทีมกู้ภัยที่กำลังแชร์ตำแหน่ง' },
  overview: { title: 'ภาพรวมระบบ', description: 'ติดตามสถานการณ์และข้อมูลสำคัญแบบเรียลไทม์' },
  users: { title: 'ผู้ใช้งาน', description: 'จัดการบทบาท สิทธิ์ และสถานะของเจ้าหน้าที่' },
  shelters: { title: 'ศูนย์พักพิง', description: 'ดูแลข้อมูล ความจุ และสถานะของศูนย์พักพิง' },
  victims: { title: 'ผู้ประสบภัย', description: 'ตรวจสอบรายการแจ้งเหตุและความคืบหน้าการช่วยเหลือ' },
  compensation: { title: 'คำขอเยียวยา', description: 'ตรวจสอบ อนุมัติ และติดตามคำขอเยียวยา' },
  governance: { title: 'กำกับและตรวจสอบ', description: 'ยืนยันเหตุเสียชีวิต ดูประวัติการปฏิบัติงาน และอัปเดตคลังที่อยู่' },
};

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
  pending: { text: 'รอตรวจสอบ', color: '#5C677D', bg: '#F1F3F7' },
  verified: { text: 'ตรวจสอบแล้ว', color: '#0466C8', bg: '#EAF3FC' },
  approved: { text: 'อนุมัติแล้ว', color: '#0353A4', bg: '#E5EFF9' },
  rejected: { text: 'ไม่อนุมัติ', color: '#001845', bg: '#E8EBF0' },
};

const SOS_STATUS_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  pending: { text: 'รอรับเรื่อง', color: '#5C677D', bg: '#F1F3F7' },
  assigned: { text: 'กำลังช่วยเหลือ', color: '#0466C8', bg: '#EAF3FC' },
  rescued: { text: 'ช่วยเหลือสำเร็จ', color: '#0353A4', bg: '#E5EFF9' },
  cannot_reach: { text: 'เข้าไม่ถึง', color: '#001845', bg: '#E8EBF0' },
  closed: { text: 'ปิดเคส', color: '#33415C', bg: '#EEF0F4' },
};

const URGENCY_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  critical: { text: 'วิกฤต', color: '#B42318', bg: '#FEE4E2' },
  high: { text: 'เร่งด่วน', color: '#C2410C', bg: '#FFF0E5' },
  medium: { text: 'ปานกลาง', color: '#A16207', bg: '#FFF7D6' },
  low: { text: 'ทั่วไป', color: '#047857', bg: '#E8F8F0' },
};

const inputStyle: React.CSSProperties = {
  padding: '10px 12px', borderRadius: 10, border: '1px solid #DDE3EC',
  fontSize: 13, fontFamily: 'inherit', width: '100%',
};

const ADMIN_SKELETON_CSS = `
  @keyframes admin-skeleton-shimmer {
    100% { transform: translateX(100%); }
  }
  .admin-skeleton-page {
    --skeleton-ink:#001845;
    --skeleton-line:#dce2eb;
    min-height:100vh;
    background:linear-gradient(150deg,#f8faff 0%,#f2f6fb 52%,#eaf1f9 100%);
    color:var(--skeleton-ink);
    font-family:var(--font-thai),'IBM Plex Sans Thai',sans-serif;
  }
  .skeleton-block {
    position:relative;
    display:block;
    overflow:hidden;
    border-radius:999px;
    background:#dce2eb;
  }
  .skeleton-block::after {
    content:'';
    position:absolute;
    inset:0;
    transform:translateX(-100%);
    background:linear-gradient(90deg,transparent,rgba(255,255,255,.76),transparent);
    animation:admin-skeleton-shimmer 1.35s ease-in-out infinite;
  }
  .skeleton-sr {
    position:absolute;
    width:1px;
    height:1px;
    padding:0;
    margin:-1px;
    overflow:hidden;
    clip:rect(0,0,0,0);
    white-space:nowrap;
    border:0;
  }
  .skeleton-header {
    min-height:78px;
    display:grid;
    grid-template-columns:auto minmax(420px,1fr) auto;
    align-items:center;
    gap:26px;
    padding:0 30px;
    border-top:4px solid #0466C8;
    border-bottom:1px solid var(--skeleton-line);
    background:rgba(255,255,255,.88);
  }
  .skeleton-brand { display:flex; align-items:center; gap:12px; }
  .skeleton-brand-mark { width:42px; height:42px; flex:0 0 42px; border-radius:14px; background:#7D8597; }
  .skeleton-brand-copy { display:grid; gap:7px; }
  .skeleton-nav { display:flex; justify-content:center; gap:7px; }
  .skeleton-nav .skeleton-block { width:78px; height:36px; }
  .skeleton-nav .skeleton-block:first-child { background:#A9BED6; }
  .skeleton-logout { width:112px; height:38px; }
  .skeleton-layout { width:min(100%,1280px); margin:0 auto; padding:32px 30px 48px; }
  .skeleton-heading { display:flex; justify-content:space-between; align-items:flex-end; gap:20px; margin-bottom:20px; }
  .skeleton-heading-copy { width:min(520px,75%); display:grid; gap:9px; }
  .skeleton-panel { display:grid; gap:14px; }
  .skeleton-overview-hero {
    min-height:178px;
    display:grid;
    grid-template-columns:minmax(0,1.2fr) minmax(300px,.8fr);
    align-items:end;
    gap:28px;
    padding:28px 30px;
    border-radius:28px;
    background:#002855;
  }
  .skeleton-hero-copy { display:grid; gap:12px; }
  .skeleton-hero-copy .skeleton-block,.skeleton-hero-stats .skeleton-block { background:rgba(255,255,255,.2); }
  .skeleton-hero-stats { display:grid; grid-template-columns:1fr 1fr; gap:1px; overflow:hidden; border-radius:18px; background:rgba(255,255,255,.12); }
  .skeleton-hero-stat { display:grid; gap:9px; padding:18px; background:rgba(255,255,255,.05); }
  .skeleton-overview-grid { display:grid; grid-template-columns:minmax(0,1.5fr) minmax(280px,.65fr); gap:18px; }
  .skeleton-surface { padding:22px; border:1px solid rgba(38,70,83,.08); border-radius:24px; background:rgba(255,255,255,.82); box-shadow:0 10px 28px rgba(38,70,83,.04); }
  .skeleton-chart { min-height:220px; display:grid; align-content:start; gap:20px; }
  .skeleton-chart-row { display:grid; grid-template-columns:80px 1fr 28px; align-items:center; gap:12px; }
  .skeleton-capacity { min-height:264px; display:grid; place-items:center; align-content:center; gap:14px; }
  .skeleton-ring { width:142px; height:142px; border-radius:50%; background:#C9D5E4; }
  .skeleton-ring::before { content:''; position:absolute; inset:15px; z-index:1; border-radius:50%; background:#fff; }
  .skeleton-overview-bottom { display:grid; grid-template-columns:minmax(0,.9fr) minmax(0,1.35fr); gap:18px; }
  .skeleton-band { min-height:145px; background:#0353A4; }
  .skeleton-band .skeleton-block { background:rgba(255,255,255,.25); }
  .skeleton-summary { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
  .skeleton-summary-item { min-height:90px; display:grid; place-items:center; align-content:center; gap:9px; border-radius:18px; background:rgba(255,255,255,.82); border:1px solid rgba(38,70,83,.07); }
  .skeleton-summary-item:nth-child(2) { background:#F2F6FB; }
  .skeleton-summary-item:nth-child(3) { background:#EDF3FA; }
  .skeleton-summary-item:nth-child(4) { background:#E8EFF7; }
  .skeleton-toolbar { display:flex; gap:9px; padding:12px; border:1px solid var(--skeleton-line); border-radius:16px; background:rgba(255,255,255,.72); }
  .skeleton-control { width:220px; height:42px; border-radius:12px; }
  .skeleton-control.short { width:170px; }
  .skeleton-list { overflow:hidden; border:1px solid var(--skeleton-line); border-radius:18px; background:#fff; }
  .skeleton-row { min-height:74px; display:flex; align-items:center; justify-content:space-between; gap:20px; padding:16px; border-bottom:1px solid #E8EDF4; }
  .skeleton-row:last-child { border-bottom:0; }
  .skeleton-row-copy { width:min(440px,62%); display:grid; gap:8px; }
  .skeleton-row-actions { display:flex; gap:8px; }
  .skeleton-row-actions .skeleton-block { width:98px; height:34px; border-radius:10px; }
  .skeleton-add { width:100%; height:48px; border-radius:14px; background:#8AAED2; }
  .skeleton-cards { display:grid; gap:10px; }
  .skeleton-card { min-height:82px; border:1px solid var(--skeleton-line); border-radius:18px; background:#fff; }
  @media(max-width:1050px) {
    .skeleton-header { grid-template-columns:auto 1fr auto; gap:16px; }
    .skeleton-nav { justify-content:flex-start; overflow:hidden; }
    .skeleton-overview-grid,.skeleton-overview-bottom { grid-template-columns:1fr; }
  }
  @media(max-width:720px) {
    .skeleton-header { grid-template-columns:1fr auto; gap:8px; padding:8px 15px 10px; }
    .skeleton-nav { grid-column:1/-1; grid-row:2; }
    .skeleton-nav .skeleton-block { flex:0 0 72px; }
    .skeleton-layout { padding:20px 13px 36px; }
    .skeleton-overview-hero { grid-template-columns:1fr; padding:24px; }
    .skeleton-overview-grid,.skeleton-overview-bottom { gap:13px; }
    .skeleton-summary { grid-template-columns:repeat(2,minmax(0,1fr)); }
  }
  @media(max-width:480px) {
    .skeleton-brand-copy { display:none; }
    .skeleton-logout { width:42px; }
    .skeleton-heading-copy { width:88%; }
    .skeleton-toolbar { flex-direction:column; }
    .skeleton-control,.skeleton-control.short { width:100%; }
    .skeleton-row-actions .skeleton-block:not(:last-child) { display:none; }
  }
  @media(prefers-reduced-motion:reduce) {
    .skeleton-block::after { animation:none; }
  }
`;

function SkeletonBlock({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={`skeleton-block ${className}`} style={style} aria-hidden="true" />;
}

function OverviewSkeleton() {
  const bars = ['82%', '62%', '74%', '48%'];

  return (
    <div className="skeleton-panel" aria-hidden="true">
      <div className="skeleton-overview-hero">
        <div className="skeleton-hero-copy">
          <SkeletonBlock style={{ width: 100, height: 10 }} />
          <SkeletonBlock style={{ width: '72%', height: 30 }} />
          <SkeletonBlock style={{ width: '54%', height: 11 }} />
        </div>
        <div className="skeleton-hero-stats">
          {[0, 1].map(item => (
            <div className="skeleton-hero-stat" key={item}>
              <SkeletonBlock style={{ width: 58, height: 30 }} />
              <SkeletonBlock style={{ width: 82, height: 10 }} />
            </div>
          ))}
        </div>
      </div>
      <div className="skeleton-overview-grid">
        <div className="skeleton-surface skeleton-chart">
          <SkeletonBlock style={{ width: 140, height: 14 }} />
          {bars.map((width, index) => (
            <div className="skeleton-chart-row" key={width}>
              <SkeletonBlock style={{ width: 68, height: 10 }} />
              <SkeletonBlock style={{ width, height: 10, background: index === 0 ? '#A9BED6' : undefined }} />
              <SkeletonBlock style={{ width: 24, height: 10 }} />
            </div>
          ))}
        </div>
        <div className="skeleton-surface skeleton-capacity">
          <SkeletonBlock className="skeleton-ring" />
          <SkeletonBlock style={{ width: 120, height: 12 }} />
          <SkeletonBlock style={{ width: 82, height: 9 }} />
        </div>
      </div>
      <div className="skeleton-overview-bottom">
        <div className="skeleton-surface skeleton-band">
          <SkeletonBlock style={{ width: 120, height: 14 }} />
          <SkeletonBlock style={{ width: 190, height: 9, marginTop: 10 }} />
          <div style={{ display: 'flex', gap: 26, marginTop: 28 }}>
            {[0, 1, 2].map(item => <SkeletonBlock key={item} style={{ width: 62, height: 34 }} />)}
          </div>
        </div>
        <div className="skeleton-surface">
          <SkeletonBlock style={{ width: 145, height: 14 }} />
          <SkeletonBlock style={{ width: '100%', height: 12, marginTop: 28 }} />
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            {[0, 1, 2, 3].map(item => <SkeletonBlock key={item} style={{ width: 76, height: 10 }} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminPanelSkeleton({ variant }: { variant: 'overview' | 'users' | 'shelters' | 'victims' | 'claims' }) {
  if (variant === 'overview') {
    return <div role="status" aria-label="กำลังโหลดภาพรวม"><OverviewSkeleton /><span className="skeleton-sr">กำลังโหลดข้อมูล</span></div>;
  }

  const hasSummary = variant === 'users' || variant === 'claims';
  const isShelters = variant === 'shelters';

  return (
    <div className="skeleton-panel" role="status" aria-label="กำลังโหลดข้อมูล">
      <span className="skeleton-sr">กำลังโหลดข้อมูล</span>
      {hasSummary && (
        <div className="skeleton-summary" aria-hidden="true">
          {[0, 1, 2, 3].map(item => (
            <div className="skeleton-summary-item" key={item}>
              <SkeletonBlock style={{ width: 38, height: 24 }} />
              <SkeletonBlock style={{ width: 82, height: 10 }} />
            </div>
          ))}
        </div>
      )}
      {isShelters ? (
        <SkeletonBlock className="skeleton-add" />
      ) : (
        <div className="skeleton-toolbar" aria-hidden="true">
          <SkeletonBlock className="skeleton-control" />
          <SkeletonBlock className="skeleton-control short" />
        </div>
      )}
      <div className={isShelters ? 'skeleton-cards' : 'skeleton-list'} aria-hidden="true">
        {[0, 1, 2, 3, 4].map(item => (
          <div className={isShelters ? 'skeleton-card skeleton-row' : 'skeleton-row'} key={item}>
            <div className="skeleton-row-copy">
              <SkeletonBlock style={{ width: `${58 + (item % 3) * 9}%`, height: 12 }} />
              <SkeletonBlock style={{ width: `${72 - (item % 2) * 12}%`, height: 9 }} />
            </div>
            <div className="skeleton-row-actions">
              {isShelters && <SkeletonBlock />}
              <SkeletonBlock />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminAppSkeleton() {
  return (
    <>
      <style>{ADMIN_SKELETON_CSS}</style>
      <div className="admin-skeleton-page" role="status" aria-busy="true" aria-label="กำลังโหลดแผงควบคุม">
        <span className="skeleton-sr">กำลังโหลดแผงควบคุม</span>
        <header className="skeleton-header" aria-hidden="true">
          <div className="skeleton-brand">
            <SkeletonBlock className="skeleton-brand-mark" />
            <div className="skeleton-brand-copy">
              <SkeletonBlock style={{ width: 142, height: 13 }} />
              <SkeletonBlock style={{ width: 92, height: 9 }} />
            </div>
          </div>
          <nav className="skeleton-nav">
            {[0, 1, 2, 3, 4].map(item => <SkeletonBlock key={item} />)}
          </nav>
          <SkeletonBlock className="skeleton-logout" />
        </header>
        <main className="skeleton-layout" aria-hidden="true">
          <div className="skeleton-heading">
            <div className="skeleton-heading-copy">
              <SkeletonBlock style={{ width: 110, height: 9 }} />
              <SkeletonBlock style={{ width: 260, maxWidth: '85%', height: 30 }} />
              <SkeletonBlock style={{ width: 380, maxWidth: '100%', height: 10 }} />
            </div>
            <SkeletonBlock style={{ width: 110, height: 36, borderRadius: 12 }} />
          </div>
          <OverviewSkeleton />
        </main>
      </div>
    </>
  );
}

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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "var(--font-thai), 'IBM Plex Sans Thai', sans-serif", padding: 20 }}>
      <div style={{ maxWidth: 380, textAlign: 'center', background: '#fff', borderRadius: 20, padding: 28, border: '1px solid #DDE3EC', boxShadow: '0 18px 45px rgba(0,24,69,.08)' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>⛔</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#001845', marginBottom: 8 }}>ไม่มีสิทธิ์เข้าถึง</div>
        <div style={{ fontSize: 13, color: '#5C677D', marginBottom: 20 }}>{accessError}</div>
        <button onClick={handleLogout} style={{ padding: '11px 20px', borderRadius: 12, border: '1px solid #DDE3EC', background: '#fff', color: '#0353A4', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          ออกจากระบบ
        </button>
      </div>
    </div>
  );

  if (loading || !profile) return <AdminAppSkeleton />;

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        ${ADMIN_SKELETON_CSS}
        @keyframes admin-enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .admin-shell { --ink:#001845; --muted:#5C677D; --primary:#0466C8; --primary-strong:#0353A4; --primary-deep:#023E7D; --navy:#002855; --navy-deep:#001845; --midnight:#001233; --slate:#33415C; --slate-mid:#5C677D; --slate-soft:#7D8597; --slate-pale:#979DAC; --line:#DDE3EC; --surface:#fff; min-height:100vh; background:#F5F8FC; color:var(--ink); font-family:var(--font-thai),'IBM Plex Sans Thai',sans-serif; font-weight:400; line-height:1.55; }
        .admin-header { height:72px; background:rgba(255,255,255,.9) !important; border-bottom:1px solid var(--line) !important; padding:0 28px !important; backdrop-filter:blur(16px); }
        .admin-header-inner { height:100%; max-width:1440px !important; }
        .admin-brand { display:flex; align-items:center; gap:12px; }
        .admin-brand-mark { width:42px !important; height:42px !important; border-radius:14px !important; background:var(--ink) !important; color:#fff; font-size:16px !important; box-shadow:0 8px 18px rgba(23,52,60,.18); }
        .admin-brand-title { max-width:285px; font-size:15px !important; font-weight:800 !important; line-height:1.35; color:var(--ink) !important; }
        .admin-brand-user { font-size:11px !important; color:var(--muted) !important; }
        .admin-logout { display:inline-flex; align-items:center; gap:7px; padding:9px 14px !important; border:1px solid var(--line) !important; border-radius:12px !important; background:#fff !important; color:var(--slate-mid) !important; font-family:inherit; cursor:pointer; transition:.2s ease; }
        .admin-logout:hover { color:var(--primary-strong) !important; border-color:#B8CBE0 !important; background:#F2F6FB !important; transform:translateY(-1px); }
        .admin-layout { max-width:1440px !important; margin:0 auto; padding:28px !important; display:grid; grid-template-columns:220px minmax(0,1fr); gap:28px; align-items:start; }
        .admin-sidebar { position:sticky; top:100px; background:var(--ink); border-radius:22px; padding:18px 12px; box-shadow:0 18px 40px rgba(23,52,60,.13); }
        .admin-sidebar-label { padding:4px 12px 13px; font-size:10px; font-weight:800; letter-spacing:.13em; color:rgba(255,255,255,.45); }
        .admin-nav { display:grid !important; gap:6px !important; margin:0 !important; }
        .admin-tab { width:100%; display:flex; align-items:center; padding:11px 13px; border:0; border-radius:13px; background:transparent; color:rgba(255,255,255,.68); font-family:inherit; font-size:13px; font-weight:650; text-align:left; cursor:pointer; transition:.2s ease; }
        .admin-tab:hover { background:rgba(255,255,255,.09); color:#fff; transform:translateX(2px); }
        .admin-tab.active { background:#fff; color:var(--ink); box-shadow:0 8px 18px rgba(0,0,0,.12); }
        .admin-workspace { min-width:0; }
        .admin-page-heading { display:flex; justify-content:space-between; gap:20px; align-items:flex-end; margin:2px 0 22px; }
        .admin-eyebrow { display:flex; align-items:center; gap:7px; margin-bottom:7px; font-size:10px; color:var(--primary); font-weight:850; letter-spacing:.12em; }
        .admin-eyebrow::before { content:''; width:7px; height:7px; border-radius:50%; background:var(--primary); box-shadow:0 0 0 5px rgba(4,102,200,.1); }
        .admin-page-heading h1 { margin:0; font-size:clamp(24px,3vw,31px); line-height:1.2; letter-spacing:-.035em; color:var(--ink); }
        .admin-page-heading p { margin:6px 0 0; color:var(--muted); font-size:13px; }
        .admin-date { flex-shrink:0; padding:9px 13px; border:1px solid var(--line); border-radius:12px; background:#fff; font-size:11px; color:var(--muted); }
        .admin-content { animation:admin-enter .28s ease both; }
        .admin-panel input,.admin-panel select { min-height:42px; border:1px solid var(--line) !important; border-radius:12px !important; background:#fff !important; color:var(--ink); outline:none; transition:border-color .2s,box-shadow .2s; }
        .admin-panel input:focus,.admin-panel select:focus { border-color:rgba(4,102,200,.65) !important; box-shadow:0 0 0 4px rgba(4,102,200,.09); }
        .admin-panel button { font-family:inherit; transition:transform .18s ease,box-shadow .18s ease,filter .18s ease; }
        .admin-panel button:hover:not(:disabled) { transform:translateY(-1px); filter:saturate(1.04); }
        .admin-panel button:active:not(:disabled) { transform:scale(.985); }
        .admin-summary-grid { gap:12px !important; margin-bottom:18px !important; }
        .admin-summary-card,.admin-stat-card { background:var(--surface) !important; border:1px solid var(--line) !important; border-radius:18px !important; box-shadow:0 7px 20px rgba(0,24,69,.045); transition:.2s ease; }
        .admin-summary-card:nth-child(1){background:#F5F8FC !important}.admin-summary-card:nth-child(2){background:#F1F5FA !important}.admin-summary-card:nth-child(3){background:#ECF2F8 !important}.admin-summary-card:nth-child(4){background:#E7EEF6 !important}
        .admin-summary-card:hover,.admin-stat-card:hover { transform:translateY(-2px); box-shadow:0 12px 26px rgba(0,24,69,.09); border-color:#C8D5E4 !important; }
        .admin-toolbar { padding:12px; margin-bottom:14px !important; border:1px solid var(--line); border-radius:16px; background:rgba(255,255,255,.72); }
        .admin-list { background:var(--surface) !important; border:1px solid var(--line) !important; border-radius:18px !important; box-shadow:0 9px 24px rgba(23,52,60,.045); overflow:hidden; }
        .admin-row { padding:16px !important; transition:background .18s ease; }
        .admin-row:hover { background:#F5F8FC; }
        .admin-victim-row { position:relative; display:grid !important; grid-template-columns:minmax(0,1fr) auto auto auto; align-items:center !important; gap:9px !important; border-left:6px solid #94A3B8 !important; }
        .admin-victim-row.urgency-critical { border-left-color:#D92D20 !important; background:#FFF8F7; }
        .admin-victim-row.urgency-high { border-left-color:#F97316 !important; background:#FFF9F5; }
        .admin-victim-row.urgency-medium { border-left-color:#EAB308 !important; background:#FFFDF4; }
        .admin-victim-row.urgency-low { border-left-color:#10B981 !important; }
        .admin-victim-row .victim-severity-badge,.admin-victim-row .victim-status-badge { display:inline-flex; align-items:center; justify-content:center; min-width:74px; white-space:nowrap; }
        .admin-victim-row-copy { min-width:0; }
        .admin-victim-row-copy > div { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .admin-claim-row { display:grid !important; grid-template-columns:minmax(0,1fr) auto auto; align-items:center !important; gap:12px !important; }
        .admin-claim-row-copy { min-width:0; }
        .admin-claim-row-copy > div { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .admin-shelter-card,.admin-claim-card { background:var(--surface) !important; border:1px solid var(--line) !important; border-radius:18px !important; padding:16px !important; box-shadow:0 7px 20px rgba(23,52,60,.04); }
        .admin-add-button { background:linear-gradient(135deg,var(--primary),var(--primary-strong)) !important; border-radius:14px !important; box-shadow:0 8px 18px rgba(4,102,200,.18); }
        .admin-form-card { background:#fff !important; border:1px solid var(--line) !important; border-radius:18px !important; padding:18px !important; }
        .admin-section-label { margin:25px 0 10px !important; color:var(--slate-mid) !important; font-size:12px !important; font-weight:800 !important; }
        .admin-section-label:first-child { margin-top:4px !important; }
        .admin-alert { border-radius:16px !important; box-shadow:0 6px 18px rgba(185,28,28,.05); }
        .admin-approved-total { background:linear-gradient(135deg,var(--navy),var(--primary-deep)) !important; border:0 !important; border-radius:18px !important; padding:18px !important; box-shadow:0 12px 28px rgba(0,40,85,.16); }
        .admin-approved-total > div:first-child { color:rgba(255,255,255,.68) !important; }.admin-approved-total > div:last-child { color:#DCEBFA !important; }
        .admin-status-grid { gap:12px !important; }.admin-status-card { border-radius:18px !important; min-height:90px; background:#fff; }
        .admin-claims { gap:12px !important; }
        .admin-detail-workspace { display:grid; grid-template-columns:minmax(0,1fr); gap:16px; align-items:start; }
        .admin-detail-workspace.is-open { grid-template-columns:minmax(320px,.76fr) minmax(560px,1.24fr); }
        .admin-detail-workspace > .admin-list,.admin-detail-workspace > .admin-claims { min-width:0; }
        .admin-detail-panel { position:sticky; top:100px; max-height:calc(100vh - 124px); overflow-y:auto; border:1px solid #DDE7F1; border-radius:20px; background:#fff; box-shadow:0 14px 34px rgba(0,24,69,.10); }
        .admin-detail-panel-head { position:sticky; z-index:1; top:0; display:flex; align-items:flex-start; justify-content:space-between; gap:14px; padding:20px 22px 16px; border-bottom:1px solid #E6EDF5; background:rgba(255,255,255,.97); backdrop-filter:blur(10px); }
        .admin-detail-panel-content { display:grid; gap:16px; padding:20px 22px 24px; }
        /* Top workspace navigation + editorial dashboard layout */
        .admin-shell { --teal:#0466C8; --saffron:#7D8597; --orange:#5C677D; --coral:#001845; --ice:#F1F6FC; background:linear-gradient(150deg,#F9FBFE 0%,#F3F7FC 52%,#EAF1F9 100%) !important; }
        .admin-header { height:auto; min-height:78px; padding:0 30px !important; position:sticky; top:0; }
        .admin-header::before { content:''; position:absolute; inset:0 0 auto; height:4px; background:linear-gradient(90deg,#0466C8 0 20%,#0353A4 20% 40%,#023E7D 40% 60%,#002855 60% 80%,#001845 80% 100%); }
        .admin-header-inner { min-height:78px; display:grid !important; grid-template-columns:auto minmax(420px,1fr) auto; gap:26px; }
        .admin-brand-mark { background:var(--navy) !important; }
        .admin-top-nav { display:flex; align-items:center; justify-content:center; gap:5px; min-width:0; }
        .admin-top-nav .admin-tab { width:auto; padding:9px 12px; color:var(--slate-mid); border:1px solid transparent; white-space:nowrap; }
        .admin-top-nav .admin-tab:hover { color:var(--primary-deep); background:#EEF4FA; transform:translateY(-1px); }
        .admin-top-nav .admin-tab.active { color:#fff; background:var(--primary); border-color:var(--primary); box-shadow:0 7px 16px rgba(4,102,200,.22); }
        .admin-layout { display:block; max-width:1280px !important; padding:32px 30px 48px !important; }
        .admin-page-heading { margin-bottom:20px; }
        .overview-hero { position:relative; min-height:178px; display:grid; grid-template-columns:minmax(0,1.2fr) minmax(300px,.8fr); gap:28px; align-items:end; overflow:hidden; padding:28px 30px; border-radius:28px; background:linear-gradient(135deg,var(--navy-deep),var(--primary-deep)); color:#fff; box-shadow:0 18px 42px rgba(0,24,69,.18); }
        .overview-hero::before,.overview-hero::after { content:''; position:absolute; border-radius:50%; pointer-events:none; }
        .overview-hero::before { width:260px; height:260px; right:-70px; top:-155px; border:32px solid rgba(151,157,172,.16); }
        .overview-hero::after { width:170px; height:170px; right:210px; bottom:-135px; border:28px solid rgba(4,102,200,.28); }
        .overview-hero-copy,.overview-hero-numbers { position:relative; z-index:1; }
        .overview-live { display:inline-flex; align-items:center; gap:8px; color:#BFD7F0; font-size:10px; font-weight:850; letter-spacing:.12em; }
        .overview-live::before { content:''; width:7px; height:7px; border-radius:50%; background:#65A7E8; box-shadow:0 0 0 5px rgba(4,102,200,.22); }
        .overview-hero h2 { margin:16px 0 7px; max-width:620px; font-size:clamp(24px,3vw,34px); line-height:1.2; letter-spacing:-.04em; }
        .overview-hero p { margin:0; color:rgba(255,255,255,.65); font-size:13px; }
        .overview-hero-numbers { display:grid; grid-template-columns:1fr 1fr; gap:1px; background:rgba(255,255,255,.14); border-radius:18px; overflow:hidden; }
        .overview-hero-number { padding:18px; background:rgba(255,255,255,.06); backdrop-filter:blur(4px); }
        .overview-hero-number b { display:block; font-size:31px; line-height:1; color:#fff; }
        .overview-hero-number span { display:block; margin-top:7px; color:rgba(255,255,255,.58); font-size:11px; }
        .overview-grid { display:grid; grid-template-columns:minmax(0,1.5fr) minmax(280px,.65fr); gap:18px; margin-top:18px; }
        .overview-flow,.overview-capacity { overflow:hidden; border:1px solid rgba(51,65,92,.11); border-radius:24px; background:rgba(255,255,255,.86); box-shadow:0 10px 28px rgba(0,24,69,.055); }
        .overview-panel-head { display:flex; justify-content:space-between; gap:12px; align-items:center; padding:20px 22px 14px; }
        .overview-panel-head h3 { margin:0; color:var(--navy-deep); font-size:15px; }.overview-panel-head span { color:var(--slate-soft); font-size:10px; }
        .flow-chart { display:grid; gap:14px; padding:8px 22px 23px; }
        .flow-row { display:grid; grid-template-columns:94px minmax(0,1fr) 34px; gap:12px; align-items:center; }
        .flow-label { color:var(--slate-mid); font-size:11px; }.flow-value { color:var(--navy-deep); font-size:12px; font-weight:850; text-align:right; }
        .flow-track { height:10px; overflow:hidden; border-radius:999px; background:#E7ECF3; }
        .flow-fill { height:100%; min-width:5px; border-radius:inherit; transform-origin:left; animation:bar-grow .55s ease both; }
        @keyframes bar-grow { from { transform:scaleX(.08); opacity:.3; } to { transform:scaleX(1); opacity:1; } }
        .overview-capacity { display:grid; place-items:center; padding:20px; text-align:center; }
        .capacity-ring { --rate:0; width:142px; height:142px; display:grid; place-items:center; position:relative; border-radius:50%; background:conic-gradient(var(--primary) calc(var(--rate)*1%),#B8C4D3 0); box-shadow:0 12px 28px rgba(4,102,200,.15); }
        .capacity-ring::after { content:''; position:absolute; inset:15px; border-radius:50%; background:#fff; }
        .capacity-ring-content { position:relative; z-index:1; }.capacity-ring-content b { display:block; color:var(--navy-deep); font-size:28px; line-height:1; }.capacity-ring-content span { display:block; margin-top:5px; color:var(--slate-soft); font-size:10px; }
        .capacity-caption { margin-top:15px; color:var(--navy-deep); font-size:13px; font-weight:750; }.capacity-sub { margin-top:4px; color:var(--slate-soft); font-size:11px; }
        .overview-bottom { display:grid; grid-template-columns:minmax(0,.9fr) minmax(0,1.35fr); gap:18px; margin-top:18px; }
        .workforce-band { position:relative; overflow:hidden; border-radius:24px; padding:22px; color:#fff; background:linear-gradient(135deg,var(--primary),var(--primary-strong)); box-shadow:0 12px 30px rgba(4,102,200,.17); }
        .workforce-band::after { content:''; position:absolute; width:150px; height:150px; right:-75px; bottom:-95px; border:25px solid rgba(151,157,172,.2); border-radius:50%; }
        .workforce-band h3,.claim-board h3 { margin:0; font-size:14px; }.workforce-band > p { margin:5px 0 18px; color:rgba(255,255,255,.62); font-size:10px; }
        .workforce-list { position:relative; z-index:1; display:grid; grid-template-columns:repeat(3,1fr); }
        .workforce-item { padding:2px 15px; border-left:1px solid rgba(255,255,255,.17); }.workforce-item:first-child { padding-left:0; border:0; }
        .workforce-item b { display:block; font-size:24px; line-height:1; }.workforce-item span { display:block; margin-top:7px; color:rgba(255,255,255,.65); font-size:10px; }
        .claim-board { border-radius:24px; padding:22px; border:1px solid rgba(51,65,92,.11); background:#fff; box-shadow:0 10px 28px rgba(0,24,69,.055); }
        .claim-board-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }.claim-board-head p { margin:4px 0 0; color:var(--slate-soft); font-size:10px; }
        .claim-total { color:var(--navy-deep); font-size:17px; font-weight:850; white-space:nowrap; }.claim-total small { display:block; color:var(--slate-pale); font-size:9px; font-weight:550; text-align:right; }
        .claim-segments { display:flex; height:12px; overflow:hidden; margin:22px 0 16px; border-radius:999px; background:#E7ECF3; }.claim-segment { height:100%; min-width:3px; }
        .claim-legend { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }.claim-legend-item { display:grid; grid-template-columns:8px 1fr; gap:7px; align-items:center; color:var(--slate-soft); font-size:9px; }.claim-dot { width:8px; height:8px; border-radius:3px; }.claim-legend-item b { color:var(--navy-deep); font-size:11px; }
        .urgent-inline { margin-top:18px; display:flex; align-items:center; gap:10px; padding:13px 16px; border-left:4px solid var(--primary); border-radius:0 14px 14px 0; background:#EAF3FC; color:var(--primary-deep); font-size:12px; }
        @media(max-width:900px){.admin-layout{grid-template-columns:1fr;padding:20px !important;gap:18px}.admin-sidebar{position:static;padding:9px;border-radius:17px;overflow-x:auto}.admin-sidebar-label{display:none}.admin-nav{display:flex !important;min-width:max-content}.admin-tab{width:auto;white-space:nowrap}.admin-tab:hover{transform:translateY(-1px)}.admin-page-heading{margin-top:0}}
        @media(max-width:1050px){.admin-header-inner{grid-template-columns:auto 1fr auto;gap:16px}.admin-top-nav{justify-content:flex-start;overflow-x:auto;padding:16px 2px}.admin-top-nav .admin-tab{flex:0 0 auto}.overview-grid,.overview-bottom,.admin-detail-workspace.is-open{grid-template-columns:1fr}.overview-capacity{min-height:240px}.admin-detail-panel{position:static;max-height:none}}
        @media(max-width:900px){.admin-layout{padding:22px 20px 42px !important}.admin-page-heading{margin-top:0}}
        @media(max-width:720px){.admin-header{padding:0 15px !important}.admin-header-inner{grid-template-columns:1fr auto;gap:8px;padding-top:8px}.admin-brand{min-height:52px}.admin-top-nav{grid-column:1/-1;grid-row:2;padding:6px 0 10px;justify-content:flex-start}.admin-logout{grid-column:2;grid-row:1}.admin-layout{padding:20px 13px 36px !important}.overview-hero{grid-template-columns:1fr;padding:24px;gap:22px}.overview-grid,.overview-bottom{gap:13px;margin-top:13px}.flow-row{grid-template-columns:78px minmax(0,1fr) 28px}.claim-legend{grid-template-columns:repeat(2,1fr)}.admin-date{display:none}.admin-victim-row,.admin-claim-row{grid-template-columns:minmax(0,1fr) auto !important}.admin-victim-row > button,.admin-claim-row > button{grid-column:1/-1;width:100%}.admin-victim-row-copy > div,.admin-claim-row-copy > div{white-space:normal}}
        @media(max-width:480px){.admin-brand-user{max-width:130px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.admin-logout{padding:8px 9px !important;font-size:0 !important}.admin-logout span{font-size:14px}.admin-page-heading{align-items:flex-start}.admin-page-heading h1{font-size:24px}.overview-hero-numbers{grid-template-columns:1fr 1fr}.workforce-list{grid-template-columns:1fr;gap:12px}.workforce-item{padding:10px 0 0;border:0;border-top:1px solid rgba(255,255,255,.16)}.workforce-item:first-child{padding-top:0;border:0}.admin-summary-grid,.admin-status-grid{grid-template-columns:repeat(2,minmax(0,1fr)) !important}.admin-toolbar input,.admin-toolbar select{max-width:none !important;width:100% !important}.admin-row{align-items:flex-start !important}.admin-panel [style*='repeat(3']{grid-template-columns:1fr !important}}
        @media(max-width:720px){.admin-victim-row{grid-template-columns:minmax(0,1fr) auto auto !important}.admin-victim-row .victim-status-badge{grid-column:2}.admin-victim-row .victim-severity-badge{grid-column:3}.admin-victim-row > button{grid-column:1/-1;width:100%}}
      `}</style>
      <div className="admin-shell" style={{ minHeight: '100vh', background: '#F5F8FC', fontFamily: "var(--font-thai), 'IBM Plex Sans Thai', sans-serif" }}>

        <header className="admin-header" style={{ background: '#fff', borderBottom: '1px solid #DDE3EC', padding: '14px 20px', position: 'sticky', top: 0, zIndex: 50 }}>
          <div className="admin-header-inner" style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="admin-brand" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="admin-brand-mark" style={{ width: 40, height: 40, borderRadius: 11, overflow: 'hidden' }}><BrandLogo size={40} priority /></div>
              <div>
                <div className="admin-brand-title" style={{ fontSize: 15, fontWeight: 700, color: '#001845' }}>{PROJECT_NAME}</div>
                <div className="admin-brand-user" style={{ fontSize: 11, color: '#7D8597' }}>{profile.full_name}</div>
              </div>
            </div>
            <nav className="admin-top-nav" aria-label="เลือกพื้นที่ทำงาน">
              <TabButton active={tab === 'overview'} onClick={() => setTab('overview')} label="ภาพรวม" />
              <TabButton active={tab === 'users'} onClick={() => setTab('users')} label="ผู้ใช้งาน" />
              <TabButton active={tab === 'shelters'} onClick={() => setTab('shelters')} label="ศูนย์พักพิง" />
              <TabButton active={tab === 'victims'} onClick={() => setTab('victims')} label="ผู้ประสบภัย" />
              <TabButton active={tab === 'compensation'} onClick={() => setTab('compensation')} label="เยียวยา" />
              <TabButton active={tab === 'governance'} onClick={() => setTab('governance')} label="กำกับ" />
              <TabButton active={tab === 'rescue_map'} onClick={() => setTab('rescue_map')} label="แผนที่กู้ภัย" />
            </nav>
            <button className="admin-logout" onClick={handleLogout} style={{ padding: '7px 14px', borderRadius: 10, border: '1px solid #DDE3EC', background: '#fff', fontSize: 13, fontWeight: 600, color: '#5C677D', cursor: 'pointer' }}>
              <span aria-hidden="true">↗</span> ออกจากระบบ
            </button>
          </div>
        </header>

        <main className="admin-layout" style={{ maxWidth: 1100, margin: '0 auto', padding: 20 }}>
          <section className="admin-workspace">
            <div className="admin-page-heading">
              <div>
                <div className="admin-eyebrow">CONTROL CENTER</div>
                <h1>{TAB_META[tab].title}</h1>
                <p>{TAB_META[tab].description}</p>
              </div>
              <div className="admin-date">{new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' }).format(new Date())}</div>
            </div>
            <div className="admin-content" key={tab}>
              {tab === 'overview' && <OverviewTab />}
              {tab === 'rescue_map' && <AdminRescuerMapPanel />}
              {tab === 'users' && <UsersTab />}
              {tab === 'shelters' && <SheltersTab />}
              {tab === 'victims' && <VictimsTab />}
              {tab === 'compensation' && <CompensationTab />}
              {tab === 'governance' && <GovernanceTab />}
            </div>
          </section>
        </main>
      </div>
    </>
  );
}

type DeathConfirmation = {
  id: string;
  status: 'pending_review' | 'confirmed' | 'rejected';
  reported_at: string;
  reported_note?: string | null;
  sos?: { full_name?: string | null; province?: string | null } | null;
};

type OperationAudit = {
  id: string;
  created_at: string;
  entity_type: string;
  action: string;
  actor?: { full_name?: string | null } | null;
};

function GovernanceTab() {
  const [confirmations, setConfirmations] = useState<DeathConfirmation[]>([]);
  const [audit, setAudit] = useState<OperationAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [syncingAddresses, setSyncingAddresses] = useState(false);
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    const [{ data: deathRows }, { data: auditRows }] = await Promise.all([
      supabase.from('death_case_confirmations')
        .select('id,status,reported_at,reported_note,sos:sos_reports(full_name,province)')
        .order('reported_at', { ascending: false }).limit(50),
      supabase.from('operation_audit_logs')
        .select('id,created_at,entity_type,action,actor:profiles(full_name)')
        .order('created_at', { ascending: false }).limit(100),
    ]);
    setConfirmations((deathRows as DeathConfirmation[]) ?? []);
    setAudit((auditRows as OperationAudit[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const review = async (id: string, decision: 'confirmed' | 'rejected') => {
    const reviewNote = decision === 'rejected'
      ? window.prompt('ระบุเหตุผลที่ไม่ยืนยันรายงาน (จำเป็น)')
      : window.prompt('บันทึกหมายเหตุการยืนยัน (ถ้ามี)');
    if (decision === 'rejected' && !reviewNote?.trim()) return;
    setSavingId(id); setNotice('');
    const { error } = await supabase.rpc('review_death_case_confirmation', {
      p_confirmation_id: id, p_decision: decision, p_review_note: reviewNote?.trim() || null,
    });
    setSavingId(null);
    if (error) { setNotice(`บันทึกไม่สำเร็จ: ${error.message}`); return; }
    setNotice(decision === 'confirmed' ? 'ยืนยันและคงสถานะปิดเคสแล้ว' : 'ไม่ยืนยันแล้ว เคสกลับไปรอประสานเข้าช่วยใหม่');
    void load();
  };

  const syncAddresses = async () => {
    setSyncingAddresses(true); setNotice('');
    const response = await fetch('/api/address-sync', { method: 'POST' });
    const result = await response.json().catch(() => ({})) as { error?: string };
    setSyncingAddresses(false);
    setNotice(response.ok ? 'อัปเดตคลังจังหวัด/อำเภอ/ตำบลในฐานข้อมูลแล้ว' : `อัปเดตไม่สำเร็จ: ${result.error ?? 'ไม่ทราบสาเหตุ'} — ข้อมูลเดิมยังใช้งานได้`);
  };

  if (loading) return <div style={{ color: '#5C677D', padding: 20 }}>กำลังโหลดข้อมูลกำกับและตรวจสอบ...</div>;
  return (
    <div className="admin-panel" style={{ display: 'grid', gap: 16 }}>
      {notice && <div className="admin-alert" style={{ padding: 13, background: '#EAF3FC', color: '#023E7D', fontSize: 13 }}>{notice}</div>}
      <section className="admin-form-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div><b>คลังที่อยู่สำรอง</b><div style={{ color: '#5C677D', fontSize: 12, marginTop: 3 }}>หน้าเว็บอ่านข้อมูลจากฐานข้อมูลก่อนเสมอ การอัปเดตจาก API ล้มเหลวจะไม่ลบข้อมูลเดิม</div></div>
          <button className="admin-add-button" onClick={() => void syncAddresses()} disabled={syncingAddresses} style={{ border: 0, padding: '10px 14px', color: '#fff', cursor: 'pointer' }}>{syncingAddresses ? 'กำลังอัปเดต...' : 'อัปเดตข้อมูลที่อยู่'}</button>
        </div>
      </section>
      <section className="admin-list">
        <div style={{ padding: 16, borderBottom: '1px solid #E8EDF4' }}><b>รายการรอยืนยันกรณีเสียชีวิต</b><div style={{ color: '#5C677D', fontSize: 12 }}>ยืนยันแล้วคงสถานะปิดเคส; ไม่ยืนยันจะเปิดให้ประสานเข้าช่วยใหม่</div></div>
        {!confirmations.length ? <div style={{ padding: 16, color: '#5C677D', fontSize: 13 }}>ไม่มีรายการรอยืนยัน</div> : confirmations.map((item) => (
          <div className="admin-row" key={item.id} style={{ borderBottom: '1px solid #E8EDF4', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}><b>{item.sos?.full_name ?? 'คำขอ SOS'}</b><div style={{ color: '#5C677D', fontSize: 12 }}>{item.sos?.province ?? '-'} · {new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.reported_at))}</div>{item.reported_note && <div style={{ color: '#33415C', fontSize: 12, marginTop: 4 }}>{item.reported_note}</div>}</div>
            {item.status === 'pending_review' ? <><button onClick={() => void review(item.id, 'confirmed')} disabled={savingId === item.id} style={{ border: 0, borderRadius: 10, background: '#0466C8', color: '#fff', padding: '9px 12px', cursor: 'pointer' }}>ยืนยัน</button><button onClick={() => void review(item.id, 'rejected')} disabled={savingId === item.id} style={{ border: '1px solid #DDE3EC', borderRadius: 10, background: '#fff', color: '#33415C', padding: '9px 12px', cursor: 'pointer' }}>ไม่ยืนยัน</button></> : <span style={{ fontSize: 12, fontWeight: 700, color: item.status === 'confirmed' ? '#0353A4' : '#5C677D' }}>{item.status === 'confirmed' ? 'ยืนยันแล้ว' : 'ไม่ยืนยัน'}</span>}
          </div>
        ))}
      </section>
      <section className="admin-list">
        <div style={{ padding: 16, borderBottom: '1px solid #E8EDF4' }}><b>ประวัติการปฏิบัติงานล่าสุด</b><div style={{ color: '#5C677D', fontSize: 12 }}>บันทึกเฉพาะการเปลี่ยนสถานะ ไม่เก็บเบอร์โทรหรือเอกสารส่วนตัวใน audit</div></div>
        {!audit.length ? <div style={{ padding: 16, color: '#5C677D', fontSize: 13 }}>ยังไม่มีรายการหลังติดตั้ง migration นี้</div> : audit.map((item) => <div className="admin-row" key={item.id} style={{ borderBottom: '1px solid #E8EDF4', display: 'flex', justifyContent: 'space-between', gap: 12 }}><div><b>{item.action}</b><div style={{ color: '#5C677D', fontSize: 12 }}>{item.entity_type} · {item.actor?.full_name ?? 'ระบบ/ไม่ระบุตัวตน'}</div></div><time style={{ color: '#7D8597', fontSize: 11, whiteSpace: 'nowrap' }}>{new Intl.DateTimeFormat('th-TH', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.created_at))}</time></div>)}
      </section>
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      className={`admin-tab ${active ? 'active' : ''}`}
      onClick={onClick}
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
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');

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
      return true;
    } catch (err: any) {
      alert(`บันทึกไม่สำเร็จ: ${err.message}`);
      return false;
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
    if (search && !u.full_name.toLowerCase().includes(search.toLowerCase()) && !(u.email ?? '').toLowerCase().includes(search.toLowerCase()) && !(u.phone ?? '').includes(search)) return false;
    return true;
  });

  if (loading) return <AdminPanelSkeleton variant="users" />;

  return (
    <div className="admin-panel admin-users">
      <div className="admin-summary-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        {(['rescuer', 'shelter_staff', 'admin', 'gov'] as const).map(r => (
          <div className="admin-summary-card" key={r} style={{ background: '#fff', borderRadius: 14, padding: '14px 12px', border: '1px solid #DDE3EC', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#001845' }}>{counts[r] ?? 0}</div>
            <div style={{ fontSize: 11, color: '#7D8597', marginTop: 2 }}>{ROLE_LABEL[r]}</div>
          </div>
        ))}
      </div>

      <div className="admin-toolbar" style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input placeholder="🔍 ค้นหาชื่อหรือเบอร์โทร" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, maxWidth: 240 }} />
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} style={{ ...inputStyle, maxWidth: 180 }}>
          <option value="all">ทุกบทบาท</option>
          {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="admin-list" style={{ background: '#fff', borderRadius: 16, border: '1px solid #DDE3EC', overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#7D8597', fontSize: 13 }}>ไม่พบผู้ใช้งาน</div>
        ) : filtered.map((u, i) => (
          <div className="admin-row" key={u.id} style={{ padding: 14, borderBottom: i < filtered.length - 1 ? '1px solid #E8EDF4' : 'none', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 250px', minWidth: 220 }}>
              {editingNameId === u.id ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input aria-label="ชื่อเจ้าหน้าที่" value={nameDraft} onChange={e => setNameDraft(e.target.value)} style={{ ...inputStyle, minWidth: 0, flex: 1, padding: '7px 9px' }} autoFocus />
                  <button type="button" disabled={!nameDraft.trim() || savingId === u.id} onClick={async () => {
                    if (await updateUser(u.id, { full_name: nameDraft.trim() })) setEditingNameId(null);
                  }} style={{ padding: '7px 9px', border: 0, borderRadius: 8, background: '#0353A4', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>บันทึก</button>
                  <button type="button" disabled={savingId === u.id} onClick={() => setEditingNameId(null)} style={{ padding: '7px 8px', border: '1px solid #D6DFEA', borderRadius: 8, background: '#fff', color: '#5C677D', fontSize: 11, cursor: 'pointer' }}>ยกเลิก</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#001845' }}>{u.full_name || 'ยังไม่ระบุชื่อ'}</div>
                  <button type="button" onClick={() => { setNameDraft(u.full_name === 'เจ้าหน้าที่' ? '' : u.full_name); setEditingNameId(u.id); }} style={{ padding: 0, border: 0, background: 'transparent', color: '#0466C8', fontSize: 11, cursor: 'pointer' }}>แก้ชื่อ</button>
                </div>
              )}
              <div style={{ fontSize: 11, color: '#5C677D', marginTop: 3 }}>{u.email ?? 'ยังไม่ได้บันทึกอีเมล'}</div>
              <div style={{ fontSize: 11, color: '#7D8597', marginTop: 2 }}>{u.phone ?? 'ไม่มีเบอร์โทร'} {u.agency ? `· ${u.agency}` : ''}</div>
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
                border: '1px solid #D6DFEA',
                background: u.is_active ? '#EAF3FC' : '#E8EBF0',
                color: u.is_active ? '#0353A4' : '#001845',
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
    const capacity = Number(draft.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) {
      alert('กรุณาระบุจำนวนคนที่ศูนย์รับได้สูงสุดอย่างน้อย 1 คน');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('shelters').insert({
        name: draft.name.trim(),
        address: draft.address.trim() || null,
        province: draft.province.trim() || null,
        capacity,
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
    const currentShelter = shelters.find(shelter => shelter.id === id);
    if (!currentShelter) return;
    const capacity = Number(editDraft.capacity ?? currentShelter.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) {
      alert('กรุณาระบุจำนวนคนที่ศูนย์รับได้สูงสุดอย่างน้อย 1 คน');
      return;
    }
    if (capacity < (currentShelter.current_occupancy ?? 0)) {
      alert(`ความจุต้องไม่น้อยกว่าจำนวนผู้พักพิงปัจจุบัน ${currentShelter.current_occupancy ?? 0} คน`);
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('shelters').update({ ...editDraft, capacity }).eq('id', id);
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

  if (loading) return <AdminPanelSkeleton variant="shelters" />;
  const missingCapacityCount = shelters.filter(shelter => !shelter.capacity || shelter.capacity < 1).length;

  return (
    <div className="admin-panel admin-shelters">
      {missingCapacityCount > 0 && (
        <div style={{
          marginBottom: 14, padding: '12px 14px', border: '1px solid #F2C97D',
          borderRadius: 13, color: '#7A4B00', background: '#FFF8E8', fontSize: 13, lineHeight: 1.55,
        }}>
          <strong style={{ display: 'block', color: '#5F3A00' }}>ต้องกำหนดความจุอีก {missingCapacityCount} ศูนย์</strong>
          ศูนย์ที่ยังไม่กำหนดจำนวนสูงสุดจะแสดงคำเตือนแก่กู้ภัยและผู้ประสบภัย
        </div>
      )}
      <button
        className="admin-add-button"
        onClick={() => setShowAdd(v => !v)}
        style={{
          width: '100%', padding: 13, borderRadius: 14, border: 'none', marginBottom: showAdd ? 12 : 16,
          background: showAdd ? '#E8EBF0' : 'linear-gradient(135deg,#0466C8,#0353A4)',
          color: showAdd ? '#33415C' : '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
        }}
      >
        {showAdd ? '✕ ยกเลิก' : '+ เพิ่มศูนย์พักพิงใหม่'}
      </button>

      {showAdd && (
        <div className="admin-form-card" style={{ background: '#fff', borderRadius: 16, padding: 16, marginBottom: 16, border: '1px solid #DDE3EC', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input placeholder="ชื่อศูนย์ *" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} style={inputStyle} />
          <input placeholder="ที่อยู่" value={draft.address} onChange={e => setDraft({ ...draft, address: e.target.value })} style={inputStyle} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input placeholder="จังหวัด" value={draft.province} onChange={e => setDraft({ ...draft, province: e.target.value })} style={inputStyle} />
            <input aria-label="จำนวนคนที่ศูนย์รับได้สูงสุด" placeholder="รับได้สูงสุด (คน) *" type="number" min={1} step={1} required value={draft.capacity} onChange={e => setDraft({ ...draft, capacity: e.target.value })} style={inputStyle} />
          </div>
          <input placeholder="เบอร์ติดต่อ" value={draft.contact_phone} onChange={e => setDraft({ ...draft, contact_phone: e.target.value })} style={inputStyle} />
          <button onClick={addShelter} disabled={saving} style={{ padding: 12, borderRadius: 12, border: 'none', background: '#023E7D', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            {saving ? 'กำลังบันทึก...' : 'บันทึกศูนย์ใหม่'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {shelters.map(s => (
          <div className="admin-shelter-card" key={s.id} style={{ background: '#fff', borderRadius: 14, padding: 14, border: '1px solid #DDE3EC' }}>
            {editingId === s.id ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input defaultValue={s.name} onChange={e => setEditDraft({ ...editDraft, name: e.target.value })} style={inputStyle} />
                <input defaultValue={s.address ?? ''} onChange={e => setEditDraft({ ...editDraft, address: e.target.value })} style={inputStyle} placeholder="ที่อยู่" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input aria-label="จำนวนคนที่ศูนย์รับได้สูงสุด" defaultValue={s.capacity || ''} type="number" min={Math.max(1, s.current_occupancy ?? 0)} step={1} required onChange={e => setEditDraft({ ...editDraft, capacity: Number(e.target.value) })} style={inputStyle} placeholder="รับได้สูงสุด (คน) *" />
                  <input defaultValue={s.contact_phone ?? ''} onChange={e => setEditDraft({ ...editDraft, contact_phone: e.target.value })} style={inputStyle} placeholder="เบอร์ติดต่อ" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button onClick={() => setEditingId(null)} style={{ padding: 10, borderRadius: 10, border: '1px solid #DDE3EC', background: '#fff', color: '#5C677D', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>ยกเลิก</button>
                  <button onClick={() => saveEdit(s.id)} disabled={saving} style={{ padding: 10, borderRadius: 10, border: 'none', background: '#023E7D', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>บันทึก</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#001845' }}>
                    {s.name} {!s.is_active && <span style={{ fontSize: 10, color: '#33415C', fontWeight: 700 }}>(ปิดใช้งาน)</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#7D8597', marginTop: 2 }}>
                    {s.address ?? 'ไม่ระบุที่อยู่'} · ปัจจุบัน {s.current_occupancy ?? 0} คน · {s.capacity > 0 ? `รับได้สูงสุด ${s.capacity} คน` : 'ยังไม่กำหนดความจุ'}
                  </div>
                  {(!s.capacity || s.capacity < 1) && (
                    <div style={{ marginTop: 5, color: '#9A3412', fontSize: 11, fontWeight: 700 }}>
                      กรุณากดแก้ไขและระบุจำนวนที่ศูนย์รับได้สูงสุด
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => { setEditingId(s.id); setEditDraft({ capacity: s.capacity }); }} style={{ padding: '7px 12px', borderRadius: 10, border: '1px solid #C9D6E5', background: '#F5F8FC', color: '#0353A4', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>แก้ไข</button>
                  <button onClick={() => toggleActive(s)} style={{ padding: '7px 12px', borderRadius: 10, border: '1px solid #DDE3EC', background: '#fff', color: '#33415C', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    {s.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                  </button>
                  <button onClick={() => deleteShelter(s)} style={{ padding: '7px 12px', borderRadius: 10, border: '1px solid #C8CED8', background: '#E8EBF0', color: '#001845', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>ลบ</button>
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
  const [selectedReport, setSelectedReport] = useState<SOSReport | null>(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchReports = async (targetPage = 1) => {
    setRefreshing(true);
    setLoadError(null);
    try {
      let query = supabase
        .from('sos_reports')
        .select('*', { count: 'exact' });
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      const normalizedSearch = search.trim().replace(/[%_,()]/g, '');
      if (normalizedSearch) query = query.or(`full_name.ilike.%${normalizedSearch}%,phone.ilike.%${normalizedSearch}%`);
      const from = (targetPage - 1) * ADMIN_PAGE_SIZE;
      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(from, from + ADMIN_PAGE_SIZE - 1);
      if (error) throw error;
      setReports((data as SOSReport[]) ?? []);
      setTotalCount(count ?? 0);
      setPage(targetPage);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'ไม่สามารถโหลดข้อมูลผู้ประสบภัยได้');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchReports(1);
    const channel = supabase
      .channel(`admin-victims-${statusFilter}-${search}`)
      .on('postgres_changes' as never, { event: '*', schema: 'public', table: 'sos_reports' }, () => { void fetchReports(1); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(totalCount / ADMIN_PAGE_SIZE));
  const filtered = reports;

  const retryDispatch = async (report: SOSReport) => {
    const { error } = await supabase.rpc('admin_redrive_rescue_case', { p_sos_report_id: report.id });
    if (error) {
      alert(`ส่งค้นหาทีมใหม่ไม่สำเร็จ: ${error.message}`);
      return;
    }
    await fetchReports(page);
    alert('ระบบเริ่มค้นหาทีมกู้ภัยตามรัศมีปัจจุบันแล้ว');
  };

  const handoffCase = async (report: SOSReport) => {
    const reason = window.prompt('ระบุเหตุผลการส่งต่อเคส (จำเป็น และจะบันทึกในประวัติ)');
    if (!reason?.trim()) return;
    const { error } = await supabase.rpc('admin_handoff_rescue_case', {
      p_sos_report_id: report.id,
      p_reason: reason.trim(),
    });
    if (error) {
      alert(`ส่งต่อเคสไม่สำเร็จ: ${error.message}`);
      return;
    }
    await fetchReports(page);
    alert('ส่งต่อเคสแล้ว ระบบกำลังค้นหาทีมถัดไป');
  };

  if (loading) return <AdminPanelSkeleton variant="victims" />;

  return (
    <div className="admin-panel admin-victims">
      <div className="admin-toolbar" style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <div aria-label="คำอธิบายระดับความเร่งด่วน" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 11, fontWeight: 700, color: '#475569' }}>
          <span>ความเร่งด่วน:</span>
          {Object.values(URGENCY_LABEL).map((urgency) => <span key={urgency.text} style={{ padding: '4px 8px', borderRadius: 999, color: urgency.color, background: urgency.bg }}>{urgency.text}</span>)}
        </div>
        <input placeholder="🔍 ค้นหาชื่อหรือเบอร์โทร" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, maxWidth: 240 }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inputStyle, maxWidth: 180 }}>
          <option value="all">ทุกสถานะ</option>
          {Object.entries(SOS_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}
        </select>
        <button type="button" onClick={() => void fetchReports(page)} disabled={refreshing} style={{ padding: '9px 13px', border: '1px solid #BAD4EE', borderRadius: 10, color: '#0466C8', background: '#F5FAFF', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{refreshing ? 'กำลังรีเฟรช…' : 'รีเฟรช'}</button>
      </div>

      <div className={`admin-detail-workspace ${selectedReport ? 'is-open' : ''}`}>
      <div className="admin-list" style={{ background: '#fff', borderRadius: 16, border: '1px solid #DDE3EC', overflow: 'hidden' }}>
        {loadError ? <AdminLoadError message={loadError} onRetry={() => void fetchReports(page)} /> : filtered.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#7D8597', fontSize: 13 }}>ไม่พบข้อมูล</div>
        ) : filtered.map((r, i) => {
          const st = SOS_STATUS_LABEL[r.status] ?? SOS_STATUS_LABEL.pending;
          const urgency = URGENCY_LABEL[r.urgency_level] ?? URGENCY_LABEL.low;
          return (
            <div className={`admin-row admin-victim-row urgency-${r.urgency_level ?? 'low'}`} key={r.id} style={{ padding: 14, borderBottom: i < filtered.length - 1 ? '1px solid #E8EDF4' : 'none' }}>
              <div className="admin-victim-row-copy">
                <div style={{ fontSize: 13, fontWeight: 700, color: '#001845' }}>{r.full_name}</div>
                <div style={{ fontSize: 11, color: '#7D8597' }}>
                  {r.phone} · {r.district} {r.province} · ผู้ใหญ่ {r.adult_count} เด็ก {r.child_count} สูงอายุ {r.elder_count}
                </div>
              </div>
              <span className="victim-severity-badge" style={{ fontSize: 11, fontWeight: 800, padding: '5px 10px', borderRadius: 999, color: urgency.color, background: urgency.bg }}>
                {urgency.text}
              </span>
              <span className="victim-status-badge" style={{ fontSize: 11, fontWeight: 800, padding: '5px 10px', borderRadius: 999, color: st.color, background: st.bg }}>
                {st.text}
              </span>
              <button type="button" onClick={() => setSelectedReport(r)} style={{ padding: '8px 11px', border: '1px solid #BAD4EE', borderRadius: 10, color: '#0466C8', background: '#F5FAFF', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>ดูรายละเอียด</button>
            </div>
          );
        })}
      </div>
      {selectedReport && <VictimDetailPanel report={selectedReport} onClose={() => setSelectedReport(null)} onRetryDispatch={retryDispatch} onHandoff={handoffCase} />}
      </div>
      {!loadError && totalCount > 0 && <AdminPagination page={page} totalPages={totalPages} totalCount={totalCount} onPageChange={(nextPage) => void fetchReports(nextPage)} />}
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

  if (loading) return <AdminPanelSkeleton variant="overview" />;

  const shelterRate = shelterTotals.capacity > 0
    ? Math.min(100, Math.round((shelterTotals.occupancy / shelterTotals.capacity) * 100))
    : 0;
  const flowItems = [
    { label: 'รอรับเรื่อง', value: sosCounts.pending ?? 0, color: '#979DAC' },
    { label: 'กำลังช่วย', value: sosCounts.assigned ?? 0, color: '#0466C8' },
    { label: 'สำเร็จแล้ว', value: sosCounts.rescued ?? 0, color: '#0353A4' },
    { label: 'เข้าไม่ถึง', value: sosCounts.cannot_reach ?? 0, color: '#001845' },
  ];
  const claimItems = [
    { label: 'รอตรวจสอบ', value: claimCounts.pending ?? 0, color: '#7D8597' },
    { label: 'ตรวจแล้ว', value: claimCounts.verified ?? 0, color: '#0466C8' },
    { label: 'อนุมัติ', value: claimCounts.approved ?? 0, color: '#023E7D' },
    { label: 'ไม่อนุมัติ', value: claimCounts.rejected ?? 0, color: '#001233' },
  ];
  const totalClaims = claimItems.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="admin-panel admin-overview">
      <section className="overview-hero">
        <div className="overview-hero-copy">
          <div className="overview-live">LIVE OPERATIONS</div>
          <h2>เห็นภาพรวม เข้าใจสถานการณ์<br />และตัดสินใจได้เร็วขึ้น</h2>
          <p>ข้อมูลจากทุกพื้นที่ทำงานถูกรวมไว้ในมุมมองเดียว</p>
        </div>
        <div className="overview-hero-numbers">
          <div className="overview-hero-number">
            <b>{totalVictims}</b>
            <span>เหตุการณ์ทั้งหมด</span>
          </div>
          <div className="overview-hero-number">
            <b>{(sosCounts.pending ?? 0) + (sosCounts.assigned ?? 0)}</b>
            <span>ภารกิจที่ต้องดูแล</span>
          </div>
        </div>
      </section>

      {pendingUrgent > 0 && (
        <div className="urgent-inline">
          <span aria-hidden="true">●</span>
          มีเคสระดับสูงหรือวิกฤตที่ยังรอรับเรื่อง {pendingUrgent} เคส
        </div>
      )}

      <div className="overview-grid">
        <section className="overview-flow">
          <div className="overview-panel-head">
            <h3>สถานะการช่วยเหลือ</h3>
            <span>จำนวนเคสปัจจุบัน</span>
          </div>
          <div className="flow-chart">
            {flowItems.map((item) => (
              <div className="flow-row" key={item.label}>
                <div className="flow-label">{item.label}</div>
                <div className="flow-track">
                  <div
                    className="flow-fill"
                    style={{
                      width: `${totalVictims > 0 ? Math.max(3, (item.value / totalVictims) * 100) : 0}%`,
                      background: item.color,
                    }}
                  />
                </div>
                <div className="flow-value">{item.value}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="overview-capacity">
          <div>
            <div
              className="capacity-ring"
            style={{ background: `conic-gradient(#0466C8 ${shelterRate}%, #C3CCD8 0)` }}
            >
              <div className="capacity-ring-content">
                <b>{shelterRate}%</b>
                <span>การใช้งาน</span>
              </div>
            </div>
            <div className="capacity-caption">ศูนย์พักพิง {shelterTotals.count} แห่ง</div>
            <div className="capacity-sub">{shelterTotals.occupancy} จาก {shelterTotals.capacity} ที่</div>
          </div>
        </section>
      </div>

      <div className="overview-bottom">
        <section className="workforce-band">
          <h3>กำลังคนในระบบ</h3>
          <p>ทีมที่พร้อมสนับสนุนการปฏิบัติงาน</p>
          <div className="workforce-list">
            <div className="workforce-item"><b>{roleCounts.rescuer ?? 0}</b><span>เจ้าหน้าที่กู้ภัย</span></div>
            <div className="workforce-item"><b>{roleCounts.shelter_staff ?? 0}</b><span>เจ้าหน้าที่ศูนย์</span></div>
            <div className="workforce-item"><b>{roleCounts.admin ?? 0}</b><span>ผู้ดูแลระบบ</span></div>
          </div>
        </section>

        <section className="claim-board">
          <div className="claim-board-head">
            <div><h3>ภาพรวมคำขอเยียวยา</h3><p>{totalClaims} รายการในระบบ</p></div>
            <div className="claim-total">
              {approvedValue.toLocaleString('th-TH')} บาท
              <small>ยอดอนุมัติรวม</small>
            </div>
          </div>
          <div className="claim-segments" aria-label="สัดส่วนสถานะคำขอเยียวยา">
            {claimItems.map((item) => (
              <div
                className="claim-segment"
                key={item.label}
                style={{ background: item.color, flexGrow: totalClaims > 0 ? item.value : 1 }}
              />
            ))}
          </div>
          <div className="claim-legend">
            {claimItems.map((item) => (
              <div className="claim-legend-item" key={item.label}>
                <span className="claim-dot" style={{ background: item.color }} />
                <span>{item.label} <b>{item.value}</b></span>
              </div>
            ))}
          </div>
        </section>
      </div>
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
  const [selectedClaim, setSelectedClaim] = useState<DamageReport | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchClaims = async () => {
    setRefreshing(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.from('damage_reports').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setClaims((data as DamageReport[]) ?? []);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'ไม่สามารถโหลดคำร้องเยียวยาได้');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
  useEffect(() => {
    void fetchClaims();
    const channel = supabase
      .channel('admin-compensation')
      .on('postgres_changes' as never, { event: '*', schema: 'public', table: 'damage_reports' }, () => { void fetchClaims(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  const updateStatus = async (id: string, status: DamageReport['status'], reason?: string) => {
    setSavingId(id);
    try {
      const response = await fetch('/api/admin/compensation-status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reportId: id, status, reason: reason?.trim() || null }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'บันทึกสถานะไม่สำเร็จ');
      setClaims(prev => prev.map(c => c.id === id ? { ...c, status } : c));
      setSelectedClaim(prev => prev?.id === id ? { ...prev, status } : prev);
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

  if (loading) return <AdminPanelSkeleton variant="claims" />;

  return (
    <div className="admin-panel admin-compensation">
      <div className="admin-status-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        {(['pending', 'verified', 'approved', 'rejected'] as const).map(s => (
          <button
            className="admin-status-card"
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              background: statusFilter === s ? CLAIM_STATUS_LABEL[s].bg : '#fff',
              border: statusFilter === s ? `2px solid ${CLAIM_STATUS_LABEL[s].color}` : '1px solid #DDE3EC',
              borderRadius: 14, padding: '14px 12px', textAlign: 'center', cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, color: CLAIM_STATUS_LABEL[s].color }}>{counts[s] ?? 0}</div>
            <div style={{ fontSize: 11, color: '#5C677D', marginTop: 2 }}>{CLAIM_STATUS_LABEL[s].text}</div>
          </button>
        ))}
      </div>

      <div className="admin-toolbar" style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input placeholder="🔍 ค้นหาชื่อหรือเบอร์โทร" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, maxWidth: 240 }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inputStyle, maxWidth: 180 }}>
          <option value="all">ทุกสถานะ</option>
          {Object.entries(CLAIM_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}
        </select>
        <button type="button" onClick={() => void fetchClaims()} disabled={refreshing} style={{ padding: '9px 13px', border: '1px solid #BAD4EE', borderRadius: 10, color: '#0466C8', background: '#F5FAFF', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{refreshing ? 'กำลังรีเฟรช…' : 'รีเฟรช'}</button>
      </div>

      <div className={`admin-detail-workspace ${selectedClaim ? 'is-open' : ''}`}>
      <div className="admin-claims" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loadError ? <AdminLoadError message={loadError} onRetry={() => void fetchClaims()} /> : filtered.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#7D8597', fontSize: 13, background: '#fff', borderRadius: 14, border: '1px solid #DDE3EC' }}>
            ไม่พบคำขอในหมวดนี้
          </div>
        ) : filtered.map(c => {
          const st = CLAIM_STATUS_LABEL[c.status];
          const expanded = false;
          return (
            <div className="admin-claim-card" key={c.id} style={{ background: '#fff', borderRadius: 14, border: '1px solid #DDE3EC', padding: 14 }}>
              <div className="admin-claim-row">
                <div className="admin-claim-row-copy">
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#001845' }}>
                    {c.full_name} {!c.victim_confirmed && <span style={{ fontSize: 10, color: '#33415C' }}>(ยังไม่ยืนยันตัวตน)</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#7D8597' }}>
                    {DAMAGE_TYPE_LABEL[c.damage_type ?? ''] ?? 'ยังไม่ระบุประเภท'} · {c.phone} · {new Date(c.created_at).toLocaleDateString('th-TH')}
                  </div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, color: st.color, background: st.bg }}>
                  {st.text}
                </span>
                <button type="button" onClick={() => setSelectedClaim(c)} style={{ padding: '8px 11px', border: '1px solid #BAD4EE', borderRadius: 10, color: '#0466C8', background: '#F5FAFF', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>ดูรายละเอียดคำร้อง</button>
              </div>

              {expanded && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #E8EDF4', fontSize: 12, color: '#33415C', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div>📍 {c.address_details ?? '-'} {c.sub_district} {c.district} {c.province}</div>
                  <div>🪪 เลขบัตร ปชช.: {c.id_card_number ?? 'ยังไม่ได้ยืนยัน'}</div>
                  <div>📅 วันที่เกิดเหตุ: {c.incident_date ? new Date(c.incident_date).toLocaleDateString('th-TH') : '-'}</div>
                  <div>💵 มูลค่าความเสียหาย: {c.damage_value ? `${Number(c.damage_value).toLocaleString('th-TH')} บาท` : 'ไม่ระบุ'}</div>
                  <div>📝 รายละเอียด: {c.description ?? '-'}</div>
                  {c.id_card_image_url && (
                    <a href={c.id_card_image_url} target="_blank" rel="noreferrer" style={{ color: '#0466C8', fontWeight: 700 }}>
                      📎 ดูรูปบัตรประชาชน
                    </a>
                  )}
                  {c.image_urls?.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                      {c.image_urls.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noreferrer">
                          <img src={url} alt={`damage-${i}`} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid #DDE3EC' }} />
                        </a>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 8 }}>
                    <button
                      onClick={() => updateStatus(c.id, 'verified')}
                      disabled={savingId === c.id || !c.victim_confirmed}
                      title={!c.victim_confirmed ? 'ผู้ประสบภัยยังไม่ได้ยืนยันตัวตน' : ''}
                          style={{ padding: 9, borderRadius: 10, border: '1px solid #BAD4EE', background: '#EAF3FC', color: '#0466C8', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: !c.victim_confirmed ? 0.5 : 1 }}
                    >
                      ตรวจสอบแล้ว
                    </button>
                    <button
                      onClick={() => updateStatus(c.id, 'approved')}
                      disabled={savingId === c.id || !c.victim_confirmed}
                          style={{ padding: 9, borderRadius: 10, border: '1px solid #B7CBE0', background: '#E5EFF9', color: '#0353A4', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: !c.victim_confirmed ? 0.5 : 1 }}
                    >
                      ✅ อนุมัติ
                    </button>
                    <button
                      onClick={() => updateStatus(c.id, 'rejected')}
                      disabled={savingId === c.id}
                          style={{ padding: 9, borderRadius: 10, border: '1px solid #C5CBD5', background: '#E8EBF0', color: '#001845', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
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
      {selectedClaim && <ClaimDetailPanel claim={selectedClaim} saving={savingId === selectedClaim.id} onStatusChange={updateStatus} onClose={() => setSelectedClaim(null)} />}
      </div>
    </div>
  );
}

function AdminLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" style={{ display: 'grid', justifyItems: 'center', gap: 10, padding: 30, textAlign: 'center', color: '#6A3D00', background: '#FFF8E8', fontSize: 13 }}>
    <strong>โหลดข้อมูลไม่สำเร็จ</strong><span>{message}</span>
    <button type="button" onClick={onRetry} style={{ padding: '8px 13px', border: '1px solid #D8B16A', borderRadius: 10, color: '#6A3D00', background: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>ลองใหม่</button>
  </div>;
}

function AdminPagination({ page, totalPages, totalCount, onPageChange }: { page: number; totalPages: number; totalCount: number; onPageChange: (page: number) => void }) {
  if (totalPages <= 1) return <div style={{ padding: '11px 2px 0', color: '#7D8597', fontSize: 12 }}>ทั้งหมด {totalCount} รายการ</div>;
  return <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 2px 0', color: '#5C677D', fontSize: 12 }}>
    <span>ทั้งหมด {totalCount} รายการ · หน้า {page} จาก {totalPages}</span>
    <div style={{ display: 'flex', gap: 7 }}>
      <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} style={{ padding: '7px 11px', border: '1px solid #D4E0EC', borderRadius: 9, color: '#0353A4', background: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>ก่อนหน้า</button>
      <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} style={{ padding: '7px 11px', border: '1px solid #D4E0EC', borderRadius: 9, color: '#0353A4', background: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>ถัดไป</button>
    </div>
  </div>;
}

function AdminDetailPanel({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <aside className="admin-detail-panel" aria-label={`รายละเอียด ${title}`}>
      <section style={{ width: '100%', background: '#fff' }}>
        <div style={{ position: 'sticky', zIndex: 1, top: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '26px 30px 20px', borderBottom: '1px solid #E6EDF5', background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(10px)' }}>
          <div><small style={{ display: 'block', color: '#0466C8', fontSize: 11, fontWeight: 800, letterSpacing: '.12em' }}>{eyebrow}</small><h2 style={{ margin: '6px 0 0', color: '#001845', fontSize: 25, letterSpacing: '-0.02em' }}>{title}</h2></div>
          <button type="button" onClick={onClose} aria-label="ปิดรายละเอียด" style={{ width: 36, height: 36, border: '1px solid #DDE3EC', borderRadius: 10, color: '#5C677D', background: '#F8FAFD', fontSize: 24, lineHeight: 1, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'grid', gap: 18, padding: '24px 30px 30px' }}>{children}</div>
      </section>
    </aside>
  );
}

function DetailGrid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>{children}</div>;
}

function DetailItem({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <div style={{ gridColumn: wide ? '1 / -1' : undefined, minHeight: 78, padding: '13px 14px', border: '1px solid #DDE7F1', borderRadius: 13, background: 'linear-gradient(145deg, #FBFCFE, #F5F8FC)' }}><small style={{ display: 'block', color: '#7D8597', fontSize: 11 }}>{label}</small><strong style={{ display: 'block', marginTop: 5, color: '#17355A', fontSize: 14, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{children}</strong></div>;
}

function VictimDetailPanel({ report, onClose, onRetryDispatch, onHandoff }: {
  report: SOSReport;
  onClose: () => void;
  onRetryDispatch: (report: SOSReport) => Promise<void>;
  onHandoff: (report: SOSReport) => Promise<void>;
}) {
  const status = SOS_STATUS_LABEL[report.status] ?? SOS_STATUS_LABEL.pending;
  const totalPeople = (report.adult_count ?? 0) + (report.child_count ?? 0) + (report.elder_count ?? 0);
  const hasCoordinates = report.lat !== null && report.lat !== undefined && report.lng !== null && report.lng !== undefined;
  return <AdminDetailPanel title={report.full_name} eyebrow="SOS REQUEST DETAIL" onClose={onClose}>
    <span style={{ justifySelf: 'start', padding: '5px 10px', borderRadius: 999, color: status.color, background: status.bg, fontSize: 12, fontWeight: 800 }}>{status.text}</span>
    <DetailGrid>
      <DetailItem label="เบอร์โทรศัพท์">{report.phone}</DetailItem>
      <DetailItem label="แจ้งเมื่อ">{formatAdminDateTime(report.created_at)}</DetailItem>
      <DetailItem label="จำนวนผู้ประสบภัย">{totalPeople} คน (ผู้ใหญ่ {report.adult_count ?? 0} · เด็ก {report.child_count ?? 0} · ผู้สูงอายุ {report.elder_count ?? 0})</DetailItem>
      <DetailItem label="ระดับความเร่งด่วน">{report.urgency_level || '-'}</DetailItem>
      <DetailItem label="พื้นที่เสียหาย" wide>{[report.address_details, report.sub_district && `ต.${report.sub_district}`, `อ.${report.district}`, `จ.${report.province}`].filter(Boolean).join(' ')}</DetailItem>
      <DetailItem label="ระดับน้ำโดยประมาณ">{report.water_level != null ? `${report.water_level} เมตร` : 'ไม่ระบุ'}</DetailItem>
      <DetailItem label="สิ่งของที่ต้องการ">{report.needed_items?.length ? report.needed_items.join(', ') : 'ไม่ระบุ'}</DetailItem>
      <DetailItem label="ความต้องการพิเศษ / หมายเหตุ" wide>{report.special_needs || 'ไม่ระบุ'}</DetailItem>
      {hasCoordinates && <DetailItem label="พิกัด GPS" wide><a href={`https://www.google.com/maps?q=${report.lat},${report.lng}`} target="_blank" rel="noreferrer" style={{ color: '#0466C8' }}>{report.lat?.toFixed(6)}, {report.lng?.toFixed(6)} · เปิดแผนที่</a></DetailItem>}
    </DetailGrid>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12, border: '1px solid #D9E5F2', borderRadius: 12, background: '#F7FAFE' }}>
      {(report.status === 'pending' || report.status === 'cannot_reach') && <button type="button" onClick={() => void onRetryDispatch(report)} style={{ padding: '9px 12px', border: '1px solid #8CB8E5', borderRadius: 9, color: '#0353A4', background: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>ค้นหาทีมกู้ภัยตอนนี้</button>}
      {report.status === 'assigned' && <button type="button" onClick={() => void onHandoff(report)} style={{ padding: '9px 12px', border: '1px solid #E8B4A6', borderRadius: 9, color: '#A33A20', background: '#FFF7F4', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>ส่งต่อเคสให้ทีมถัดไป</button>}
      <span style={{ alignSelf: 'center', color: '#5C677D', fontSize: 11 }}>คำสั่งนี้ตรวจสิทธิ์ผู้ดูแลและบันทึกเหตุผลที่ฐานข้อมูล</span>
    </div>
  </AdminDetailPanel>;
}

function ClaimDetailPanel({ claim, saving, onStatusChange, onClose }: { claim: DamageReport; saving: boolean; onStatusChange: (id: string, status: DamageReport['status'], reason?: string) => Promise<void>; onClose: () => void }) {
  const status = CLAIM_STATUS_LABEL[claim.status];
  const [reviewReason, setReviewReason] = useState('');
  const [history, setHistory] = useState<ClaimStatusAudit[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const loadHistory = async () => {
      const { data, error } = await supabase
        .from('operation_audit_logs')
        .select('id, before_data, after_data, created_at, actor:profiles(full_name)')
        .eq('entity_type', 'damage_reports')
        .eq('entity_id', claim.id)
        .order('created_at', { ascending: false });
      if (!active) return;
      if (error) {
        setHistoryError(error.message);
        return;
      }
      setHistory((data ?? []).map((item) => {
        const before = item.before_data as { status?: DamageReport['status'] } | null;
        const after = item.after_data as { status?: DamageReport['status']; reason?: string | null } | null;
        return { id: item.id, old_status: before?.status ?? claim.status, new_status: after?.status ?? claim.status, reason: after?.reason ?? null, created_at: item.created_at, actor: item.actor };
      }) as ClaimStatusAudit[]);
      setHistoryError(null);
    };
    void loadHistory();
    return () => { active = false; };
  }, [claim.id, claim.status]);
  const documentLinks = [
    { label: 'บัตรประชาชน', url: claim.id_card_image_url },
    { label: 'หน้าสมุดบัญชี', url: claim.bank_book_image_url },
    { label: 'สัญญาเช่า / หลักฐานหอพัก', url: claim.rental_agreement_image_url },
    { label: 'สำเนาทะเบียนบ้าน', url: claim.house_registration_image_url },
  ].filter((item): item is { label: string; url: string } => Boolean(item.url));
  return <AdminDetailPanel title={claim.full_name} eyebrow="COMPENSATION CLAIM DETAIL" onClose={onClose}>
    <span style={{ justifySelf: 'start', padding: '5px 10px', borderRadius: 999, color: status.color, background: status.bg, fontSize: 12, fontWeight: 800 }}>{status.text}</span>
    {!claim.victim_confirmed && <div style={{ padding: '11px 13px', borderRadius: 11, color: '#6A3D00', background: '#FFF5DF', fontSize: 12, fontWeight: 700 }}>ผู้ประสบภัยยังไม่ได้ยืนยันข้อมูล จึงยังไม่สามารถตรวจสอบหรืออนุมัติได้</div>}
    <DetailGrid>
      <DetailItem label="เบอร์โทรศัพท์">{claim.phone}</DetailItem>
      <DetailItem label="ยื่นเมื่อ">{formatAdminDateTime(claim.created_at)}</DetailItem>
      <DetailItem label="ประเภทคำร้อง">{DAMAGE_TYPE_LABEL[claim.damage_type ?? ''] ?? claim.claim_category ?? 'ไม่ระบุ'}</DetailItem>
      <DetailItem label="มูลค่าความเสียหาย">{claim.damage_value != null ? `${Number(claim.damage_value).toLocaleString('th-TH')} บาท` : 'ไม่ระบุ'}</DetailItem>
      <DetailItem label="พื้นที่เสียหาย" wide>{[claim.address_details, claim.sub_district && `ต.${claim.sub_district}`, `อ.${claim.district}`, `จ.${claim.province}`].filter(Boolean).join(' ')}</DetailItem>
      <DetailItem label="ช่วงวันที่เสียหาย">{formatAdminDate(claim.incident_date)} – {formatAdminDate(claim.damage_end_date ?? claim.incident_date)}{claim.damage_duration_days ? ` (${claim.damage_duration_days} วัน)` : ''}</DetailItem>
      <DetailItem label="เลขบัตรประชาชน">{claim.id_card_number || 'ยังไม่ได้ระบุ'}</DetailItem>
      <DetailItem label="รายละเอียดความเสียหาย" wide>{claim.description || 'ไม่ระบุ'}</DetailItem>
    </DetailGrid>
    <div style={{ display: 'grid', gap: 8 }}>
      <strong style={{ color: '#243B5A', fontSize: 13 }}>เอกสารและหลักฐาน</strong>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {documentLinks.map((item) => <a key={item.label} href={item.url} target="_blank" rel="noreferrer" style={{ padding: '8px 10px', border: '1px solid #BAD4EE', borderRadius: 9, color: '#0466C8', background: '#F5FAFF', fontSize: 12, fontWeight: 700 }}>{item.label}</a>)}
        {claim.image_urls?.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" style={{ padding: '8px 10px', border: '1px solid #DDE3EC', borderRadius: 9, color: '#33415C', background: '#fff', fontSize: 12, fontWeight: 700 }}>รูปความเสียหาย {index + 1}</a>)}
        {!documentLinks.length && !claim.image_urls?.length && <span style={{ color: '#7D8597', fontSize: 12 }}>ไม่มีไฟล์แนบ</span>}
      </div>
    </div>
    <div style={{ display: 'grid', gap: 8, padding: '14px', border: '1px solid #DDE7F1', borderRadius: 13, background: '#F8FBFE' }}>
      <label htmlFor={`claim-review-reason-${claim.id}`} style={{ color: '#243B5A', fontSize: 13, fontWeight: 800 }}>บันทึกผลการพิจารณา</label>
      <textarea id={`claim-review-reason-${claim.id}`} value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} placeholder="จำเป็นเมื่อไม่อนุมัติ เช่น เอกสารไม่ครบ หรือข้อมูลไม่ตรงกัน" rows={3} style={{ width: '100%', resize: 'vertical', padding: 10, border: '1px solid #C9D8E8', borderRadius: 10, color: '#17355A', background: '#fff', fontFamily: 'inherit', fontSize: 12 }} />
      <small style={{ color: '#7D8597', fontSize: 11 }}>ระบบจะบันทึกผู้ดำเนินการ เวลา สถานะเดิม/ใหม่ และเหตุผลไว้ในประวัติ</small>
    </div>
    <div style={{ display: 'grid', gap: 8 }}>
      <strong style={{ color: '#243B5A', fontSize: 13 }}>ประวัติการพิจารณา</strong>
      {historyError ? <span style={{ color: '#A15900', fontSize: 12 }}>ยังโหลดประวัติไม่ได้: {historyError}</span> : history.length === 0 ? <span style={{ color: '#7D8597', fontSize: 12 }}>ยังไม่มีการพิจารณา</span> : <div style={{ display: 'grid', gap: 8 }}>
        {history.map((item) => <div key={item.id} style={{ padding: '10px 11px', border: '1px solid #E2EAF2', borderRadius: 10, background: '#fff', color: '#33415C', fontSize: 12 }}>
          <strong style={{ color: '#17355A' }}>{CLAIM_STATUS_LABEL[item.old_status]?.text ?? item.old_status} → {CLAIM_STATUS_LABEL[item.new_status]?.text ?? item.new_status}</strong>
          <span style={{ display: 'block', marginTop: 3, color: '#7D8597' }}>{item.actor?.full_name ?? 'ผู้ดูแลระบบ'} · {formatAdminDateTime(item.created_at)}</span>
          {item.reason && <span style={{ display: 'block', marginTop: 4 }}>เหตุผล: {item.reason}</span>}
        </div>)}
      </div>}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, paddingTop: 4 }}>
      <button type="button" onClick={() => void onStatusChange(claim.id, 'verified', reviewReason)} disabled={saving || !claim.victim_confirmed || claim.status !== 'pending'} style={{ minHeight: 42, border: '1px solid #BAD4EE', borderRadius: 10, color: '#0466C8', background: '#EAF3FC', fontSize: 12, fontWeight: 800, cursor: 'pointer', opacity: !claim.victim_confirmed || claim.status !== 'pending' ? .5 : 1 }}>ตรวจสอบแล้ว</button>
      <button type="button" onClick={() => void onStatusChange(claim.id, 'approved', reviewReason)} disabled={saving || !claim.victim_confirmed || claim.status !== 'verified'} style={{ minHeight: 42, border: '1px solid #B7CBE0', borderRadius: 10, color: '#0353A4', background: '#E5EFF9', fontSize: 12, fontWeight: 800, cursor: 'pointer', opacity: !claim.victim_confirmed || claim.status !== 'verified' ? .5 : 1 }}>อนุมัติ</button>
      <button type="button" onClick={() => void onStatusChange(claim.id, 'rejected', reviewReason)} disabled={saving || !reviewReason.trim() || !['pending', 'verified'].includes(claim.status)} style={{ minHeight: 42, border: '1px solid #C5CBD5', borderRadius: 10, color: '#001845', background: '#E8EBF0', fontSize: 12, fontWeight: 800, cursor: 'pointer', opacity: !reviewReason.trim() || !['pending', 'verified'].includes(claim.status) ? .5 : 1 }}>ไม่อนุมัติ</button>
    </div>
  </AdminDetailPanel>;
}

function formatAdminDate(value: string | null | undefined) {
  return value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('th-TH') : '-';
}

function formatAdminDateTime(value: string) {
  return new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}
