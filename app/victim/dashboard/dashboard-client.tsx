'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, ArrowLeft, Radio } from 'lucide-react';
import SosRequestForm from './sos-request-form';
import StatusTracker from './status-tracker';

type DashboardTab = 'sos' | 'status';

export default function VictimDashboard({ initialTab }: { initialTab: DashboardTab }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<DashboardTab>(initialTab);
  const [submittedPhone, setSubmittedPhone] = useState('');
  const headerTitle = activeTab === 'sos' ? 'แจ้งขอความช่วยเหลือ' : 'เช็คสถานะการช่วยเหลือ';

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
          <div><strong>{headerTitle}</strong><small>ช่วยเหลือและติดตามสถานะแบบเรียลไทม์</small></div>
        </div>
        <div className="victim-dashboard-live"><i /> พร้อมให้บริการ</div>
      </header>

      <main className="victim-dashboard-main">
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
