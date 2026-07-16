'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { PROJECT_NAME } from '@/lib/brand';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Home as HomeIcon,
  Radio,
  ShieldCheck,
  Truck,
  User,
  Wallet,
} from 'lucide-react';

const MapComponent = dynamic(() => import('@/components/Map'), {
  ssr: false,
  loading: () => (
    <div className="home-map-loading" role="status" aria-label="กำลังโหลดแผนที่">
      <span className="home-map-loading-ring" aria-hidden="true" />
      <span>กำลังโหลดแผนที่...</span>
    </div>
  ),
});

const NAV_ITEMS = [
  { key: 'sos', label: 'SOS', icon: AlertTriangle, href: '/victim/dashboard' },
  { key: 'status', label: 'สถานะ', icon: Activity, href: '/victim/dashboard?tab=status' },
  { key: 'compensation', label: 'เยียวยา', icon: Wallet, href: '/victim/compensation' },
  { key: 'profile', label: 'ข้อมูลฉัน', icon: User, href: '/victim/profile' },
] as const;

export default function HomePage() {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <>
      <style>{HOME_STYLES}</style>
      <div className="home-shell">
        <div className="home-glow home-glow-one" aria-hidden="true" />
        <div className="home-glow home-glow-two" aria-hidden="true" />

        <header className="home-header">
          <div className="home-brand">
            <div className="home-brand-mark" aria-hidden="true">
              <ShieldCheck size={21} strokeWidth={2.2} />
            </div>
            <div>
              <div className="home-brand-name">{PROJECT_NAME}</div>
              <div className="home-brand-subtitle">ช่วยเหลือรวดเร็ว ติดตามสถานะได้ทุกขั้นตอน</div>
            </div>
          </div>

          <button className="home-notification" aria-label="การแจ้งเตือน">
            <Bell size={18} strokeWidth={2} />
            <span aria-hidden="true" />
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
              <RoleBlock
                onClick={() => router.push('/officer/dashboard')}
                icon={Truck}
                eyebrow="สำหรับหน่วยงาน"
                title="เจ้าหน้าที่กู้ภัย / หน่วยงาน"
                subtitle="เข้าสู่ระบบเพื่อรับเคสและอัปเดตสถานะการช่วยเหลือ"
                tone="dark"
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

          <section className="home-map-card" aria-labelledby="map-heading">
            <div className="home-map-head">
              <div>
                <div className="home-map-eyebrow"><Radio size={13} /> LIVE RESPONSE MAP</div>
                <h2 id="map-heading">สถานการณ์ในพื้นที่</h2>
              </div>
              <span className="home-online"><span /> ออนไลน์</span>
            </div>
            <div className="home-map-frame">
              <MapComponent />
            </div>
            <div className="home-map-foot">
              <span>ข้อมูลเหตุการณ์อัปเดตแบบ Real-time</span>
              <button onClick={() => router.push('/victim/dashboard')}>
                ดูรายละเอียด <ArrowUpRight size={14} />
              </button>
            </div>
          </section>
        </main>

        <nav className="home-bottom-nav" aria-label="เมนูบริการหลัก">
          {NAV_ITEMS.map(({ key, label, icon: Icon, href }) => {
            const active = pathname === href.split('?')[0];
            return (
              <button
                key={key}
                className={active ? 'active' : ''}
                onClick={() => router.push(href)}
                aria-current={active ? 'page' : undefined}
              >
                <span className="home-nav-icon"><Icon size={18} strokeWidth={2.2} /></span>
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </>
  );
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
    overflow:hidden;
    padding:0 24px 116px;
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
    display:grid;
    place-items:center;
    border-radius:15px;
    color:#fff;
    background:linear-gradient(145deg,var(--blue),var(--blue-deep));
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
  .home-map-card {
    min-width:0;
    padding:18px;
    border:1px solid rgba(51,65,92,.12);
    border-radius:28px;
    background:rgba(255,255,255,.88);
    box-shadow:0 20px 50px rgba(0,24,69,.1);
    backdrop-filter:blur(12px);
    animation:home-enter .45s .08s ease both;
  }
  .home-map-head { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:2px 3px 14px; }
  .home-map-eyebrow { display:flex; align-items:center; gap:6px; color:var(--blue); font-size:9px; font-weight:750; letter-spacing:.1em; }
  .home-map-head h2 { margin:4px 0 0; color:var(--ink); font-size:16px; font-weight:750; letter-spacing:-.02em; }
  .home-online { display:flex; align-items:center; gap:7px; padding:7px 10px; border:1px solid #C6D7E8; border-radius:999px; color:var(--blue-strong); background:#EDF5FC; font-size:9px; font-weight:750; }
  .home-online > span { width:6px; height:6px; border-radius:50%; background:var(--blue); animation:home-pulse 2s ease infinite; }
  .home-map-frame { position:relative; z-index:0; height:390px; overflow:hidden; border:1px solid var(--line); border-radius:20px; background:#EEF3F8; }
  .home-map-loading { height:100%; display:grid; place-items:center; align-content:center; gap:10px; color:var(--muted); font-size:10px; font-weight:600; }
  .home-map-loading-ring { width:24px; height:24px; border:2px solid #C9D6E4; border-top-color:var(--blue); border-radius:50%; animation:home-spin .8s linear infinite; }
  .home-map-foot { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:13px 3px 0; color:var(--muted); font-size:9px; }
  .home-map-foot button { display:flex; align-items:center; gap:5px; border:0; color:var(--blue); background:transparent; font-family:inherit; font-size:10px; font-weight:700; cursor:pointer; }
  .home-bottom-nav {
    position:fixed;
    z-index:50;
    left:50%;
    bottom:22px;
    width:min(calc(100% - 32px),390px);
    display:grid;
    grid-template-columns:repeat(4,1fr);
    gap:4px;
    padding:8px;
    border:1px solid rgba(255,255,255,.1);
    border-radius:24px;
    background:rgba(0,24,69,.94);
    box-shadow:0 18px 40px rgba(0,18,51,.22);
    backdrop-filter:blur(16px);
    transform:translateX(-50%);
  }
  .home-bottom-nav button { display:grid; place-items:center; gap:2px; padding:4px 3px; border:0; border-radius:17px; color:rgba(255,255,255,.5); background:transparent; font-family:inherit; font-size:9px; font-weight:650; cursor:pointer; transition:.2s ease; }
  .home-bottom-nav button:hover,.home-bottom-nav button.active { color:#fff; background:rgba(255,255,255,.09); }
  .home-nav-icon { width:34px; height:30px; display:grid; place-items:center; border-radius:11px; transition:.2s ease; }
  .home-bottom-nav button.active .home-nav-icon { color:#fff; background:var(--blue); box-shadow:0 6px 14px rgba(4,102,200,.3); }
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
  .home-map-eyebrow { font-size:12px; }
  .home-map-head h2 { font-size:20px; }
  .home-online { font-size:12px; }
  .home-map-loading { font-size:14px; }
  .home-map-foot { font-size:12px; }
  .home-map-foot button { min-height:40px; font-size:13px; }
  .home-bottom-nav button { min-height:62px; font-size:12px; }
  @media(max-width:900px) {
    .home-main { grid-template-columns:1fr; max-width:620px; margin-top:12px; }
    .home-header { max-width:620px; }
    .home-map-frame { height:360px; }
  }
  @media(max-width:560px) {
    .home-shell { padding:0 15px 108px; }
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
    .home-map-card { padding:13px; border-radius:23px; }
    .home-map-frame { height:310px; border-radius:17px; }
    .home-map-foot > span { display:none; }
    .home-map-foot { justify-content:flex-end; }
  }
  @media(max-width:360px) {
    .home-role-copy small { display:none; }
    .home-bottom-nav { bottom:12px; width:calc(100% - 20px); }
  }
  @media(prefers-reduced-motion:reduce) {
    .home-actions,.home-map-card,.home-map-loading-ring,.home-eyebrow > span,.home-online > span { animation:none; }
    .home-role,.home-quick,.home-notification { transition:none; }
  }
`;
