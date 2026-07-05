'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

const MapComponent = dynamic(() => import('@/components/Map'), { 
  ssr: false,
  loading: () => <p className="text-slate-400 text-xs font-medium animate-pulse">กำลังโหลดแผนที่...</p>
});

export default function HomePage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 flex flex-col justify-between pb-24 md:pb-6">
      
      {/* Header */}
      <header className="p-6 bg-gradient-to-br from-blue-600 to-blue-500 text-white rounded-b-[2.5rem] shadow-[0_8px_20px_-6px_rgba(37,99,235,0.5)]">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider opacity-80">ระบบประสานงานภัยพิบัติ</p>
            <h1 className="text-2xl font-bold mt-0.5 tracking-tight">Nexus Rescue</h1>
          </div>
          <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center font-bold shadow-[inner_0_2px_4px_rgba(255,255,255,0.2)]">TH</div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl w-full mx-auto p-4 flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 items-start mt-4">
        
        {/* ฝั่งซ้าย */}
        <div className="space-y-6 w-full">
          <div className="bg-slate-50 p-6 rounded-[2rem] shadow-[0_4px_12px_rgba(0,0,0,0.03)] border border-white/60">
            <h2 className="text-sm font-bold mb-4 text-slate-500 uppercase tracking-wider">กรุณาเลือกบทบาทการใช้งาน</h2>
            <div className="grid grid-cols-1 gap-4">
              <button onClick={() => router.push('/victim/dashboard')} className="w-full bg-gradient-to-r from-rose-500 to-rose-400 text-white p-5 rounded-2xl flex items-center gap-4 transition-all active:scale-[0.98]">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center text-xl">🚨</div>
                <div className="text-left"><h3 className="font-bold text-lg">ต้องการความช่วยเหลือ (SOS)</h3><p className="text-xs text-rose-100 opacity-90">แจ้งเหตุน้ำท่วม ขออพยพ ขอเสบียง หรือยื่นเยียวยา</p></div>
              </button>
              <button onClick={() => router.push('/officer/dashboard')} className="w-full bg-gradient-to-r from-blue-700 to-indigo-600 text-white p-5 rounded-2xl flex items-center gap-4 transition-all active:scale-[0.98]">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center text-xl">🚒</div>
                <div className="text-left"><h3 className="font-bold text-lg">เจ้าหน้าที่กู้ภัย / หน่วยงาน</h3><p className="text-xs text-blue-100 opacity-90">เข้าสู่ระบบเพื่อรับเคสและอัปเดตสถานะการช่วยเหลือ</p></div>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button 
              onClick={() => router.push('/victim/shelter-list')} 
              className="p-4 bg-white hover:bg-slate-50 active:scale-[0.97] rounded-2xl text-center border border-slate-200/60 shadow-sm flex flex-col items-center justify-center gap-1"
            >
              <span className="text-2xl">🏠</span>
              <span className="text-xs font-bold text-slate-700">ดูรายชื่อศูนย์พักพิง</span>
            </button>
            
            <button 
              onClick={() => router.push('/victim/compensation')} 
              className="p-4 bg-white hover:bg-slate-50 active:scale-[0.97] rounded-2xl text-center border border-slate-200/60 shadow-sm flex flex-col items-center justify-center gap-1"
            >
              <span className="text-2xl">💰</span>
              <span className="text-xs font-bold text-slate-700">ยื่นเยียวยา</span>
            </button>
          </div>
        </div> {/* <--- ปิด div ฝั่งซ้ายที่ตรงนี้ครับ */}

        {/* ฝั่งขวา (แผนที่) */}
        <div className="bg-slate-50 p-4 rounded-[2rem] shadow-[0_4px_12px_rgba(0,0,0,0.03)] border border-white/60 h-[320px] md:h-[480px] w-full flex flex-col">
          <div className="flex justify-between items-center mb-3 px-1">
            <h3 className="font-bold text-slate-500 text-xs uppercase tracking-wider flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>แผนที่ Real-time
            </h3>
          </div>
          <div className="bg-slate-200/60 rounded-2xl flex-1 overflow-hidden relative z-0">
            <MapComponent />
          </div>
        </div>
      </main>

      {/* Navigation Bar */}
<div className="fixed bottom-5 left-4 right-4 max-w-md mx-auto bg-white/75 backdrop-blur-xl border border-white/60 px-2 py-2 flex justify-around items-center rounded-full shadow-[0_10px_25px_-5px_rgba(0,0,0,0.08)] z-50">
  
  {/* SOS */}
  <button onClick={() => router.push('/victim/sos')} className="flex flex-col items-center gap-0.5 px-4 py-1.5 text-rose-500">
    <span className="text-xl">🚨</span><span className="text-[10px] font-bold">SOS</span>
  </button>
  
  {/* สถานะ */}
  <button onClick={() => router.push('/victim/dashboard?tab=status')} className="flex flex-col items-center gap-0.5 px-4 py-1.5 text-slate-500">
    <span className="text-xl">📊</span><span className="text-[10px] font-bold">สถานะ</span>
  </button>
  
  {/* เยียวยา - เชื่อมไปที่หน้า compensation ที่เราสร้างไว้ */}
  <button onClick={() => router.push('/victim/compensation')} className="flex flex-col items-center gap-0.5 px-4 py-1.5 text-slate-500">
    <span className="text-xl">💰</span><span className="text-[10px] font-bold">เยียวยา</span>
  </button>
  
  {/* ข้อมูลฉัน */}
  <button onClick={() => router.push('/victim/profile')} className="flex flex-col items-center gap-0.5 px-4 py-1.5 text-slate-500">
    <span className="text-xl">👤</span><span className="text-[10px] font-bold">ข้อมูลฉัน</span>
  </button>
  
</div>
    </div>
  );
}