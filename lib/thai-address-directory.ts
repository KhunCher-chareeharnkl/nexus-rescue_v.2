"use client";

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type ThaiAddressRow = {
  province: string;
  district: string;
  subdistrict: string;
  zip_code?: string | null;
};

type DirectoryRow = {
  province: string;
  district: string;
  sub_district: string;
  zip_code?: string | null;
};

function unique(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'th'));
}

/**
 * Runtime reads use the database directory first.  The packaged dataset is
 * retained only as a first-install fallback until an administrator has run the
 * initial directory sync, so an upstream address API outage never breaks forms.
 */
export function useThaiAddressDirectory(fallbackRows: ThaiAddressRow[]) {
  const [rows, setRows] = useState<ThaiAddressRow[]>(fallbackRows);
  const [source, setSource] = useState<'database' | 'fallback'>('fallback');

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await supabase
        .from('thai_address_directory')
        .select('province,district,sub_district,zip_code')
        .limit(10000);
      if (!active || error || !data?.length) return;
      const normalized = (data as DirectoryRow[])
        .filter((item) => item.province && item.district && item.sub_district)
        .map((item) => ({ province: item.province, district: item.district, subdistrict: item.sub_district, zip_code: item.zip_code }));
      if (normalized.length) {
        setRows(normalized);
        setSource('database');
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  const provinces = useMemo(() => unique(rows.map((item) => item.province)), [rows]);
  const byProvince = useMemo(() => new Map(provinces.map((province) => [province, rows.filter((item) => item.province === province)])), [provinces, rows]);

  return { rows, provinces, byProvince, source };
}
