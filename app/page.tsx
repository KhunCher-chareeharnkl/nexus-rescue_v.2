'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { PROJECT_NAME } from '@/lib/brand';
import { supabase } from '@/lib/supabase';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Home as HomeIcon,
  LogIn,
  Radio,
  Siren,
  Wallet,
} from 'lucide-react';

type PublicSosReport = {
  id: string;
  full_name: string;
  status: 'pending' | 'assigned' | 'rescued' | 'cannot_reach' | 'closed';
  urgency_level: 'low' | 'medium' | 'high' | 'critical';
  created_at: string;
};

export default function HomePage() {
  const router = useRouter();
  const [reports, setReports] = useState<PublicSosReport[]>([]);
  const [streamState, setStreamState] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [streamError, setStreamError] = useState<string | null>(null);

  const orderedReports = useMemo(() => [...reports].sort((left, right) => {
    const rank = (report: PublicSosReport) => report.status === 'pending' || report.status === 'cannot_reach' ? 0 : report.status === 'assigned' ? 1 : 2;
    const rankDifference = rank(left) - rank(right);
    return rankDifference || new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
  }), [reports]);

  useEffect(() => {
    let active = true;
    const loadReports = async () => {
      const { data, error } = await supabase
        .from('sos_reports')
        .select('id, full_name, status, urgency_level, created_at')
        .order('created_at', { ascending: false })
        .limit(40);
      if (!active) return;
      if (error) {
        setStreamError('ยังโหลดรายการช่วยเหลือไม่ได้');
        return;
      }
      setReports((data as PublicSosReport[]) ?? []);
      setStreamError(null);
    };

    void loadReports();
    const channel = supabase
      .channel('home-sos-stream')
      .on('postgres_changes' as never, { event: '*', schema: 'public', table: 'sos_reports' }, () => { void loadReports(); })
      .subscribe((status) => {
        if (!active) return;
        setStreamState(status === 'SUBSCRIBED' ? 'live' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED' ? 'offline' : 'connecting');
      });
    const fallback = window.setInterval(() => { void loadReports(); }, 20000);

    return () => {
      active = false;
      window.clearInterval(fallback);
      void supabase.removeChannel(channel);
    };
  }, []);

  return (
    <>
      <style>{HOME_STYLES}</style>
      <div className="home-shell">
        <div className="home-glow home-glow-one" aria-hidden="true" />
        <div className="home-glow home-glow-two" aria-hidden="true" />

        <header className="home-header">
          <div className="home-brand">
            <div className="home-brand-mark" aria-hidden="true"><BrandLogo size={44} priority /></div>
            <div>
              <div className="home-brand-name">{PROJECT_NAME}</div>
              <div className="home-brand-subtitle">ช่วยเหลือรวดเร็ว ติดตามสถานะได้ทุกขั้นตอน</div>
            </div>
          </div>

          <button className="home-officer-login" onClick={() => router.push('/officer/login')}>
            <LogIn size={18} strokeWidth={2.2} />
            <span>เข้าสู่ระบบเจ้าหน้าที่</span>
          </button>
        </header>

        <main className="home-main">
          <section className="home-actions" aria-labelledby="home-heading">
            <div className="home-heading-wrap">
              <div className="home-eyebrow"><span /> พร้อมให้บริการตลอด 24 ชั่วโมง</div>
              <h1 id="home-heading">พร้อมช่วยเหลือ<br />ทุกสถานการณ์</h1>
              <p>เลือกบริการที่คุณต้องการ ระบบจะพาคุณไปยังขั้นตอนที่เหมาะสมอย่างรวดเร็ว</p>
            </div>

            <div className="home-role-list">
              <RoleBlock
                onClick={() => router.push('/victim/dashboard')}
                icon={AlertTriangle}
                eyebrow="กรณีฉุกเฉิน"
                title="ต้องการความช่วยเหลือ (SOS)"
                subtitle="แจ้งตำแหน่งและรายละเอียด เพื่อให้เจ้าหน้าที่เข้าช่วยเหลือ"
                tone="primary"
              />
            </div>

            <div className="home-quick-grid">
              <QuickBlock
                onClick={() => router.push('/victim/shelter-list')}
                icon={HomeIcon}
                label="ศูนย์พักพิง"
                description="ค้นหาศูนย์ใกล้คุณ"
                tone="light"
              />
              <QuickBlock
                onClick={() => router.push('/victim/compensation')}
                icon={Wallet}
                label="ยื่นเยียวยา"
                description="ส่งคำขอและเอกสาร"
                tone="medium"
              />
            </div>
          </section>

          <section className="home-response-card" aria-labelledby="response-heading">
            <div className="home-response-orbit home-response-orbit-one" aria-hidden="true" />
            <div className="home-response-orbit home-response-orbit-two" aria-hidden="true" />
            <div className="home-response-head">
              <div>
                <div className="home-response-eyebrow"><Radio size={14} /> LIVE ASSISTANCE STREAM</div>
                <h2 id="response-heading">สถานะผู้ประสบภัย</h2>
                <p>ติดตามคำขอความช่วยเหลือล่าสุดจากระบบ</p>
              </div>
              <span className={`home-stream-state ${streamState}`}><i />{streamState === 'live' ? 'อัปเดตสด' : streamState === 'offline' ? 'กำลังเชื่อมต่อใหม่' : 'กำลังเชื่อมต่อ'}</span>
            </div>

            <div className="home-response-legend" aria-label="คำอธิบายสีสถานะ">
              <span className="safe"><i />ปลอดภัยแล้ว</span><span className="active"><i />กำลังช่วยเหลือ</span><span className="urgent"><i />ต้องติดตามเร่งด่วน</span>
            </div>

            <div className="home-response-scroll" role="log" aria-live="polite" aria-label="รายชื่อผู้ประสบภัยล่าสุด">
              {streamError ? <div className="home-response-empty"><Siren size={22} /><strong>{streamError}</strong><button type="button" onClick={() => window.location.reload()}>ลองใหม่</button></div> : orderedReports.length === 0 ? <div className="home-response-empty"><Clock3 size={22} /><strong>ยังไม่มีคำขอความช่วยเหลือ</strong><span>รายการใหม่จะแสดงที่นี่ทันที</span></div> : orderedReports.map((report) => <PublicResponseItem key={report.id} report={report} />)}
            </div>

            <div className="home-response-foot">
              <span><CheckCircle2 size={15} /> แสดง {orderedReports.length} รายการล่าสุด</span>
              <button onClick={() => router.push('/victim/dashboard')}>ขอความช่วยเหลือ <ArrowUpRight size={15} /></button>
            </div>
          </section>
        </main>
      </div>
    </>
  );
}

function PublicResponseItem({ report }: { report: PublicSosReport }) {
  const meta = getPublicResponseMeta(report);
  return <article className={`home-response-item ${meta.tone}`}>
    <span className="home-response-item-dot" aria-hidden="true" />
    <div className="home-response-item-copy">
      <strong>{report.full_name || 'ผู้แจ้งเหตุ'}</strong>
      <small>{meta.description} · {formatHomeTime(report.created_at)}</small>
    </div>
    <span className="home-response-item-status">{meta.label}</span>
  </article>;
}

function getPublicResponseMeta(report: PublicSosReport) {
  if (report.status === 'rescued' || report.status === 'closed') return { tone: 'safe', label: 'ปลอดภัยแล้ว', description: 'ช่วยเหลือเรียบร้อย' };
  if (report.status === 'assigned') return { tone: 'active', label: 'กำลังช่วยเหลือ', description: 'ทีมกำลังดำเนินการ' };
  if (report.status === 'cannot_reach') return { tone: 'critical', label: 'ต้องติดตาม', description: 'กำลังประสานการเข้าถึง' };
  if (report.urgency_level === 'critical') return { tone: 'critical', label: 'วิกฤต', description: 'รอรับเรื่องด่วน' };
  if (report.urgency_level === 'high') return { tone: 'high', label: 'เร่งด่วน', description: 'รอรับเรื่อง' };
  if (report.urgency_level === 'medium') return { tone: 'medium', label: 'ปานกลาง', description: 'รอรับเรื่อง' };
  return { tone: 'low', label: 'รอรับเรื่อง', description: 'กำลังตรวจสอบข้อมูล' };
}

function formatHomeTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'เมื่อสักครู่' : date.toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function RoleBlock({
  onClick,
  icon: Icon,
  eyebrow,
  title,
  subtitle,
  tone,
}: {
  onClick: () => void;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  subtitle: string;
  tone: 'primary' | 'dark';
}) {
  return (
    <button className={`home-role home-role-${tone}`} onClick={onClick}>
      <span className="home-role-icon"><Icon size={22} strokeWidth={2.2} /></span>
      <span className="home-role-copy">
        <span className="home-role-eyebrow">{eyebrow}</span>
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </span>
      <span className="home-role-arrow"><ArrowUpRight size={17} strokeWidth={2.3} /></span>
    </button>
  );
}

function QuickBlock({
  onClick,
  icon: Icon,
  label,
  description,
  tone,
}: {
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  description: string;
  tone: 'light' | 'medium';
}) {
  return (
    <button className={`home-quick home-quick-${tone}`} onClick={onClick}>
      <span className="home-quick-icon"><Icon size={20} strokeWidth={2.2} /></span>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <ArrowUpRight className="home-quick-arrow" size={16} strokeWidth={2.2} />
    </button>
  );
}

const HOME_STYLES = `
  @keyframes home-enter {
    from { opacity:0; transform:translateY(10px); }
    to { opacity:1; transform:translateY(0); }
  }
  @keyframes home-pulse {
    0%,100% { box-shadow:0 0 0 0 rgba(4,102,200,.26); }
    50% { box-shadow:0 0 0 6px rgba(4,102,200,0); }
  }
  @keyframes home-spin { to { transform:rotate(360deg); } }
  .home-shell {
    --blue:#0466C8;
    --blue-strong:#0353A4;
    --blue-deep:#023E7D;
    --navy:#002855;
    --ink:#001845;
    --midnight:#001233;
    --slate:#33415C;
    --muted:#7D8597;
    --line:#DCE3EC;
    position:relative;
    isolation:isolate;
    min-height:100vh;
    min-height:100dvh;
    overflow:hidden;
    padding:0 24px max(40px, env(safe-area-inset-bottom));
    color:var(--ink);
    background:linear-gradient(145deg,#F9FBFE 0%,#F3F7FC 52%,#EAF1F9 100%);
    font-family:var(--font-thai),'IBM Plex Sans Thai',sans-serif;
  }
  .home-glow { position:absolute; z-index:-1; border-radius:50%; pointer-events:none; filter:blur(2px); }
  .home-glow-one { width:440px; height:440px; right:-190px; top:-210px; background:rgba(4,102,200,.08); }
  .home-glow-two { width:300px; height:300px; left:-180px; bottom:20px; border:55px solid rgba(151,157,172,.08); }
  .home-header {
    width:min(100%,1120px);
    min-height:90px;
    display:flex;
    align-items:center;
    justify-content:space-between;
    margin:0 auto;
  }
  .home-brand { min-width:0; display:flex; align-items:center; gap:12px; }
  .home-brand-mark {
    width:44px;
    height:44px;
    overflow:hidden;
    border-radius:15px;
    background:#061f58;
    box-shadow:0 9px 24px rgba(4,102,200,.2);
  }
  .home-brand-name { max-width:390px; font-size:15px; line-height:1.3; font-weight:800; letter-spacing:-.02em; }
  .home-brand-subtitle { margin-top:3px; color:var(--muted); font-size:10px; font-weight:500; letter-spacing:.04em; }
  .home-notification {
    position:relative;
    width:42px;
    height:42px;
    display:grid;
    place-items:center;
    border:1px solid var(--line);
    border-radius:14px;
    color:var(--slate);
    background:rgba(255,255,255,.82);
    box-shadow:0 7px 20px rgba(0,24,69,.05);
    cursor:pointer;
    transition:.2s ease;
  }
  .home-notification:hover { color:var(--blue); border-color:#B9CCE1; transform:translateY(-2px); box-shadow:0 10px 24px rgba(0,24,69,.08); }
  .home-notification span { position:absolute; width:7px; height:7px; right:7px; top:7px; border:2px solid #fff; border-radius:50%; background:var(--blue); }
  .home-main {
    width:min(100%,1120px);
    display:grid;
    grid-template-columns:minmax(0,.95fr) minmax(420px,1.05fr);
    gap:34px;
    align-items:center;
    margin:26px auto 0;
  }
  .home-actions { min-width:0; animation:home-enter .45s ease both; }
  .home-heading-wrap { margin-bottom:24px; }
  .home-eyebrow { display:flex; align-items:center; gap:8px; color:var(--blue); font-size:10px; font-weight:750; letter-spacing:.08em; }
  .home-eyebrow > span { width:7px; height:7px; border-radius:50%; background:var(--blue); animation:home-pulse 2s ease infinite; }
  .home-heading-wrap h1 { margin:11px 0 10px; color:var(--ink); font-size:clamp(34px,4.4vw,52px); font-weight:750; line-height:1.06; letter-spacing:-.045em; }
  .home-heading-wrap p { max-width:480px; margin:0; color:var(--muted); font-size:12px; line-height:1.7; }
  .home-role-list { display:grid; gap:11px; }
  .home-role {
    position:relative;
    width:100%;
    min-height:92px;
    display:grid;
    grid-template-columns:48px minmax(0,1fr) 36px;
    align-items:center;
    gap:14px;
    padding:16px 17px;
    overflow:hidden;
    border:0;
    border-radius:21px;
    color:#fff;
    text-align:left;
    cursor:pointer;
    transition:transform .2s ease,box-shadow .2s ease,filter .2s ease;
  }
  .home-role::after { content:''; position:absolute; width:150px; height:150px; right:-100px; bottom:-115px; border:22px solid rgba(255,255,255,.08); border-radius:50%; }
  .home-role:hover { transform:translateY(-3px); filter:saturate(1.04); }
  .home-role:active { transform:scale(.988); }
  .home-role-primary { background:linear-gradient(135deg,var(--blue),var(--blue-strong)); box-shadow:0 13px 28px rgba(4,102,200,.2); }
  .home-role-dark { background:linear-gradient(135deg,var(--navy),var(--midnight)); box-shadow:0 13px 28px rgba(0,24,69,.18); }
  .home-role-icon,.home-role-arrow {
    display:grid;
    place-items:center;
    border:1px solid rgba(255,255,255,.18);
    background:rgba(255,255,255,.12);
    backdrop-filter:blur(4px);
  }
  .home-role-icon { width:48px; height:48px; border-radius:16px; }
  .home-role-arrow { position:relative; z-index:1; width:34px; height:34px; border-radius:12px; transition:transform .2s ease,background .2s ease; }
  .home-role:hover .home-role-arrow { transform:translate(2px,-2px); background:rgba(255,255,255,.2); }
  .home-role-copy { min-width:0; display:block; }
  .home-role-eyebrow { display:block; margin-bottom:2px; color:rgba(255,255,255,.6); font-size:9px; font-weight:650; letter-spacing:.05em; }
  .home-role-copy strong { display:block; font-size:15px; font-weight:750; line-height:1.4; }
  .home-role-copy small { display:block; margin-top:2px; color:rgba(255,255,255,.66); font-size:10px; font-weight:400; line-height:1.5; }
  .home-quick-grid { display:grid; grid-template-columns:1fr 1fr; gap:11px; margin-top:11px; }
  .home-quick {
    position:relative;
    min-height:92px;
    display:grid;
    grid-template-columns:40px 1fr;
    align-items:center;
    gap:11px;
    padding:15px;
    border:1px solid rgba(0,24,69,.08);
    border-radius:20px;
    text-align:left;
    cursor:pointer;
    box-shadow:0 8px 22px rgba(0,24,69,.055);
    transition:.2s ease;
  }
  .home-quick:hover { transform:translateY(-3px); box-shadow:0 13px 28px rgba(0,24,69,.09); }
  .home-quick:active { transform:scale(.985); }
  .home-quick-light { color:var(--blue-deep); background:#E8F2FC; }
  .home-quick-medium { color:#fff; background:linear-gradient(135deg,#33415C,#002855); }
  .home-quick-icon { width:40px; height:40px; display:grid; place-items:center; border-radius:13px; background:rgba(255,255,255,.72); color:var(--blue-deep); }
  .home-quick strong { display:block; font-size:12px; font-weight:750; }
  .home-quick small { display:block; margin-top:2px; color:currentColor; opacity:.62; font-size:9px; }
  .home-quick-arrow { position:absolute; top:12px; right:12px; opacity:.45; }
  .home-officer-login { min-height:43px; display:inline-flex; align-items:center; gap:8px; padding:0 14px; border:1px solid #BFD3E6; border-radius:13px; color:var(--blue-deep); background:rgba(255,255,255,.88); box-shadow:0 7px 20px rgba(0,24,69,.05); font-family:inherit; font-size:12px; font-weight:750; cursor:pointer; transition:.2s ease; }
  .home-officer-login:hover { border-color:var(--blue); color:#fff; background:var(--blue); transform:translateY(-2px); box-shadow:0 11px 24px rgba(4,102,200,.18); }
  .home-response-card { position:relative; min-width:0; overflow:hidden; padding:20px; border:1px solid rgba(51,65,92,.12); border-radius:28px; background:rgba(255,255,255,.72); box-shadow:0 20px 50px rgba(0,24,69,.1); backdrop-filter:blur(20px) saturate(1.08); animation:home-enter .45s .08s ease both; }
  .home-response-card::before { content:''; position:absolute; inset:0; pointer-events:none; opacity:.42; background-image:radial-gradient(circle at 14% 16%,rgba(20,156,112,.28) 0 3px,transparent 4px),radial-gradient(circle at 80% 24%,rgba(4,102,200,.18) 0 4px,transparent 5px),radial-gradient(circle at 68% 76%,rgba(234,170,8,.18) 0 3px,transparent 4px); background-size:86px 95px,122px 105px,108px 116px; }
  .home-response-orbit { position:absolute; z-index:0; width:230px; height:230px; border:1px solid rgba(4,102,200,.11); border-radius:50%; pointer-events:none; }
  .home-response-orbit-one { right:-116px; top:-130px; }.home-response-orbit-two { left:-145px; bottom:-156px; width:275px; height:275px; border-color:rgba(20,156,112,.1); }
  .home-response-head,.home-response-legend,.home-response-scroll,.home-response-foot { position:relative; z-index:1; }
  .home-response-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:2px 3px 15px; }
  .home-response-eyebrow { display:flex; align-items:center; gap:7px; color:var(--blue); font-size:10px; font-weight:800; letter-spacing:.1em; }
  .home-response-head h2 { margin:5px 0 2px; color:var(--ink); font-size:23px; font-weight:800; letter-spacing:-.035em; }
  .home-response-head p { margin:0; color:var(--muted); font-size:12px; }
  .home-stream-state { display:inline-flex; align-items:center; gap:7px; flex:0 0 auto; padding:7px 10px; border:1px solid #C6D7E8; border-radius:999px; color:var(--blue-strong); background:rgba(237,245,252,.82); font-size:11px; font-weight:750; }
  .home-stream-state i { width:7px; height:7px; border-radius:50%; background:#52A475; box-shadow:0 0 0 4px rgba(82,164,117,.13); animation:home-pulse 2s ease infinite; }.home-stream-state.offline i { background:#E18A25; box-shadow:0 0 0 4px rgba(225,138,37,.13); }.home-stream-state.connecting i { background:#7D8597; box-shadow:none; }
  .home-response-legend { display:flex; flex-wrap:wrap; gap:7px; padding:10px 11px; border:1px solid rgba(51,65,92,.1); border-radius:13px; background:rgba(255,255,255,.48); color:#5C677D; font-size:10px; font-weight:700; }
  .home-response-legend span { display:flex; align-items:center; gap:5px; }.home-response-legend i { width:7px; height:7px; border-radius:50%; background:#EAAA08; }.home-response-legend .safe i { background:#2B9B66; }.home-response-legend .active i { background:#0466C8; }.home-response-legend .urgent i { background:#D92D20; }
  .home-response-scroll { height:288px; display:grid; align-content:start; gap:8px; margin-top:12px; padding:3px 4px 4px; overflow-y:auto; overscroll-behavior:contain; scrollbar-color:rgba(4,102,200,.35) transparent; scrollbar-width:thin; }
  .home-response-item { display:grid; grid-template-columns:10px minmax(0,1fr) auto; align-items:center; gap:10px; min-height:61px; padding:10px 11px; border:1px solid rgba(51,65,92,.1); border-radius:15px; background:rgba(255,255,255,.7); box-shadow:0 5px 14px rgba(0,24,69,.035); transition:.2s ease; }
  .home-response-item:hover { transform:translateX(2px); background:rgba(255,255,255,.9); box-shadow:0 9px 20px rgba(0,24,69,.07); }.home-response-item-dot { width:8px; height:8px; border-radius:50%; background:#EAAA08; box-shadow:0 0 0 5px rgba(234,170,8,.11); }.home-response-item.safe .home-response-item-dot { background:#2B9B66; box-shadow:0 0 0 5px rgba(43,155,102,.11); }.home-response-item.active .home-response-item-dot { background:#0466C8; box-shadow:0 0 0 5px rgba(4,102,200,.1); }.home-response-item.high .home-response-item-dot,.home-response-item.critical .home-response-item-dot { background:#D92D20; box-shadow:0 0 0 5px rgba(217,45,32,.1); }
  .home-response-item-copy { min-width:0; }.home-response-item-copy strong,.home-response-item-copy small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.home-response-item-copy strong { color:#17355A; font-size:13px; font-weight:800; }.home-response-item-copy small { margin-top:2px; color:#7D8597; font-size:10px; }.home-response-item-status { padding:5px 8px; border-radius:999px; color:#A66C00; background:rgba(255,242,204,.82); font-size:10px; font-weight:800; white-space:nowrap; }.home-response-item.safe .home-response-item-status { color:#19744B; background:rgba(225,246,235,.84); }.home-response-item.active .home-response-item-status { color:#0353A4; background:rgba(229,239,249,.9); }.home-response-item.high .home-response-item-status,.home-response-item.critical .home-response-item-status { color:#B42318; background:rgba(255,234,232,.9); }
  .home-response-empty { min-height:100%; display:grid; place-items:center; align-content:center; justify-items:center; gap:8px; padding:24px; color:#7D8597; text-align:center; font-size:12px; }.home-response-empty strong { color:#33415C; font-size:14px; }.home-response-empty button { padding:7px 11px; border:1px solid #BAD4EE; border-radius:9px; color:#0466C8; background:#fff; font:inherit; font-size:11px; font-weight:750; cursor:pointer; }
  .home-response-foot { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:13px 3px 0; color:var(--muted); font-size:11px; }.home-response-foot span,.home-response-foot button { display:flex; align-items:center; gap:6px; }.home-response-foot button { min-height:38px; padding:0; border:0; color:var(--blue); background:transparent; font-family:inherit; font-size:12px; font-weight:800; cursor:pointer; }
  /* Readable public-facing type scale */
  .home-brand-name { font-size:18px; }
  .home-brand-subtitle { font-size:13px; }
  .home-eyebrow { font-size:13px; }
  .home-heading-wrap p { font-size:16px; line-height:1.65; }
  .home-role-eyebrow { font-size:12px; }
  .home-role-copy strong { font-size:18px; }
  .home-role-copy small { margin-top:4px; font-size:14px; line-height:1.5; }
  .home-quick strong { font-size:16px; }
  .home-quick small { margin-top:3px; font-size:13px; }
  .home-response-eyebrow { font-size:12px; }
  .home-response-head h2 { font-size:24px; }
  @media(max-width:900px) {
    .home-main { grid-template-columns:1fr; max-width:620px; margin-top:12px; }
    .home-header { max-width:620px; }
    .home-response-scroll { height:330px; }
  }
  @media(max-width:560px) {
    .home-shell { padding:0 15px max(32px, calc(16px + env(safe-area-inset-bottom))); }
    .home-header { min-height:78px; }
    .home-brand-mark { width:40px; height:40px; flex:0 0 40px; border-radius:13px; }
    .home-brand-name { max-width:245px; font-size:15px; line-height:1.35; }
    .home-brand-subtitle { display:none; }
    .home-main { gap:18px; margin-top:14px; }
    .home-heading-wrap { margin-bottom:18px; }
    .home-heading-wrap h1 { margin-top:9px; font-size:38px; }
    .home-heading-wrap p { font-size:16px; }
    .home-role { grid-template-columns:44px minmax(0,1fr) 32px; gap:11px; min-height:88px; padding:14px; border-radius:19px; }
    .home-role-icon { width:44px; height:44px; border-radius:14px; }
    .home-role-arrow { width:31px; height:31px; }
    .home-role-copy strong { font-size:17px; }
    .home-role-copy small { font-size:14px; }
    .home-quick-grid { grid-template-columns:1fr 1fr; }
    .home-quick { grid-template-columns:1fr; align-content:center; justify-items:center; gap:8px; min-height:114px; text-align:center; }
    .home-officer-login { min-height:40px; padding:0 11px; font-size:11px; }
    .home-response-card { padding:14px; border-radius:23px; }
    .home-response-head { gap:10px; }.home-response-head h2 { font-size:22px; }.home-response-head p { font-size:11px; }.home-stream-state { padding:6px 8px; font-size:10px; }
    .home-response-scroll { height:310px; }.home-response-foot { font-size:10px; }.home-response-foot button { min-height:35px; font-size:11px; }
  }
  @media(max-width:360px) {
    .home-role-copy small { display:none; }
  }
  @media(prefers-reduced-motion:reduce) {
    .home-actions,.home-response-card,.home-eyebrow > span,.home-stream-state i { animation:none; }
    .home-role,.home-quick,.home-officer-login,.home-response-item { transition:none; }
  }
`;
