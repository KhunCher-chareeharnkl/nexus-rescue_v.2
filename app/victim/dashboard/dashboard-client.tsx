'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, ArrowLeft, Radio, ShieldCheck } from 'lucide-react';
import SosRequestForm from './sos-request-form';
import StatusTracker from './status-tracker';

type DashboardTab = 'sos' | 'status';

export default function VictimDashboard({ initialTab }: { initialTab: DashboardTab }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<DashboardTab>(initialTab);
  const [submittedPhone, setSubmittedPhone] = useState('');

  const selectTab = (tab: DashboardTab) => {
    setActiveTab(tab);
    router.replace(`/victim/dashboard?tab=${tab}`, { scroll: false });
  };

  const handleSubmitted = (phone: string) => {
    setSubmittedPhone(phone);
    selectTab('status');
  };

  return (
    <div className="victim-dashboard">
      <header className="victim-dashboard-header">
        <button className="victim-home-button" onClick={() => router.push('/')} aria-label="กลับไปหน้าหลัก">
          <ArrowLeft size={18} strokeWidth={2.2} />
          <span>หน้าหลัก</span>
        </button>
        <div className="victim-dashboard-brand">
          <span><ShieldCheck size={18} strokeWidth={2.2} /></span>
          <div><strong>Nexus Rescue</strong><small>ระบบประสานงานช่วยเหลือ</small></div>
        </div>
        <div className="victim-dashboard-live"><i /> พร้อมให้บริการ</div>
      </header>

      <main className="victim-dashboard-main">
        <section className="victim-dashboard-intro">
          <span className="victim-dashboard-eyebrow">EMERGENCY ASSISTANCE</span>
          <h1>{activeTab === 'sos' ? 'แจ้งขอความช่วยเหลือ' : 'ติดตามการช่วยเหลือ'}</h1>
          <p>{activeTab === 'sos'
            ? 'กรอกข้อมูลตามขั้นตอน ระบบจะส่งพิกัดและรายละเอียดไปยังเจ้าหน้าที่ทันที'
            : 'ตรวจสอบความคืบหน้าแบบเข้าใจง่ายด้วยเบอร์โทรที่ใช้แจ้งเหตุ'}</p>
        </section>

        <nav className="victim-workspace-tabs" aria-label="เลือกพื้นที่ทำงาน">
          <button className={activeTab === 'sos' ? 'active' : ''} onClick={() => selectTab('sos')}>
            <span><Radio size={17} /></span>
            <div><strong>ขอความช่วยเหลือ</strong><small>ส่งข้อมูล SOS</small></div>
          </button>
          <button className={activeTab === 'status' ? 'active' : ''} onClick={() => selectTab('status')}>
            <span><Activity size={17} /></span>
            <div><strong>เช็คสถานะ</strong><small>ดูความคืบหน้า</small></div>
          </button>
        </nav>

        <section className="victim-workspace" key={activeTab}>
          {activeTab === 'sos'
            ? <SosRequestForm onSubmitted={handleSubmitted} />
            : <StatusTracker initialPhone={submittedPhone} onCreateRequest={() => selectTab('sos')} />}
        </section>
      </main>
    </div>
  );
}
