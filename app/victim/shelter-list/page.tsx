'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  ChevronRight,
  Home,
  MapPin,
  Navigation,
  Phone,
  Search,
  Users,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PROJECT_NAME } from '@/lib/brand';

type Shelter = {
  id: string;
  name: string;
  address: string | null;
  province: string | null;
  lat: number | null;
  lng: number | null;
  capacity: number | null;
  current_occupancy: number | null;
  contact_phone: string | null;
  is_active: boolean;
};

type OccupancyStatus = 'available' | 'limited' | 'full' | 'unknown';

const STATUS_META: Record<OccupancyStatus, { label: string; className: string }> = {
  available: { label: 'พร้อมรองรับ', className: 'available' },
  limited: { label: 'ใกล้เต็ม', className: 'limited' },
  full: { label: 'เต็มแล้ว', className: 'full' },
  unknown: { label: 'ยังไม่ระบุความจุ', className: 'unknown' },
};

function getOccupancyStatus(capacity: number, occupancy: number): OccupancyStatus {
  if (capacity <= 0) return 'unknown';
  if (occupancy >= capacity) return 'full';
  if (occupancy / capacity >= 0.85) return 'limited';
  return 'available';
}

export default function ShelterListPage() {
  const router = useRouter();
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [province, setProvince] = useState('');

  useEffect(() => {
    let active = true;

    async function loadShelters() {
      setLoading(true);
      setError(null);

      const { data, error: loadError } = await supabase
        .from('shelters')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (!active) return;

      if (loadError) {
        setError('โหลดข้อมูลศูนย์พักพิงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
        setShelters([]);
      } else {
        setShelters((data ?? []) as Shelter[]);
      }
      setLoading(false);
    }

    loadShelters();
    return () => {
      active = false;
    };
  }, []);

  const provinces = useMemo(
    () => [...new Set(shelters.map((shelter) => shelter.province).filter(Boolean) as string[])].sort(),
    [shelters],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return shelters.filter((shelter) => {
      const searchableText = `${shelter.name} ${shelter.address ?? ''} ${shelter.province ?? ''}`.toLowerCase();
      if (query && !searchableText.includes(query)) return false;
      if (province && shelter.province !== province) return false;
      return true;
    });
  }, [shelters, search, province]);

  const hasFilters = search.trim().length > 0 || province.length > 0;

  const clearFilters = () => {
    setSearch('');
    setProvince('');
  };

  return (
    <>
      <style>{SHELTER_STYLES}</style>
      <div className="shelter-page">
        <header className="shelter-nav">
          <div className="shelter-nav-inner">
            <button className="shelter-back" onClick={() => router.back()} aria-label="ย้อนกลับ">
              <ArrowLeft size={18} strokeWidth={2} />
            </button>
            <div className="shelter-brand">
              <span className="shelter-brand-mark"><Home size={17} strokeWidth={2.2} /></span>
              <span>
                <strong>{PROJECT_NAME}</strong>
                <small>ศูนย์พักพิงและจุดช่วยเหลือ</small>
              </span>
            </div>
            <button className="shelter-home" onClick={() => router.push('/')}>
              หน้าหลัก <ChevronRight size={14} />
            </button>
          </div>
        </header>

        <main className="shelter-main">
          <section className="shelter-hero">
            <div className="shelter-hero-copy">
              <span className="shelter-eyebrow">SHELTER DIRECTORY</span>
              <h1>ค้นหาศูนย์พักพิง<br />ที่เหมาะกับคุณ</h1>
              <p>ตรวจสอบที่ตั้ง จำนวนผู้พักพิง และช่องทางติดต่อของศูนย์ที่เปิดให้บริการ</p>
            </div>
            <div className="shelter-hero-stat" aria-label={`ศูนย์พักพิงทั้งหมด ${shelters.length} แห่ง`}>
              <Building2 size={20} strokeWidth={2} />
              <strong>{loading ? '—' : shelters.length}</strong>
              <span>ศูนย์ที่เปิดให้บริการ</span>
            </div>
          </section>

          <section className="shelter-filter" aria-label="ค้นหาและกรองศูนย์พักพิง">
            <label className="shelter-search">
              <Search size={17} strokeWidth={2} aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                type="search"
                placeholder="ค้นหาชื่อศูนย์ อำเภอ หรือตำบล"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label="ล้างคำค้นหา">
                  <X size={15} />
                </button>
              )}
            </label>
            <label className="shelter-province">
              <MapPin size={16} strokeWidth={2} aria-hidden="true" />
              <select value={province} onChange={(event) => setProvince(event.target.value)}>
                <option value="">ทุกจังหวัด</option>
                {provinces.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </section>

          <div className="shelter-results-head">
            <div>
              <span className="shelter-results-dot" aria-hidden="true" />
              {loading ? 'กำลังค้นหาศูนย์พักพิง...' : `พบ ${filtered.length} จาก ${shelters.length} ศูนย์`}
            </div>
            {hasFilters && <button onClick={clearFilters}>ล้างตัวกรอง</button>}
          </div>

          {error && <div className="shelter-error" role="alert">{error}</div>}

          {loading && <ShelterSkeleton />}

          {!loading && !error && filtered.length === 0 && (
            <div className="shelter-empty">
              <span><Building2 size={26} strokeWidth={1.8} /></span>
              <h2>ไม่พบศูนย์พักพิงที่ตรงกับเงื่อนไข</h2>
              <p>ลองเปลี่ยนคำค้นหา เลือกจังหวัดอื่น หรือล้างตัวกรองทั้งหมด</p>
              <button onClick={clearFilters}>ล้างตัวกรอง</button>
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <div className="shelter-list">
              {filtered.map((shelter, index) => (
                <ShelterItem key={shelter.id} shelter={shelter} index={index} />
              ))}
            </div>
          )}
        </main>
      </div>
    </>
  );
}

function ShelterItem({ shelter, index }: { shelter: Shelter; index: number }) {
  const capacity = shelter.capacity ?? 0;
  const occupancy = shelter.current_occupancy ?? 0;
  const percentage = capacity > 0 ? Math.min((occupancy / capacity) * 100, 100) : 0;
  const available = Math.max(capacity - occupancy, 0);
  const status = getOccupancyStatus(capacity, occupancy);
  const statusMeta = STATUS_META[status];
  const hasCoordinates = shelter.lat != null && shelter.lng != null;
  const mapUrl = hasCoordinates
    ? `https://www.google.com/maps/dir/?api=1&destination=${shelter.lat},${shelter.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${shelter.name} ${shelter.address ?? ''} ${shelter.province ?? ''}`,
      )}`;
  const hasPhone = Boolean(shelter.contact_phone?.trim());
  const phoneHref = hasPhone ? `tel:${shelter.contact_phone!.replace(/[^0-9+]/g, '')}` : undefined;

  return (
    <article className="shelter-item" style={{ animationDelay: `${Math.min(index, 7) * 35}ms` }}>
      <div className="shelter-item-accent" aria-hidden="true" />
      <div className="shelter-item-main">
        <div className="shelter-item-top">
          <span className="shelter-item-icon"><Building2 size={20} strokeWidth={2} /></span>
          <div className="shelter-item-copy">
            <div className="shelter-item-title-row">
              <h2>{shelter.name}</h2>
              <span className={`shelter-status ${statusMeta.className}`}><i />{statusMeta.label}</span>
            </div>
            <p><MapPin size={13} /> {shelter.address || 'ไม่ระบุที่อยู่'}{shelter.province ? ` · ${shelter.province}` : ''}</p>
          </div>
        </div>

        <div className="shelter-capacity">
          <div className="shelter-capacity-head">
            <span><Users size={14} /> ผู้พักพิงปัจจุบัน</span>
            <strong>{occupancy.toLocaleString('th-TH')} <small>/ {capacity.toLocaleString('th-TH')} คน</small></strong>
          </div>
          <div className="shelter-progress" aria-label={`ใช้งาน ${Math.round(percentage)} เปอร์เซ็นต์`}>
            <span className={statusMeta.className} style={{ width: `${percentage}%` }} />
          </div>
          <span className="shelter-remaining">{capacity > 0 ? `เหลือรองรับประมาณ ${available.toLocaleString('th-TH')} คน` : 'กรุณาติดต่อศูนย์เพื่อตรวจสอบความจุ'}</span>
        </div>
      </div>

      <div className="shelter-actions">
        <a className="shelter-directions" href={mapUrl} target="_blank" rel="noopener noreferrer">
          <Navigation size={16} strokeWidth={2.1} />
          <span><strong>นำทาง</strong><small>เปิด Google Maps</small></span>
        </a>
        <a
          className={`shelter-call ${hasPhone ? '' : 'disabled'}`}
          href={phoneHref}
          aria-disabled={!hasPhone}
          onClick={(event) => { if (!hasPhone) event.preventDefault(); }}
        >
          <Phone size={16} strokeWidth={2.1} />
          <span><strong>{hasPhone ? 'โทรติดต่อ' : 'ไม่มีเบอร์'}</strong><small>{hasPhone ? shelter.contact_phone : 'ติดต่อผ่านแผนที่'}</small></span>
        </a>
      </div>
    </article>
  );
}

function ShelterSkeleton() {
  return (
    <div className="shelter-list" role="status" aria-label="กำลังโหลดศูนย์พักพิง">
      <span className="shelter-sr-only">กำลังโหลดข้อมูล</span>
      {[0, 1, 2, 3].map((item) => (
        <div className="shelter-skeleton" key={item} aria-hidden="true">
          <span className="skeleton-square" />
          <div><span className="skeleton-line wide" /><span className="skeleton-line medium" /><span className="skeleton-line full" /></div>
          <div className="skeleton-buttons"><span /><span /></div>
        </div>
      ))}
    </div>
  );
}

const SHELTER_STYLES = `
  @keyframes shelter-enter { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
  @keyframes shelter-shimmer { to { transform:translateX(100%); } }
  .shelter-page {
    --blue:#0466C8; --blue-strong:#0353A4; --blue-deep:#023E7D; --navy:#002855;
    --ink:#001845; --midnight:#001233; --slate:#33415C; --muted:#7D8597; --pale:#979DAC;
    --line:#DDE3EC; min-height:100vh; color:var(--ink);
    background:linear-gradient(145deg,#F9FBFE,#F2F6FB 55%,#EAF1F9);
    font-family:var(--font-thai),'IBM Plex Sans Thai',sans-serif;
  }
  .shelter-nav { position:sticky; z-index:30; top:0; border-top:4px solid var(--blue); border-bottom:1px solid rgba(51,65,92,.1); background:rgba(255,255,255,.9); backdrop-filter:blur(16px); }
  .shelter-nav-inner { width:min(100%,1040px); min-height:70px; display:grid; grid-template-columns:40px 1fr auto; align-items:center; gap:12px; margin:auto; padding:0 22px; }
  .shelter-back { width:38px; height:38px; display:grid; place-items:center; border:1px solid var(--line); border-radius:13px; color:var(--slate); background:#fff; cursor:pointer; transition:.2s; }
  .shelter-back:hover { color:var(--blue); border-color:#B8CCE1; transform:translateX(-2px); }
  .shelter-brand { min-width:0; display:flex; align-items:center; gap:10px; }
  .shelter-brand-mark { width:36px; height:36px; display:grid; place-items:center; border-radius:12px; color:#fff; background:linear-gradient(135deg,var(--blue),var(--blue-deep)); }
  .shelter-brand strong,.shelter-brand small { display:block; }.shelter-brand strong { max-width:520px; font-size:13px; line-height:1.35; }.shelter-brand small { margin-top:1px; color:var(--muted); font-size:9px; }
  .shelter-home { display:flex; align-items:center; gap:3px; padding:8px 10px; border:0; color:var(--blue-strong); background:transparent; font-family:inherit; font-size:10px; font-weight:700; cursor:pointer; }
  .shelter-main { width:min(100%,1040px); margin:auto; padding:26px 22px 50px; }
  .shelter-hero { position:relative; min-height:190px; display:grid; grid-template-columns:1fr auto; align-items:end; gap:28px; overflow:hidden; padding:30px 32px; border-radius:27px; color:#fff; background:linear-gradient(135deg,var(--navy),var(--blue-deep)); box-shadow:0 18px 42px rgba(0,24,69,.16); }
  .shelter-hero::after { content:''; position:absolute; width:230px; height:230px; right:-90px; top:-145px; border:30px solid rgba(151,157,172,.15); border-radius:50%; }
  .shelter-hero-copy { position:relative; z-index:1; }.shelter-eyebrow { color:#A9CDEC; font-size:9px; font-weight:750; letter-spacing:.13em; }
  .shelter-hero h1 { margin:10px 0 7px; font-size:clamp(25px,4vw,36px); font-weight:750; line-height:1.12; letter-spacing:-.04em; }
  .shelter-hero p { max-width:560px; margin:0; color:rgba(255,255,255,.62); font-size:11px; }
  .shelter-hero-stat { position:relative; z-index:1; min-width:150px; display:grid; grid-template-columns:auto 1fr; align-items:center; gap:3px 9px; padding:17px; border:1px solid rgba(255,255,255,.14); border-radius:18px; background:rgba(255,255,255,.08); backdrop-filter:blur(5px); }
  .shelter-hero-stat svg { grid-row:1/3; color:#A9CDEC; }.shelter-hero-stat strong { font-size:26px; line-height:1; }.shelter-hero-stat span { color:rgba(255,255,255,.58); font-size:9px; }
  .shelter-filter { position:relative; z-index:2; display:grid; grid-template-columns:1fr 190px; gap:9px; margin:-20px 22px 0; padding:11px; border:1px solid rgba(51,65,92,.1); border-radius:18px; background:rgba(255,255,255,.94); box-shadow:0 12px 30px rgba(0,24,69,.09); backdrop-filter:blur(12px); }
  .shelter-search,.shelter-province { min-height:44px; display:flex; align-items:center; gap:9px; padding:0 13px; border:1px solid var(--line); border-radius:12px; color:var(--muted); background:#F8FAFD; transition:.2s; }
  .shelter-search:focus-within,.shelter-province:focus-within { border-color:#8DB5DC; box-shadow:0 0 0 3px rgba(4,102,200,.08); background:#fff; }
  .shelter-search input,.shelter-province select { min-width:0; flex:1; border:0; outline:0; color:var(--ink); background:transparent; font:inherit; font-size:11px; }
  .shelter-search input::placeholder { color:var(--pale); }.shelter-search button { width:25px; height:25px; display:grid; place-items:center; border:0; border-radius:8px; color:var(--muted); background:#E8EDF4; cursor:pointer; }
  .shelter-results-head { display:flex; justify-content:space-between; align-items:center; margin:25px 4px 12px; color:var(--muted); font-size:10px; }
  .shelter-results-head > div { display:flex; align-items:center; gap:7px; }.shelter-results-dot { width:6px; height:6px; border-radius:50%; background:var(--blue); }
  .shelter-results-head button { border:0; color:var(--blue); background:transparent; font:inherit; font-weight:700; cursor:pointer; }
  .shelter-list { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .shelter-item { position:relative; min-width:0; overflow:hidden; display:grid; grid-template-rows:1fr auto; border:1px solid rgba(51,65,92,.11); border-radius:20px; background:rgba(255,255,255,.9); box-shadow:0 8px 24px rgba(0,24,69,.045); animation:shelter-enter .35s ease both; transition:.22s; }
  .shelter-item:hover { transform:translateY(-3px); border-color:#C0D1E3; box-shadow:0 15px 32px rgba(0,24,69,.08); }.shelter-item-accent { position:absolute; inset:0 auto 0 0; width:4px; background:linear-gradient(var(--blue),var(--blue-deep)); }
  .shelter-item-main { padding:17px 17px 14px 20px; }.shelter-item-top { display:flex; align-items:flex-start; gap:11px; }
  .shelter-item-icon { width:40px; height:40px; flex:0 0 40px; display:grid; place-items:center; border-radius:13px; color:var(--blue-strong); background:#EAF3FC; }
  .shelter-item-copy { min-width:0; flex:1; }.shelter-item-title-row { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }.shelter-item h2 { min-width:0; margin:1px 0 0; overflow:hidden; color:var(--ink); font-size:13px; font-weight:750; line-height:1.35; text-overflow:ellipsis; white-space:nowrap; }
  .shelter-item-copy p { display:flex; align-items:flex-start; gap:4px; margin:3px 0 0; color:var(--muted); font-size:9px; line-height:1.45; }.shelter-item-copy p svg { flex:0 0 auto; margin-top:1px; }
  .shelter-status { flex:0 0 auto; display:flex; align-items:center; gap:5px; padding:4px 7px; border-radius:999px; font-size:8px; font-weight:750; }.shelter-status i { width:5px; height:5px; border-radius:50%; background:currentColor; }
  .shelter-status.available { color:var(--blue-strong); background:#EAF3FC; }.shelter-status.limited { color:var(--slate); background:#EEF0F4; }.shelter-status.full { color:var(--midnight); background:#DDE2EA; }.shelter-status.unknown { color:#805400; background:#FFF3D7; }
  .shelter-capacity { margin-top:16px; }.shelter-capacity-head { display:flex; align-items:end; justify-content:space-between; gap:10px; color:var(--muted); font-size:9px; }.shelter-capacity-head > span { display:flex; align-items:center; gap:5px; }.shelter-capacity-head strong { color:var(--ink); font-size:13px; }.shelter-capacity-head small { color:var(--muted); font-size:9px; font-weight:500; }
  .shelter-progress { height:6px; overflow:hidden; margin-top:7px; border-radius:999px; background:#E7ECF3; }.shelter-progress span { display:block; height:100%; min-width:3px; border-radius:inherit; transition:width .5s ease; }.shelter-progress span.available { background:var(--blue); }.shelter-progress span.limited { background:var(--slate); }.shelter-progress span.full { background:var(--midnight); }.shelter-progress span.unknown { min-width:100%; background:repeating-linear-gradient(135deg,#E6C36B 0 7px,#F4E2AE 7px 14px); }
  .shelter-remaining { display:block; margin-top:5px; color:var(--pale); font-size:8px; }
  .shelter-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:11px 13px 13px 16px; border-top:1px solid #E9EDF3; background:#FBFCFE; }
  .shelter-actions a { min-width:0; min-height:44px; display:flex; align-items:center; justify-content:center; gap:8px; padding:8px 10px; border-radius:12px; text-decoration:none; transition:.18s; }.shelter-actions a:hover { transform:translateY(-1px); }.shelter-actions strong,.shelter-actions small { display:block; }.shelter-actions strong { font-size:10px; }.shelter-actions small { margin-top:1px; overflow:hidden; font-size:7px; font-weight:450; opacity:.65; text-overflow:ellipsis; white-space:nowrap; }
  .shelter-directions { border:1px solid var(--blue); color:#fff; background:var(--blue); box-shadow:0 6px 14px rgba(4,102,200,.14); }.shelter-directions:hover { background:var(--blue-strong); }
  .shelter-call { border:1px solid #C6D3E1; color:var(--blue-deep); background:#fff; }.shelter-call:hover { border-color:#94B5D5; background:#F1F6FC; }.shelter-call.disabled { color:var(--pale); border-color:#E0E5EC; background:#F2F4F7; pointer-events:none; }
  .shelter-error { margin-top:18px; padding:14px 16px; border-left:4px solid var(--blue-deep); border-radius:0 13px 13px 0; color:var(--blue-deep); background:#EAF3FC; font-size:11px; }
  .shelter-empty { padding:60px 20px; text-align:center; color:var(--muted); }.shelter-empty > span { width:54px; height:54px; display:grid; place-items:center; margin:0 auto 12px; border-radius:18px; color:var(--blue); background:#EAF3FC; }.shelter-empty h2 { margin:0; color:var(--ink); font-size:15px; }.shelter-empty p { margin:5px 0 15px; font-size:10px; }.shelter-empty button { padding:9px 14px; border:1px solid #BFD0E2; border-radius:10px; color:var(--blue); background:#fff; font:inherit; font-size:10px; font-weight:700; cursor:pointer; }
  .shelter-skeleton { min-height:208px; display:grid; grid-template-columns:40px 1fr; gap:12px; padding:17px; border:1px solid var(--line); border-radius:20px; background:#fff; }.shelter-skeleton span { position:relative; display:block; overflow:hidden; background:#E3E8EF; }.shelter-skeleton span::after { content:''; position:absolute; inset:0; transform:translateX(-100%); background:linear-gradient(90deg,transparent,rgba(255,255,255,.75),transparent); animation:shelter-shimmer 1.35s infinite; }.skeleton-square { width:40px; height:40px; border-radius:13px; }.skeleton-line { height:9px; margin-bottom:9px; border-radius:99px; }.skeleton-line.wide { width:72%; height:13px; }.skeleton-line.medium { width:55%; }.skeleton-line.full { width:100%; margin-top:35px; }.skeleton-buttons { grid-column:1/-1; display:grid; grid-template-columns:1fr 1fr; gap:8px; align-self:end; }.skeleton-buttons span { height:44px; border-radius:12px; }
  .shelter-sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  /* Readable type and touch targets for phone-first use */
  .shelter-brand strong { font-size:16px; }.shelter-brand small { font-size:12px; }.shelter-home { min-height:44px; font-size:13px; }
  .shelter-eyebrow { font-size:12px; }.shelter-hero h1 { font-size:clamp(30px,5vw,40px); }.shelter-hero p { font-size:15px; line-height:1.6; }.shelter-hero-stat span { font-size:12px; }
  .shelter-search,.shelter-province { min-height:52px; }.shelter-search input,.shelter-province select { font-size:16px; }.shelter-results-head { font-size:13px; }
  .shelter-item h2 { font-size:17px; }.shelter-item-copy p { margin-top:5px; font-size:13px; line-height:1.55; }.shelter-status { padding:6px 9px; font-size:12px; }
  .shelter-capacity-head { font-size:13px; }.shelter-capacity-head strong { font-size:16px; }.shelter-capacity-head small { font-size:12px; }.shelter-remaining { margin-top:7px; font-size:12px; }
  .shelter-actions a { min-height:52px; }.shelter-actions strong { font-size:14px; }.shelter-actions small { font-size:11px; }.shelter-error { font-size:14px; }.shelter-empty h2 { font-size:19px; }.shelter-empty p,.shelter-empty button { font-size:14px; }
  @media(max-width:720px) { .shelter-list { grid-template-columns:1fr; }.shelter-hero { min-height:180px; padding:25px; }.shelter-filter { margin-left:12px; margin-right:12px; }.shelter-main { padding-left:13px; padding-right:13px; }.shelter-nav-inner { padding:0 14px; } }
  @media(max-width:520px) { .shelter-brand small,.shelter-home { display:none; }.shelter-filter { grid-template-columns:1fr; margin-top:-16px; }.shelter-hero { grid-template-columns:1fr; gap:18px; }.shelter-hero-stat { min-width:0; justify-self:start; }.shelter-actions { grid-template-columns:1fr 1fr; }.shelter-item-title-row { display:block; }.shelter-status { width:max-content; margin-top:6px; } }
  @media(prefers-reduced-motion:reduce) { .shelter-item,.shelter-skeleton span::after { animation:none; }.shelter-item,.shelter-actions a,.shelter-back { transition:none; } }
`;
