'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { RescuerMapMarker } from '@/components/rescuer-location-map';

const RescuerLocationMap = dynamic(() => import('@/components/rescuer-location-map'), {
  ssr: false,
  loading: () => <div style={{ height: 380, borderRadius: 16, background: '#EEF4FA' }} />,
});

type LocationRow = {
  agency: string;
  assignment_status: string;
  latitude: number;
  longitude: number;
  location_updated_at: string;
};

export default function VictimRescuerMapModal({
  reportId,
  phone,
  onClose,
}: {
  reportId: string;
  phone: string;
  onClose: () => void;
}) {
  const [location, setLocation] = useState<LocationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      const { data, error: fetchError } = await supabase.rpc('get_victim_assigned_rescuer_location', {
        p_sos_report_id: reportId,
        p_phone: phone,
      });
      if (fetchError) {
        setError('ไม่สามารถโหลดตำแหน่งทีมกู้ภัยได้');
      } else {
        setLocation(((data as LocationRow[] | null) ?? [])[0] ?? null);
        setError('');
      }
      setLoading(false);
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [phone, reportId]);

  const markers: RescuerMapMarker[] = location ? [{
    id: reportId,
    label: location.agency || 'ทีมกู้ภัยที่ได้รับมอบหมาย',
    assignmentStatus: location.assignment_status,
    availability: 'busy',
    latitude: location.latitude,
    longitude: location.longitude,
    updatedAt: location.location_updated_at,
  }] : [];

  return (
    <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'grid', placeItems: 'center', padding: 16, background: 'rgba(0,18,51,.58)', backdropFilter: 'blur(5px)' }}>
      <section role="dialog" aria-modal="true" aria-labelledby="rescuer-map-title" style={{ width: 'min(100%, 680px)', overflow: 'hidden', borderRadius: 22, background: '#fff', boxShadow: '0 24px 70px rgba(0,18,51,.3)' }}>
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '20px 20px 15px' }}>
          <div><h2 id="rescuer-map-title" style={{ margin: 0, color: '#001845', fontSize: 20 }}>ตำแหน่งทีมกู้ภัย</h2><p style={{ margin: '4px 0 0', color: '#5C677D', fontSize: 13 }}>แสดงเฉพาะทีมที่ได้รับมอบหมายให้ช่วยเคสนี้</p></div>
          <button type="button" onClick={onClose} aria-label="ปิดแผนที่" style={{ border: '1px solid #DDE3EC', borderRadius: 10, width: 36, height: 36, background: '#fff', color: '#33415C', cursor: 'pointer', fontSize: 20 }}>×</button>
        </header>
        <div style={{ padding: '0 20px 20px' }}>
          {loading ? <div style={{ height: 380, borderRadius: 16, background: '#EEF4FA' }} />
            : error ? <div style={{ padding: 24, borderRadius: 16, background: '#FFF1F0', color: '#B42318', textAlign: 'center' }}>{error}</div>
              : markers.length ? <RescuerLocationMap markers={markers} height={380} />
                : <div style={{ padding: 28, borderRadius: 16, background: '#F2F7FC', color: '#5C677D', textAlign: 'center' }}>ทีมกู้ภัยยังไม่ได้ส่งตำแหน่งล่าสุด กรุณาลองใหม่อีกครั้ง</div>}
        </div>
      </section>
    </div>
  );
}
