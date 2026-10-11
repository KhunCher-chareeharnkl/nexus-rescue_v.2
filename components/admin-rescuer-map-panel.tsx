'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { RescuerMapMarker } from '@/components/rescuer-location-map';

const RescuerLocationMap = dynamic(() => import('@/components/rescuer-location-map'), {
  ssr: false,
  loading: () => <div style={{ height: 420, borderRadius: 16, background: '#EEF4FA' }} />,
});

type LocationRow = {
  rescuer_id: string;
  display_name: string;
  agency: string | null;
  availability: 'available' | 'busy' | 'offline';
  latitude: number;
  longitude: number;
  location_updated_at: string;
  assignment_status: string | null;
};

export default function AdminRescuerMapPanel() {
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      const { data, error: fetchError } = await supabase.rpc('get_admin_rescuer_locations');
      if (fetchError) {
        setError('ไม่สามารถโหลดตำแหน่งกู้ภัยได้');
      } else {
        setLocations((data as LocationRow[]) ?? []);
        setError('');
      }
      setLoading(false);
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const markers: RescuerMapMarker[] = locations.map((item) => ({
    id: item.rescuer_id,
    label: item.agency || item.display_name || 'ทีมกู้ภัย',
    detail: item.agency ? item.display_name : null,
    availability: item.availability,
    assignmentStatus: item.assignment_status,
    latitude: item.latitude,
    longitude: item.longitude,
    updatedAt: item.location_updated_at,
  }));

  return (
    <div className="admin-panel" style={{ display: 'grid', gap: 16 }}>
      <section className="admin-form-card">
        <strong>ตำแหน่งทีมกู้ภัย</strong>
        <p style={{ margin: '4px 0 0', color: '#5C677D', fontSize: 13 }}>แสดงเฉพาะตำแหน่งที่อัปเดตใน 15 นาทีล่าสุด และรีเฟรชทุก 10 วินาที</p>
      </section>
      {error && <div className="admin-alert" style={{ padding: 13, background: '#FFF1F0', color: '#B42318', fontSize: 13 }}>{error}</div>}
      {loading ? <div style={{ height: 420, borderRadius: 16, background: '#EEF4FA' }} /> : markers.length ? (
        <RescuerLocationMap markers={markers} />
      ) : (
        <div className="admin-form-card" style={{ padding: 24, color: '#5C677D', textAlign: 'center' }}>ยังไม่มีทีมที่แชร์ตำแหน่งล่าสุด</div>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', color: '#5C677D', fontSize: 12 }}>
        <span>● น้ำเงิน: พร้อมรับงาน</span><span>● แดง: กำลังปฏิบัติภารกิจ</span><span>● เทา: ไม่พร้อมรับงาน</span>
      </div>
    </div>
  );
}
