'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock3,
  MapPin,
  PackageOpen,
  Phone,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  UserRound,
  Waves,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getSavedPhone } from '@/lib/session';

type SosReport = {
  id: string;
  full_name: string;
  phone: string;
  province: string;
  district: string;
  sub_district: string | null;
  address_details: string | null;
  urgency_level: string;
  water_level: number | null;
  needed_items: string[] | null;
  special_needs: string | null;
  status: 'pending' | 'assigned' | 'rescued' | 'cannot_reach' | 'closed';
  created_at: string;
  updated_at?: string | null;
};

type VictimDestinationStatus = {
  status: 'waiting' | 'rescue_assigned' | 'rescued' | 'at_shelter' | 'returned_home' | 'unknown';
  shelter_name: string | null;
  notes: string | null;
  updated_at: string | null;
};

const STATUS_COPY: Record<SosReport['status'], { title: string; description: string; badge: string }> = {
  pending: { title: 'รับคำขอของคุณแล้ว', description: 'ศูนย์ประสานงานกำลังตรวจสอบข้อมูลและจัดทีมที่เหมาะสม', badge: 'กำลังประสานทีม' },
  assigned: { title: 'ทีมกู้ภัยกำลังเข้าช่วยเหลือ', description: 'เจ้าหน้าที่รับภารกิจแล้ว โปรดเปิดโทรศัพท์ไว้เพื่อรับการติดต่อ', badge: 'ทีมกำลังเดินทาง' },
  rescued: { title: 'ช่วยเหลือสำเร็จแล้ว', description: 'ภารกิจช่วยเหลือเสร็จสิ้นและมีการบันทึกผลเรียบร้อย', badge: 'สำเร็จ' },
  cannot_reach: { title: 'เจ้าหน้าที่ยังเข้าถึงพื้นที่ไม่ได้', description: 'ศูนย์กำลังประสานเส้นทางหรือข้อมูลเพิ่มเติม โปรดเปิดโทรศัพท์ไว้', badge: 'กำลังประสานใหม่' },
  closed: { title: 'ปิดภารกิจเรียบร้อย', description: 'รายการนี้ดำเนินการเสร็จสิ้นแล้ว', badge: 'ปิดภารกิจ' },
};

const TIMELINE_STEPS = [
  { title: 'ส่งข้อมูล SOS สำเร็จ', description: 'ข้อมูลติดต่อและตำแหน่งถูกส่งถึงศูนย์แล้ว', icon: Check },
  { title: 'ศูนย์กำลังประสานทีม', description: 'ตรวจสอบความเร่งด่วนและจัดเจ้าหน้าที่ในพื้นที่', icon: Radio },
  { title: 'ทีมกู้ภัยกำลังเดินทาง', description: 'เจ้าหน้าที่รับภารกิจและเดินทางไปยังพิกัด', icon: Truck },
  { title: 'ภารกิจเสร็จสิ้น', description: 'ผู้แจ้งเหตุได้รับการช่วยเหลือและอยู่ในจุดปลอดภัย', icon: ShieldCheck },
] as const;

function getTimelineIndex(status: SosReport['status']) {
  if (status === 'assigned') return 2;
  if (status === 'rescued' || status === 'closed') return 4;
  return 1;
}

export default function StatusTracker({
  initialPhone,
  onCreateRequest,
}: {
  initialPhone: string;
  onCreateRequest: () => void;
}) {
  const [searchPhone, setSearchPhone] = useState(() => initialPhone || getSavedPhone() || '');
  const [report, setReport] = useState<SosReport | null>(null);
  const [destinationStatus, setDestinationStatus] = useState<VictimDestinationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');

  const fetchReport = useCallback(async (phone: string) => {
    if (phone.length !== 10) return;
    setLoading(true);
    setError('');

    const { data, error: fetchError } = await supabase
      .from('sos_reports')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      setError('ไม่สามารถตรวจสอบสถานะได้ กรุณาลองใหม่อีกครั้ง');
      setReport(null);
    } else {
      const nextReport = data as SosReport | null;
      setReport(nextReport);
      if (nextReport) {
        const { data: statusData } = await supabase
          .from('victim_status')
          .select('status, shelter_name, notes, updated_at')
          .eq('sos_report_id', nextReport.id)
          .maybeSingle();
        setDestinationStatus(statusData as VictimDestinationStatus | null);
      } else {
        setDestinationStatus(null);
      }
    }
    setSearched(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (searchPhone.length !== 10) return;
    const task = window.setTimeout(() => { void fetchReport(searchPhone); }, 0);
    return () => window.clearTimeout(task);
  }, [fetchReport, searchPhone]);

  useEffect(() => {
    if (!report?.id) return;

    const channel = supabase
      .channel(`victim-status-${report.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sos_reports', filter: `id=eq.${report.id}` },
        (payload) => setReport(payload.new as SosReport),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'victim_status', filter: `sos_report_id=eq.${report.id}` },
        (payload) => setDestinationStatus(payload.new as VictimDestinationStatus),
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [report?.id]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    if (searchPhone.length === 10) void fetchReport(searchPhone);
  };

  const timelineIndex = report ? getTimelineIndex(report.status) : 0;
  const statusCopy = useMemo(() => {
    if (!report) return null;
    const base = STATUS_COPY[report.status];
    if (report.status === 'assigned' && destinationStatus?.notes) {
      return { ...base, description: destinationStatus.notes };
    }
    if (report.status === 'rescued' && destinationStatus?.status === 'at_shelter') {
      return {
        title: destinationStatus.shelter_name ? `ถึง${destinationStatus.shelter_name}แล้ว` : 'ถึงศูนย์พักพิงแล้ว',
        description: destinationStatus.notes || 'เจ้าหน้าที่นำส่งถึงศูนย์พักพิงเรียบร้อยแล้ว',
        badge: 'อยู่ที่ศูนย์พักพิง',
      };
    }
    if (report.status === 'rescued' && destinationStatus?.status === 'returned_home') {
      return {
        title: 'กลับถึงบ้านแล้ว',
        description: destinationStatus.notes || 'ออกจากศูนย์พักพิงและเดินทางกลับบ้านเรียบร้อยแล้ว',
        badge: 'กลับบ้าน',
      };
    }
    if (report.status === 'rescued' && destinationStatus?.notes) {
      return { ...base, description: destinationStatus.notes };
    }
    return base;
  }, [destinationStatus, report]);
  const updatedTime = useMemo(() => {
    if (!report) return '';
    return new Date(destinationStatus?.updated_at || report.updated_at || report.created_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  }, [destinationStatus?.updated_at, report]);

  return (
    <div className="status-tracker">
      <form className="status-search" onSubmit={submitSearch}>
        <div className="status-search-copy">
          <span><Search size={17} /></span>
          <div><strong>ค้นหาด้วยเบอร์โทรศัพท์</strong><small>ใช้เบอร์เดียวกับที่กรอกตอนส่งคำขอ SOS</small></div>
        </div>
        <div className="status-search-control">
          <Phone size={16} />
          <input type="tel" inputMode="numeric" maxLength={10} value={searchPhone} onChange={(event) => setSearchPhone(event.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="กรอกเบอร์โทร 10 หลัก" />
          <button type="submit" disabled={loading || searchPhone.length !== 10}>{loading ? <RefreshCw className="spin" size={15} /> : <Search size={15} />}<span>{loading ? 'กำลังค้นหา' : 'เช็คสถานะ'}</span></button>
        </div>
        {searchPhone.length > 0 && searchPhone.length < 10 && <p className="status-search-hint">กรุณากรอกเบอร์โทรให้ครบ 10 หลัก</p>}
      </form>

      {error && <div className="status-error" role="alert"><AlertCircle size={17} /> {error}</div>}

      {loading && <StatusSkeleton />}

      {!loading && report && statusCopy && (
        <div className="status-result">
          <section className={`status-overview status-${report.status}`}>
            <div className="status-overview-copy">
              <span className="status-live-label"><i /> อัปเดตสถานะล่าสุด</span>
              <h2>{statusCopy.title}</h2>
              <p>{statusCopy.description}</p>
              <span className="status-badge">{statusCopy.badge}</span>
            </div>
            <WaitingRescuer complete={report.status === 'rescued' || report.status === 'closed'} issue={report.status === 'cannot_reach'} />
          </section>

          <div className="status-content-grid">
            <section className="status-timeline-panel">
              <div className="status-section-heading"><div><span>PROGRESS</span><h3>ขั้นตอนการช่วยเหลือ</h3></div><small>อัปเดต {updatedTime}</small></div>
              <div className={`status-timeline ${report.status === 'cannot_reach' ? 'has-issue' : ''}`}>
                {TIMELINE_STEPS.map((item, index) => {
                  const isComplete = index < timelineIndex;
                  const isCurrent = index === timelineIndex && timelineIndex < TIMELINE_STEPS.length;
                  const isIssue = report.status === 'cannot_reach' && index === 1;
                  const Icon = isComplete ? Check : item.icon;
                  return (
                    <div className={`status-timeline-item ${isComplete ? 'complete' : ''} ${isCurrent ? 'current' : ''} ${isIssue ? 'issue' : ''}`} key={item.title}>
                      <span className="status-timeline-icon"><Icon size={15} strokeWidth={2.3} /></span>
                      <div><strong>{isIssue ? 'กำลังประสานเส้นทางใหม่' : item.title}</strong><p>{isIssue ? 'พื้นที่อาจเข้าถึงยาก เจ้าหน้าที่กำลังหาเส้นทางหรือขอข้อมูลเพิ่ม' : item.description}</p>{isCurrent && <small><Clock3 size={12} /> กำลังดำเนินการ</small>}</div>
                    </div>
                  );
                })}
              </div>
            </section>

            <aside className="status-detail-panel">
              <div className="status-section-heading"><div><span>REQUEST INFO</span><h3>รายละเอียดคำขอ</h3></div></div>
              <div className="status-person"><span><UserRound size={17} /></span><div><strong>{report.full_name}</strong><small>{report.phone}</small></div></div>
              <dl className="status-details">
                <div><dt><MapPin size={14} /> พื้นที่</dt><dd>{report.sub_district ? `ต.${report.sub_district} ` : ''}อ.{report.district} จ.{report.province}</dd></div>
                {report.address_details && <div><dt>จุดสังเกต</dt><dd>{report.address_details}</dd></div>}
                <div><dt><Waves size={14} /> ระดับน้ำ</dt><dd>{report.water_level ?? '-'} เมตร</dd></div>
                <div><dt><PackageOpen size={14} /> สิ่งของที่ต้องการ</dt><dd>{report.needed_items?.length ? report.needed_items.join(', ') : 'ไม่ได้ระบุ'}</dd></div>
                {destinationStatus && (destinationStatus.shelter_name || destinationStatus.notes) && (
                  <div className="important"><dt><ShieldCheck size={14} /> สถานที่ปัจจุบัน</dt><dd>{destinationStatus.shelter_name || destinationStatus.notes}{destinationStatus.shelter_name && destinationStatus.notes ? <><br />{destinationStatus.notes}</> : null}</dd></div>
                )}
                {report.special_needs && <div className="important"><dt><AlertCircle size={14} /> หมายเหตุสำคัญ</dt><dd>{report.special_needs}</dd></div>}
              </dl>
              <button className="status-refresh" onClick={() => fetchReport(searchPhone)} disabled={loading}><RefreshCw size={14} /> อัปเดตสถานะอีกครั้ง</button>
            </aside>
          </div>
        </div>
      )}

      {!loading && searched && !report && !error && (
        <div className="status-empty">
          <span><Search size={24} /></span><h2>ไม่พบคำขอจากเบอร์นี้</h2><p>ตรวจสอบเบอร์โทรอีกครั้ง หรือเริ่มส่งคำขอความช่วยเหลือใหม่</p><button onClick={onCreateRequest}>ขอความช่วยเหลือ</button>
        </div>
      )}

      {!loading && !searched && !report && (
        <div className="status-welcome">
          <WaitingRescuer />
          <div><span>ไม่ต้องกังวล เราอยู่กับคุณ</span><h2>กรอกเบอร์โทรเพื่อดูความคืบหน้า</h2><p>เมื่อสถานะเปลี่ยน หน้านี้จะอัปเดตแบบ Real-time โดยไม่ต้องส่งคำขอซ้ำ</p></div>
        </div>
      )}
    </div>
  );
}

function WaitingRescuer({ complete = false, issue = false }: { complete?: boolean; issue?: boolean }) {
  return (
    <div className={`waiting-rescuer ${complete ? 'complete' : ''} ${issue ? 'issue' : ''}`} aria-label={complete ? 'ภารกิจสำเร็จแล้ว' : 'เจ้าหน้าที่กำลังดำเนินการ'}>
      <span className="waiting-bubble one" /><span className="waiting-bubble two" />
      <div className="rescuer-character" aria-hidden="true">
        <div className="rescuer-head"><span className="rescuer-helmet"><i /></span><span className="rescuer-face"><i /><i /></span></div>
        <div className="rescuer-body"><span className="rescuer-badge">+</span><i className="rescuer-arm" /></div>
      </div>
      <div className="rescuer-shadow" aria-hidden="true" />
      <span className="waiting-check">{issue ? '!' : <CheckCircle2 size={18} />}</span>
    </div>
  );
}

function StatusSkeleton() {
  return <div className="status-skeleton" role="status" aria-label="กำลังค้นหาสถานะ"><div /><span /><span /><span /></div>;
}
