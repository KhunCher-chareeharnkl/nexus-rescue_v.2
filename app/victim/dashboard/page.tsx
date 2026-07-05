'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase'; 

export default function VictimDashboard() {
  const [activeTab, setActiveTab] = useState('sos');
  const [formStep, setFormStep] = useState(1);

  // หน้าที่ 1: ข้อมูลส่วนตัว
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');

  // หน้าที่ 2: สถานที่และพิกัด
  const [province, setProvince] = useState('');
  const [district, setDistrict] = useState('');
  const [subDistrict, setSubDistrict] = useState('');
  const [addressDetails, setAddressDetails] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  // ตัวเลือกที่อยู่ ดึงมาจากตาราง thai_addresses (แบบ cascade จังหวัด -> อำเภอ -> ตำบล)
  const [provinces, setProvinces] = useState<string[]>([]);
  const [districts, setDistricts] = useState<string[]>([]);
  const [subDistricts, setSubDistricts] = useState<string[]>([]);
  const [loadingProvinces, setLoadingProvinces] = useState(false);
  const [loadingDistricts, setLoadingDistricts] = useState(false);
  const [loadingSubDistricts, setLoadingSubDistricts] = useState(false);

  // หน้าที่ 3: รายละเอียดภัยพิบัติ
  const [waterLevel, setWaterLevel] = useState(1);
  const [urgencyLevel, setUrgencyLevel] = useState('medium'); 
  const [adultCount, setAdultCount] = useState(1);
  const [childCount, setChildCount] = useState(0);
  const [elderCount, setElderCount] = useState(0);
  const [specialNeeds, setSpecialNeeds] = useState('');
  const [neededItems, setNeededItems] = useState<string[]>([]);
  const [customItem, setCustomItem] = useState('');

  // States สำหรับหน้าติดตามสถานะ (Status Tab)
  const [searchPhone, setSearchPhone] = useState('');
  const [latestReport, setLatestReport] = useState<any>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const availableItems = ['อาหารและน้ำดื่ม', 'ยารักษาโรค', 'ชุดสุขอนามัย/ผ้าอนามัย', 'ไฟฉาย/แบตเตอรี่สำรอง', 'เสื้อผ้าแห้ง', 'แพชูชีพ/ชูชีพ'];

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, ''); 
    if (val.length <= 10) {
      setPhone(val);
      if (val.length === 10) setPhoneError('');
    }
  };

  const validateStep1 = () => {
    if (!firstName.trim() || !lastName.trim()) {
      alert('กรุณากรอกชื่อ และนามสกุล ให้ครบถ้วน');
      return false;
    }
    if (phone.length < 10) {
      setPhoneError('❌ เบอร์โทรศัพท์ไม่ครบ 10 หลัก กรุณาตรวจสอบอีกครั้ง');
      return false;
    }
    setPhoneError('');
    return true;
  };

  const getLocation = () => {
    setGpsLoading(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLat(position.coords.latitude);
          setLng(position.coords.longitude);
          setGpsLoading(false);
          alert('📍 ดึงพิกัด GPS สำเร็จ!');
        },
        (error) => {
          console.error(error);
          alert('⚠️ บราวเซอร์บล็อกการเข้าถึงเนื่องจากไม่ใช่ https (ไม่เป็นไร สามารถกรอกข้อมูลส่วนอื่นและกดส่งต่อไปได้เลยครับ)');
          setGpsLoading(false);
        }
      );
    } else {
      alert('เบราว์เซอร์ไม่รองรับการดึง GPS');
      setGpsLoading(false);
    }
  };

  const toggleItem = (item: string) => {
    if (neededItems.includes(item)) {
      setNeededItems(neededItems.filter(i => i !== item));
    } else {
      setNeededItems([...neededItems, item]);
    }
  };

  const addCustomItem = () => {
    const trimmed = customItem.trim();
    if (!trimmed) return;
    if (!neededItems.includes(trimmed)) {
      setNeededItems([...neededItems, trimmed]);
    }
    setCustomItem('');
  };

  // ===== ดึงตัวเลือกที่อยู่จากตาราง thai_addresses แบบ cascade =====
  const fetchProvinces = async () => {
    setLoadingProvinces(true);
    try {
      const { data, error } = await supabase
        .from('thai_addresses')
        .select('province')
        .order('province', { ascending: true });
      if (error) throw error;
      const unique = Array.from(new Set((data || []).map((d) => d.province)));
      setProvinces(unique);
    } catch (err) {
      console.error('Error fetching provinces:', err);
    } finally {
      setLoadingProvinces(false);
    }
  };

  const fetchDistricts = async (selectedProvince: string) => {
    setLoadingDistricts(true);
    try {
      const { data, error } = await supabase
        .from('thai_addresses')
        .select('district')
        .eq('province', selectedProvince)
        .order('district', { ascending: true });
      if (error) throw error;
      const unique = Array.from(new Set((data || []).map((d) => d.district)));
      setDistricts(unique);
    } catch (err) {
      console.error('Error fetching districts:', err);
    } finally {
      setLoadingDistricts(false);
    }
  };

  const fetchSubDistricts = async (selectedProvince: string, selectedDistrict: string) => {
    setLoadingSubDistricts(true);
    try {
      const { data, error } = await supabase
        .from('thai_addresses')
        .select('sub_district')
        .eq('province', selectedProvince)
        .eq('district', selectedDistrict)
        .order('sub_district', { ascending: true });
      if (error) throw error;
      const unique = Array.from(new Set((data || []).map((d) => d.sub_district)));
      setSubDistricts(unique);
    } catch (err) {
      console.error('Error fetching sub-districts:', err);
    } finally {
      setLoadingSubDistricts(false);
    }
  };

  // โหลดรายชื่อจังหวัดครั้งแรกที่ component mount
  useEffect(() => {
    fetchProvinces();
  }, []);

  // เมื่อเลือกจังหวัดใหม่ -> โหลดอำเภอใหม่ และเคลียร์ค่าอำเภอ/ตำบลเดิมทิ้ง
  useEffect(() => {
    if (province) {
      fetchDistricts(province);
    } else {
      setDistricts([]);
    }
    setDistrict('');
    setSubDistrict('');
    setSubDistricts([]);
  }, [province]);

  // เมื่อเลือกอำเภอใหม่ -> โหลดตำบลใหม่ และเคลียร์ค่าตำบลเดิมทิ้ง
  useEffect(() => {
    if (province && district) {
      fetchSubDistricts(province, district);
    } else {
      setSubDistricts([]);
    }
    setSubDistrict('');
  }, [district]);

  const fetchReportStatus = async (targetPhone: string) => {
    if (!targetPhone || targetPhone.length < 10) return;
    setStatusLoading(true);
    try {
      const { data, error } = await supabase
        .from('sos_reports')
        .select('*')
        .eq('phone', targetPhone)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) throw error;
      if (data && data.length > 0) {
        setLatestReport(data[0]);
      } else {
        setLatestReport(null);
      }
    } catch (err) {
      console.error('Error fetching status:', err);
    } finally {
      setStatusLoading(false);
    }
  };

  const handleSubmitAll = async (e: React.FormEvent) => {
    e.preventDefault();

    const finalData = {
      full_name: `${firstName.trim()} ${lastName.trim()}`, 
      phone: phone,
      province: province,
      district: district,
      sub_district: subDistrict,
      address_details: addressDetails,
      lat: lat, 
      lng: lng,
      adult_count: adultCount,
      child_count: childCount,
      elder_count: elderCount,
      urgency_level: urgencyLevel, 
      water_level: waterLevel, 
      special_needs: specialNeeds,
      needed_items: neededItems,
      status: 'pending' 
    };

    try {
      const { data, error } = await supabase
        .from('sos_reports')
        .insert([finalData])
        .select();

      if (error) throw error;

      alert('🚨 บันทึกข้อมูล SOS ลงฐานข้อมูลสำเร็จเรียบร้อยแล้ว!');
      
      setSearchPhone(phone);
      await fetchReportStatus(phone);

      setFirstName(''); setLastName(''); setPhone(''); setProvince(''); setDistrict(''); setSubDistrict(''); setAddressDetails(''); setLat(null); setLng(null); setNeededItems([]); setSpecialNeeds(''); setCustomItem(''); setAdultCount(1); setChildCount(0); setElderCount(0);
      setFormStep(1); 
      setActiveTab('status');

    } catch (error: any) {
      console.error('Error inserting data to Supabase:', error);
      alert(`❌ ข้อผิดพลาดทางเทคนิค: ${error.message}`);
    }
  };

  useEffect(() => {
    if (activeTab === 'status' && searchPhone.length === 10) {
      fetchReportStatus(searchPhone);
    }
  }, [activeTab]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 pb-28">
      
      {/* ส่วนหัวแอปพลิเคชัน */}
      <div className="p-6 bg-gradient-to-br from-rose-600 to-rose-400 text-white rounded-b-[2.5rem] shadow-[0_8px_20px_-6px_rgba(244,63,94,0.4)] flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {activeTab === 'sos' ? `ขอความช่วยเหลือด่วน (หน้า ${formStep}/3)` : 'ติดตามสถานะกู้ภัย Real-time'}
          </h1>
          <p className="text-xs text-rose-100 opacity-90 mt-0.5">ระบบจัดการและส่งพิกัดภัยพิบัติ Nexus Rescue</p>
        </div>
        <span className="text-2xl">{activeTab === 'sos' ? '📝' : '📊'}</span>
      </div>

      <main className="max-w-xl mx-auto p-4 mt-2">
        
        {/* ====================================================================== */}
        {/* TAB WORKSPACE 1: ขอความช่วยเหลือ (SOS FORM) */}
        {/* ====================================================================== */}
        {activeTab === 'sos' && (
          <div className="space-y-5">
            
            <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden shadow-[inner_0_1px_3px_rgba(0,0,0,0.1)]">
              <div className="bg-gradient-to-r from-rose-500 to-rose-400 h-full transition-all duration-300" style={{ width: `${(formStep / 3) * 100}%` }} />
            </div>

            {/* หน้าที่ 1 ข้อมูลส่วนตัว */}
            {formStep === 1 && (
              <div className="space-y-4">
                {/* 🏠 ปุ่มย้อนกลับไปหน้าหลักของเหยื่อผู้ประสบภัย */}
                <a href="/" className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-600 bg-white border border-rose-100 px-3 py-2 rounded-xl shadow-sm hover:bg-rose-50 transition-all">
            🏠 ย้อนกลับไปหน้าหลักของระบบ
            </a>

                <div className="bg-white p-6 rounded-3xl border border-slate-200/60 shadow-[0_4px_12px_rgba(0,0,0,0.02)] space-y-4">
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">👤 หน้าที่ 1: ข้อมูลระบุตัวตนผู้ประสบภัย</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">ชื่อจริง</label>
                      <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="กรอกชื่อ" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-rose-400" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">นามสกุล</label>
                      <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="กรอกนามสกุล" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-rose-400" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">เบอร์โทรศัพท์มือถือ</label>
                    <input type="tel" value={phone} onChange={handlePhoneChange} placeholder="เช่น 0891234567" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono tracking-wider focus:outline-none focus:border-rose-400" />
                    {phoneError && <p className="text-rose-500 text-xs font-semibold mt-1.5">{phoneError}</p>}
                  </div>
                  <button type="button" onClick={() => { if (validateStep1()) setFormStep(2); }} className="w-full bg-rose-500 hover:bg-rose-600 text-white font-bold py-3.5 rounded-xl shadow-md text-center">ถัดไป (ระบุพิกัดสถานที่) ➡️</button>
                </div>
              </div>
            )}

            {/* หน้าที่ 2 ข้อมูลสถานที่ */}
            {formStep === 2 && (
              <div className="bg-white p-6 rounded-3xl border border-slate-200/60 shadow-[0_4px_12px_rgba(0,0,0,0.02)] space-y-4">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">📍 หน้าที่ 2: ระบุพื้นที่และพิกัดตำแหน่งข้อมูล</h2>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">จังหวัด</label>
                  <select value={province} onChange={(e) => setProvince(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none">
                    <option value="">{loadingProvinces ? '⏳ กำลังโหลด...' : '-- กรุณาเลือกจังหวัด --'}</option>
                    {provinces.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">อำเภอ</label>
                    <select value={district} onChange={(e) => setDistrict(e.target.value)} disabled={!province || loadingDistricts} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none disabled:opacity-50">
                      <option value="">{loadingDistricts ? '⏳ กำลังโหลด...' : '-- เลือกอำเภอ --'}</option>
                      {districts.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">ตำบล</label>
                    <select value={subDistrict} onChange={(e) => setSubDistrict(e.target.value)} disabled={!district || loadingSubDistricts} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none disabled:opacity-50">
                      <option value="">{loadingSubDistricts ? '⏳ กำลังโหลด...' : '-- เลือกตำบล --'}</option>
                      {subDistricts.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">รายละเอียดเพิ่มเติม</label>
                  <textarea rows={2} value={addressDetails} onChange={(e) => setAddressDetails(e.target.value)} placeholder="บ้านเลขที่ / ซอย / จุดสังเกต" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none" />
                </div>
                <div className="bg-slate-50 p-4 rounded-2xl border border-dashed border-slate-300 text-center space-y-2">
                  <span className="text-xs font-bold text-slate-600 block">🛰️ ข้อมูลพิกัดภูมิศาสตร์ (GPS)</span>
                  <button type="button" onClick={getLocation} disabled={gpsLoading} className="bg-white hover:bg-slate-50 border border-slate-200 px-4 py-2 rounded-xl text-xs font-bold text-blue-600 shadow-sm">
                    {gpsLoading ? '⏳ กำลังอ่านค่า...' : '🎯 ดึงพิกัดปัจจุบัน'}
                  </button>
                  {lat && lng && <p className="text-[11px] text-emerald-600 font-mono font-bold mt-1">Lat: {lat.toFixed(5)}, Lng: {lng.toFixed(5)}</p>}
                </div>
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button type="button" onClick={() => setFormStep(1)} className="w-full bg-slate-200 font-bold py-3.5 rounded-xl text-xs text-slate-600">⬅️ ย้อนกลับไปหน้า 1</button>
                  <button type="button" onClick={() => { if(!province || !district) { alert('กรุณาเลือกจังหวัดและอำเภอ'); return; } setFormStep(3); }} className="w-full bg-rose-500 text-white font-bold py-3.5 rounded-xl text-xs shadow-md">ถัดไป ➡️</button>
                </div>
              </div>
            )}

            {/* หน้าที่ 3 ข้อมูลความรุนแรงและสิ่งของ */}
            {formStep === 3 && (
              <div className="bg-white p-6 rounded-3xl border border-slate-200/60 shadow-[0_4px_12px_rgba(0,0,0,0.02)] space-y-5">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">🌊 หน้าที่ 3: ระดับสถานการณ์ภัยพิบัติ</h2>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-2">ระดับน้ำปัจจุบัน (เมตร)</label>
                  <div className="grid grid-cols-5 gap-2">
                    {[1, 2, 3, 4, 5].map((level) => (
                      <button type="button" key={level} onClick={() => setWaterLevel(level)} className={`p-3 rounded-xl font-bold text-xs transition-all ${waterLevel === level ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-50 border border-slate-200 text-slate-500'}`}>{level} ม.</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-2">ระดับความเร่งด่วน</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[{ key: 'low', label: '🟢 ปกติ' }, { key: 'medium', label: '🟡 ปานกลาง' }, { key: 'high', label: '🔴 วิกฤต' }].map((item) => (
                      <button type="button" key={item.key} onClick={() => setUrgencyLevel(item.key)} className={`p-2.5 rounded-xl text-xs font-bold transition-all ${urgencyLevel === item.key ? 'bg-rose-500 text-white shadow-md' : 'bg-slate-50 border border-slate-200 text-slate-500'}`}>{item.label}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-2">👥 จำนวนผู้ประสบภัย (คน)</label>
                  <div className="space-y-2">
                    {[
                      { label: '🧑 ผู้ใหญ่', value: adultCount, setValue: setAdultCount },
                      { label: '🧒 เด็ก', value: childCount, setValue: setChildCount },
                      { label: '👵 ผู้สูงอายุ', value: elderCount, setValue: setElderCount },
                    ].map((row) => (
                      <div key={row.label} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5">
                        <span className="text-xs font-bold text-slate-600">{row.label}</span>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => row.setValue(Math.max(0, row.value - 1))}
                            className="w-8 h-8 flex items-center justify-center rounded-full bg-white border border-slate-300 text-slate-500 font-bold shadow-sm active:scale-95 transition-all"
                          >
                            −
                          </button>
                          <span className="w-6 text-center text-sm font-bold text-slate-800">{row.value}</span>
                          <button
                            type="button"
                            onClick={() => row.setValue(Math.min(20, row.value + 1))}
                            className="w-8 h-8 flex items-center justify-center rounded-full bg-blue-600 text-white font-bold shadow-sm active:scale-95 transition-all"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-2">📦 สิ่งของบรรเทาทุกข์ที่ต้องการ</label>
                  <div className="flex flex-wrap gap-2">
                    {availableItems.map((item) => {
                      const isSelected = neededItems.includes(item);
                      return (
                        <button type="button" key={item} onClick={() => toggleItem(item)} className={`px-3 py-2 rounded-xl text-xs font-medium border transition-all ${isSelected ? 'bg-emerald-500 text-white border-emerald-600' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>{isSelected ? '✓ ' : '+ '} {item}</button>
                      );
                    })}
                  </div>

                  {/* ช่องพิมพ์สิ่งของเพิ่มเติมที่ไม่มีในลิสต์ด้านบน */}
                  <div className="flex gap-2 mt-3">
                    <input
                      type="text"
                      value={customItem}
                      onChange={(e) => setCustomItem(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomItem(); } }}
                      placeholder="พิมพ์สิ่งของอื่นๆ ที่ต้องการ แล้วกด +"
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-emerald-400"
                    />
                    <button type="button" onClick={addCustomItem} className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-4 rounded-xl text-xs shadow-sm">＋ เพิ่ม</button>
                  </div>

                  {/* แสดงรายการที่พิมพ์เพิ่มเอง (ที่ไม่ได้อยู่ใน availableItems) เป็น chip ลบได้ */}
                  {neededItems.filter((i) => !availableItems.includes(i)).length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {neededItems.filter((i) => !availableItems.includes(i)).map((item) => (
                        <span key={item} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-blue-50 border border-blue-200 text-blue-700">
                          {item}
                          <button type="button" onClick={() => toggleItem(item)} className="text-blue-400 hover:text-blue-600 font-bold">✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-2">⚠️ ความต้องการพิเศษ / หมายเหตุเพิ่มเติม</label>
                  <textarea
                    rows={2}
                    value={specialNeeds}
                    onChange={(e) => setSpecialNeeds(e.target.value)}
                    placeholder="เช่น มีผู้ป่วยติดเตียง / ผู้พิการ / หญิงตั้งครรภ์ / โรคประจำตัวที่ต้องการยาเฉพาะ"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-rose-400"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3 pt-2">
                  {/* 🛠️ แก้ไขให้สามารถกดถอยกลับไปหน้า 2 (พิกัดสถานที่) ได้อย่างถูกต้องตรงตามที่ระบุ */}
                  <button type="button" onClick={() => setFormStep(2)} className="w-full bg-slate-200 font-bold py-3.5 rounded-xl text-xs text-slate-600">⬅️ ย้อนกลับไปหน้า 2</button>
                  <button type="button" onClick={handleSubmitAll} className="w-full bg-gradient-to-r from-rose-600 to-rose-500 text-white font-bold py-3.5 rounded-xl text-xs shadow-lg">🚨 ส่งพิกัดแจ้งเหตุ</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ====================================================================== */}
        {/* TAB WORKSPACE 2: ติดตามสถานะ (STATUS TRACKER) */}
        {/* ====================================================================== */}
        {activeTab === 'status' && (
          <div className="space-y-4">
            
            {/* 🏠 ปุ่มย้อนกลับไปหน้าหลักของเหยื่อผู้ประสบภัย */}
            <a href="/" className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-600 bg-white border border-rose-100 px-3 py-2 rounded-xl shadow-sm hover:bg-rose-50 transition-all">
            🏠 ย้อนกลับไปหน้าหลักของระบบ
            </a>

            {/* กล่องค้นหาความช่วยเหลือด้วยเบอร์โทร */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-3">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">🔍 ค้นหาคิวช่วยเหลือด้วยเบอร์โทรศัพท์</label>
              <div className="flex gap-2">
                <input 
                  type="tel" 
                  maxLength={10}
                  value={searchPhone} 
                  onChange={(e) => setSearchPhone(e.target.value.replace(/\D/g, ''))}
                  placeholder="กรอกเบอร์โทร 10 หลักของคุณ" 
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono tracking-wider focus:outline-none focus:border-blue-500" 
                />
                <button 
                  type="button"
                  onClick={() => fetchReportStatus(searchPhone)}
                  disabled={statusLoading || searchPhone.length < 10}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold px-5 rounded-xl text-xs transition-all shadow-md"
                >
                  {statusLoading ? '⏳ กำลังค้น...' : 'ค้นหา'}
                </button>
              </div>
            </div>

            {/* ส่วนแสดงผลรายงานข้อมูล */}
            {latestReport ? (
              <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-6">
                
                <div className="flex justify-between items-start border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="font-bold text-slate-800 text-base">{latestReport.full_name}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">📞 เบอร์โทร: {latestReport.phone}</p>
                    <p className="text-[10px] text-slate-400 mt-1">แจ้งเมื่อ: {new Date(latestReport.created_at).toLocaleString('th-TH')}</p>
                  </div>
                  
                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
                    latestReport.urgency_level === 'high' ? 'bg-rose-100 text-rose-600' : 
                    latestReport.urgency_level === 'medium' ? 'bg-amber-100 text-amber-600' : 
                    'bg-emerald-100 text-emerald-600'
                  }`}>
                    {latestReport.urgency_level === 'high' ? '🔴 วิกฤตด่วน' : latestReport.urgency_level === 'medium' ? '🟡 ปานกลาง' : '🟢 ปลอดภัย'}
                  </span>
                </div>

                {/* 📊 ขั้นตอนการประสานงานกู้ภัย */}
                <div className="space-y-4">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">📊 ขั้นตอนการประสานงานกู้ภัย</span>
                  <div className="relative border-l-2 border-slate-200 pl-6 ml-3 space-y-6 text-sm">
                    
                    {/* ขั้นตอนที่ 1 */}
                    <div className="relative">
                      <span className={`absolute -left-[31px] top-0 w-4 h-4 rounded-full border-2 bg-white ${
                        ['pending', 'assigned', 'accepted', 'completed', 'closed'].includes(latestReport.status)
                          ? 'border-emerald-500 bg-emerald-500 animate-pulse' : 'border-slate-300'
                      }`} />
                      <div className="font-bold text-slate-700">ส่งข้อมูลพิกัด SOS เข้าระบบสำเร็จ</div>
                      <p className="text-xs text-slate-400 mt-0.5">พิกัด Lat/Lng ถูกบันทึกลงฐานข้อมูลศูนย์กู้ภัย Nexus Rescue แล้ว</p>
                    </div>

                    {/* ขั้นตอนที่ 2 */}
                    <div className="relative">
                      <span className={`absolute -left-[31px] top-0 w-4 h-4 rounded-full border-2 bg-white ${
                        ['assigned', 'accepted', 'completed', 'closed'].includes(latestReport.status)
                          ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300'
                      }`} />
                      <div className={`font-bold ${['assigned', 'accepted'].includes(latestReport.status) ? 'text-blue-600' : 'text-slate-700'}`}>
                        กำลังส่งทีมกู้ภัยเข้าพื้นที่ช่วยเหลือ
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">ศูนย์ประสานงานกำลังจัดเตรียมสิ่งของเพื่อเดินทางเข้าพื้นที่ตามดาวเทียม</p>
                    </div>

                    {/* ขั้นตอนที่ 3 */}
                    <div className="relative">
                      <span className={`absolute -left-[31px] top-0 w-4 h-4 rounded-full border-2 bg-white ${
                        ['completed', 'closed'].includes(latestReport.status) ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300'
                      }`} />
                      <div className="font-bold text-slate-700">ภารกิจช่วยเหลือเสร็จสิ้น</div>
                      <p className="text-xs text-slate-400 mt-0.5">ผู้ประสบภัยได้รับการช่วยเหลือเข้าสู่พื้นที่ปลอดภัยเรียบร้อย</p>
                    </div>

                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/60 space-y-2 text-xs">
                  <span className="font-bold text-slate-500 block">🏠 รายละเอียดพื้นที่และสิ่งของที่ขอไว้:</span>
                  <p className="text-slate-700">📍 <b>พื้นที่:</b> ต.{latestReport.sub_district} อ.{latestReport.district} จ.{latestReport.province}</p>
                  <p className="text-slate-700">🌊 <b>ระดับน้ำ:</b> {latestReport.water_level} เมตร</p>
                  <p className="text-slate-700">📦 <b>ถุงยังชีพที่ต้องการ:</b> {latestReport.needed_items && latestReport.needed_items.length > 0 ? latestReport.needed_items.join(', ') : 'ไม่มีระบุเพิ่มเติม'}</p>
                  {latestReport.special_needs && <p className="text-rose-600">⚠️ <b>หมายเหตุเด่น:</b> {latestReport.special_needs}</p>}
                </div>

              </div>
            ) : (
              <div className="bg-white p-10 rounded-3xl border border-slate-200 text-center text-slate-400 space-y-3 shadow-sm">
                <span className="text-4xl block">📡</span>
                <h4 className="font-bold text-slate-700 text-sm">ไม่พบข้อมูลการแจ้งเหตุ SOS</h4>
                <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
                  กรุณากรอกเบอร์โทรศัพท์ 10 หลักที่คุณระบุไว้ตอนส่งฟอร์ม SOS เพื่อทำการดึงประวัติความคืบหน้าแบบ Real-time จากเซิร์ฟเวอร์
                </p>
              </div>
            )}

          </div>
        )}

      </main>

      {/* แถบเมนูด้านล่างสุด (Sticky Bottom Navbar) */}
      <div className="fixed bottom-5 left-4 right-4 max-w-md mx-auto bg-white/75 backdrop-blur-xl border border-white/60 px-2 py-2 flex justify-around items-center rounded-full shadow-[0_10px_25px_-5px_rgba(0,0,0,0.08)] z-50">
        <button type="button" onClick={() => setActiveTab('sos')} className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-full transition-all ${activeTab === 'sos' ? 'text-rose-500 bg-rose-500/10 font-bold shadow-[inset_0_1px_2px_rgba(244,63,94,0.1)]' : 'text-slate-500'}`}>
          <span className="text-xl">🚨</span>
          <span className="text-[10px]">SOS ฟอร์ม</span>
        </button>
        <button type="button" onClick={() => setActiveTab('status')} className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-full transition-all ${activeTab === 'status' ? 'text-blue-600 bg-blue-500/10 font-bold shadow-[inset_0_1px_2px_rgba(37,99,235,0.1)]' : 'text-slate-500'}`}>
          <span className="text-xl">📊</span>
          <span className="text-[10px]">ดูสถานะ</span>
        </button>
      </div>

    </div>
  );
}