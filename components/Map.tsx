'use client';

import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { createClient } from '@supabase/supabase-js';

// ตั้งค่า Supabase Client (ให้เปลี่ยน URL และ KEY เป็นของคุณเอง หรือ import จากไฟล์ตั้งค่าของคุณ)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// 1. ไอคอนปกติ (สำหรับศูนย์ประสานงาน)
const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

// 2. ไอคอนฉุกเฉิน (สีแดง) สำหรับผู้ประสบภัย
const sosIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

// กำหนด Type ให้กับข้อมูล SOS
interface SOSReport {
  id: string;
  full_name: string;
  phone: string;
  lat: number;
  lng: number;
  urgency_level: string;
  status: string;
  water_level: number;
}

export default function Map() {
  // พิกัดเริ่มต้น (หาดใหญ่ สงขลา)
  const defaultCenter: [number, number] = [7.0086, 100.4746]; 
  
  // State สำหรับเก็บข้อมูลพิกัดผู้ประสบภัย
  const [sosMarkers, setSosMarkers] = useState<SOSReport[]>([]);

  // ดึงข้อมูลจากฐานข้อมูลเมื่อ Component ถูกโหลด
  useEffect(() => {
    const fetchSOSReports = async () => {
      const { data, error } = await supabase
        .from('sos_reports')
        .select('id, full_name, phone, lat, lng, urgency_level, status, water_level')
        // ดึงเฉพาะเคสที่ยังไม่ถูกปิดการช่วยเหลือ และมีพิกัด
        .not('status', 'eq', 'closed')
        .not('lat', 'is', null)
        .not('lng', 'is', null);

      if (error) {
        console.error('Error fetching SOS reports:', error);
      } else if (data) {
        setSosMarkers(data as SOSReport[]);
      }
    };

    fetchSOSReports();

    // หากต้องการให้แผนที่อัปเดตแบบ Real-time เมื่อมีคนกด SOS เข้ามาใหม่ สามารถเปิดใช้ Realtime Subscription ของ Supabase ได้ตามนี้:
    /*
    const subscription = supabase
      .channel('public:sos_reports')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_reports' }, payload => {
        fetchSOSReports(); // โหลดข้อมูลใหม่เมื่อมีการเปลี่ยนแปลง
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
    */
  }, []);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <MapContainer 
        center={defaultCenter} 
        zoom={12} 
        style={{ width: '100%', height: '100%', zIndex: 10 }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {/* หมุดศูนย์ประสานงานกลาง */}
        <Marker position={defaultCenter} icon={defaultIcon}>
          <Popup>
            <div className="font-prompt text-sm">
              <strong>ศูนย์ประสานงานภัยพิบัติ</strong><br />
              กำลังติดตามสถานการณ์
            </div>
          </Popup>
        </Marker>

        {/* นำข้อมูล SOS มาวนลูปแสดงผลบนแผนที่ */}
        {sosMarkers.map((report) => (
          <Marker 
            key={report.id} 
            position={[report.lat, report.lng]} 
            icon={sosIcon}
          >
            <Popup>
              <div className="font-prompt text-sm space-y-1">
                <p className="font-bold text-red-600 text-base mb-1">🚨 ขอความช่วยเหลือ</p>
                <p><strong>ชื่อ:</strong> {report.full_name}</p>
                <p><strong>เบอร์โทร:</strong> {report.phone}</p>
                <p><strong>ความเร่งด่วน:</strong> {
                  report.urgency_level === 'critical' ? 'วิกฤต (สีแดง)' :
                  report.urgency_level === 'high' ? 'สูง (สีส้ม)' : 
                  report.urgency_level === 'medium' ? 'ปานกลาง (สีเหลือง)' : 'ทั่วไป'
                }</p>
                <p><strong>ระดับน้ำ:</strong> ระดับ {report.water_level}</p>
                <p><strong>สถานะ:</strong> {
                  report.status === 'pending' ? '⏳ รอรับเรื่อง' :
                  report.status === 'assigned' ? '🚒 กู้ภัยกำลังไป' :
                  report.status === 'cannot_reach' ? '❌ เข้าไม่ถึง' : '✅ ช่วยเหลือแล้ว'
                }[cite: 1]</p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}