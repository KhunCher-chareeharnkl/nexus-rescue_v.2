'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type AddressRow = {
  sub_district: string;
  district: string;
  province: string;
  zip_code: string | null;
};

export type ThaiAddressValue = {
  province: string;
  district: string;
  subDistrict: string;
};

type Props = {
  value: ThaiAddressValue;
  onChange: (value: ThaiAddressValue) => void;
  required?: boolean;
};

export default function ThaiAddressSelect({ value, onChange, required }: Props) {
  const [rows, setRows] = useState<AddressRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      const { data } = await supabase
        .from('thai_addresses')
        .select('sub_district, district, province, zip_code');
      if (active) {
        setRows((data ?? []) as AddressRow[]);
        setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  const provinces = useMemo(
    () => [...new Set(rows.map((r) => r.province))].sort(),
    [rows]
  );

  const districts = useMemo(
    () =>
      [...new Set(rows.filter((r) => r.province === value.province).map((r) => r.district))].sort(),
    [rows, value.province]
  );

  const subDistricts = useMemo(
    () =>
      [
        ...new Set(
          rows
            .filter((r) => r.province === value.province && r.district === value.district)
            .map((r) => r.sub_district)
        ),
      ].sort(),
    [rows, value.province, value.district]
  );

  const selectClass =
    'w-full text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-400';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <select
        required={required}
        disabled={loading}
        value={value.province}
        onChange={(e) => onChange({ province: e.target.value, district: '', subDistrict: '' })}
        className={selectClass}
      >
        <option value="">{loading ? 'กำลังโหลด...' : 'จังหวัด'}</option>
        {provinces.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>

      <select
        required={required}
        disabled={!value.province}
        value={value.district}
        onChange={(e) => onChange({ ...value, district: e.target.value, subDistrict: '' })}
        className={selectClass}
      >
        <option value="">อำเภอ/เขต</option>
        {districts.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>

      <select
        required={required}
        disabled={!value.district}
        value={value.subDistrict}
        onChange={(e) => onChange({ ...value, subDistrict: e.target.value })}
        className={selectClass}
      >
        <option value="">ตำบล/แขวง</option>
        {subDistricts.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}
