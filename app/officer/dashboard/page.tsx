'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface SOSReport {
  id: string;
  name: string;
  phone: string;
  report_type: string;
  location_details: string;
  latitude: number;
  longitude: number;
  status: 'pending' | 'assigned' | 'closed' | 'cannot_reach';
  created_at: string;
  items_requested?: string;
  district?: string;
}

export default function OfficerDashboard() {
  const router = useRouter();

  const [officer, setOfficer] = useState<any>(null);
  const [officerCoords, setOfficerCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [reports, setReports] = useState<SOSReport[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedDistrict, setSelectedDistrict] = useState<string>('all');
  const [loading, setLoading] = useState<boolean>(true);

  // 1. ตรวจสอบสิทธิ์การเข้าใช้งาน
  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/officer/login');
        return;
      }
      setOfficer(user);

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            setOfficerCoords({
              lat: position.coords.latitude,
              lng: position.coords.longitude
            });
          },
          (error) => console.error('Error getting location', error)
        );
      }
    };
    checkUser();
  }, [router]);

  // 2. ดึงข้อมูล SOS จาก Supabase
  useEffect(() => {
    if (!officer) return;

    const fetchInitialData = async () => {
      const { data, error } = await supabase
        .from('sos_reports')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data) {
        setReports(data as SOSReport[]);
      }
      setLoading(false);
    };

    fetchInitialData();

    // ระบบ Real-time
    const channel = supabase
      .channel('realtime_sos')
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'sos_reports' },
        (payload: any) => {
          if (payload.eventType === 'INSERT') {
            setReports((prev) => [payload.new as SOSReport, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setReports((prev) => prev.map((item) => item.id === payload.new.id ? (payload.new as SOSReport) : item));
          } else if (payload.eventType === 'DELETE') {
            setReports((prev) => prev.filter((item) => item.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [officer]);

  // 3. ฟังก์ชันคำนวณระยะทางห่างกัน
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return (R * c).toFixed(1);
  };

  // 4. ฟังก์ชันอัปเดตสถานะ (แก้ไขใหม่ให้ลื่นไหลขึ้น)
 // เปลี่ยน parameter จาก accepted/completed เป็น assigned/closed
const updateCaseStatus = async (reportId: string, nextStatus: 'assigned' | 'closed' | 'cannot_reach', reason?: string) => {
  try {
    // อัปเดตหน้าจอทันที (Optimistic Update)
    setReports((prev) =>
      prev.map((item) => (item.id === reportId ? { ...item, status: nextStatus } : item))
    );

    // อัปเดตฐานข้อมูล
    const { error: updateReportError } = await supabase
      .from('sos_reports')
      .update({ status: nextStatus })
      .eq('id', reportId);

    if (updateReportError) throw updateReportError;

    // ส่วนของตาราง assignments (ถ้ามี)
    if (officer?.id) {
      const assignmentData: any = {
        sos_report_id: reportId,
        rescuer_id: officer.id,
        status: nextStatus,
        notes: reason || null,
      };

      if (nextStatus === 'assigned') { // เปลี่ยนตรงนี้
        assignmentData.accepted_at = new Date().toISOString();
      } else if (nextStatus === 'closed') { // เปลี่ยนตรงนี้
        assignmentData.completed_at = new Date().toISOString();
      }
      
      // ... โค้ด insert ลง assignments เหมือนเดิม

        const { error: assignmentError } = await supabase
          .from('assignments')
          .upsert(assignmentData, { onConflict: 'sos_report_id' });

        if (assignmentError) {
          console.warn('บันทึกประวัติการรับงานไม่ได้ (อาจยังไม่ได้สร้างตาราง assignments):', assignmentError.message);
        }
      }

      // แจ้งเตือนเมื่อทำงานเสร็จสิ้น
      alert('📌 อัปเดตสถานะภารกิจเรียบร้อยแล้ว');

    } catch (error: any) {
      console.error('Error updating status:', error);
      alert(`ไม่สามารถอัปเดตสถานะได้: ${error.message || 'กรุณาลองใหม่อีกครั้ง'}`);
      // หากพลาด ให้รีเฟรชหน้าเพื่อให้ข้อมูลกลับมาตรงกับฐานข้อมูลจริง
      window.location.reload(); 
    }
  };

  // 5. ออกจากระบบ
  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const sortedAndFilteredReports = reports
    .filter((r) => filterStatus === 'all' || r.status === filterStatus)
    .filter((r) => selectedDistrict === 'all' || r.district === selectedDistrict)
    .sort((a, b) => {
      if (!officerCoords) return 0;
      const distA = parseFloat(calculateDistance(officerCoords.lat, officerCoords.lng, a.latitude, a.longitude) || '999');
      const distB = parseFloat(calculateDistance(officerCoords.lat, officerCoords.lng, b.latitude, b.longitude) || '999');
      return distA - distB;
    });

  const uniqueDistricts = Array.from(new Set(reports.map(r => r.district).filter(Boolean)));

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center font-bold text-slate-500 animate-pulse">
        🛰️ กำลังตรวจสอบสิทธิ์และเชื่อมต่อฐานข้อมูลเรียลไทม์...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 flex flex-col justify-between pb-12">
      
      <header className="p-6 bg-gradient-to-br from-blue-700 to-indigo-600 text-white rounded-b-[2.5rem] shadow-[0_8px_20px_-6px_rgba(37,99,235,0.5)]">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider opacity-80">ศูนย์ปฏิบัติการกู้ภัยภาคสนาม</p>
            <h1 className="text-2xl font-bold mt-0.5 tracking-tight">Nexus Rescue Command</h1>
            <p className="text-xs text-blue-100/80 mt-1">เจ้าหน้าที่: {officer?.email}</p>
          </div>
          <button 
            onClick={handleLogout}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 active:scale-95 text-xs font-bold rounded-xl border border-white/20 shadow-[inner_0_2px_4px_rgba(255,255,255,0.1)] transition-all"
          >
            🚪 ออกจากระบบ
          </button>
        </div>
      </header>

      <main className="max-w-6xl w-full mx-auto p-4 flex-1 space-y-6 mt-4">
        
        <div className="bg-white p-6 rounded-[2rem] shadow-[0_4px_12px_rgba(0,0,0,0.02)] border border-slate-200/60 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-ping"></span>
                ระบบกระจายงานตามพิกัดดาวเทียม (เรียงตามระยะใกล้สุด)
              </h2>
            </div>

            <div className="flex items-center gap-2 text-xs font-bold">
              <span className="text-slate-500">📍 ตัวกรองพื้นที่:</span>
              <select 
                value={selectedDistrict} 
                onChange={(e) => setSelectedDistrict(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">ทุกพื้นที่ / ทุกอำเภอ</option>
                {uniqueDistricts.map(dist => <option key={dist} value={dist}>{dist}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap bg-slate-100 p-1 rounded-2xl border border-slate-200/60 text-xs font-bold w-max">
            <button onClick={() => setFilterStatus('all')} className={`px-4 py-2 rounded-xl transition ${filterStatus === 'all' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>ทั้งหมด</button>
            <button onClick={() => setFilterStatus('pending')} className={`px-4 py-2 rounded-xl transition ${filterStatus === 'pending' ? 'bg-rose-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>🚨 รอคนไปช่วย</button>
            <button onClick={() => setFilterStatus('accepted')} className={`px-4 py-2 rounded-xl transition ${filterStatus === 'accepted' ? 'bg-amber-500 text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>🚒 กำลังช่วย</button>
            <button onClick={() => setFilterStatus('completed')} className={`px-4 py-2 rounded-xl transition ${filterStatus === 'completed' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>✅ สำเร็จ</button>
            <button onClick={() => setFilterStatus('cannot_reach')} className={`px-4 py-2 rounded-xl transition ${filterStatus === 'cannot_reach' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>⚠️ เข้าไม่ถึง</button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sortedAndFilteredReports.length === 0 ? (
            <div className="col-span-full bg-white text-center py-12 rounded-[2rem] border border-slate-200 text-slate-400 font-medium">
              📭 ไม่พบรายการแจ้งเหตุที่ตรงกับเงื่อนไขที่เลือก
            </div>
          ) : (
            sortedAndFilteredReports.map((item) => {
              const distance = officerCoords ? calculateDistance(officerCoords.lat, officerCoords.lng, item.latitude, item.longitude) : null;
              
              return (
                <div 
                  key={item.id} 
                  className={`p-6 bg-white rounded-[2rem] border transition-all shadow-[0_4px_12px_rgba(0,0,0,0.02)] flex flex-col justify-between ${
                    item.status === 'pending' ? 'border-rose-200 ring-2 ring-rose-500/5' :
                    item.status === 'assigned' ? 'border-amber-200 ring-2 ring-amber-500/5' :
                    item.status === 'cannot_reach' ? 'border-purple-300 bg-purple-50/10' : 'border-slate-200 opacity-70'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex justify-between items-start">
                      <span className={`px-3 py-1 rounded-xl text-xs font-bold ${
                        item.status === 'pending' ? 'bg-rose-100 text-rose-600' :
                        item.status === 'assigned' ? 'bg-amber-100 text-amber-700' :
                        item.status === 'cannot_reach' ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {item.status === 'pending' && '🚨 รอการช่วยเหลือด่วน'}
                        {item.status === 'assigned' && '🚒 มีทีมกู้ภัยกำลังไป'}
                        {item.status === 'closed' && '✅ ปิดงานสำเร็จ'}
                        {item.status === 'cannot_reach' && '⚠️ วิกฤต! เข้าไม่ถึงพื้นที่'}
                      </span>
                      {distance && (
                        <span className="text-xs font-mono font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-xl border border-blue-100">
                          📍 ห่างจากคุณ {distance} กม.
                        </span>
                      )}
                    </div>

                    <div>
                      <h3 className="font-bold text-slate-800 text-lg">{item.name}</h3>
                      <p className="text-xs text-slate-500 font-mono mt-0.5">📞 เบอร์ติดต่อ: {item.phone}</p>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs space-y-1">
                      <p><strong className="text-slate-600">ประเภทเหตุ:</strong> {item.report_type}</p>
                      {item.items_requested && <p><strong className="text-slate-600">📦 ต้องการถุงยังชีพ:</strong> {item.items_requested}</p>}
                      <p className="text-slate-500 leading-relaxed"><strong className="text-slate-600">🏠 ที่อยู่/พิกัด:</strong> {item.location_details}</p>
                    </div>
                  </div>

                  <div className="mt-5 pt-4 border-t border-slate-100">
                    {item.status === 'pending' && (
                      <button
                        onClick={() => updateCaseStatus(item.id, 'assigned')}
                        className="w-full bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold p-3.5 rounded-xl transition shadow-[0_4px_10px_rgba(37,99,235,0.3)] hover:shadow-[0_6px_14px_rgba(37,99,235,0.4)] active:scale-[0.98]"
                      >
                        📥 กดรับภารกิจช่วยเหลือเคสนี้
                      </button>
                    )}

                    {item.status === 'assigned' && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => updateCaseStatus(item.id, 'closed')}
                            className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 px-2 rounded-xl text-xs transition shadow-md shadow-emerald-500/20"
                          >
                            ✔ สำเร็จภารกิจแล้ว
                          </button>
                          
                          <button
                            onClick={() => {
                              const reason = prompt('กรุณาระบุเหตุผล/อุปสรรคในการเข้าไม่ถึงพื้นที่ (เช่น กระแสน้ำเชี่ยวเกินไป, ต้องการเรือท้องแบน):');
                              if (reason) updateCaseStatus(item.id, 'cannot_reach', reason);
                            }}
                            className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-2 rounded-xl text-xs transition shadow-md shadow-purple-600/20"
                          >
                            ❌ เข้าไม่ถึง (แจ้งอุปสรรค)
                          </button>
                        </div>
                      </div>
                    )}

                    {item.status === 'closed' && (
                      <p className="text-center text-xs font-bold text-emerald-600 bg-emerald-50 py-2 rounded-xl">
                        🔒 เคสนี้ได้รับการช่วยเหลือสำเร็จเสร็จสิ้นแล้ว
                      </p>
                    )}

                    {item.status === 'cannot_reach' && (
                      <div className="bg-purple-50 border border-purple-100 p-3 rounded-xl space-y-2">
                        <p className="text-xs text-purple-800 font-medium">⚠️ เคสนี้ต้องการอุปกรณ์พิเศษหรือทีมสนับสนุนเพิ่มเติม</p>
                        <button
                          onClick={() => updateCaseStatus(item.id, 'assigned')}
                          className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-2 rounded-xl text-xs transition"
                        >
                          ↩️ ทีมเราพร้อมแล้ว ขอลองเข้าใหม่อีกครั้ง
                        </button>
                      </div>
                    )}
                  </div>

                </div>
              );
            })
          )}
        </div>

      </main>

    </div>
  );
}