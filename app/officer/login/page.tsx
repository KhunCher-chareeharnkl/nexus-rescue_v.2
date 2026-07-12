'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// เพิ่ม 'admin' เข้าไปใน type Role — แต่แอดมินจะไม่ผ่านขั้นตอนรหัสอ้างอิงเหมือน 2 role แรก
type Role = 'rescuer' | 'shelter_staff' | 'admin';
type Step = 'role' | 'details';

type Shelter = {
  id: string;
  name: string;
};

export default function OfficerLogin() {
  const [step, setStep] = useState<Step>('role');
  const [role, setRole] = useState<Role | null>(null);

  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [shelterId, setShelterId] = useState('');
  const [sheltersLoading, setSheltersLoading] = useState(false);

  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  // ฟังก์ชันสำหรับเช็ค URL ให้รองรับทั้งเวลาเทสในคอม (localhost) และระบบจริงบนมือถือ (Vercel)
  const getRedirectUrl = () => {
    let url =
      process?.env?.NEXT_PUBLIC_SITE_URL ??
      (typeof window !== 'undefined' ? window.location.origin : '');
    url = url.replace(/\/+$/, '');
    return url;
  };

  // เมื่อเลือก role = เจ้าหน้าที่ศูนย์ ค่อยดึงรายชื่อศูนย์พักพิงจากตาราง shelters
  useEffect(() => {
    if (role !== 'shelter_staff') return;
    let cancelled = false;

    const fetchShelters = async () => {
      setSheltersLoading(true);
      const { data, error } = await supabase
        .from('shelters')
        .select('id, name')
        .order('name', { ascending: true });

      if (!cancelled) {
        if (!error && data) setShelters(data as Shelter[]);
        setSheltersLoading(false);
      }
    };

    fetchShelters();
    return () => {
      cancelled = true;
    };
  }, [role]);

  const handleSelectRole = (selected: Role) => {
    setRole(selected);
    setMessage(null);
    setStep('details');
  };

  const handleBack = () => {
    setStep('role');
    setRole(null);
    setShelterId('');
    setCode('');
    setMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!role) return;

    if (role === 'shelter_staff' && !shelterId) {
      setMessage({ type: 'error', text: '⚠️ กรุณาเลือกศูนย์พักพิงที่ดูแล' });
      return;
    }

    setLoading(true);
    setMessage(null);

    // แอดมิน: ข้ามขั้นตอนเช็ครหัสอ้างอิงทีมไปเลย เพราะ role ของแอดมินถูกกำหนดไว้ล่วงหน้า
    // ทาง SQL Editor แล้ว (ไม่ใช่ self-service เหมือนกู้ภัย/เจ้าหน้าที่ศูนย์)
    // ถ้าเรียก redeem_access_code() ที่นี่ จะไปจอง role เป็น rescuer/shelter_staff ทับของเดิม
    // โดยไม่ตั้งใจ (เพราะฟังก์ชันนั้นรับแค่ 2 role นี้อยู่แล้ว จะ error หรือแย่กว่านั้นคือ over-write)
    if (role !== 'admin') {
      // 1. เช็ครหัสอ้างอิงทีมก่อน แล้วจอง role/ศูนย์ไว้ล่วงหน้า (ยังไม่ต้อง login)
      const { error: redeemError } = await supabase.rpc('redeem_access_code', {
        p_email: email,
        p_code: code,
        p_role: role,
        p_shelter_id: role === 'shelter_staff' ? shelterId : null,
      });

      if (redeemError) {
        setLoading(false);
        setMessage({ type: 'error', text: `❌ ${redeemError.message}` });
        return;
      }
    }

    // 2. ส่ง Magic Link ตามปกติ (แอดมินมาถึงขั้นนี้ตรงๆ โดยไม่ผ่าน redeem_access_code)
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${getRedirectUrl()}/officer/dashboard`,
      },
    });

    setLoading(false);

    if (otpError) {
      setMessage({ type: 'error', text: `❌ เกิดข้อผิดพลาด: ${otpError.message}` });
    } else {
      setMessage({
        type: 'success',
        text: '📩 ระบบได้ส่งลิงก์เข้าสู่ระบบไปยังอีเมลของคุณแล้ว! กรุณาเปิดกล่องข้อความในอีเมลเพื่อกดปุ่มเข้าใช้งาน',
      });
    }
  };

  const roleBadge =
    role === 'rescuer' ? '🚑 กู้ภัย' : role === 'shelter_staff' ? '🏠 เจ้าหน้าที่ศูนย์' : '🛡️ แอดมิน';

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 flex flex-col items-center justify-center p-4 select-none">
      <div className="max-w-md w-full bg-white p-8 rounded-[2.5rem] shadow-[0_10px_30px_rgba(0,0,0,0.03)] border border-slate-200/80 space-y-6 text-center">
        {/* ส่วนหัวโลโก้และชื่อระบบ */}
        <div>
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-3xl font-bold mx-auto shadow-[inset_0_2px_4px_rgba(37,99,235,0.06)] border border-blue-100 mb-4">
            🛰️
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">ศูนย์ปฏิบัติการกู้ภัยสนาม</h1>
          <p className="text-xs text-slate-400 mt-1 uppercase font-bold tracking-wider">Nexus Rescue Central Auth</p>
        </div>

        {/* ===================== STEP 1: เลือก Role ===================== */}
        {step === 'role' && (
          <div className="space-y-3 text-left">
            <p className="text-xs font-bold text-slate-500 pl-1 text-center">คุณเข้าสู่ระบบในฐานะ</p>

            <button
              type="button"
              onClick={() => handleSelectRole('rescuer')}
              className="w-full flex items-center gap-4 bg-slate-50 hover:bg-blue-50 text-slate-700 font-bold p-4 rounded-2xl border border-slate-200 hover:border-blue-200 shadow-sm active:scale-[0.98] transition-all text-left"
            >
              <span className="w-11 h-11 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-xl shrink-0">
                🚑
              </span>
              <span>
                <span className="block text-sm">เจ้าหน้าที่กู้ภัย</span>
                <span className="block text-[11px] font-normal text-slate-400">รับเคส SOS และลงพื้นที่ช่วยเหลือ</span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectRole('shelter_staff')}
              className="w-full flex items-center gap-4 bg-slate-50 hover:bg-blue-50 text-slate-700 font-bold p-4 rounded-2xl border border-slate-200 hover:border-blue-200 shadow-sm active:scale-[0.98] transition-all text-left"
            >
              <span className="w-11 h-11 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-xl shrink-0">
                🏠
              </span>
              <span>
                <span className="block text-sm">เจ้าหน้าที่ศูนย์พักพิง</span>
                <span className="block text-[11px] font-normal text-slate-400">ดูแลผู้เข้าพักและยอดคงเหลือของศูนย์</span>
              </span>
            </button>

            {/* ปุ่มแอดมิน — จงใจทำให้เล็ก/จางกว่า 2 ปุ่มบน เพราะไม่ใช่ทางเข้าหลักสำหรับคนทั่วไป
                ไม่มีการเช็ครหัสอ้างอิงตรงนี้ เพราะ role ต้องถูกตั้งไว้ล่วงหน้าทาง SQL โดยแอดมินระบบเท่านั้น */}
            <div className="pt-1 text-center">
              <button
                type="button"
                onClick={() => handleSelectRole('admin')}
                className="text-[11px] font-bold text-slate-400 hover:text-slate-600 underline underline-offset-2"
              >
                เข้าสู่ระบบสำหรับแอดมิน
              </button>
            </div>
          </div>
        )}

        {/* ===================== STEP 2: กรอกรหัสอ้างอิง + อีเมล ===================== */}
        {step === 'details' && role && (
          <form onSubmit={handleSubmit} className="space-y-4 text-left">
            {/* แถบแสดง role ที่เลือก + ปุ่มย้อนกลับ */}
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center gap-2 text-xs font-bold text-blue-600 hover:text-blue-700 mb-1"
            >
              ← เปลี่ยนบทบาท
              <span className="ml-auto px-3 py-1 rounded-full bg-blue-50 text-blue-600 border border-blue-100 text-[11px]">
                {roleBadge}
              </span>
            </button>

            {/* Dropdown เลือกศูนย์ (เฉพาะ shelter_staff) */}
            {role === 'shelter_staff' && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 pl-1">ศูนย์พักพิงที่ดูแล</label>
                <select
                  required
                  value={shelterId}
                  onChange={(e) => setShelterId(e.target.value)}
                  disabled={sheltersLoading}
                  className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-800 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] disabled:opacity-50"
                >
                  <option value="">
                    {sheltersLoading ? 'กำลังโหลดรายชื่อศูนย์...' : '-- เลือกศูนย์พักพิง --'}
                  </option>
                  {shelters.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* รหัสอ้างอิงทีม — ไม่แสดงสำหรับแอดมิน เพราะสิทธิ์ถูกตั้งไว้ล่วงหน้าแล้ว ไม่ใช้รหัสสาธารณะ */}
            {role !== 'admin' && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 pl-1">รหัสอ้างอิงทีม</label>
                <input
                  type="text"
                  placeholder="เช่น RESCUE2026"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm tracking-widest font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-800 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                />
              </div>
            )}

            {/* คำอธิบายสำหรับแอดมินแทนช่องรหัส */}
            {role === 'admin' && (
              <div className="text-[11px] font-semibold text-slate-400 bg-slate-50 border border-slate-200 rounded-2xl p-3 leading-relaxed">
                🔒 บัญชีแอดมินต้องถูกตั้งค่าสิทธิ์ไว้ล่วงหน้าโดยผู้ดูแลระบบเท่านั้น หากอีเมลนี้ยังไม่มีสิทธิ์
                แอดมิน การ login จะยังคงเป็นบทบาทเดิมของบัญชีตามปกติ
              </div>
            )}

            {/* อีเมล */}
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
              {loading
                ? role === 'admin'
                  ? '⏳ กำลังส่งลิงก์...'
                  : '⏳ กำลังตรวจสอบรหัส...'
                : '🚀 ยืนยันและรับลิงก์เข้าสู่ระบบ'}
            </button>
          </form>
        )}

        {/* ส่วนแสดงข้อความแจ้งเตือน */}
        {message && (
          <div
            className={`text-xs font-bold p-4 rounded-2xl leading-relaxed ${
              message.type === 'error'
                ? 'bg-red-50/60 border border-red-100 text-red-600'
                : 'bg-blue-50/50 border border-blue-100 text-blue-700 animate-pulse'
            }`}
          >
            {message.text}
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-400 font-bold mt-6 uppercase tracking-widest">
        🔐 Secured by Supabase Authentication
      </p>
    </div>
  );
}
