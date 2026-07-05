'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Shelter = {
  id: string;
  name: string;
  address: string | null;
  province: string | null;
  lat: number | null;
  lng: number | null;
  capacity: number | null;
  current_occupancy: number | null;
  contact_phone: string | null;
  is_active: boolean;
};

function occStatus(cap: number, occ: number): 'ok' | 'warn' | 'full' {
  if (cap <= 0) return 'warn';
  const pct = occ / cap;
  if (pct >= 1) return 'full';
  if (pct >= 0.85) return 'warn';
  return 'ok';
}

const STATUS_STYLE: Record<string, { badge: string; bar: string; label: string }> = {
  ok: { badge: 'bg-[#E4F8ED] text-[#24A159]', bar: 'bg-[#24A159]', label: 'ยังรับได้' },
  warn: { badge: 'bg-[#FEF5E7] text-[#D97706]', bar: 'bg-[#D97706]', label: 'ใกล้เต็ม' },
  full: { badge: 'bg-[#FCECEB] text-[#FF3B30]', bar: 'bg-[#FF3B30]', label: 'เต็มแล้ว' },
};

export default function ShelterListPage() {
  const router = useRouter();
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [province, setProvince] = useState('');

  useEffect(() => {
    let active = true;

    async function loadShelters() {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from('shelters')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (!active) return;
      if (error) {
        setError('โหลดข้อมูลศูนย์พักพิงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
        setShelters([]);
      } else {
        setShelters((data ?? []) as Shelter[]);
      }
      setLoading(false);
    }

    loadShelters();
    return () => {
      active = false;
    };
  }, []);

  const provinces = useMemo(
    () => [...new Set(shelters.map((s) => s.province).filter(Boolean) as string[])].sort(),
    [shelters]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shelters.filter((s) => {
      const hay = `${s.name} ${s.address ?? ''} ${s.province ?? ''}`.toLowerCase();
      if (q && !hay.includes(q)) return false;
      if (province && s.province !== province) return false;
      return true;
    });
  }, [shelters, search, province]);

  return (
    <div className="min-h-screen bg-[#F2F2F7] text-[#1C1C1E] font-sans pb-10">
      
      {/* Header */}
      <header className="pt-12 pb-6 px-6 bg-[#F2F2F7]">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4 mb-6">
            <button
              onClick={() => router.back()}
              aria-label="ย้อนกลับ"
              className="w-10 h-10 rounded-full bg-white border border-[#E5E5EA] flex items-center justify-center active:scale-95 transition-transform shadow-sm text-[#1C1C1E]"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
            </button>
            <div>
              <p className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-widest mb-0.5">
                Nexus Rescue
              </p>
              <h1 className="text-[22px] font-extrabold tracking-tight text-[#1C1C1E] leading-none">
                รายชื่อศูนย์พักพิง
              </h1>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-[#8E8E93]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                type="text"
                placeholder="ค้นหาชื่อศูนย์ / อำเภอ / ตำบล"
                className="w-full text-[14px] pl-11 pr-4 py-3.5 rounded-[16px] bg-white border border-[#E5E5EA] text-[#1C1C1E] placeholder-[#8E8E93] focus:outline-none focus:border-[#1C1C1E] focus:ring-1 focus:ring-[#1C1C1E] transition-all shadow-sm"
              />
            </div>
            
            <div className="relative sm:w-48">
              <select
                value={province}
                onChange={(e) => setProvince(e.target.value)}
                className="w-full appearance-none text-[14px] px-4 py-3.5 rounded-[16px] bg-white border border-[#E5E5EA] text-[#1C1C1E] focus:outline-none focus:border-[#1C1C1E] focus:ring-1 focus:ring-[#1C1C1E] transition-all shadow-sm pr-10"
              >
                <option value="">ทุกจังหวัด</option>
                {provinces.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-[#8E8E93]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 space-y-5">
        
        <div className="flex items-center justify-between text-[13px] font-medium text-[#8E8E93]">
          <span>
            {loading ? 'กำลังประมวลผลข้อมูล...' : `แสดงผล ${filtered.length} จาก ${shelters.length} ศูนย์`}
          </span>
        </div>

        {error && (
          <div className="bg-[#FCECEB] border border-[#FF3B30]/20 text-[#FF3B30] text-[14px] font-medium rounded-[16px] p-4 flex items-center gap-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            {error}
          </div>
        )}

        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-44 rounded-[24px] bg-white border border-[#E5E5EA] animate-pulse" />
            ))}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-20 text-[#8E8E93] flex flex-col items-center">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-4 opacity-50">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="9" y1="3" x2="9" y2="21"></line>
            </svg>
            <p className="font-bold text-[16px] text-[#1C1C1E] mb-1">ไม่พบศูนย์พักพิง</p>
            <p className="text-[14px]">กรุณาลองปรับเงื่อนไขการค้นหาใหม่อีกครั้ง</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {!loading &&
            filtered.map((s) => {
              const cap = s.capacity ?? 0;
              const occ = s.current_occupancy ?? 0;
              const pct = cap > 0 ? Math.min(occ / cap, 1) : 0;
              const status = occStatus(cap, occ);
              const style = STATUS_STYLE[status];

              const hasCoords = s.lat != null && s.lng != null;
              const mapUrl = hasCoords
                ? `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`
                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    `${s.name} ${s.address ?? ''} ${s.province ?? ''}`
                  )}`;
              const hasPhone = !!s.contact_phone && s.contact_phone.trim().length > 0;
              const telHref = hasPhone ? `tel:${s.contact_phone!.replace(/[^0-9+]/g, '')}` : undefined;

              return (
                <div
                  key={s.id}
                  className="bg-white p-5 rounded-[24px] shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-[#E5E5EA] flex flex-col gap-4 transition-all hover:shadow-[0_4px_16px_rgba(0,0,0,0.04)]"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-full bg-[#F2F2F7] flex items-center justify-center text-[#1C1C1E] shrink-0">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                        <polyline points="9 22 9 12 15 12 15 22"></polyline>
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <h3 className="font-bold text-[16px] text-[#1C1C1E] leading-tight truncate">{s.name}</h3>
                      <p className="text-[13px] text-[#8E8E93] leading-snug mt-1 truncate">
                        {s.address}
                        {s.province ? ` · ${s.province}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="mt-1">
                    <div className="flex justify-between items-center text-[13px] mb-2">
                      <div className="flex items-center gap-2">
                         <span className="text-[#8E8E93]">ความจุ</span>
                         <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${style.badge}`}>
                           {style.label}
                         </span>
                      </div>
                      <span className="font-bold text-[#1C1C1E]">
                        {occ} <span className="text-[#8E8E93] font-normal">/ {cap}</span>
                      </span>
                    </div>
                    <div className="h-2 w-full bg-[#F2F2F7] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${style.bar}`}
                        style={{ width: `${pct * 100}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <a
                      href={mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 bg-[#1C1C1E] hover:bg-[#2C2C2E] text-white text-[14px] font-bold py-3.5 rounded-[16px] flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      นำทาง
                    </a>
                    <a
                      href={telHref}
                      aria-disabled={!hasPhone}
                      className={`flex-1 text-[14px] font-bold py-3.5 rounded-[16px] flex items-center justify-center gap-2 active:scale-[0.98] transition-all ${
                        hasPhone
                          ? 'bg-[#FF3B30] hover:bg-[#E0352B] text-white'
                          : 'bg-[#E5E5EA] text-[#8E8E93] pointer-events-none'
                      }`}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                      {hasPhone ? 'โทรติดต่อ' : 'ไม่มีเบอร์'}
                    </a>
                  </div>
                </div>
              );
            })}
        </div>
      </main>
    </div>
  );
}