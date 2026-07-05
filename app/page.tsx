'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

const MapComponent = dynamic(() => import('@/components/Map'), { 
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#F2F2F7]">
      <p className="text-[#8E8E93] text-[13px] font-semibold animate-pulse tracking-wide">
        Loading Map...
      </p>
    </div>
  )
});

export default function HomePage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[#F2F2F7] text-[#1C1C1E] flex flex-col font-sans pb-32">
      
      {/* Header */}
      <header className="pt-14 pb-8 px-6">
        <div className="max-w-4xl mx-auto flex justify-between items-end">
          <div>
            <p className="text-[12px] font-bold text-[#8E8E93] uppercase tracking-widest mb-1.5">
              แพลตฟอร์มประสานงานกู้ภัยและติดตามช่วยเหลือผู้ประสบภัย
            </p>
            <h1 className="text-[28px] font-extrabold tracking-tight text-[#1C1C1E] leading-none">
              Nexus Rescue
            </h1>
          </div>
          <div className="w-11 h-11 bg-[#E5E5EA] rounded-full flex items-center justify-center font-bold text-[13px] text-[#1C1C1E] shadow-sm">
            TH
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl w-full mx-auto px-5 flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        
        {/* ฝั่งซ้าย (เมนูและบทบาท) */}
        <div className="space-y-6 w-full">
          
          <div className="space-y-4">
            <h2 className="text-[13px] font-bold text-[#8E8E93] uppercase tracking-wider ml-1">
              เลือกบทบาทการใช้งาน
            </h2>
            
            {/* ปุ่ม SOS (Primary Accent Color) */}
            <button 
              onClick={() => router.push('/victim/dashboard')} 
              className="w-full bg-[#FF3B30] text-white p-6 rounded-[28px] flex flex-col items-start gap-4 transition-transform active:scale-[0.98] shadow-sm"
            >
              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div className="text-left">
                <h3 className="font-bold text-[20px] mb-1">ต้องการความช่วยเหลือ (SOS)</h3>
                <p className="text-[13px] text-white/80 font-medium">แจ้งเหตุน้ำท่วม ขออพยพ ขอเสบียง หรือยื่นเยียวยา</p>
              </div>
            </button>

            {/* ปุ่มเจ้าหน้าที่ (Dark Professional Tone) */}
            <button 
              onClick={() => router.push('/officer/dashboard')} 
              className="w-full bg-[#1C1C1E] text-white p-6 rounded-[28px] flex flex-col items-start gap-4 transition-transform active:scale-[0.98] shadow-sm"
            >
              <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div className="text-left">
                <h3 className="font-bold text-[20px] mb-1">เจ้าหน้าที่กู้ภัย / หน่วยงาน</h3>
                <p className="text-[13px] text-white/60 font-medium">เข้าสู่ระบบเพื่อรับเคสและอัปเดตสถานะการช่วยเหลือ</p>
              </div>
            </button>
          </div>

          {/* ปุ่มฟีเจอร์ย่อย (Clean Light Cards) */}
          <div className="grid grid-cols-2 gap-4">
            <button 
              onClick={() => router.push('/victim/shelter-list')} 
              className="p-5 bg-white hover:bg-[#F9F9FB] active:scale-[0.97] rounded-[24px] text-left border border-[#E5E5EA] shadow-[0_2px_8px_rgba(0,0,0,0.02)] flex flex-col items-start gap-4 transition-colors"
            >
              <div className="w-10 h-10 bg-[#F2F2F7] rounded-full flex items-center justify-center text-[#1C1C1E]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </div>
              <span className="text-[14px] font-bold text-[#1C1C1E]">ดูศูนย์พักพิง</span>
            </button>
            
            <button 
              onClick={() => router.push('/victim/compensation')} 
              className="p-5 bg-white hover:bg-[#F9F9FB] active:scale-[0.97] rounded-[24px] text-left border border-[#E5E5EA] shadow-[0_2px_8px_rgba(0,0,0,0.02)] flex flex-col items-start gap-4 transition-colors"
            >
              <div className="w-10 h-10 bg-[#F2F2F7] rounded-full flex items-center justify-center text-[#1C1C1E]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="6" width="20" height="12" rx="2" />
                  <circle cx="12" cy="12" r="2" />
                  <path d="M6 12h.01M18 12h.01" />
                </svg>
              </div>
              <span className="text-[14px] font-bold text-[#1C1C1E]">ยื่นขอเยียวยา</span>
            </button>
          </div>

        </div> 

        {/* ฝั่งขวา (แผนที่) */}
        <div className="w-full flex flex-col h-[400px] md:h-full min-h-[500px]">
          <h2 className="text-[13px] font-bold text-[#8E8E93] uppercase tracking-wider ml-1 mb-4 flex items-center gap-2">
            <span className="w-2 h-2 bg-[#FF3B30] rounded-full animate-pulse"></span>
            แผนที่ Real-time
          </h2>
          <div className="bg-white p-2 rounded-[28px] shadow-[0_2px_12px_rgba(0,0,0,0.03)] border border-[#E5E5EA] flex-1 flex flex-col relative overflow-hidden">
            <div className="w-full h-full bg-[#F9F9FB] rounded-[20px] overflow-hidden relative z-0">
              <MapComponent />
            </div>
          </div>
        </div>

      </main>

      {/* Navigation Bar (Dark Pill Style) */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-sm bg-[#1C1C1E] px-6 py-4 flex justify-between items-center rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.2)] z-50">
        
        <button onClick={() => router.push('/victim/sos')} className="flex flex-col items-center text-[#FF3B30]">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </button>
        
        <button onClick={() => router.push('/victim/dashboard?tab=status')} className="flex flex-col items-center text-[#8E8E93] hover:text-white transition-colors">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
        </button>
        
        <button onClick={() => router.push('/victim/compensation')} className="flex flex-col items-center text-[#8E8E93] hover:text-white transition-colors">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <circle cx="12" cy="12" r="2" />
          </svg>
        </button>
        
        <button onClick={() => router.push('/victim/profile')} className="flex flex-col items-center text-[#8E8E93] hover:text-white transition-colors">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </button>

      </div>
    </div>
  );
}