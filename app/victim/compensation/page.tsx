'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { getSosReportId } from '@/lib/session';

type DamageType = 'housing' | 'vehicle' | 'agriculture' | 'property' | 'other';
type HomeStatus = 'returned' | 'temporary_shelter' | 'cannot_return';
type AddressRow = { province: string; district: string; sub_district: string; zip_code: string | null };

const DAMAGE_TYPE_OPTIONS: { value: DamageType; label: string }[] = [
  { value: 'housing', label: 'ที่อยู่อาศัย' },
  { value: 'vehicle', label: 'ยานพาหนะ' },
  { value: 'agriculture', label: 'พื้นที่เกษตรกรรม' },
  { value: 'property', label: 'ทรัพย์สินอื่นๆ' },
  { value: 'other', label: 'อื่นๆ' },
];

const HOME_STATUS_OPTIONS: { value: HomeStatus; label: string }[] = [
  { value: 'temporary_shelter', label: 'พักอยู่ในศูนย์พักพิงชั่วคราว' },
  { value: 'returned', label: 'กลับเข้าที่พักอาศัยแล้ว' },
  { value: 'cannot_return', label: 'ยังไม่สามารถกลับที่พักอาศัยได้' },
];

const MAX_IMAGES = 5;

export default function DamageReportForm() {
  const router = useRouter();
  const [formStep, setFormStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingSosData, setLoadingSosData] = useState(true);
  const [linkedSosId, setLinkedSosId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ที่อยู่ (cascade จังหวัด -> อำเภอ -> ตำบล)
  const [addressData, setAddressData] = useState<AddressRow[]>([]);
  const [provinces, setProvinces] = useState<string[]>([]);
  const [districts, setDistricts] = useState<string[]>([]);
  const [subDistricts, setSubDistricts] = useState<string[]>([]);

  const [formData, setFormData] = useState({
    full_name: '',
    phone: '',
    province: '',
    district: '',
    sub_district: '',
    address_details: '',
    damage_type: 'housing' as DamageType,
    damage_value: '',
    description: '',
    home_status: 'temporary_shelter' as HomeStatus,
  });

  // แนบรูปความเสียหาย
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  // โหลดที่อยู่ทั้งหมด + เช็คว่ามีเคส SOS ผูกอยู่ไหม เพื่อ prefill
  useEffect(() => {
    let active = true;

    async function init() {
      const { data } = await supabase.from('thai_addresses').select('province, district, sub_district, zip_code');
      if (active && data) {
        setAddressData(data as AddressRow[]);
        setProvinces([...new Set(data.map((d) => d.province))].sort());
      }

      const sosId = getSosReportId();
      if (sosId) {
        const { data: sosData } = await supabase
          .from('sos_reports')
          .select('full_name, phone, province, district, sub_district, address_details')
          .eq('id', sosId)
          .single();

        if (active && sosData) {
          setLinkedSosId(sosId);
          setFormData((prev) => ({
            ...prev,
            full_name: sosData.full_name ?? '',
            phone: sosData.phone ?? '',
            province: sosData.province ?? '',
            district: sosData.district ?? '',
            sub_district: sosData.sub_district ?? '',
            address_details: sosData.address_details ?? '',
          }));
          if (data && sosData.province) {
            setDistricts(
              [...new Set(data.filter((d) => d.province === sosData.province).map((d) => d.district))].sort()
            );
          }
          if (data && sosData.province && sosData.district) {
            setSubDistricts(
              [
                ...new Set(
                  data
                    .filter((d) => d.province === sosData.province && d.district === sosData.district)
                    .map((d) => d.sub_district)
                ),
              ].sort()
            );
          }
        }
      }
      if (active) setLoadingSosData(false);
    }

    init();
    return () => {
      active = false;
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleProvinceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedProvince = e.target.value;
    setFormData({ ...formData, province: selectedProvince, district: '', sub_district: '' });
    setDistricts([...new Set(addressData.filter((d) => d.province === selectedProvince).map((d) => d.district))].sort());
    setSubDistricts([]);
  };

  const handleDistrictChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedDistrict = e.target.value;
    setFormData({ ...formData, district: selectedDistrict, sub_district: '' });
    setSubDistricts(
      [
        ...new Set(
          addressData
            .filter((d) => d.province === formData.province && d.district === selectedDistrict)
            .map((d) => d.sub_district)
        ),
      ].sort()
    );
  };

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const combined = [...images, ...files].slice(0, MAX_IMAGES);
    setImages(combined);
    setImagePreviews(combined.map((f) => URL.createObjectURL(f)));
    e.target.value = '';
  }

  function removeImage(index: number) {
    const next = images.filter((_, i) => i !== index);
    setImages(next);
    setImagePreviews(next.map((f) => URL.createObjectURL(f)));
  }

  async function uploadImages(): Promise<string[]> {
    const urls: string[] = [];
    for (let i = 0; i < images.length; i++) {
      setUploadProgress(`กำลังอัปโหลดรูปที่ ${i + 1}/${images.length}...`);
      const file = images[i];
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { error: uploadError } = await supabase.storage.from('damage-photos').upload(path, file);
      if (uploadError) {
        throw new Error(`อัปโหลดรูปที่ ${i + 1} ไม่สำเร็จ: ${uploadError.message}`);
      }
      const { data: publicUrlData } = supabase.storage.from('damage-photos').getPublicUrl(path);
      urls.push(publicUrlData.publicUrl);
    }
    setUploadProgress(null);
    return urls;
  }

  const validateStep1 = () => formData.full_name.trim().length > 0 && formData.phone.trim().length > 0;
  const validateStep2 = () => !!formData.province && !!formData.district && !!formData.sub_district;

  const handleSubmit = async () => {
    setSubmitError(null);
    setLoading(true);
    try {
      const imageUrls = images.length > 0 ? await uploadImages() : [];

      const { error } = await supabase.from('damage_reports').insert({
        sos_report_id: linkedSosId,
        full_name: formData.full_name.trim(),
        phone: formData.phone.trim(),
        province: formData.province,
        district: formData.district,
        sub_district: formData.sub_district,
        address_details: formData.address_details.trim() || null,
        damage_type: formData.damage_type,
        damage_value: formData.damage_value ? Number(formData.damage_value) : null,
        description: formData.description.trim() || null,
        image_urls: imageUrls,
        home_status: formData.home_status,
        status: 'pending',
      });

      if (error) throw error;

      alert('✅ ยื่นคำร้องขอรับเงินเยียวยาสำเร็จ');
      router.push('/');
    } catch (err: any) {
      setSubmitError(err.message || 'ส่งคำร้องไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
      setUploadProgress(null);
    }
  };

  const inputClass = 'w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <header className="bg-gradient-to-br from-emerald-600 to-emerald-500 text-white p-8 rounded-b-[3rem] shadow-lg mb-6">
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
              <h1 className="text-xl font-bold tracking-tight">ยื่นคำร้องขอรับเงินเยียวยา</h1>
            </div>
          </div>
      </header>

      <div className="max-w-xl mx-auto px-4">
        <div className="w-full bg-slate-200 h-2 rounded-full mb-4 overflow-hidden">
          <div className="bg-emerald-600 h-2 rounded-full transition-all duration-300" style={{ width: `${(formStep / 3) * 100}%` }} />
        </div>

        {linkedSosId && !loadingSosData && (
          <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-semibold rounded-2xl p-3 mb-4">
            🔗 เชื่อมกับเคสขอความช่วยเหลือที่เคยแจ้งไว้แล้ว ระบบดึงข้อมูลชื่อ/ที่อยู่มาให้อัตโนมัติ
          </div>
        )}

        {submitError && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-2xl p-3 mb-4">
            {submitError}
          </div>
        )}

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 space-y-4">
          {formStep === 1 && (
            <>
              <h2 className="font-bold text-slate-700">ข้อมูลผู้ประสบภัย</h2>
              <input
                name="full_name"
                value={formData.full_name}
                placeholder="ชื่อ-นามสกุล"
                onChange={handleChange}
                className={inputClass}
              />
              <input
                name="phone"
                value={formData.phone}
                placeholder="เบอร์โทรศัพท์ติดต่อ"
                onChange={handleChange}
                className={inputClass}
              />
              <button
                onClick={() => validateStep1() && setFormStep(2)}
                className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold hover:bg-emerald-700 transition-colors"
              >
                ถัดไป
              </button>
            </>
          )}

          {formStep === 2 && (
            <>
              <h2 className="font-bold text-slate-700">รายละเอียดที่อยู่ที่เสียหาย</h2>
              <select name="province" value={formData.province} onChange={handleProvinceChange} className={inputClass}>
                <option value="">เลือกจังหวัด</option>
                {provinces.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <select
                name="district"
                value={formData.district}
                onChange={handleDistrictChange}
                disabled={!formData.province}
                className={`${inputClass} disabled:opacity-50`}
              >
                <option value="">เลือกอำเภอ</option>
                {districts.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <select
                name="sub_district"
                value={formData.sub_district}
                onChange={handleChange}
                disabled={!formData.district}
                className={`${inputClass} disabled:opacity-50`}
              >
                <option value="">เลือกตำบล</option>
                {subDistricts.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <textarea
                name="address_details"
                value={formData.address_details}
                placeholder="รายละเอียดที่อยู่บ้านเลขที่/หมู่บ้าน"
                onChange={handleChange}
                className={`${inputClass} h-20`}
              />
              <div className="flex gap-2">
                <button onClick={() => setFormStep(1)} className="flex-1 bg-slate-200 py-4 rounded-2xl font-bold text-slate-600">ย้อนกลับ</button>
                <button
                  onClick={() => validateStep2() && setFormStep(3)}
                  className="flex-1 bg-emerald-600 text-white py-4 rounded-2xl font-bold hover:bg-emerald-700 transition-colors"
                >
                  ถัดไป
                </button>
              </div>
            </>
          )}

          {formStep === 3 && (
            <>
              <h2 className="font-bold text-slate-700">ข้อมูลความเสียหาย</h2>
              <select name="damage_type" value={formData.damage_type} onChange={handleChange} className={inputClass}>
                {DAMAGE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <select name="home_status" value={formData.home_status} onChange={handleChange} className={inputClass}>
                {HOME_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <input
                name="damage_value"
                type="number"
                min={0}
                value={formData.damage_value}
                placeholder="ประเมินมูลค่าความเสียหาย (บาท)"
                onChange={handleChange}
                className={inputClass}
              />
              <textarea
                name="description"
                value={formData.description}
                placeholder="รายละเอียดความเสียหายเพิ่มเติม"
                onChange={handleChange}
                className={`${inputClass} h-20`}
              />

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-2">
                  📷 แนบรูปความเสียหาย (สูงสุด {MAX_IMAGES} รูป)
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {imagePreviews.map((src, i) => (
                    <div key={i} className="relative w-20 h-20">
                      <img src={src} alt={`รูปความเสียหาย ${i + 1}`} className="w-20 h-20 object-cover rounded-xl border border-slate-200" />
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        aria-label="ลบรูปนี้"
                        className="absolute -top-2 -right-2 w-6 h-6 bg-rose-500 text-white rounded-full text-xs font-bold flex items-center justify-center shadow-sm"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {images.length < MAX_IMAGES && (
                    <label className="w-20 h-20 flex items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-slate-400 text-2xl cursor-pointer hover:border-emerald-400 hover:text-emerald-500 transition-colors">
                      +
                      <input type="file" accept="image/*" multiple onChange={handleImageSelect} className="hidden" />
                    </label>
                  )}
                </div>
                {uploadProgress && <p className="text-xs text-emerald-600 font-semibold">{uploadProgress}</p>}
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={() => setFormStep(2)} className="flex-1 bg-slate-200 py-4 rounded-2xl font-bold text-slate-600">ย้อนกลับ</button>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="flex-1 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white py-4 rounded-2xl font-bold hover:opacity-90 disabled:opacity-60 transition-all"
                >
                  {loading ? 'กำลังส่ง...' : 'ยืนยันยื่นคำร้อง'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
