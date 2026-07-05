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

  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

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
      setUploadProgress(`Uploading ${i + 1} of ${images.length}...`);
      const file = images[i];
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { error: uploadError } = await supabase.storage.from('damage-photos').upload(path, file);
      if (uploadError) {
        throw new Error(`Upload failed for image ${i + 1}: ${uploadError.message}`);
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

      alert('ยื่นคำร้องขอรับเงินเยียวยาสำเร็จ');
      router.push('/');
    } catch (err: any) {
      setSubmitError(err.message || 'ไม่สามารถส่งคำร้องได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
      setUploadProgress(null);
    }
  };

  const inputClass = 'w-full px-4 py-4 bg-[#F9F9FB] border border-[#E5E5EA] rounded-2xl text-[15px] text-[#1C1C1E] placeholder-[#8E8E93] focus:outline-none focus:border-[#1C1C1E] focus:ring-1 focus:ring-[#1C1C1E] transition-all';
  const labelClass = 'block text-[13px] font-semibold text-[#8E8E93] uppercase tracking-wider mb-2 mt-4';

  return (
    <div className="min-h-screen bg-[#F2F2F7] font-sans pb-24 text-[#1C1C1E]">
      <header className="pt-14 pb-8 px-6 bg-white rounded-b-[2rem] shadow-[0_4px_24px_rgba(0,0,0,0.02)] mb-6">
        <div className="max-w-xl mx-auto flex items-center gap-4">
          <button
            onClick={() => router.back()}
            aria-label="Back"
            className="w-10 h-10 rounded-full bg-[#F2F2F7] flex items-center justify-center hover:bg-[#E5E5EA] active:scale-95 transition-all text-[#1C1C1E]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#8E8E93] mb-0.5">
              Nexus Rescue
            </p>
            <h1 className="text-[22px] font-bold tracking-tight text-[#1C1C1E]">
              ยื่นคำร้องขอรับเยียวยา
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-xl mx-auto px-4">
        {/* Progress Indicator */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2, 3].map((step) => (
            <div key={step} className="flex-1 h-1.5 rounded-full bg-[#E5E5EA] overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ease-out ${formStep >= step ? 'bg-[#1C1C1E]' : 'bg-transparent'}`} 
                style={{ width: formStep >= step ? '100%' : '0%' }}
              />
            </div>
          ))}
        </div>

        {linkedSosId && !loadingSosData && (
          <div className="bg-white border border-[#E5E5EA] text-[#1C1C1E] text-sm rounded-2xl p-4 mb-6 shadow-sm flex items-start gap-3">
            <div className="mt-0.5 text-[#1C1C1E]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
              </svg>
            </div>
            <p className="leading-relaxed">เชื่อมต่อกับเคสขอความช่วยเหลือของท่านแล้ว ระบบได้ดึงข้อมูลพื้นฐานให้อัตโนมัติ</p>
          </div>
        )}

        {submitError && (
          <div className="bg-[#FFF0F0] border border-[#FFD6D6] text-[#FF3B30] text-sm rounded-2xl p-4 mb-6 shadow-sm">
            {submitError}
          </div>
        )}

        <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-[#E5E5EA]">
          {formStep === 1 && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <h2 className="text-xl font-bold mb-6 text-[#1C1C1E]">ข้อมูลผู้ประสบภัย</h2>
              
              <label className={labelClass}>ชื่อ-นามสกุล</label>
              <input
                name="full_name"
                value={formData.full_name}
                placeholder="ระบุชื่อ-นามสกุล"
                onChange={handleChange}
                className={inputClass}
              />

              <label className={labelClass}>เบอร์โทรศัพท์ติดต่อ</label>
              <input
                name="phone"
                value={formData.phone}
                placeholder="ระบุหมายเลขโทรศัพท์"
                onChange={handleChange}
                className={inputClass}
              />
              
              <div className="mt-8">
                <button
                  onClick={() => validateStep1() && setFormStep(2)}
                  className="w-full bg-[#1C1C1E] text-white py-4 rounded-2xl font-semibold text-[15px] hover:bg-[#2C2C2E] transition-colors shadow-md"
                >
                  ดำเนินการต่อ
                </button>
              </div>
            </div>
          )}

          {formStep === 2 && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <h2 className="text-xl font-bold mb-6 text-[#1C1C1E]">ที่อยู่ที่ได้รับความเสียหาย</h2>
              
              <label className={labelClass}>จังหวัด</label>
              <select name="province" value={formData.province} onChange={handleProvinceChange} className={inputClass}>
                <option value="">เลือกจังหวัด</option>
                {provinces.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>

              <label className={labelClass}>อำเภอ / เขต</label>
              <select
                name="district"
                value={formData.district}
                onChange={handleDistrictChange}
                disabled={!formData.province}
                className={`${inputClass} disabled:opacity-50 disabled:bg-[#F2F2F7]`}
              >
                <option value="">เลือกอำเภอ</option>
                {districts.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>

              <label className={labelClass}>ตำบล / แขวง</label>
              <select
                name="sub_district"
                value={formData.sub_district}
                onChange={handleChange}
                disabled={!formData.district}
                className={`${inputClass} disabled:opacity-50 disabled:bg-[#F2F2F7]`}
              >
                <option value="">เลือกตำบล</option>
                {subDistricts.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>

              <label className={labelClass}>รายละเอียดที่อยู่เพิ่มเติม</label>
              <textarea
                name="address_details"
                value={formData.address_details}
                placeholder="บ้านเลขที่, หมู่, อาคาร, ซอย"
                onChange={handleChange}
                className={`${inputClass} min-h-[100px] resize-none`}
              />

              <div className="flex gap-3 mt-8">
                <button 
                  onClick={() => setFormStep(1)} 
                  className="w-1/3 bg-[#F2F2F7] text-[#1C1C1E] py-4 rounded-2xl font-semibold text-[15px] hover:bg-[#E5E5EA] transition-colors"
                >
                  ย้อนกลับ
                </button>
                <button
                  onClick={() => validateStep2() && setFormStep(3)}
                  className="w-2/3 bg-[#1C1C1E] text-white py-4 rounded-2xl font-semibold text-[15px] hover:bg-[#2C2C2E] transition-colors shadow-md"
                >
                  ดำเนินการต่อ
                </button>
              </div>
            </div>
          )}

          {formStep === 3 && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <h2 className="text-xl font-bold mb-6 text-[#1C1C1E]">ข้อมูลความเสียหาย</h2>
              
              <label className={labelClass}>ประเภทความเสียหาย</label>
              <select name="damage_type" value={formData.damage_type} onChange={handleChange} className={inputClass}>
                {DAMAGE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>

              <label className={labelClass}>สถานะที่พักอาศัยปัจจุบัน</label>
              <select name="home_status" value={formData.home_status} onChange={handleChange} className={inputClass}>
                {HOME_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>

              <label className={labelClass}>ประเมินมูลค่าความเสียหายเบื้องต้น</label>
              <div className="relative">
                <input
                  name="damage_value"
                  type="number"
                  min={0}
                  value={formData.damage_value}
                  placeholder="0.00"
                  onChange={handleChange}
                  className={`${inputClass} pr-12`}
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#8E8E93] font-medium text-[15px]">THB</span>
              </div>

              <label className={labelClass}>รายละเอียดเพิ่มเติม</label>
              <textarea
                name="description"
                value={formData.description}
                placeholder="ระบุรายละเอียดความเสียหายเพิ่มเติม"
                onChange={handleChange}
                className={`${inputClass} min-h-[100px] resize-none`}
              />

              <div className="mt-6 mb-8 border border-[#E5E5EA] rounded-2xl p-4 bg-[#F9F9FB]">
                <div className="flex justify-between items-center mb-4">
                  <label className="text-[13px] font-semibold text-[#1C1C1E] uppercase tracking-wider">
                    รูปภาพความเสียหาย
                  </label>
                  <span className="text-xs text-[#8E8E93] font-medium">สูงสุด {MAX_IMAGES} รูป</span>
                </div>
                
                <div className="flex flex-wrap gap-3">
                  {imagePreviews.map((src, i) => (
                    <div key={i} className="relative w-[72px] h-[72px] group">
                      <img src={src} alt={`Damage ${i + 1}`} className="w-full h-full object-cover rounded-xl border border-[#E5E5EA]" />
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        aria-label="Remove"
                        className="absolute -top-2 -right-2 w-6 h-6 bg-[#FF3B30] text-white rounded-full text-xs font-bold flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </div>
                  ))}
                  {images.length < MAX_IMAGES && (
                    <label className="w-[72px] h-[72px] flex items-center justify-center rounded-xl border-2 border-dashed border-[#C7C7CC] text-[#C7C7CC] bg-white cursor-pointer hover:border-[#1C1C1E] hover:text-[#1C1C1E] transition-colors">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                      </svg>
                      <input type="file" accept="image/*" multiple onChange={handleImageSelect} className="hidden" />
                    </label>
                  )}
                </div>
                {uploadProgress && (
                  <p className="text-[13px] text-[#1C1C1E] font-medium mt-3 flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full border-2 border-[#1C1C1E] border-t-transparent animate-spin"></span>
                    {uploadProgress}
                  </p>
                )}
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setFormStep(2)} 
                  className="w-1/3 bg-[#F2F2F7] text-[#1C1C1E] py-4 rounded-2xl font-semibold text-[15px] hover:bg-[#E5E5EA] transition-colors"
                >
                  ย้อนกลับ
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="w-2/3 bg-[#FF3B30] text-white py-4 rounded-2xl font-semibold text-[15px] hover:bg-[#FF453A] disabled:opacity-50 disabled:hover:bg-[#FF3B30] transition-all shadow-md flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin"></span>
                      กำลังประมวลผล...
                    </>
                  ) : (
                    'ยืนยันข้อมูล'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}