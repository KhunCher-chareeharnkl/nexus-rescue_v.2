'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { Activity, Clock3, MapPin, RefreshCw, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { RescuerMapMarker } from '@/components/rescuer-location-map';
import styles from './admin-rescuer-map-panel.module.css';

const RescuerLocationMap = dynamic(() => import('@/components/rescuer-location-map'), {
  ssr: false,
  loading: () => <div className={styles.mapLoading} role="status">กำลังโหลดแผนที่...</div>,
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

function getMapErrorMessage(error: { code?: string; message?: string; hint?: string }) {
  const message = error.message ?? '';
  if (error.code === 'PGRST202' || message.includes('get_admin_rescuer_locations')) {
    return 'ยังไม่ได้ติดตั้งฐานข้อมูลแผนที่กู้ภัย กรุณารัน migration 202610110001_rescuer_location_map_access.sql ใน Supabase SQL Editor';
  }
  if (error.code === '42501' || message.includes('Admin access required')) {
    return 'บัญชีนี้ไม่มีสิทธิ์ดูตำแหน่งกู้ภัย';
  }
  return message || error.hint || 'ไม่สามารถโหลดตำแหน่งกู้ภัยได้';
}

export default function AdminRescuerMapPanel() {
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const loadLocations = useCallback(async () => {
    setRefreshing(true);
    const { data, error: fetchError } = await supabase.rpc('get_admin_rescuer_locations');
    if (fetchError) {
      setError(getMapErrorMessage(fetchError));
    } else {
      setLocations((data as LocationRow[]) ?? []);
      setLastUpdated(new Date().toISOString());
      setError('');
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void loadLocations(); }, 0);
    const timer = window.setInterval(() => { void loadLocations(); }, 10_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, [loadLocations]);

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

  const availableCount = locations.filter((item) => item.availability === 'available').length;
  const busyCount = locations.filter((item) => item.availability === 'busy').length;
  const offlineCount = locations.filter((item) => item.availability === 'offline').length;

  return (
    <div className={styles.panel}>
      <section className={styles.intro}>
        <div className={styles.introCopy}>
          <span className={styles.eyebrow}><Activity size={14} /> ศูนย์ควบคุมกำลังปฏิบัติการ</span>
          <h2>ตำแหน่งทีมกู้ภัย</h2>
          <p>ติดตามตำแหน่งล่าสุดและความพร้อมของทีม เพื่อประสานงานช่วยเหลือได้ทันเวลา</p>
        </div>
        <div className={styles.liveStatus}>
          <span className={styles.liveDot} />
          <span>อัปเดตอัตโนมัติทุก 10 วินาที</span>
        </div>
      </section>

      <section className={styles.summary} aria-label="สรุปสถานะทีมกู้ภัย">
        <article className={`${styles.statCard} ${styles.statTotal}`}>
          <span className={styles.statIcon}><Users size={19} /></span>
          <span className={styles.statCopy}><small>แชร์ตำแหน่งล่าสุด</small><strong>{loading ? '—' : locations.length}<small> ทีม</small></strong></span>
        </article>
        <article className={`${styles.statCard} ${styles.statAvailable}`}>
          <span className={styles.statIcon}><span className={styles.statusDot} /></span>
          <span className={styles.statCopy}><small>พร้อมรับงาน</small><strong>{loading ? '—' : availableCount}<small> ทีม</small></strong></span>
        </article>
        <article className={`${styles.statCard} ${styles.statBusy}`}>
          <span className={styles.statIcon}><span className={styles.statusDot} /></span>
          <span className={styles.statCopy}><small>กำลังปฏิบัติการ</small><strong>{loading ? '—' : busyCount}<small> ทีม</small></strong></span>
        </article>
        <article className={`${styles.statCard} ${styles.statOffline}`}>
          <span className={styles.statIcon}><span className={styles.statusDot} /></span>
          <span className={styles.statCopy}><small>ไม่พร้อมรับงาน</small><strong>{loading ? '—' : offlineCount}<small> ทีม</small></strong></span>
        </article>
      </section>

      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void loadLocations()} disabled={refreshing}>
            <RefreshCw size={15} /> ลองอีกครั้ง
          </button>
        </div>
      )}

      <section className={styles.mapCard} aria-label="แผนที่ตำแหน่งกู้ภัย">
        <div className={styles.mapToolbar}>
          <div className={styles.mapHeading}>
            <span className={styles.mapIcon}><MapPin size={18} /></span>
            <div><strong>แผนที่ปฏิบัติการ</strong><small>แสดงตำแหน่งที่อัปเดตภายใน 15 นาทีล่าสุด</small></div>
          </div>
          <div className={styles.mapActions}>
            {lastUpdated && (
              <span className={styles.updatedAt}>
                <Clock3 size={14} />
                <span>อัปเดต {new Date(lastUpdated).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              </span>
            )}
            <button className={styles.refreshButton} type="button" onClick={() => void loadLocations()} disabled={refreshing} aria-label="รีเฟรชตำแหน่งทีมกู้ภัย">
              <RefreshCw size={16} className={refreshing ? styles.spinning : undefined} />
              <span>{refreshing ? 'กำลังอัปเดต' : 'รีเฟรช'}</span>
            </button>
          </div>
        </div>

        <div className={styles.mapFrame}>
          {!loading && markers.length === 0 && (
            <div className={styles.emptyState} role="status">
              <span><MapPin size={20} /></span>
              <strong>ยังไม่มีทีมที่แชร์ตำแหน่งล่าสุด</strong>
              <small>แผนที่จะแสดงทีมเมื่อเจ้าหน้าที่เปิดแชร์ตำแหน่ง</small>
            </div>
          )}
          <RescuerLocationMap markers={markers} height={560} />
        </div>

        <footer className={styles.mapFooter}>
          <span className={styles.freshness}><i /> แสดงเฉพาะพิกัดไม่เกิน 15 นาที</span>
          <div className={styles.legend} aria-label="คำอธิบายสีหมุด">
            <span><i className={styles.legendAvailable} /> พร้อมรับงาน</span>
            <span><i className={styles.legendBusy} /> กำลังปฏิบัติการ</span>
            <span><i className={styles.legendOffline} /> ไม่พร้อมรับงาน</span>
          </div>
        </footer>
      </section>
    </div>
  );
}
