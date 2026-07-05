'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function OfficerLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  // ฟังก์ชันสำหรับเช็ค URL ให้รองรับทั้งเวลาเทสในคอม (localhost) และระบบจริงบนมือถือ (Vercel)
  const getRedirectUrl = () => {
    let url =
      process?.env?.NEXT_PUBLIC_SITE_URL ?? // ดึงค่าจาก Environment Variable (Vercel)
      (typeof window !== 'undefined' ? window.location.origin : ''); // ค่าเริ่มต้น
      
    // ตัดเครื่องหมาย / ตัวสุดท้ายออก (ถ้ามี) เพื่อป้องกัน URL เบิ้ล
    url = url.replace(/\/+$/, '');
    return url;
  };

  // 1. ระบบล็อกอินด้วย Magic Link (ส่งลิงก์เข้าสู่ระบบทางอีเมลโดยไม่ต้องใช้รหัสผ่าน)
  const handleMagicLinkLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    setIsError(false);

    const { error } = await supabase.auth.signInWithOtp({
      email: email,
      options: {
        // ใช้ getRedirectUrl() เพื่อให้ลิงก์กลับมาถูกที่เสมอ
        emailRedirectTo: `${getRedirectUrl()}/officer/dashboard`,
      },
    });

    setLoading(false);
    if (error) {
      setIsError(true);
      setMessage(`เกิดข้อผิดพลาด: ${error.message}`);
    } else {
      setMessage('ระบบได้ส่งลิงก์เข้าสู่ระบบไปยังอีเมลของคุณแล้ว กรุณาตรวจสอบกล่องข้อความ');
    }
  };

  // 2. ระบบล็อกอินด้วย Google Sign-In
  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // ใช้ getRedirectUrl() เพื่อให้ลิงก์กลับมาถูกที่เสมอ
        redirectTo: `${getRedirectUrl()}/officer/dashboard`,
      },
    });
    
    if (error) {
      alert(`ไม่สามารถเชื่อมต่อ Google Auth ได้: ${error.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-[#F2F2F7] text-[#1C1C1E] flex flex-col items-center justify-center p-6 font-sans select-none relative">
      
      {/* ปุ่มย้อนกลับ (จัดวางให้อยู่มุมซ้ายบน) */}
<div className="absolute top-6 left-6 md:top-8 md:left-8">
  <button
    // เปลี่ยนจาก router.back() เป็นการระบุ path '/' เพื่อกลับสู่หน้าหลัก
    onClick={() => router.push('/')}
    aria-label="กลับสู่หน้าหลัก"
    className="w-10 h-10 rounded-full bg-white border border-[#E5E5EA] flex items-center justify-center active:scale-95 transition-transform shadow-sm text-[#1C1C1E] hover:bg-[#F9F9FB]"
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6"/>
    </svg>
  </button>
</div>

      {/* การ์ดฟอร์มเข้าสู่ระบบ */}
      <div className="max-w-[420px] w-full bg-white p-10 rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.03)] border border-[#E5E5EA] mt-12 md:mt-0">
        
        {/* ส่วนหัวโลโก้และชื่อระบบ */}
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-[#1C1C1E] rounded-[20px] flex items-center justify-center mx-auto mb-6 shadow-md">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
          </div>
          <h1 className="text-[24px] font-extrabold tracking-tight text-[#1C1C1E]">
            ศูนย์ปฏิบัติการกู้ภัย
          </h1>
          <p className="text-[12px] text-[#8E8E93] mt-2 uppercase font-bold tracking-widest">
            Nexus Rescue Central Auth
          </p>
        </div>

        {/* ปุ่ม Google Sign-In */}
        <button
          onClick={handleGoogleLogin}
          type="button"
          className="w-full flex items-center justify-center gap-3 bg-white hover:bg-[#F9F9FB] text-[#1C1C1E] font-bold py-4 px-6 rounded-[20px] border border-[#E5E5EA] shadow-[0_2px_8px_rgba(0,0,0,0.02)] active:scale-[0.98] transition-all text-[15px]"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          เข้าสู่ระบบด้วย Google
        </button>

        {/* เส้นแบ่งทางเลือก */}
        <div className="relative flex py-6 items-center text-[12px] font-bold text-[#8E8E93] uppercase">
          <div className="flex-grow border-t border-[#E5E5EA]"></div>
          <span className="flex-shrink mx-4">หรือใช้รหัสผ่านชั่วคราว</span>
          <div className="flex-grow border-t border-[#E5E5EA]"></div>
        </div>

        {/* ฟอร์มรับ Magic Link */}
        <form onSubmit={handleMagicLinkLogin} className="space-y-6">
          <div className="space-y-2 text-left">
            <label className="text-[13px] font-bold text-[#8E8E93] ml-1">อีเมลผู้ปฏิบัติงาน</label>
            <input
              type="email"
              placeholder="name@example.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-5 py-4 rounded-[20px] bg-[#F9F9FB] border border-[#E5E5EA] text-[15px] focus:outline-none focus:border-[#1C1C1E] focus:ring-1 focus:ring-[#1C1C1E] transition-all text-[#1C1C1E] placeholder-[#C7C7CC]"
            />
          </div>
          
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#FF3B30] hover:bg-[#E0352B] text-white font-bold py-4 rounded-[20px] text-[15px] shadow-[0_4px_14px_rgba(255,59,48,0.25)] active:scale-[0.98] transition-all disabled:opacity-50 flex justify-center items-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                กำลังดำเนินการ...
              </>
            ) : (
              'รับลิงก์เข้าสู่ระบบ'
            )}
          </button>
        </form>

        {/* ส่วนแสดงข้อความแจ้งเตือนสถานะการส่งอีเมล */}
        {message && (
          <div className={`mt-6 text-[13px] font-medium p-4 border rounded-[16px] leading-relaxed text-left flex items-start gap-3 ${
            isError 
              ? 'bg-[#FCECEB] border-[#FF3B30]/20 text-[#FF3B30]' 
              : 'bg-[#F2F2F7] border-[#E5E5EA] text-[#1C1C1E]'
          }`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
              {isError ? (
                <>
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </>
              ) : (
                <>
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                  <polyline points="22,6 12,13 2,6"></polyline>
                </>
              )}
            </svg>
            <span>{message}</span>
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center gap-2 text-[11px] text-[#8E8E93] font-bold uppercase tracking-widest">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        Secured Authentication
      </div>
    </div>
  );
}