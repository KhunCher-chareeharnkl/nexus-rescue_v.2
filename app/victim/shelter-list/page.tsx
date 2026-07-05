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
  ok: { badge: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500', label: 'ยังรับได้' },
  warn: { badge: 'bg-amber-100 text-amber-700', bar: 'bg-amber-500', label: 'ใกล้เต็ม' },
  full: { badge: 'bg-rose-100 text-rose-700', bar: 'bg-rose-500', label: 'เต็มแล้ว' },
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
        setError('โหลดข้อมูลศูนย์พักพิงไม่สำเร็จ ลองใหม่อีกครั้ง');
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
    <div className="min-h-screen bg-slate-100 text-slate-800 pb-10">
      {/* Header */}
      <header className="p-6 bg-gradient-to-br from-blue-600 to-blue-500 text-white rounded-b-[2.5rem] shadow-[0_8px_20px_-6px_rgba(37,99,235,0.5)]">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => router.back()}
              aria-label="ย้อนกลับ"
              className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center active:scale-95 transition-transform"
            >
              ←
            </button>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider opacity-80">
                Nexus Rescue
              </p>
              <h1 className="text-xl font-bold tracking-tight">รายชื่อศูนย์พักพิง</h1>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              type="text"
              placeholder="ค้นหาชื่อศูนย์ / อำเภอ / ตำบล"
              className="flex-1 text-sm px-4 py-2.5 rounded-xl bg-white/15 placeholder-blue-100 text-white focus:outline-none focus:ring-2 focus:ring-white/70"
            />
            <select
              value={province}
              onChange={(e) => setProvince(e.target.value)}
              className="text-sm px-4 py-2.5 rounded-xl bg-white/15 text-white focus:outline-none focus:ring-2 focus:ring-white/70 sm:w-40"
            >
              <option className="text-slate-800" value="">
                ทุกจังหวัด
              </option>
              {provinces.map((p) => (
                <option className="text-slate-800" key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto p-4 mt-4 space-y-4">
        <div className="flex items-center justify-between px-1 text-xs text-slate-500">
          <span>
            {loading ? 'กำลังโหลดข้อมูล...' : `พบ ${filtered.length} ศูนย์ จากทั้งหมด ${shelters.length} ศูนย์`}
          </span>
        </div>

        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-2xl p-4">
            {error}
          </div>
        )}

        {loading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 rounded-[1.75rem] bg-slate-50 border border-white/60 animate-pulse" />
            ))}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <p className="text-3xl mb-2">🏚️</p>
            <p className="font-semibold text-slate-600">ไม่พบศูนย์พักพิงที่ตรงกับเงื่อนไข</p>
            <p className="text-sm">ลองล้างตัวกรองหรือค้นหาด้วยคำอื่น</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  className="bg-slate-50 p-5 rounded-[1.75rem] shadow-[0_4px_12px_rgba(0,0,0,0.03)] border border-white/60 flex flex-col gap-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center text-xl shrink-0">
                      🏠
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-slate-800 leading-snug truncate">{s.name}</h3>
                      <p className="text-xs text-slate-500 leading-snug">
                        {s.address}
                        {s.province ? ` · ${s.province}` : ''}
                      </p>
                    </div>
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${style.badge}`}>
                      {style.label}
                    </span>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span>ผู้พักพิงปัจจุบัน</span>
                      <span className="font-semibold text-slate-700">
                        {occ} / {cap} คน
                      </span>
                    </div>
                    <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${style.bar}`}
                        style={{ width: `${pct * 100}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <a
                      href={mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
                    >
                      🧭 นำทาง
                    </a>
                    <a
                      href={telHref}
                      aria-disabled={!hasPhone}
                      className={`flex-1 text-sm font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform ${
                        hasPhone
                          ? 'bg-rose-500 hover:bg-rose-600 text-white'
                          : 'bg-slate-200 text-slate-400 pointer-events-none'
                      }`}
                    >
                      📞 {hasPhone ? 'โทร' : 'ไม่มีเบอร์'}
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
