'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Accessibility,
  AlertCircle,
  BarChart3,
  Building2,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Footprints,
  Hospital,
  History,
  Home,
  LayoutDashboard,
  LogOut,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Skull,
  Truck,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { PROJECT_NAME } from '@/lib/brand';
import { supabase } from '@/lib/supabase';
import styles from './page.module.css';

type ChartRange = 'day' | 'week' | 'month';
type OccupantTab = 'in_shelter' | 'exited';
type Notice = { type: 'success' | 'error'; message: string } | null;
type RealtimeState = 'connecting' | 'live' | 'offline';

interface Profile {
  id: string;
  full_name: string;
  role: string;
  shelter_id?: string | null;
}

interface Shelter {
  id: string;
  name: string;
  address?: string | null;
  province?: string | null;
  capacity?: number | null;
}

interface Occupant {
  id: string;
  sos_report_id?: string | null;
  assignment_id?: string | null;
  full_name: string;
  phone?: string | null;
  adult_count: number;
  child_count: number;
  elder_count: number;
  entry_source: 'rescuer' | 'self_registered';
  status: OccupantTab;
  entry_date: string;
  exit_date?: string | null;
  exit_destination?: ExitDestination | null;
  exit_note?: string | null;
}

interface DeliveryPerson {
  id: string;
  sequence_no: number;
  full_name: string;
  age_group: 'adult' | 'child' | 'elder';
  is_primary_destination: boolean;
  destination_type: 'shelter' | 'hospital' | 'deceased' | 'relative_home' | 'hotel' | 'other_safe';
  destination_name?: string | null;
  notes?: string | null;
}

interface DeliveryManifest {
  id: string;
  sos_report_id: string;
  requested_adult_count: number;
  requested_child_count: number;
  requested_elder_count: number;
  accounted_total: number;
  primary_destination_total: number;
  hospital_total: number;
  deceased_total: number;
  count_discrepancy_note?: string | null;
  created_at: string;
  rescue_delivery_people: DeliveryPerson[];
}

type ExitDestination = 'home' | 'relative_home' | 'other_shelter' | 'other';

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
  destination: ExitDestination | null;
  note: string;
  exitDate: string;
  exitTime: string;
}

interface ChartBucket {
  key: string;
  label: string;
  detail: string;
  rescuer: number;
  self: number;
  home: number;
}

const EXIT_LABEL: Record<ExitDestination, string> = {
  home: 'กลับบ้าน',
  relative_home: 'บ้านญาติ',
  other_shelter: 'ย้ายศูนย์อื่น',
  other: 'ปลายทางอื่น',
};

const RANGE_OPTIONS: ReadonlyArray<{ value: ChartRange; label: string }> = [
  { value: 'day', label: '1 วัน' },
  { value: 'week', label: '1 สัปดาห์' },
  { value: 'month', label: '1 เดือน' },
];

const EMPTY_ADD_DRAFT: AddDraft = { fullName: '', phone: '', adult: 1, child: 0, elder: 0 };

export default function ShelterStaffDashboard() {
  const router = useRouter();
  const params = useParams<{ shelterId: string }>();
  const shelterId = params?.shelterId;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [shelter, setShelter] = useState<Shelter | null>(null);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [tab, setTab] = useState<OccupantTab>('in_shelter');
  const [activeSection, setActiveSection] = useState<'overview' | 'activity'>('overview');
  const [chartRange, setChartRange] = useState<ChartRange>('week');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [realtimeState, setRealtimeState] = useState<RealtimeState>('connecting');
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDraft, setAddDraft] = useState<AddDraft>(EMPTY_ADD_DRAFT);
  const [exitDraft, setExitDraft] = useState<ExitDraft | null>(null);
  const [manifests, setManifests] = useState<DeliveryManifest[]>([]);
  const [selectedManifest, setSelectedManifest] = useState<DeliveryManifest | null>(null);
  const [capacityDraft, setCapacityDraft] = useState('');

  useEffect(() => {
    let active = true;

    const authenticate = async () => {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) {
          router.replace(`/officer/login?redirect=${encodeURIComponent(`/officer/shelter/${shelterId}`)}`);
          return;
        }

        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, role, shelter_id')
          .eq('id', user.id)
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          router.replace('/officer/login');
          return;
        }

        const userProfile = data as Profile;
        if (userProfile.role === 'rescuer') {
          router.replace('/officer/dashboard');
          return;
        }
        if (userProfile.role !== 'admin' && userProfile.role !== 'shelter_staff') {
          router.replace('/officer/login');
          return;
        }
        if (userProfile.role === 'shelter_staff' && userProfile.shelter_id !== shelterId) {
          if (userProfile.shelter_id) router.replace(`/officer/shelter/${userProfile.shelter_id}`);
          else router.replace('/officer/login');
          return;
        }

        if (active) setProfile(userProfile);
      } catch (error) {
        if (active) {
          setDataError(getErrorMessage(error, 'ไม่สามารถตรวจสอบสิทธิ์เข้าใช้งานได้'));
          setLoading(false);
        }
      }
    };

    void authenticate();
    return () => { active = false; };
  }, [router, shelterId]);

  const loadDashboard = useCallback(async (manual = false) => {
    if (!shelterId) return;
    if (manual) setRefreshing(true);

    try {
      const [shelterResult, occupantsResult, manifestsResult] = await Promise.all([
        supabase
          .from('shelters')
          .select('id, name, address, province, capacity')
          .eq('id', shelterId)
          .maybeSingle(),
        supabase
          .from('shelter_occupants')
          .select('id, sos_report_id, assignment_id, full_name, phone, adult_count, child_count, elder_count, entry_source, status, entry_date, exit_date, exit_destination, exit_note')
          .eq('shelter_id', shelterId)
          .order('entry_date', { ascending: false }),
        supabase
          .from('rescue_delivery_manifests')
          .select('id, sos_report_id, requested_adult_count, requested_child_count, requested_elder_count, accounted_total, primary_destination_total, hospital_total, deceased_total, count_discrepancy_note, created_at, rescue_delivery_people(id, sequence_no, full_name, age_group, is_primary_destination, destination_type, destination_name, notes)')
          .eq('shelter_id', shelterId)
          .order('created_at', { ascending: false }),
      ]);

      if (shelterResult.error) throw shelterResult.error;
      if (!shelterResult.data) throw new Error('ไม่พบข้อมูลศูนย์พักพิงนี้');
      if (occupantsResult.error) throw occupantsResult.error;

      const nextShelter = shelterResult.data as Shelter;
      setShelter(nextShelter);
      setCapacityDraft(String(nextShelter.capacity ?? ''));
      setOccupants((occupantsResult.data as Occupant[] | null) ?? []);
      if (!manifestsResult.error) {
        setManifests((manifestsResult.data as DeliveryManifest[] | null) ?? []);
      } else if (!isMissingManifestSchema(manifestsResult.error)) {
        throw manifestsResult.error;
      }
      setLastUpdated(new Date());
      setDataError(null);
      if (manual) setNotice({ type: 'success', message: 'อัปเดตข้อมูลล่าสุดแล้ว' });
    } catch (error) {
      const message = getErrorMessage(error, 'โหลดข้อมูลศูนย์พักพิงไม่สำเร็จ');
      setDataError(message);
      if (manual) setNotice({ type: 'error', message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [shelterId]);

  useEffect(() => {
    if (!profile) return;
    const initialLoad = window.setTimeout(() => { void loadDashboard(); }, 0);

    const channel = supabase
      .channel(`shelter-dashboard-${shelterId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shelter_occupants', filter: `shelter_id=eq.${shelterId}` },
        () => { void loadDashboard(); },
      )
      .subscribe(status => {
        if (status === 'SUBSCRIBED') setRealtimeState('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setRealtimeState('offline');
        else setRealtimeState('connecting');
      });

    return () => {
      window.clearTimeout(initialLoad);
      void supabase.removeChannel(channel);
    };
  }, [loadDashboard, profile, shelterId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!showAddForm && !exitDraft && !selectedManifest) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || saving) return;
      setShowAddForm(false);
      setExitDraft(null);
      setSelectedManifest(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [exitDraft, saving, selectedManifest, showAddForm]);

  useEffect(() => {
    if (loading) return;
    const sections = ['overview', 'activity']
      .map(id => document.getElementById(id))
      .filter((element): element is HTMLElement => Boolean(element));
    const observer = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target.id === 'overview' || visible?.target.id === 'activity') setActiveSection(visible.target.id);
    }, { rootMargin: '-90px 0px -48% 0px', threshold: [0, .2, .5] });
    sections.forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, [loading]);

  const currentOccupants = useMemo(() => occupants.filter(item => item.status === 'in_shelter'), [occupants]);
  const manifestBySosReportId = useMemo(
    () => new Map(manifests.map(manifest => [manifest.sos_report_id, manifest])),
    [manifests],
  );
  const currentStats = useMemo(() => currentOccupants.reduce(
    (total, item) => ({
      people: total.people + getMemberTotal(item),
      adults: total.adults + item.adult_count,
      children: total.children + item.child_count,
      elders: total.elders + item.elder_count,
      rescuer: total.rescuer + (item.entry_source === 'rescuer' ? getMemberTotal(item) : 0),
      self: total.self + (item.entry_source === 'self_registered' ? getMemberTotal(item) : 0),
    }),
    { people: 0, adults: 0, children: 0, elders: 0, rescuer: 0, self: 0 },
  ), [currentOccupants]);

  const capacity = Math.max(0, Number(shelter?.capacity ?? 0));
  const hasCapacity = capacity > 0;
  const capacityRate = hasCapacity ? Math.min(100, Math.round((currentStats.people / capacity) * 100)) : 0;
  const remainingCapacity = hasCapacity ? Math.max(capacity - currentStats.people, 0) : null;
  const chartData = useMemo(() => buildChartData(occupants, chartRange), [chartRange, occupants]);
  const chartMaximum = Math.max(4, ...chartData.map(bucket => bucket.rescuer + bucket.self + bucket.home));
  const chartHasData = chartData.some(bucket => bucket.rescuer + bucket.self + bucket.home > 0);
  const chartTotals = chartData.reduce(
    (total, bucket) => ({ rescuer: total.rescuer + bucket.rescuer, self: total.self + bucket.self, home: total.home + bucket.home }),
    { rescuer: 0, self: 0, home: 0 },
  );

  const filteredOccupants = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('th-TH');
    return occupants
      .filter(item => item.status === tab)
      .filter(item => !keyword || item.full_name.toLocaleLowerCase('th-TH').includes(keyword) || item.phone?.includes(keyword))
      .sort((a, b) => {
        const aTime = new Date(tab === 'exited' ? (a.exit_date ?? a.entry_date) : a.entry_date).getTime();
        const bTime = new Date(tab === 'exited' ? (b.exit_date ?? b.entry_date) : b.entry_date).getTime();
        return bTime - aTime;
      });
  }, [occupants, search, tab]);

  const saveCapacity = async () => {
    if (!shelterId || !profile || saving) return;
    const nextCapacity = Math.floor(Number(capacityDraft));
    if (!Number.isFinite(nextCapacity) || nextCapacity < 1) {
      setNotice({ type: 'error', message: 'กรุณาระบุความจุอย่างน้อย 1 คน' });
      return;
    }
    if (nextCapacity < currentStats.people) {
      setNotice({ type: 'error', message: `ความจุต้องไม่น้อยกว่าผู้ที่อยู่ในศูนย์ปัจจุบัน ${currentStats.people} คน` });
      return;
    }

    setSaving(true);
    try {
      let { error } = await supabase.rpc('update_shelter_capacity', {
        p_shelter_id: shelterId,
        p_capacity: nextCapacity,
      });
      const missingRpc = error?.code === 'PGRST202' || error?.message?.includes('update_shelter_capacity');
      if (missingRpc) {
        ({ error } = await supabase.from('shelters').update({ capacity: nextCapacity }).eq('id', shelterId));
      }
      if (error) throw error;
      setShelter(current => current ? { ...current, capacity: nextCapacity } : current);
      setCapacityDraft(String(nextCapacity));
      setNotice({ type: 'success', message: `อัปเดตความจุศูนย์เป็น ${nextCapacity.toLocaleString('th-TH')} คนแล้ว` });
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, 'อัปเดตความจุศูนย์ไม่สำเร็จ') });
    } finally {
      setSaving(false);
    }
  };

  const submitAddOccupant = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile || saving) return;

    const fullName = addDraft.fullName.trim();
    const counts = [addDraft.adult, addDraft.child, addDraft.elder].map(value => Math.max(0, Math.floor(Number(value) || 0)));
    const incomingTotal = counts.reduce((sum, value) => sum + value, 0);
    if (!fullName) {
      setNotice({ type: 'error', message: 'กรุณากรอกชื่อผู้ลงทะเบียน' });
      return;
    }
    if (incomingTotal < 1) {
      setNotice({ type: 'error', message: 'จำนวนผู้เข้าพักต้องมีอย่างน้อย 1 คน' });
      return;
    }
    if (hasCapacity && currentStats.people + incomingTotal > capacity) {
      setNotice({
        type: 'error',
        message: `ศูนย์เหลือที่ว่าง ${Math.max(capacity - currentStats.people, 0)} คน ไม่สามารถรับเพิ่ม ${incomingTotal} คนได้`,
      });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('shelter_occupants').insert({
        shelter_id: shelterId,
        full_name: fullName,
        phone: addDraft.phone.trim() || null,
        adult_count: counts[0],
        child_count: counts[1],
        elder_count: counts[2],
        entry_source: 'self_registered',
        status: 'in_shelter',
        entry_date: new Date().toISOString(),
        registered_by: profile.id,
      });
      if (error) throw error;
      setAddDraft(EMPTY_ADD_DRAFT);
      setShowAddForm(false);
      setNotice({ type: 'success', message: `เพิ่ม ${fullName} เข้าศูนย์แล้ว` });
      await loadDashboard();
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, 'เพิ่มรายชื่อไม่สำเร็จ') });
    } finally {
      setSaving(false);
    }
  };

  const submitExit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!exitDraft || saving) return;
    if (!exitDraft.destination) {
      setNotice({ type: 'error', message: 'กรุณาเลือกปลายทางหลังออกจากศูนย์' });
      return;
    }

    const exitDateTime = parseLocalDateTime(exitDraft.exitDate, exitDraft.exitTime);
    if (!exitDateTime) {
      setNotice({ type: 'error', message: 'กรุณาระบุวันที่และเวลาออกให้ถูกต้อง' });
      return;
    }
    if (exitDateTime.getTime() > Date.now() + 60_000) {
      setNotice({ type: 'error', message: 'เวลาออกต้องไม่เกินเวลาปัจจุบัน' });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.rpc('confirm_shelter_exit', {
        p_occupant_id: exitDraft.occupantId,
        p_exit_destination: exitDraft.destination,
        p_exit_at: exitDateTime.toISOString(),
        p_exit_note: exitDraft.note.trim() || null,
      });
      if (error) {
        if (error.code === 'PGRST202' || error.message?.includes('confirm_shelter_exit')) {
          throw new Error('ยังไม่ได้ติดตั้งระบบยืนยันออกจากศูนย์ กรุณารัน migration 202608190001 ก่อนใช้งาน');
        }
        throw error;
      }

      const name = exitDraft.fullName;
      const returnedHome = exitDraft.destination === 'home';
      setExitDraft(null);
      setNotice({
        type: 'success',
        message: returnedHome
          ? `ยืนยันการออกของ ${name} แล้ว และสร้างรายการติดตามหลังกลับบ้านอัตโนมัติ`
          : `ยืนยันการออกของ ${name} แล้ว`,
      });
      await loadDashboard();
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, 'บันทึกการออกไม่สำเร็จ') });
    } finally {
      setSaving(false);
    }
  };

  const openExitDialog = (occupant: Occupant) => {
    const now = new Date();
    setExitDraft({
      occupantId: occupant.id,
      fullName: occupant.full_name,
      destination: null,
      note: '',
      exitDate: toLocalDateInput(now),
      exitTime: toLocalTimeInput(now),
    });
  };

  const scrollToSection = (sectionId: 'overview' | 'activity', nextTab?: OccupantTab) => {
    setActiveSection(sectionId);
    if (nextTab) setTab(nextTab);
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/');
  };

  if (loading) return <DashboardSkeleton />;

  if (dataError && !shelter) {
    return (
      <main className={styles.fatalState}>
        <span><AlertCircle size={28} /></span>
        <h1>เปิดหน้าแดชบอร์ดไม่ได้</h1>
        <p>{dataError}</p>
        <button onClick={() => window.location.reload()}><RefreshCw size={17} /> ลองอีกครั้ง</button>
      </main>
    );
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.rail} aria-label="เมนูศูนย์พักพิง">
        <button className={styles.railBrand} onClick={() => scrollToSection('overview')} aria-label="กลับไปด้านบน"><ShieldCheck size={23} /></button>
        <nav>
          <button className={activeSection === 'overview' ? styles.railActive : ''} onClick={() => scrollToSection('overview')} aria-label="ภาพรวม"><LayoutDashboard size={19} /><span>ภาพรวม</span></button>
          <button className={activeSection === 'activity' && tab === 'in_shelter' ? styles.railActive : ''} onClick={() => scrollToSection('activity', 'in_shelter')} aria-label="ผู้พักพิงปัจจุบัน"><Users size={19} /><span>ผู้พักพิง</span></button>
          <button className={activeSection === 'activity' && tab === 'exited' ? styles.railActive : ''} onClick={() => scrollToSection('activity', 'exited')} aria-label="ประวัติการออก"><History size={19} /><span>ประวัติ</span></button>
        </nav>
        <button className={styles.logoutButton} onClick={handleLogout} aria-label="ออกจากระบบ"><LogOut size={19} /><span>ออกจากระบบ</span></button>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <div className={styles.shelterIdentity}>
            <span><Building2 size={20} /></span>
            <div><strong>{shelter?.name ?? 'ศูนย์พักพิง'}</strong><small>{PROJECT_NAME}</small></div>
          </div>
          <div className={styles.topbarActions}>
            <div className={`${styles.syncStatus} ${styles[realtimeState]}`}><i />{realtimeState === 'live' ? 'ข้อมูลสด' : realtimeState === 'connecting' ? 'กำลังเชื่อมต่อ' : 'ออฟไลน์'}</div>
            <button className={styles.refreshButton} onClick={() => void loadDashboard(true)} disabled={refreshing} aria-label="รีเฟรชข้อมูล"><RefreshCw className={refreshing ? styles.spinning : ''} size={17} /></button>
            <div className={styles.profileBlock}>
              <div><strong>{profile?.full_name || 'เจ้าหน้าที่'}</strong><small>{profile?.role === 'admin' ? 'ผู้ดูแลระบบ' : 'เจ้าหน้าที่ศูนย์พักพิง'}</small></div>
              <span>{getInitial(profile?.full_name)}</span>
            </div>
          </div>
        </header>

        <main className={styles.main}>
          {dataError && <div className={styles.inlineError}><AlertCircle size={17} /><span>{dataError}</span><button onClick={() => void loadDashboard(true)}>ลองใหม่</button></div>}

          <section className={styles.hero} id="overview">
            <div>
              <span className={styles.eyebrow}>SHELTER OPERATIONS</span>
              <h1>ภาพรวมศูนย์พักพิง</h1>
              <p><MapPin size={14} /> {shelter?.address || shelter?.province || 'ยังไม่ได้ระบุที่อยู่ศูนย์พักพิง'}</p>
            </div>
            <div className={styles.heroActions}>
              <span>{lastUpdated ? `อัปเดต ${formatRelativeUpdate(lastUpdated)}` : 'กำลังรอข้อมูลล่าสุด'}</span>
              <button onClick={() => setShowAddForm(true)}><Plus size={18} /> เพิ่มผู้ลงทะเบียน</button>
            </div>
          </section>

          <section className={styles.statGrid} aria-label="จำนวนผู้พักพิงปัจจุบัน">
            <StatCard icon={<Users size={20} />} label="อยู่ในศูนย์ทั้งหมด" value={currentStats.people} detail={`${currentOccupants.length} รายการ`} tone="blue" />
            <StatCard icon={<UserRound size={20} />} label="ผู้ใหญ่" value={currentStats.adults} detail={getPercentageLabel(currentStats.adults, currentStats.people)} />
            <StatCard icon={<Footprints size={20} />} label="เด็ก" value={currentStats.children} detail={getPercentageLabel(currentStats.children, currentStats.people)} tone="light" />
            <StatCard icon={<Accessibility size={20} />} label="ผู้สูงอายุ" value={currentStats.elders} detail={getPercentageLabel(currentStats.elders, currentStats.people)} tone="navy" />
          </section>

          <div className={styles.overviewGrid}>
            <section className={styles.chartPanel}>
              <div className={styles.panelHeader}>
                <div className={styles.panelTitle}>
                  <span><BarChart3 size={19} /></span>
                  <div><small>FLOW OVERVIEW</small><h2>ภาพรวมการเข้า–ออกศูนย์</h2><p>จำนวนคน แยกตามช่องทางและช่วงเวลาที่เกิดขึ้นจริง</p></div>
                </div>
                <div className={styles.rangeSwitch} aria-label="เลือกช่วงเวลาของกราฟ">
                  {RANGE_OPTIONS.map(option => <button key={option.value} className={chartRange === option.value ? styles.rangeActive : ''} onClick={() => setChartRange(option.value)}>{option.label}</button>)}
                </div>
              </div>

              <div className={styles.chartLegendRow}>
                <ChartLegend tone="rescuer" label="กู้ภัยพามา" value={chartTotals.rescuer} />
                <ChartLegend tone="self" label="เดินทางมาเอง" value={chartTotals.self} />
                <ChartLegend tone="home" label="กลับบ้าน" value={chartTotals.home} />
              </div>

              <div className={styles.chartCanvas}>
                <div className={styles.yAxis} aria-hidden="true"><span>{chartMaximum}</span><span>{Math.round(chartMaximum * .66)}</span><span>{Math.round(chartMaximum * .33)}</span><span>0</span></div>
                <div className={styles.plotArea} role="img" aria-label="กราฟแท่งแสดงจำนวนผู้เข้าศูนย์และผู้กลับบ้าน">
                  <div className={styles.gridLines}><i /><i /><i /><i /></div>
                  {chartData.map(bucket => {
                    const total = bucket.rescuer + bucket.self + bucket.home;
                    return (
                      <div className={styles.chartColumn} key={bucket.key}>
                        <div className={styles.chartTooltip}><strong>{bucket.detail}</strong><span><i className={styles.dotRescuer} />กู้ภัยพามา <b>{bucket.rescuer}</b></span><span><i className={styles.dotSelf} />เดินทางมาเอง <b>{bucket.self}</b></span><span><i className={styles.dotHome} />กลับบ้าน <b>{bucket.home}</b></span></div>
                        <button className={styles.chartBar} aria-label={`${bucket.detail} รวม ${total} คน`}>
                          <i className={styles.barRescuer} style={{ height: `${bucket.rescuer / chartMaximum * 100}%` }} />
                          <i className={styles.barSelf} style={{ height: `${bucket.self / chartMaximum * 100}%` }} />
                          <i className={styles.barHome} style={{ height: `${bucket.home / chartMaximum * 100}%` }} />
                        </button>
                        <span>{bucket.label}</span>
                      </div>
                    );
                  })}
                  {!chartHasData && <div className={styles.chartEmpty}><BarChart3 size={21} /><span>ยังไม่มีรายการในช่วงเวลานี้</span></div>}
                </div>
              </div>
            </section>

            <aside className={styles.insightColumn}>
              <section className={styles.capacityCard}>
                <div className={styles.compactHeading}><div><small>CAPACITY</small><h2>ความจุศูนย์</h2></div><span className={hasCapacity && capacityRate >= 85 ? styles.capacityWarning : styles.capacityOkay}>{hasCapacity ? (capacityRate >= 100 ? 'เต็ม' : capacityRate >= 85 ? 'ใกล้เต็ม' : 'พร้อมรับ') : 'รอกำหนด'}</span></div>
                <div className={`${styles.capacityRing} ${!hasCapacity ? styles.capacityUnknown : ''}`} style={{ '--rate': capacityRate } as React.CSSProperties}>
                  <div><strong>{hasCapacity ? `${capacityRate}%` : '—'}</strong><span>{hasCapacity ? 'ใช้งานแล้ว' : 'ไม่พบความจุ'}</span></div>
                </div>
                <p><strong>{currentStats.people.toLocaleString('th-TH')}</strong> <span>/ {hasCapacity ? capacity.toLocaleString('th-TH') : '—'} คน</span></p>
                <small>{remainingCapacity === null ? 'กรุณากำหนดความจุที่ศูนย์รองรับได้' : remainingCapacity === 0 ? 'ไม่มีที่ว่างคงเหลือ' : `รองรับได้อีก ${remainingCapacity.toLocaleString('th-TH')} คน`}</small>
                <div className={styles.capacityEditor}>
                  <label htmlFor="shelter-capacity">จำนวนที่ศูนย์รับได้สูงสุด</label>
                  <div>
                    <input id="shelter-capacity" type="number" inputMode="numeric" min={Math.max(1, currentStats.people)} value={capacityDraft} onChange={event => setCapacityDraft(event.target.value.replace(/\D/g, ''))} placeholder="เช่น 800" />
                    <button type="button" onClick={saveCapacity} disabled={saving}>{saving ? 'กำลังบันทึก' : 'บันทึก'}</button>
                  </div>
                  <span>เจ้าหน้าที่ศูนย์แก้ไขได้ และห้ามต่ำกว่าจำนวนคนที่อยู่จริง</span>
                </div>
              </section>

              <section className={styles.sourceCard}>
                <div className={styles.compactHeading}><div><small>REGISTRATION</small><h2>ที่มาของผู้พักพิง</h2></div></div>
                <SourceRow icon={<Truck size={16} />} label="กู้ภัยพามา" value={currentStats.rescuer} total={currentStats.people} tone="blue" />
                <SourceRow icon={<Footprints size={16} />} label="เดินทางมาเอง" value={currentStats.self} total={currentStats.people} tone="sky" />
              </section>

              <section className={styles.serviceCard}><span><CheckCircle2 size={19} /></span><div><strong>ศูนย์เปิดให้บริการ</strong><small>ระบบจะอัปเดตเมื่อมีการรับเข้าและยืนยันออก</small></div></section>
            </aside>
          </div>

          <section className={styles.activityPanel} id="activity">
            <div className={styles.activityHeader}>
              <div className={styles.panelTitle}>
                <span><Clock3 size={19} /></span>
                <div><small>OCCUPANT ACTIVITY</small><h2>รายชื่อและเวลาเข้า–ออก</h2><p>ค้นหา ตรวจสอบ และยืนยันการออกจากศูนย์ในจุดเดียว</p></div>
              </div>
              <div className={styles.activityTools}>
                <label className={styles.searchBox}><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="ค้นหาชื่อหรือเบอร์โทร" /><span>{filteredOccupants.length}</span></label>
                <div className={styles.tabs}>
                  <button className={tab === 'in_shelter' ? styles.tabActive : ''} onClick={() => setTab('in_shelter')}>อยู่ในศูนย์ <b>{currentOccupants.length}</b></button>
                  <button className={tab === 'exited' ? styles.tabActive : ''} onClick={() => setTab('exited')}>ออกแล้ว <b>{occupants.length - currentOccupants.length}</b></button>
                </div>
              </div>
            </div>

            <div className={styles.tableScroller}>
              <div className={styles.tableHead}><span>ผู้พักพิง</span><span>ช่องทาง</span><span>มาถึงศูนย์</span><span>ออกจากศูนย์</span><span>สมาชิก</span><span>การจัดการ</span></div>
              <div className={styles.activityList}>
                {filteredOccupants.length === 0 ? (
                  <div className={styles.emptyState}><span><Users size={24} /></span><strong>{search ? 'ไม่พบรายชื่อที่ค้นหา' : 'ยังไม่มีรายการในหมวดนี้'}</strong><small>{search ? 'ลองค้นหาด้วยชื่อหรือเบอร์โทรอื่น' : 'รายการใหม่จะแสดงพร้อมวันและเวลาโดยอัตโนมัติ'}</small></div>
                ) : filteredOccupants.map(occupant => (
                  <OccupantRow
                    key={occupant.id}
                    occupant={occupant}
                    manifest={occupant.sos_report_id ? manifestBySosReportId.get(occupant.sos_report_id) : undefined}
                    onViewManifest={setSelectedManifest}
                    onExit={() => openExitDialog(occupant)}
                  />
                ))}
              </div>
            </div>
          </section>
        </main>
      </div>

      {notice && <div className={`${styles.toast} ${notice.type === 'error' ? styles.toastError : styles.toastSuccess}`} role="status">{notice.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}<span>{notice.message}</span><button onClick={() => setNotice(null)} aria-label="ปิดข้อความ"><X size={16} /></button></div>}

      {showAddForm && (
        <div className={styles.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget && !saving) setShowAddForm(false); }}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="add-title">
            <button className={styles.modalClose} onClick={() => setShowAddForm(false)} disabled={saving} aria-label="ปิด"><X size={19} /></button>
            <div className={styles.modalHeading}><span><Plus size={20} /></span><div><small>NEW OCCUPANT</small><h2 id="add-title">เพิ่มผู้ลงทะเบียน</h2><p>บันทึกผู้ที่เดินทางมายังศูนย์ด้วยตนเอง</p></div></div>
            <form className={styles.form} onSubmit={submitAddOccupant}>
              <label><span>ชื่อ–นามสกุล <b>*</b></span><input autoFocus value={addDraft.fullName} onChange={event => setAddDraft(current => ({ ...current, fullName: event.target.value }))} placeholder="กรอกชื่อผู้ลงทะเบียน" maxLength={120} /></label>
              <label><span>เบอร์โทรศัพท์</span><input inputMode="tel" value={addDraft.phone} onChange={event => setAddDraft(current => ({ ...current, phone: event.target.value }))} placeholder="เช่น 0812345678" maxLength={20} /></label>
              <fieldset><legend>จำนวนสมาชิก</legend><div className={styles.countGrid}>{(['adult', 'child', 'elder'] as const).map((key, index) => <label key={key}><span>{['ผู้ใหญ่', 'เด็ก', 'ผู้สูงอายุ'][index]}</span><input type="number" min={0} max={99} value={addDraft[key]} onChange={event => setAddDraft(current => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}</div></fieldset>
              <div className={styles.formSummary}><Users size={17} /><span>รวม <strong>{Math.max(0, addDraft.adult) + Math.max(0, addDraft.child) + Math.max(0, addDraft.elder)} คน</strong></span></div>
              <div className={styles.modalActions}><button type="button" onClick={() => setShowAddForm(false)} disabled={saving}>ยกเลิก</button><button className={styles.primaryButton} type="submit" disabled={saving}>{saving ? <><RefreshCw className={styles.spinning} size={17} /> กำลังบันทึก</> : <><Plus size={17} /> เพิ่มเข้าศูนย์</>}</button></div>
            </form>
          </section>
        </div>
      )}

      {exitDraft && (
        <div className={styles.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget && !saving) setExitDraft(null); }}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="exit-title">
            <button className={styles.modalClose} onClick={() => setExitDraft(null)} disabled={saving} aria-label="ปิด"><X size={19} /></button>
            <div className={styles.modalHeading}><span><LogOut size={20} /></span><div><small>CHECK OUT</small><h2 id="exit-title">ยืนยันออกจากศูนย์</h2><p>{exitDraft.fullName}</p></div></div>
            <form className={styles.form} onSubmit={submitExit}>
              <div className={styles.dateGrid}><label><span>วันที่ออก <b>*</b></span><input type="date" max={toLocalDateInput(new Date())} value={exitDraft.exitDate} onChange={event => setExitDraft(current => current ? ({ ...current, exitDate: event.target.value }) : current)} /></label><label><span>เวลาออก <b>*</b></span><input type="time" value={exitDraft.exitTime} onChange={event => setExitDraft(current => current ? ({ ...current, exitTime: event.target.value }) : current)} /></label></div>
              <fieldset><legend>เดินทางไปที่ใด <b>*</b></legend><div className={styles.destinationGrid}>{(Object.keys(EXIT_LABEL) as ExitDestination[]).map(destination => <button type="button" key={destination} className={exitDraft.destination === destination ? styles.destinationSelected : ''} onClick={() => setExitDraft(current => current ? ({ ...current, destination }) : current)}>{destination === 'home' && <Home size={16} />}{EXIT_LABEL[destination]}</button>)}</div></fieldset>
              <label><span>รายละเอียดเพิ่มเติม</span><textarea rows={3} value={exitDraft.note} onChange={event => setExitDraft(current => current ? ({ ...current, note: event.target.value }) : current)} placeholder="เช่น ผู้มารับ หรือหมายเหตุการเดินทาง" maxLength={500} /></label>
              <div className={styles.modalActions}><button type="button" onClick={() => setExitDraft(null)} disabled={saving}>ยกเลิก</button><button className={styles.primaryButton} type="submit" disabled={saving}>{saving ? <><RefreshCw className={styles.spinning} size={17} /> กำลังบันทึก</> : <><CheckCircle2 size={17} /> ยืนยันคนออก</>}</button></div>
            </form>
          </section>
        </div>
      )}

      {selectedManifest && (
        <div className={styles.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) setSelectedManifest(null); }}>
          <section className={`${styles.modal} ${styles.manifestModal}`} role="dialog" aria-modal="true" aria-labelledby="manifest-title">
            <button className={styles.modalClose} onClick={() => setSelectedManifest(null)} aria-label="ปิด"><X size={19} /></button>
            <div className={styles.modalHeading}>
              <span><ClipboardList size={20} /></span>
              <div>
                <small>DELIVERY MANIFEST</small>
                <h2 id="manifest-title">บัญชีรายชื่อการนำส่ง</h2>
                <p>ตรวจสอบจำนวนจากคำร้องเทียบกับปลายทางจริงของทุกคน</p>
              </div>
            </div>

            <div className={styles.manifestSummary}>
              <div><small>คำร้องเดิม</small><strong>{getManifestRequestedTotal(selectedManifest)} คน</strong></div>
              <div><small>มีข้อมูลปลายทาง</small><strong>{selectedManifest.accounted_total} คน</strong></div>
              <div><small>มาถึงศูนย์</small><strong>{selectedManifest.primary_destination_total} คน</strong></div>
              <div className={selectedManifest.hospital_total > 0 ? styles.manifestHospital : ''}><small>ส่งโรงพยาบาล</small><strong>{selectedManifest.hospital_total} คน</strong></div>
              <div className={selectedManifest.deceased_total > 0 ? styles.manifestRed : ''}><small>เสียชีวิต</small><strong>{selectedManifest.deceased_total} คน</strong></div>
            </div>

            {(selectedManifest.accounted_total !== getManifestRequestedTotal(selectedManifest) || selectedManifest.count_discrepancy_note) && (
              <div className={styles.manifestWarning}>
                <AlertCircle size={18} />
                <div>
                  <strong>จำนวนต้องตรวจสอบเพิ่มเติม</strong>
                  <p>{selectedManifest.count_discrepancy_note || 'จำนวนในบัญชีรายชื่อไม่ตรงกับคำร้องเดิม'}</p>
                </div>
              </div>
            )}

            <div className={styles.manifestPeople}>
              {[...selectedManifest.rescue_delivery_people]
                .sort((a, b) => a.sequence_no - b.sequence_no)
                .map(person => (
                  <article
                    key={person.id}
                    className={
                      person.destination_type === 'hospital'
                        ? styles.personHospital
                        : person.destination_type === 'deceased'
                          ? styles.personDeceased
                          : styles.personArrived
                    }
                  >
                    <span>
                      {person.destination_type === 'hospital'
                        ? <Hospital size={18} />
                        : person.destination_type === 'deceased'
                          ? <Skull size={18} />
                          : <CheckCircle2 size={18} />}
                    </span>
                    <div>
                      <strong>{person.sequence_no}. {person.full_name}</strong>
                      <small>
                        {getAgeGroupLabel(person.age_group)} · {getDestinationLabel(person.destination_type)}
                        {person.destination_name ? ` · ${person.destination_name}` : ''}
                      </small>
                      {person.notes && <p>{person.notes}</p>}
                    </div>
                  </article>
                ))}
            </div>

            <button className={styles.manifestDone} onClick={() => setSelectedManifest(null)}>ตรวจสอบแล้ว</button>
          </section>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, detail, tone = 'default' }: { icon: React.ReactNode; label: string; value: number; detail: string; tone?: 'default' | 'blue' | 'light' | 'navy' }) {
  return <article className={`${styles.statCard} ${styles[`stat_${tone}`]}`}><span>{icon}</span><div><small>{label}</small><strong>{value.toLocaleString('th-TH')}</strong><p>{detail}</p></div></article>;
}

function ChartLegend({ tone, label, value }: { tone: 'rescuer' | 'self' | 'home'; label: string; value: number }) {
  return <div className={styles.legendItem}><i className={styles[`dot_${tone}`]} /><div><span>{label}</span><strong>{value.toLocaleString('th-TH')} คน</strong></div></div>;
}

function SourceRow({ icon, label, value, total, tone }: { icon: React.ReactNode; label: string; value: number; total: number; tone: 'blue' | 'sky' }) {
  const rate = total > 0 ? Math.min(100, Math.round(value / total * 100)) : 0;
  return <div className={styles.sourceRow}><div><span className={styles[`source_${tone}`]}>{icon}</span><strong>{label}</strong><b>{value.toLocaleString('th-TH')}</b></div><div className={styles.sourceTrack}><i className={styles[`fill_${tone}`]} style={{ width: `${rate}%` }} /></div><small>{rate}% ของผู้พักพิงปัจจุบัน</small></div>;
}

function OccupantRow({
  occupant,
  manifest,
  onViewManifest,
  onExit,
}: {
  occupant: Occupant;
  manifest?: DeliveryManifest;
  onViewManifest: (manifest: DeliveryManifest) => void;
  onExit: () => void;
}) {
  const memberTotal = getMemberTotal(occupant);
  return (
    <article className={styles.activityRow}>
      <div className={styles.personCell}><span>{getInitial(occupant.full_name)}</span><div><strong>{occupant.full_name}</strong><small>{occupant.phone || 'ไม่ระบุเบอร์โทร'}</small></div></div>
      <div><span className={`${styles.sourceBadge} ${occupant.entry_source === 'rescuer' ? styles.badgeRescuer : styles.badgeSelf}`}>{occupant.entry_source === 'rescuer' ? <Truck size={13} /> : <Footprints size={13} />}{occupant.entry_source === 'rescuer' ? 'กู้ภัยพามา' : 'มาเอง'}</span></div>
      <DateTimeCell value={occupant.entry_date} />
      {occupant.exit_date ? <DateTimeCell value={occupant.exit_date} note={occupant.exit_destination ? EXIT_LABEL[occupant.exit_destination] : undefined} /> : <div className={`${styles.dateCell} ${styles.mutedCell}`}><strong>—</strong><small>ยังอยู่ในศูนย์</small></div>}
      <div className={styles.memberCell}><strong>{memberTotal} คน</strong><small>ผู้ใหญ่ {occupant.adult_count} · เด็ก {occupant.child_count} · สูงอายุ {occupant.elder_count}</small></div>
      <div className={styles.rowAction}>
        {manifest && <button className={styles.manifestButton} onClick={() => onViewManifest(manifest)}><ClipboardList size={13} /> ดูรายชื่อ</button>}
        {occupant.status === 'in_shelter'
          ? <button onClick={onExit}>ยืนยันคนออก</button>
          : <span>{occupant.exit_destination ? EXIT_LABEL[occupant.exit_destination] : 'ออกจากศูนย์แล้ว'}</span>}
      </div>
    </article>
  );
}

function DateTimeCell({ value, note }: { value: string; note?: string }) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <div className={`${styles.dateCell} ${styles.mutedCell}`}><strong>—</strong><small>ไม่พบข้อมูลเวลา</small></div>;
  return <div className={styles.dateCell}><strong>{date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</strong><small>{date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}{note ? ` · ${note}` : ''}</small></div>;
}

function DashboardSkeleton() {
  return <div className={styles.skeletonShell}><aside /><main><header /><section className={styles.skeletonHero} /><section className={styles.skeletonStats}>{Array.from({ length: 4 }, (_, index) => <i key={index} />)}</section><section className={styles.skeletonChart} /><section className={styles.skeletonTable} /></main></div>;
}

function buildChartData(occupants: Occupant[], range: ChartRange): ChartBucket[] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let bucketCount = 8;
  let bucketDuration = 3 * 60 * 60 * 1000;

  if (range === 'week') {
    start.setDate(start.getDate() - 6);
    bucketCount = 7;
    bucketDuration = 24 * 60 * 60 * 1000;
  } else if (range === 'month') {
    start.setDate(start.getDate() - 29);
    bucketCount = 10;
    bucketDuration = 3 * 24 * 60 * 60 * 1000;
  }

  const buckets = Array.from({ length: bucketCount }, (_, index): ChartBucket => {
    const bucketStart = new Date(start.getTime() + index * bucketDuration);
    const bucketEnd = new Date(bucketStart.getTime() + bucketDuration - 1);
    const label = range === 'day'
      ? `${String(bucketStart.getHours()).padStart(2, '0')}:00`
      : range === 'week'
        ? bucketStart.toLocaleDateString('th-TH', { weekday: 'short' })
        : bucketStart.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
    const detail = range === 'day'
      ? `${bucketStart.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} เวลา ${label}–${String(bucketEnd.getHours()).padStart(2, '0')}:59 น.`
      : range === 'week'
        ? bucketStart.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'short' })
        : `${bucketStart.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}–${bucketEnd.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}`;
    return { key: bucketStart.toISOString(), label, detail, rescuer: 0, self: 0, home: 0 };
  });

  const addEvent = (dateValue: string | null | undefined, field: 'rescuer' | 'self' | 'home', count: number) => {
    if (!dateValue || count < 1) return;
    const eventTime = new Date(dateValue).getTime();
    if (Number.isNaN(eventTime)) return;
    const index = Math.floor((eventTime - start.getTime()) / bucketDuration);
    if (index >= 0 && index < buckets.length) buckets[index][field] += count;
  };

  occupants.forEach(occupant => {
    const count = getMemberTotal(occupant);
    addEvent(occupant.entry_date, occupant.entry_source === 'rescuer' ? 'rescuer' : 'self', count);
    if (occupant.exit_destination === 'home') addEvent(occupant.exit_date, 'home', count);
  });

  return buckets;
}

function getMemberTotal(occupant: Pick<Occupant, 'adult_count' | 'child_count' | 'elder_count'>) {
  return Math.max(0, Number(occupant.adult_count) || 0) + Math.max(0, Number(occupant.child_count) || 0) + Math.max(0, Number(occupant.elder_count) || 0);
}

function getManifestRequestedTotal(manifest: DeliveryManifest) {
  return Math.max(0, manifest.requested_adult_count)
    + Math.max(0, manifest.requested_child_count)
    + Math.max(0, manifest.requested_elder_count);
}

function getAgeGroupLabel(ageGroup: DeliveryPerson['age_group']) {
  if (ageGroup === 'child') return 'เด็ก';
  if (ageGroup === 'elder') return 'ผู้สูงอายุ';
  return 'ผู้ใหญ่';
}

function getDestinationLabel(destination: DeliveryPerson['destination_type']) {
  if (destination === 'hospital') return 'ส่งโรงพยาบาล (เคสแดง)';
  if (destination === 'deceased') return 'เสียชีวิต';
  if (destination === 'relative_home') return 'ถึงบ้านญาติ';
  if (destination === 'hotel') return 'ถึงโรงแรม';
  if (destination === 'other_safe') return 'ถึงพื้นที่ปลอดภัยอื่น';
  return 'มาถึงศูนย์พักพิง';
}

function isMissingManifestSchema(error: { code?: string; message?: string }) {
  return error.code === '42P01'
    || error.code === 'PGRST205'
    || Boolean(error.message?.includes('rescue_delivery_manifests'));
}

function getPercentageLabel(value: number, total: number) {
  return total > 0 ? `${Math.round(value / total * 100)}% ของผู้พักพิง` : 'ยังไม่มีผู้พักพิง';
}

function getInitial(name?: string | null) {
  return name?.trim().slice(0, 1).toLocaleUpperCase('th-TH') || '–';
}

function toLocalDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toLocalTimeInput(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function parseLocalDateTime(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const [hour, minute] = timeValue.split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatRelativeUpdate(date: Date) {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 20) return 'เมื่อสักครู่';
  if (seconds < 60) return `${seconds} วินาทีที่แล้ว`;
  return `${Math.floor(seconds / 60)} นาทีที่แล้ว`;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
