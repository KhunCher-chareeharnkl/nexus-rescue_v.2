'use client';

import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function OfficerLogin() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // 1. ระบบล็อกอินด้วย Magic Link (ส่งลิงก์เข้าสู่ระบบทางอีเมลโดยไม่ต้องใช้รหัสผ่าน)
  const handleMagicLinkLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    const { error } = await supabase.auth.signInWithOtp({
      email: email,
      options: {
        // เมื่อเจ้าหน้าที่กดลิงก์ในเมล ระบบจะพาเด้งกลับมาที่หน้า Dashboard โดยอัตโนมัติ
        emailRedirectTo: `${window.location.origin}/officer/dashboard`,
      },
    });

    setLoading(false);
    if (error) {
      setMessage(`❌ เกิดข้อผิดพลาด: ${error.message}`);
    } else {
      setMessage('📩 ระบบได้ส่งลิงก์เข้าสู่ระบบไปยังอีเมลของคุณแล้ว! กรุณาเปิดกล่องข้อความในอีเมลเพื่อกดปุ่มเข้าใช้งาน');
    }
  };

  // 2. ระบบล็อกอินด้วย Google Sign-In
  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/officer/dashboard`,
      },
    });
    
    if (error) {
      alert(`ไม่สามารถเชื่อมต่อ Google Auth ได้: ${error.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 flex flex-col items-center justify-center p-4 select-none">
      
      {/* การ์ดฟอร์มเข้าสู่ระบบ ดีไซน์โค้งมน นูนเด่น มีมิติสไตล์เดียวกับฝั่งผู้ประสบภัย */}
      <div className="max-w-md w-full bg-white p-8 rounded-[2.5rem] shadow-[0_10px_30px_rgba(0,0,0,0.03)] border border-slate-200/80 space-y-6 text-center">
        
        {/* ส่วนหัวโลโก้และชื่อระบบ */}
        <div>
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-3xl font-bold mx-auto shadow-[inset_0_2px_4px_rgba(37,99,235,0.06)] border border-blue-100 mb-4">
            🛰️
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">ศูนย์ปฏิบัติการกู้ภัยสนาม</h1>
          <p className="text-xs text-slate-400 mt-1 uppercase font-bold tracking-wider">Nexus Rescue Central Auth</p>
        </div>

        {/* ปุ่ม Google Sign-In ชัดเจน มนสวย กดง่าย */}
        <button
          onClick={handleGoogleLogin}
          type="button"
          className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-50 text-slate-700 font-bold p-4 rounded-2xl border border-slate-200 shadow-sm active:scale-[0.98] transition-all text-sm"
        >
          <img src="https://www.google.com/favicon.ico" alt="Google" className="w-4 h-4" />
          เข้าสู่ระบบด้วยบัญชี Google
        </button>

        {/* เส้นแบ่งทางเลือก */}
        <div className="relative flex py-2 items-center text-xs font-bold text-slate-300 uppercase">
          <div className="flex-grow border-t border-slate-200"></div>
          <span className="flex-shrink mx-4">หรือใช้ระบบไร้รหัสผ่าน</span>
          <div className="flex-grow border-t border-slate-200"></div>
        </div>

        {/* ฟอร์มรับ Magic Link */}
        <form onSubmit={handleMagicLinkLogin} className="space-y-4 text-left">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 pl-1">อีเมลผู้ปฏิบัติงาน</label>
            <input
              type="email"
              placeholder="name@example.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-800 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
            />
          </div>
          
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold p-4 rounded-2xl text-sm shadow-[0_6px_16px_rgba(37,99,235,0.2)] hover:shadow-[0_8px_20px_rgba(37,99,235,0.3)] active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {loading ? '⏳ กำลังส่งข้อมูล...' : '🚀 รับลิงก์เข้าสู่ระบบผ่านอีเมล'}
          </button>
        </form>

        {/* ส่วนแสดงข้อความแจ้งเตือนสถานะการส่งอีเมล */}
        {message && (
          <div className="text-xs font-bold p-4 bg-blue-50/50 border border-blue-100 rounded-2xl text-blue-700 leading-relaxed animate-pulse">
            {message}
          </div>
        )}

      </div>

      <p className="text-[11px] text-slate-400 font-bold mt-6 uppercase tracking-widest">
        🔐 Secured by Supabase Authentication
      </p>
    </div>
  );
}