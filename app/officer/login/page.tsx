'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { BrandLogo } from '@/components/brand-logo';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Check,
  ChevronDown,
  ChevronRight,
  KeyRound,
  LockKeyhole,
  Mail,
  Search,
  Siren,
  UserCog,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PROJECT_NAME } from '@/lib/brand';

type Role = 'rescuer' | 'shelter_staff' | 'admin';
type Step = 'role' | 'details';

type Shelter = {
  id: string;
  name: string;
};

const ROLE_META = {
  rescuer: {
    label: 'เจ้าหน้าที่กู้ภัย',
    description: 'รับคำร้อง SOS และจัดการภารกิจช่วยเหลือ',
    icon: Siren,
  },
  shelter_staff: {
    label: 'เจ้าหน้าที่ศูนย์พักพิง',
    description: 'ดูแลผู้เข้าพักและข้อมูลของศูนย์พักพิง',
    icon: Building2,
  },
  admin: {
    label: 'ผู้ดูแลระบบ',
    description: 'จัดการสิทธิ์และภาพรวมของแพลตฟอร์ม',
    icon: UserCog,
  },
} as const;

export default function OfficerLogin() {
  const [step, setStep] = useState<Step>('role');
  const [role, setRole] = useState<Role | null>(null);
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [shelterId, setShelterId] = useState('');
  const [sheltersLoading, setSheltersLoading] = useState(false);
  const [shelterMenuOpen, setShelterMenuOpen] = useState(false);
  const [shelterSearch, setShelterSearch] = useState('');
  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const getRedirectUrl = () => {
    const url = process?.env?.NEXT_PUBLIC_SITE_URL
      ?? (typeof window !== 'undefined' ? window.location.origin : '');
    return url.replace(/\/+$/, '');
  };

  const getMagicLinkCallbackUrl = () => {
    const callbackUrl = new URL('/auth/complete', getRedirectUrl());
    callbackUrl.searchParams.set('next', '/officer/dashboard');
    return callbackUrl.toString();
  };

  useEffect(() => {
    if (role !== 'shelter_staff') return;
    let cancelled = false;

    const fetchShelters = async () => {
      setSheltersLoading(true);
      const { data, error } = await supabase
        .from('shelters')
        .select('id, name')
        .order('name', { ascending: true });

      if (!cancelled) {
        if (!error && data) setShelters(data as Shelter[]);
        setSheltersLoading(false);
      }
    };

    fetchShelters();
    return () => { cancelled = true; };
  }, [role]);

  const handleSelectRole = (selectedRole: Role) => {
    setRole(selectedRole);
    setMessage(null);
    setEmailOtp('');
    setOtpSent(false);
    setStep('details');
  };

  const handleBack = () => {
    setStep('role');
    setRole(null);
    setShelterId('');
    setShelterMenuOpen(false);
    setShelterSearch('');
    setCode('');
    setFullName('');
    setMessage(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!role) return;

    if (!fullName.trim()) {
      setMessage({ type: 'error', text: 'กรุณาระบุชื่อ-นามสกุลผู้ปฏิบัติงาน' });
      return;
    }

    if (role === 'shelter_staff' && !shelterId) {
      setMessage({ type: 'error', text: 'กรุณาเลือกศูนย์พักพิงที่ดูแล' });
      return;
    }

    setLoading(true);
    setMessage(null);

    if (role === 'admin') {
      const response = await fetch('/api/auth/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        setLoading(false);
        setMessage({ type: 'error', text: result.error || 'ไม่สามารถตรวจสอบสิทธิ์ผู้ดูแลระบบได้' });
        return;
      }
    }

    if (role !== 'admin') {
      const { error: redeemError } = await supabase.rpc('redeem_access_code', {
        p_email: email,
        p_code: code,
        p_role: role,
        p_shelter_id: role === 'shelter_staff' ? shelterId : null,
      });

      if (redeemError) {
        setLoading(false);
        setMessage({ type: 'error', text: redeemError.message });
        return;
      }
    }

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: getMagicLinkCallbackUrl(),
        data: { full_name: fullName.trim() },
      },
    });

    setLoading(false);
    if (otpError) {
      setMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${otpError.message}` });
    } else {
      setOtpSent(true);
      setMessage({
        type: 'success',
        text: 'ส่งลิงก์เข้าสู่ระบบไปยังอีเมลแล้ว หากลิงก์เปิดไม่ได้ ให้ใช้รหัส 6 หลักจากอีเมลด้านล่างแทน',
      });
    }
  };

  const handleVerifyEmailCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!emailOtp.trim() || !email.trim()) return;
    setLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: emailOtp.trim(),
      type: 'email',
    });
    if (error) {
      setLoading(false);
      setMessage({ type: 'error', text: `ยืนยันรหัสไม่สำเร็จ: ${error.message}` });
      return;
    }
    const sessionResponse = await fetch('/auth/session', { method: 'POST', credentials: 'same-origin' });
    setLoading(false);
    if (!sessionResponse.ok) {
      setMessage({ type: 'error', text: 'ยืนยันรหัสแล้ว แต่ยังสร้างเซสชันไม่ได้ กรุณาลองใหม่' });
      return;
    }
    window.location.replace('/officer/dashboard');
  };

  const selectedRole = role ? ROLE_META[role] : null;
  const selectedShelter = shelters.find((shelter) => shelter.id === shelterId);
  const visibleShelters = shelters.filter((shelter) =>
    shelter.name.toLocaleLowerCase('th-TH').includes(shelterSearch.trim().toLocaleLowerCase('th-TH')),
  );

  return (
    <>
      <style>{LOGIN_STYLES}</style>
      <main className="login-page bg-white">
        <button className="login-home" type="button" onClick={() => window.location.assign('/')}>
          <ArrowLeft size={17} /> หน้าหลัก
        </button>

        <section className="login-shell">
          <div className="login-visual">
            <div className="login-visual-brand">
              <span><BrandLogo size={36} priority /></span>
              <strong>{PROJECT_NAME}</strong>
            </div>

            <div className="login-illustration-wrap">
              <span className="login-orbit orbit-one" aria-hidden="true" />
              <span className="login-orbit orbit-two" aria-hidden="true" />
              <Image
                className="login-illustration"
                src="/images/rescue-login-illustration.png"
                alt="ทีมกู้ภัยกำลังช่วยผู้ประสบภัยขึ้นเรือในพื้นที่น้ำท่วม"
                width={1536}
                height={1024}
                sizes="(max-width: 760px) 92vw, 56vw"
                preload
              />
            </div>

            <div className="login-visual-copy">
              <span>RESCUE OPERATIONS</span>
              <h1>ทุกภารกิจ เริ่มต้นจาก<br />การประสานงานที่ดี</h1>
              <p>เข้าสู่ระบบเพื่อรับคำร้อง ติดตามสถานการณ์ และส่งต่อความช่วยเหลือให้ผู้ประสบภัยอย่างรวดเร็ว</p>
            </div>

            <div className="login-visual-progress" aria-hidden="true">
              <i className="active" /><i /><i />
            </div>
          </div>

          <div className="login-panel">
            <div className="login-panel-inner">
              <div className="login-heading">
                <span className="login-step-label">{step === 'role' ? 'WELCOME BACK' : 'SECURE SIGN IN'}</span>
                <h2>{step === 'role' ? 'เข้าสู่ระบบเจ้าหน้าที่' : 'รับลิงก์เข้าสู่ระบบ'}</h2>
                <p>{step === 'role' ? 'เลือกหน้าที่ของคุณเพื่อดำเนินการต่อ' : 'ยืนยันข้อมูลและรับ Magic Link ผ่านอีเมล'}</p>
              </div>

              {step === 'role' && (
                <div className="login-role-list">
                  {(['rescuer', 'shelter_staff'] as const).map((roleKey) => {
                    const item = ROLE_META[roleKey];
                    const Icon = item.icon;
                    return (
                      <button type="button" className="login-role" onClick={() => handleSelectRole(roleKey)} key={roleKey}>
                        <span className="login-role-icon"><Icon size={21} strokeWidth={2} /></span>
                        <span className="login-role-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
                        <ChevronRight size={18} />
                      </button>
                    );
                  })}

                  <button type="button" className="login-admin-link" onClick={() => handleSelectRole('admin')}>
                    <UserCog size={15} /> เข้าสู่ระบบสำหรับผู้ดูแลระบบ
                  </button>
                </div>
              )}

              {step === 'details' && role && selectedRole && (
                <form className="login-form" onSubmit={handleSubmit}>
                  <button type="button" className="login-back" onClick={handleBack}>
                    <ArrowLeft size={15} /> เปลี่ยนบทบาท
                  </button>

                  <div className="login-selected-role">
                    <span><selectedRole.icon size={19} /></span>
                    <div><strong>{selectedRole.label}</strong><small>{selectedRole.description}</small></div>
                  </div>

                  {role === 'shelter_staff' && (
                    <div className="login-field">
                      <span>ศูนย์พักพิงที่ดูแล</span>
                      <div className={`shelter-picker ${shelterMenuOpen ? 'open' : ''}`} onKeyDown={(event) => { if (event.key === 'Escape') setShelterMenuOpen(false); }}>
                        <button
                          className="shelter-picker-trigger"
                          type="button"
                          disabled={sheltersLoading}
                          aria-haspopup="listbox"
                          aria-expanded={shelterMenuOpen}
                          onClick={() => setShelterMenuOpen((current) => !current)}
                        >
                          <Building2 size={17} />
                          <span>{sheltersLoading ? 'กำลังโหลดรายชื่อศูนย์...' : selectedShelter?.name || 'เลือกศูนย์พักพิง'}</span>
                          <ChevronDown size={16} />
                        </button>

                        {shelterMenuOpen && !sheltersLoading && (
                          <div className="shelter-picker-menu">
                            <label className="shelter-picker-search">
                              <Search size={15} />
                              <input value={shelterSearch} onChange={(event) => setShelterSearch(event.target.value)} placeholder="ค้นหาชื่อศูนย์" autoFocus />
                            </label>
                            <div className="shelter-picker-options" role="listbox" aria-label="รายชื่อศูนย์พักพิง">
                              {visibleShelters.length ? visibleShelters.map((shelter) => (
                                <button
                                  className={shelter.id === shelterId ? 'selected' : ''}
                                  type="button"
                                  role="option"
                                  aria-selected={shelter.id === shelterId}
                                  key={shelter.id}
                                  onClick={() => {
                                    setShelterId(shelter.id);
                                    setShelterMenuOpen(false);
                                    setShelterSearch('');
                                  }}
                                >
                                  <span>{shelter.name}</span>
                                  {shelter.id === shelterId && <Check size={15} />}
                                </button>
                              )) : <p>ไม่พบศูนย์พักพิง</p>}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {role !== 'admin' && (
                    <label className="login-field">
                      <span>รหัสอ้างอิงทีม</span>
                      <div className="login-control"><KeyRound size={17} /><input type="text" placeholder="เช่น RESCUE2026" required value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} autoComplete="off" /></div>
                    </label>
                  )}

                  {role === 'admin' && (
                    <div className="login-admin-note"><LockKeyhole size={17} /><p>บัญชีผู้ดูแลต้องได้รับสิทธิ์จากระบบล่วงหน้า การเข้าสู่ระบบจะไม่เปลี่ยนบทบาทเดิมของบัญชี</p></div>
                  )}

                  <label className="login-field">
                    <span>ชื่อ-นามสกุลผู้ปฏิบัติงาน</span>
                    <div className="login-control"><UserCog size={17} /><input type="text" placeholder="เช่น สมชาย ใจดี" required value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" /></div>
                  </label>

                  <label className="login-field">
                    <span>อีเมลผู้ปฏิบัติงาน</span>
                    <div className="login-control"><Mail size={17} /><input type="email" placeholder="name@example.com" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></div>
                  </label>

                  <button className="login-submit" type="submit" disabled={loading}>
                    <span>{loading ? 'กำลังตรวจสอบข้อมูล...' : 'ยืนยันและรับลิงก์เข้าสู่ระบบ'}</span>
                    {!loading && <ArrowRight size={17} />}
                  </button>
                </form>
              )}

              {otpSent && (
                <form className="login-form" onSubmit={handleVerifyEmailCode} style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #DDE3EC' }}>
                  <label className="login-field">
                    <span>รหัสยืนยัน 6 หลัก (ใช้แทนลิงก์ได้)</span>
                    <div className="login-control"><KeyRound size={17} /><input inputMode="numeric" pattern="[0-9]*" maxLength={8} placeholder="เช่น 123456" value={emailOtp} onChange={(event) => setEmailOtp(event.target.value.replace(/\s/g, ''))} autoComplete="one-time-code" /></div>
                  </label>
                  <button className="login-submit" type="submit" disabled={loading || !emailOtp.trim()}>
                    <span>{loading ? 'กำลังยืนยันรหัส...' : 'ยืนยันด้วยรหัส'}</span>
                    {!loading && <CheckCircle2 size={17} />}
                  </button>
                </form>
              )}

              {message && (
                <div className={`login-message ${message.type}`} role="status">
                  {message.type === 'success' ? <CheckCircle2 size={18} /> : <LockKeyhole size={18} />}
                  <span>{message.text}</span>
                </div>
              )}

              <div className="login-security"><LockKeyhole size={13} /> ปกป้องการเข้าสู่ระบบด้วย Supabase Authentication</div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

const LOGIN_STYLES = `
  @keyframes login-enter { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
  @keyframes login-float { 50% { transform:translateY(-7px); } }
  @keyframes login-pulse { 50% { opacity:.45; transform:scale(.86); } }
  .login-page { --blue:#0466C8;--blue-strong:#0353A4;--blue-deep:#023E7D;--navy:#002855;--ink:#001845;--midnight:#001233;--slate:#33415C;--muted:#7D8597;--pale:#979DAC;--line:#DDE3EC; min-height:100vh; display:grid; place-items:center; padding:34px; color:var(--ink); background:linear-gradient(145deg,#F8FAFD,#EEF3F8); font-family:var(--font-thai),'IBM Plex Sans Thai',sans-serif; }
  .login-home { position:fixed; z-index:20; left:24px; top:22px; min-height:43px; display:flex; align-items:center; gap:7px; padding:0 13px; border:1px solid var(--line); border-radius:13px; color:var(--slate); background:rgba(255,255,255,.86); font:700 13px/1 inherit; cursor:pointer; backdrop-filter:blur(10px); transition:.2s; }.login-home:hover { color:var(--blue); border-color:#B7CCE2; transform:translateX(-2px); }
  .login-shell { width:min(100%,1180px); min-height:700px; display:grid; grid-template-columns:minmax(0,1.08fr) minmax(400px,.92fr); overflow:hidden; border:1px solid rgba(51,65,92,.1); border-radius:32px; background:#fff; box-shadow:0 28px 80px rgba(0,24,69,.12); animation:login-enter .45s ease both; }
  .login-visual { position:relative; min-width:0; display:flex; flex-direction:column; justify-content:space-between; overflow:hidden; padding:26px 30px 32px; background:linear-gradient(150deg,#F3F7FC,#E4EDF7); }
  .login-visual::before { content:''; position:absolute; width:290px; height:290px; right:-145px; top:-150px; border:40px solid rgba(4,102,200,.08); border-radius:50%; }.login-visual-brand { position:relative; z-index:3; display:flex; align-items:center; gap:9px; }.login-visual-brand > span { width:36px; height:36px; display:grid; place-items:center; border-radius:12px; color:#fff; background:linear-gradient(135deg,var(--blue),var(--blue-deep)); }.login-visual-brand strong { max-width:480px; font-size:14px; line-height:1.35; }
  .login-illustration-wrap { position:relative; width:100%; margin:auto; animation:login-float 5s ease-in-out infinite; }.login-illustration { position:relative; z-index:2; width:100%; height:auto; display:block; border-radius:25px; box-shadow:0 18px 45px rgba(0,40,85,.12); }.login-orbit { position:absolute; z-index:1; border:1px solid rgba(4,102,200,.13); border-radius:50%; }.orbit-one { width:180px; height:180px; left:-65px; top:-45px; }.orbit-two { width:110px; height:110px; right:-35px; bottom:-35px; background:rgba(4,102,200,.05); }
  .login-visual-copy { position:relative; z-index:3; max-width:540px; margin-top:23px; }.login-visual-copy > span,.login-step-label { color:var(--blue); font-size:11px; font-weight:800; letter-spacing:.13em; }.login-visual-copy h1 { margin:8px 0 7px; font-size:clamp(27px,3vw,38px); line-height:1.15; letter-spacing:-.04em; }.login-visual-copy p { max-width:510px; margin:0; color:var(--muted); font-size:14px; line-height:1.65; }.login-visual-progress { display:flex; gap:6px; margin-top:20px; }.login-visual-progress i { width:7px; height:7px; border-radius:99px; background:#B9C5D2; }.login-visual-progress i.active { width:28px; background:var(--blue); }
  .login-panel { display:grid; place-items:center; padding:44px 38px; background:#fff; }.login-panel-inner { width:min(100%,420px); }.login-heading { margin-bottom:28px; }.login-heading h2 { margin:7px 0 5px; font-size:30px; line-height:1.25; letter-spacing:-.035em; }.login-heading p { margin:0; color:var(--muted); font-size:14px; }
  .login-role-list { display:grid; gap:11px; }.login-role { min-height:82px; display:grid; grid-template-columns:45px minmax(0,1fr) 20px; align-items:center; gap:13px; padding:14px; border:1px solid var(--line); border-radius:17px; color:var(--ink); background:#F8FAFD; font:inherit; text-align:left; cursor:pointer; transition:.2s; }.login-role:hover { border-color:#AFC7E0; background:#EFF5FB; transform:translateY(-2px); box-shadow:0 10px 22px rgba(0,24,69,.07); }.login-role-icon { width:45px; height:45px; display:grid; place-items:center; border-radius:14px; color:var(--blue); background:#E6F0FA; }.login-role-copy strong,.login-role-copy small { display:block; }.login-role-copy strong { font-size:16px; }.login-role-copy small { margin-top:3px; color:var(--muted); font-size:13px; line-height:1.45; }.login-role > svg { color:var(--pale); }.login-admin-link { min-height:44px; display:flex; align-items:center; justify-content:center; gap:6px; margin-top:5px; border:0; color:var(--muted); background:transparent; font:700 13px/1 inherit; cursor:pointer; }.login-admin-link:hover { color:var(--blue); }
  .login-form { display:grid; gap:16px; animation:login-enter .28s ease both; }.login-back { width:max-content; min-height:40px; display:flex; align-items:center; gap:6px; padding:0; border:0; color:var(--blue); background:transparent; font:700 13px/1 inherit; cursor:pointer; }.login-selected-role { display:flex; align-items:center; gap:10px; padding:12px; border:1px solid #C8D7E6; border-radius:14px; background:#F1F6FB; }.login-selected-role > span { width:38px; height:38px; display:grid; place-items:center; border-radius:11px; color:#fff; background:var(--blue); }.login-selected-role strong,.login-selected-role small { display:block; }.login-selected-role strong { font-size:14px; }.login-selected-role small { margin-top:2px; color:var(--muted); font-size:12px; }
  .login-field { display:grid; gap:7px; }.login-field > span { color:var(--slate); font-size:13px; font-weight:700; }.login-control { min-height:52px; display:flex; align-items:center; gap:10px; padding:0 13px; border:1px solid var(--line); border-radius:13px; color:var(--muted); background:#F8FAFD; transition:.18s; }.login-control:focus-within { color:var(--blue); border-color:#8BB4DB; background:#fff; box-shadow:0 0 0 4px rgba(4,102,200,.08); }.login-control input,.login-control select { min-width:0; flex:1; border:0; outline:0; color:var(--ink); background:transparent; font:inherit; font-size:16px; }.login-control select:disabled { opacity:.55; }.login-admin-note { display:flex; align-items:flex-start; gap:9px; padding:12px; border-left:3px solid var(--blue); border-radius:0 12px 12px 0; color:var(--blue-deep); background:#EAF3FC; }.login-admin-note svg { flex:0 0 auto; margin-top:2px; }.login-admin-note p { margin:0; font-size:13px; line-height:1.55; }
  .shelter-picker { display:grid; gap:7px; }.shelter-picker-trigger { width:100%; min-height:50px; display:grid; grid-template-columns:18px minmax(0,1fr) 17px; align-items:center; gap:9px; padding:0 12px; border:1px solid #CDD5DF; border-radius:10px; color:var(--muted); background:#F3F5F7; font:inherit; text-align:left; cursor:pointer; transition:.18s; }.shelter-picker-trigger > span { overflow:hidden; color:var(--ink); font-size:15px; text-overflow:ellipsis; white-space:nowrap; }.shelter-picker-trigger > svg:last-child { transition:transform .18s; }.shelter-picker.open .shelter-picker-trigger { border-color:#9EB5CD; background:#fff; box-shadow:0 0 0 3px rgba(4,102,200,.07); }.shelter-picker.open .shelter-picker-trigger > svg:last-child { transform:rotate(180deg); }.shelter-picker-trigger:disabled { opacity:.55; cursor:wait; }
  .shelter-picker-menu { display:grid; gap:7px; padding:8px; border:1px solid #CDD5DF; border-radius:10px; background:#EEF1F4; box-shadow:0 10px 24px rgba(0,24,69,.08); animation:login-enter .18s ease both; }.shelter-picker-search { min-height:42px; display:flex; align-items:center; gap:8px; padding:0 10px; border:1px solid #D2D9E2; border-radius:8px; color:var(--muted); background:#fff; }.shelter-picker-search:focus-within { color:var(--blue); border-color:#9AB8D5; }.shelter-picker-search input { min-width:0; flex:1; border:0; outline:0; color:var(--ink); background:transparent; font:inherit; font-size:15px; }
  .shelter-picker-options { max-height:230px; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:#9AA5B4 transparent; }.shelter-picker-options button { width:100%; min-height:42px; display:grid; grid-template-columns:minmax(0,1fr) 18px; align-items:center; gap:8px; padding:9px 10px; border:0; border-bottom:1px solid #DDE2E8; color:var(--slate); background:transparent; font:inherit; font-size:14px; line-height:1.4; text-align:left; cursor:pointer; }.shelter-picker-options button:last-child { border-bottom:0; }.shelter-picker-options button:hover,.shelter-picker-options button.selected { color:var(--blue-deep); background:#E1E9F2; }.shelter-picker-options button span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.shelter-picker-options p { margin:0; padding:20px 10px; color:var(--muted); font-size:13px; text-align:center; }
  .login-submit { min-height:52px; display:flex; align-items:center; justify-content:center; gap:8px; margin-top:2px; border:0; border-radius:13px; color:#fff; background:linear-gradient(135deg,var(--blue),var(--blue-strong)); box-shadow:0 9px 20px rgba(4,102,200,.18); font:750 15px/1 inherit; cursor:pointer; transition:.2s; }.login-submit:hover:not(:disabled) { transform:translateY(-2px); box-shadow:0 13px 25px rgba(4,102,200,.23); }.login-submit:disabled { opacity:.58; cursor:wait; }
  .login-message { display:flex; align-items:flex-start; gap:9px; margin-top:16px; padding:13px; border-radius:12px; font-size:13px; line-height:1.55; }.login-message svg { flex:0 0 auto; margin-top:1px; }.login-message.success { color:var(--blue-deep); border:1px solid #BDD1E5; background:#EAF3FC; }.login-message.error { color:var(--midnight); border:1px solid #CCD3DD; background:#EEF0F4; }.login-security { display:flex; align-items:center; justify-content:center; gap:5px; margin-top:26px; color:var(--pale); font-size:11px; }
  @media(max-width:900px) { .login-page { padding:75px 20px 25px; }.login-shell { width:min(100%,670px); grid-template-columns:1fr; }.login-visual { min-height:0; padding:22px; }.login-illustration-wrap { max-width:570px; margin:23px auto 0; }.login-visual-copy { margin-top:20px; }.login-panel { padding:36px 24px 40px; } }
  @media(max-width:560px) { .login-page { display:block; padding:68px 12px 18px; }.login-home { left:12px; top:12px; }.login-shell { border-radius:23px; }.login-visual { padding:17px; }.login-visual-brand strong { font-size:13px; }.login-illustration { border-radius:17px; }.login-visual-copy h1 { font-size:28px; }.login-visual-copy p { font-size:14px; }.login-panel { padding:30px 14px 34px; }.login-heading h2 { font-size:27px; }.login-role { min-height:88px; }.login-security { line-height:1.4; text-align:center; }.shelter-picker-menu { padding:7px; border-radius:9px; }.shelter-picker-options { max-height:210px; }.shelter-picker-options button { min-height:46px; font-size:15px; } }
  @media(prefers-reduced-motion:reduce) { .login-shell,.login-form,.login-illustration-wrap { animation:none; }.login-role,.login-submit,.login-home { transition:none; } }

  /* Minimal white sign-in surface.  Authentication behavior above is unchanged. */
  .login-page { --ink:#18181B; --slate:#52525B; --muted:#71717A; --pale:#A1A1AA; --line:#E4E4E7; min-height:100svh; padding:28px 18px; background:#fff !important; }
  .login-home { position:absolute; left:24px; top:22px; min-height:38px; border:0; border-radius:999px; color:#52525B; background:#fff; box-shadow:none; }.login-home:hover { color:#18181B; background:#F4F4F5; border:0; transform:none; }
  .login-shell { width:min(100%,470px); min-height:0; display:block; overflow:visible; border:1px solid #ECECF0; border-radius:28px; background:#fff; box-shadow:0 18px 50px rgba(24,24,27,.09); animation:login-enter .35s ease both; }
  .login-visual { display:none; }
  .login-panel { display:block; padding:38px 30px 30px; background:#fff; }.login-panel-inner { width:100%; max-width:none; }
  .login-heading { margin-bottom:27px; text-align:center; }.login-step-label { color:#71717A; font-size:10px; letter-spacing:.16em; }.login-heading h2 { margin:8px 0 7px; color:#18181B; font-size:27px; letter-spacing:-.045em; }.login-heading p { color:#71717A; font-size:13px; line-height:1.6; }
  .login-role-list { gap:10px; }.login-role { min-height:72px; grid-template-columns:42px minmax(0,1fr) 18px; gap:11px; padding:12px; border-color:#E4E4E7; border-radius:17px; background:#fff; }.login-role:hover { border-color:#A1A1AA; background:#FAFAFA; transform:translateY(-1px); box-shadow:0 9px 18px rgba(24,24,27,.06); }.login-role-icon { width:42px; height:42px; border-radius:13px; color:#18181B; background:#F4F4F5; }.login-role-copy strong { color:#18181B; font-size:15px; }.login-role-copy small { color:#71717A; font-size:12px; }.login-role > svg { color:#A1A1AA; }.login-admin-link { color:#71717A; }.login-admin-link:hover { color:#18181B; }
  .login-form { gap:15px; }.login-back { color:#52525B; }.login-back:hover { color:#18181B; }.login-selected-role { border-color:#E4E4E7; border-radius:16px; background:#FAFAFA; }.login-selected-role > span { color:#fff; background:#18181B; }.login-selected-role strong { color:#18181B; }.login-selected-role small { color:#71717A; }
  .login-field > span { color:#3F3F46; font-size:12px; }.login-control { min-height:50px; border-color:#E4E4E7; border-radius:15px; color:#71717A; background:#fff; }.login-control:focus-within { color:#18181B; border-color:#18181B; background:#fff; box-shadow:0 0 0 4px rgba(24,24,27,.07); }.login-control input,.login-control select { color:#18181B; }
  .login-admin-note { border-left-color:#18181B; color:#3F3F46; background:#F4F4F5; }.shelter-picker-trigger { border-color:#E4E4E7; border-radius:15px; background:#fff; }.shelter-picker.open .shelter-picker-trigger { border-color:#18181B; box-shadow:0 0 0 4px rgba(24,24,27,.07); }.shelter-picker-menu { border-color:#E4E4E7; border-radius:15px; background:#fff; box-shadow:0 14px 30px rgba(24,24,27,.1); }.shelter-picker-search { border-color:#E4E4E7; }.shelter-picker-search:focus-within { color:#18181B; border-color:#18181B; }.shelter-picker-options button:hover,.shelter-picker-options button.selected { color:#18181B; background:#F4F4F5; }
  .login-submit { min-height:52px; margin-top:5px; border-radius:999px; color:#fff; background:#18181B; box-shadow:none; }.login-submit:hover:not(:disabled) { background:#3F3F46; transform:translateY(-1px); box-shadow:0 8px 16px rgba(24,24,27,.16); }.login-submit:focus-visible,.login-role:focus-visible,.login-home:focus-visible { outline:3px solid #A1A1AA; outline-offset:3px; }.login-message { border-radius:15px; }.login-message.success { color:#166534; border-color:#BBF7D0; background:#F0FDF4; }.login-message.error { color:#991B1B; border-color:#FECACA; background:#FEF2F2; }.login-security { color:#A1A1AA; }
  @media(max-width:560px) { .login-page { padding:72px 14px 20px; }.login-home { left:13px; top:14px; }.login-shell { border-radius:24px; }.login-panel { padding:31px 20px 25px; }.login-heading h2 { font-size:25px; } }
`;
