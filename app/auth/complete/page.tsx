'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, LoaderCircle, TriangleAlert } from 'lucide-react';
import { supabase } from '@/lib/supabase';

function getSafeNextPath() {
  if (typeof window === 'undefined') return '/officer/dashboard';
  const next = new URLSearchParams(window.location.search).get('next');
  return next?.startsWith('/') && !next.startsWith('//')
    ? next
    : '/officer/dashboard';
}

export default function AuthCompletePage() {
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const finishLogin = async () => {
      // createBrowserClient processes the implicit access_token in the URL hash.
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (cancelled) return;

      if (sessionError || !session) {
        setError('ลิงก์เข้าสู่ระบบไม่สมบูรณ์หรือหมดอายุ กรุณาขอลิงก์ใหม่อีกครั้ง');
        return;
      }

      const response = await fetch('/auth/session', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (cancelled) return;

      if (!response.ok) {
        setError('ไม่สามารถยืนยันการเข้าสู่ระบบได้ กรุณาขอลิงก์ใหม่อีกครั้ง');
        return;
      }

      window.location.replace(getSafeNextPath());
    };

    void finishLogin();
    return () => { cancelled = true; };
  }, []);

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#F5F8FC', color: '#001845', fontFamily: 'var(--font-thai), sans-serif' }}>
      <section style={{ width: 'min(100%, 420px)', padding: '34px 28px', border: '1px solid #DDE7F0', borderRadius: 24, background: '#fff', boxShadow: '0 22px 55px rgba(0, 40, 85, .12)', textAlign: 'center' }}>
        {error ? <TriangleAlert size={34} color="#B42318" /> : <LoaderCircle size={34} color="#0466C8" style={{ animation: 'auth-complete-spin 1s linear infinite' }} />}
        <h1 style={{ margin: '16px 0 7px', fontSize: 22 }}>{error ? 'เข้าสู่ระบบไม่สำเร็จ' : 'กำลังเข้าสู่ระบบ'}</h1>
        <p style={{ margin: 0, color: '#5C677D', fontSize: 14, lineHeight: 1.6 }}>{error || 'กำลังยืนยันตัวตนจากอีเมลของคุณ กรุณารอสักครู่'}</p>
        {error && <Link href="/officer/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 20, padding: '10px 15px', borderRadius: 10, background: '#0466C8', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}><CheckCircle2 size={16} /> กลับไปขอลิงก์ใหม่</Link>}
      </section>
      <style>{'@keyframes auth-complete-spin { to { transform: rotate(360deg); } }'}</style>
    </main>
  );
}
