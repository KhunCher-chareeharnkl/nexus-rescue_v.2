'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Crosshair,
  MapPin,
  Minus,
  PackageOpen,
  Plus,
  Send,
  UserRound,
  Users,
  Waves,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { saveSosSession } from '@/lib/session';

const AVAILABLE_ITEMS = [
  'อาหารและน้ำดื่ม',
  'ยารักษาโรค',
  'ชุดสุขอนามัย/ผ้าอนามัย',
  'ไฟฉาย/แบตเตอรี่สำรอง',
  'เสื้อผ้าแห้ง',
  'แพชูชีพ/ชูชีพ',
];

const STEP_META = [
  { number: 1, label: 'ข้อมูลติดต่อ', icon: UserRound },
  { number: 2, label: 'ตำแหน่ง', icon: MapPin },
  { number: 3, label: 'สถานการณ์', icon: Waves },
] as const;

type UrgencyLevel = 'low' | 'medium' | 'high' | 'critical';

function calculateUrgency({
  waterLevel,
  adultCount,
  childCount,
  elderCount,
  specialNeeds,
  neededItems,
}: {
  waterLevel: number;
  adultCount: number;
  childCount: number;
  elderCount: number;
  specialNeeds: string;
  neededItems: string[];
}): UrgencyLevel {
  const totalPeople = adultCount + childCount + elderCount;
  const vulnerablePeople = childCount + elderCount;
  const hasSpecialNeeds = specialNeeds.trim().length > 0;
  const needsRescueEquipment = neededItems.some((item) => item.includes('ชูชีพ'));
  const needsMedicine = neededItems.some((item) => item.includes('ยา'));

  const riskScore =
    waterLevel * 2
    + Math.min(totalPeople, 8) * 0.5
    + Math.min(vulnerablePeople, 4)
    + (hasSpecialNeeds ? 3 : 0)
    + (needsRescueEquipment ? 2 : 0)
    + (needsMedicine ? 1 : 0);

  if (waterLevel >= 5 || riskScore >= 15) return 'critical';
  if (waterLevel >= 3 || riskScore >= 10) return 'high';
  if (waterLevel >= 2 || riskScore >= 6) return 'medium';
  return 'low';
}

export default function SosRequestForm({ onSubmitted }: { onSubmitted: (phone: string) => void }) {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [province, setProvince] = useState('');
  const [district, setDistrict] = useState('');
  const [subDistrict, setSubDistrict] = useState('');
  const [addressDetails, setAddressDetails] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [provinces, setProvinces] = useState<string[]>([]);
  const [districts, setDistricts] = useState<string[]>([]);
  const [subDistricts, setSubDistricts] = useState<string[]>([]);
  const [loadingProvinces, setLoadingProvinces] = useState(false);
  const [loadingDistricts, setLoadingDistricts] = useState(false);
  const [loadingSubDistricts, setLoadingSubDistricts] = useState(false);
  const [waterLevel, setWaterLevel] = useState(1);
  const [adultCount, setAdultCount] = useState(1);
  const [childCount, setChildCount] = useState(0);
  const [elderCount, setElderCount] = useState(0);
  const [specialNeeds, setSpecialNeeds] = useState('');
  const [neededItems, setNeededItems] = useState<string[]>([]);
  const [customItem, setCustomItem] = useState('');

  useEffect(() => {
    let active = true;

    async function loadProvinces() {
      setLoadingProvinces(true);
      const { data, error } = await supabase.from('thai_addresses').select('province').order('province');
      if (!active) return;
      if (!error) setProvinces(Array.from(new Set((data ?? []).map((item) => item.province))));
      setLoadingProvinces(false);
    }

    loadProvinces();
    return () => { active = false; };
  }, []);

  const handlePhoneChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 10);
    setPhone(digits);
    if (digits.length === 10) setPhoneError('');
  };

  const handleProvinceChange = async (value: string) => {
    setProvince(value);
    setDistrict('');
    setSubDistrict('');
    setDistricts([]);
    setSubDistricts([]);
    if (!value) return;

    setLoadingDistricts(true);
    const { data, error } = await supabase
      .from('thai_addresses')
      .select('district')
      .eq('province', value)
      .order('district');
    if (!error) setDistricts(Array.from(new Set((data ?? []).map((item) => item.district))));
    setLoadingDistricts(false);
  };

  const handleDistrictChange = async (value: string) => {
    setDistrict(value);
    setSubDistrict('');
    setSubDistricts([]);
    if (!province || !value) return;

    setLoadingSubDistricts(true);
    const { data, error } = await supabase
      .from('thai_addresses')
      .select('sub_district')
      .eq('province', province)
      .eq('district', value)
      .order('sub_district');
    if (!error) setSubDistricts(Array.from(new Set((data ?? []).map((item) => item.sub_district))));
    setLoadingSubDistricts(false);
  };

  const getLocation = () => {
    if (!navigator.geolocation) {
      alert('เบราว์เซอร์นี้ไม่รองรับการดึงพิกัด GPS');
      return;
    }

    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(position.coords.latitude);
        setLng(position.coords.longitude);
        setGpsLoading(false);
      },
      () => {
        setGpsLoading(false);
        alert('ไม่สามารถอ่านพิกัดได้ กรุณาอนุญาตตำแหน่งหรือกรอกรายละเอียดสถานที่แทน');
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  const goToLocationStep = () => {
    if (!firstName.trim() || !lastName.trim()) {
      alert('กรุณากรอกชื่อและนามสกุลให้ครบถ้วน');
      return;
    }
    if (phone.length !== 10) {
      setPhoneError('กรุณากรอกเบอร์โทรศัพท์ให้ครบ 10 หลัก');
      return;
    }
    setStep(2);
  };

  const goToSituationStep = () => {
    if (!province || !district) {
      alert('กรุณาเลือกจังหวัดและอำเภอ');
      return;
    }
    setStep(3);
  };

  const toggleItem = (item: string) => {
    setNeededItems((current) => current.includes(item)
      ? current.filter((selected) => selected !== item)
      : [...current, item]);
  };

  const addCustomItem = () => {
    const item = customItem.trim();
    if (!item) return;
    setNeededItems((current) => current.includes(item) ? current : [...current, item]);
    setCustomItem('');
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    try {
      const urgencyLevel = calculateUrgency({
        waterLevel,
        adultCount,
        childCount,
        elderCount,
        specialNeeds,
        neededItems,
      });

      const { data, error } = await supabase
        .from('sos_reports')
        .insert([{
          full_name: `${firstName.trim()} ${lastName.trim()}`,
          phone,
          province,
          district,
          sub_district: subDistrict,
          address_details: addressDetails.trim() || null,
          lat,
          lng,
          adult_count: adultCount,
          child_count: childCount,
          elder_count: elderCount,
          urgency_level: urgencyLevel,
          water_level: waterLevel,
          special_needs: specialNeeds.trim() || null,
          needed_items: neededItems,
          status: 'pending',
        }])
        .select('id')
        .single();

      if (error) throw error;
      saveSosSession(data.id, phone);
      onSubmitted(phone);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ไม่สามารถส่งข้อมูลได้';
      alert(`ส่งข้อมูลไม่สำเร็จ: ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="sos-form" onSubmit={handleSubmit}>
      <div className="sos-stepper" aria-label={`ขั้นตอนที่ ${step} จาก 3`}>
        <div className="sos-stepper-line"><span style={{ width: `${((step - 1) / 2) * 100}%` }} /></div>
        {STEP_META.map(({ number, label, icon: Icon }) => (
          <div className={`sos-step ${number < step ? 'complete' : number === step ? 'active' : ''}`} key={number}>
            <span>{number < step ? <Check size={15} /> : <Icon size={15} />}</span>
            <small>{label}</small>
          </div>
        ))}
      </div>

      {step === 1 && (
        <section className="sos-panel">
          <PanelHeading number="01" title="ข้อมูลสำหรับติดต่อ" description="เจ้าหน้าที่จะใช้ข้อมูลนี้เพื่อยืนยันเคสและติดต่อกลับ" />
          <div className="sos-field-grid two">
            <Field label="ชื่อจริง"><input value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="กรอกชื่อ" autoComplete="given-name" /></Field>
            <Field label="นามสกุล"><input value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder="กรอกนามสกุล" autoComplete="family-name" /></Field>
          </div>
          <Field label="เบอร์โทรศัพท์มือถือ" hint="ใช้สำหรับเช็คสถานะภายหลัง">
            <input className={phoneError ? 'error' : ''} type="tel" inputMode="numeric" value={phone} onChange={(event) => handlePhoneChange(event.target.value)} placeholder="เช่น 0891234567" autoComplete="tel" />
            {phoneError && <span className="sos-field-error">{phoneError}</span>}
          </Field>
          <button className="sos-primary-button" type="button" onClick={goToLocationStep}>ระบุตำแหน่งต่อ <ArrowRight size={16} /></button>
        </section>
      )}

      {step === 2 && (
        <section className="sos-panel">
          <PanelHeading number="02" title="ตำแหน่งที่ต้องการความช่วยเหลือ" description="เลือกพื้นที่และเพิ่มจุดสังเกตเพื่อให้เจ้าหน้าที่หาเจอง่ายขึ้น" />
          <Field label="จังหวัด"><select value={province} onChange={(event) => handleProvinceChange(event.target.value)}><option value="">{loadingProvinces ? 'กำลังโหลด...' : 'เลือกจังหวัด'}</option>{provinces.map((item) => <option key={item}>{item}</option>)}</select></Field>
          <div className="sos-field-grid two">
            <Field label="อำเภอ"><select value={district} disabled={!province || loadingDistricts} onChange={(event) => handleDistrictChange(event.target.value)}><option value="">{loadingDistricts ? 'กำลังโหลด...' : 'เลือกอำเภอ'}</option>{districts.map((item) => <option key={item}>{item}</option>)}</select></Field>
            <Field label="ตำบล"><select value={subDistrict} disabled={!district || loadingSubDistricts} onChange={(event) => setSubDistrict(event.target.value)}><option value="">{loadingSubDistricts ? 'กำลังโหลด...' : 'เลือกตำบล'}</option>{subDistricts.map((item) => <option key={item}>{item}</option>)}</select></Field>
          </div>
          <Field label="บ้านเลขที่ ซอย หรือจุดสังเกต"><textarea rows={3} value={addressDetails} onChange={(event) => setAddressDetails(event.target.value)} placeholder="เช่น บ้านชั้นเดียวติดร้านขายยา หลังคาสีน้ำเงิน" /></Field>
          <div className={`sos-location-box ${lat && lng ? 'success' : ''}`}>
            <span><Crosshair size={20} /></span>
            <div><strong>{lat && lng ? 'บันทึกพิกัดแล้ว' : 'เพิ่มพิกัด GPS'}</strong><small>{lat && lng ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'ช่วยให้ทีมกู้ภัยนำทางมาถึงได้แม่นยำขึ้น'}</small></div>
            <button type="button" onClick={getLocation} disabled={gpsLoading}>{gpsLoading ? 'กำลังอ่าน...' : lat && lng ? 'อัปเดต' : 'ใช้ตำแหน่งนี้'}</button>
          </div>
          <div className="sos-button-row"><button className="sos-secondary-button" type="button" onClick={() => setStep(1)}><ArrowLeft size={15} /> ย้อนกลับ</button><button className="sos-primary-button" type="button" onClick={goToSituationStep}>รายละเอียดเหตุการณ์ <ArrowRight size={15} /></button></div>
        </section>
      )}

      {step === 3 && (
        <section className="sos-panel">
          <PanelHeading number="03" title="รายละเอียดสถานการณ์" description="ข้อมูลนี้ช่วยให้เจ้าหน้าที่เตรียมกำลังคนและอุปกรณ์ได้เหมาะสม" />
          <Field label="ระดับน้ำโดยประมาณ"><div className="sos-choice-grid five">{[1, 2, 3, 4, 5].map((level) => <button type="button" className={waterLevel === level ? 'selected' : ''} key={level} onClick={() => setWaterLevel(level)}><strong>{level}</strong><small>เมตร</small></button>)}</div></Field>
          <Field label="จำนวนผู้ประสบภัย"><div className="sos-people-list"><Counter label="ผู้ใหญ่" value={adultCount} setValue={setAdultCount} /><Counter label="เด็ก" value={childCount} setValue={setChildCount} /><Counter label="ผู้สูงอายุ" value={elderCount} setValue={setElderCount} /></div></Field>
          <Field label="สิ่งของบรรเทาทุกข์ที่ต้องการ"><div className="sos-chip-list">{AVAILABLE_ITEMS.map((item) => <button type="button" className={neededItems.includes(item) ? 'selected' : ''} key={item} onClick={() => toggleItem(item)}>{neededItems.includes(item) && <Check size={13} />}{item}</button>)}</div></Field>
          <div className="sos-custom-item"><PackageOpen size={17} /><input value={customItem} onChange={(event) => setCustomItem(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomItem(); } }} placeholder="เพิ่มสิ่งของอื่น ๆ" /><button type="button" onClick={addCustomItem}>เพิ่ม</button></div>
          {neededItems.some((item) => !AVAILABLE_ITEMS.includes(item)) && <div className="sos-custom-chips">{neededItems.filter((item) => !AVAILABLE_ITEMS.includes(item)).map((item) => <span key={item}>{item}<button type="button" onClick={() => toggleItem(item)} aria-label={`ลบ ${item}`}><X size={12} /></button></span>)}</div>}
          <Field label="ความต้องการพิเศษหรือหมายเหตุ"><textarea rows={3} value={specialNeeds} onChange={(event) => setSpecialNeeds(event.target.value)} placeholder="เช่น มีผู้ป่วยติดเตียง ผู้พิการ หญิงตั้งครรภ์ หรือยาที่จำเป็น" /></Field>
          <div className="sos-submit-note"><Send size={17} /><span><strong>ระบบจะประเมินความเร่งด่วนให้อัตโนมัติ</strong><small>ประเมินจากระดับน้ำ จำนวนผู้ประสบภัย กลุ่มเปราะบาง และความต้องการพิเศษ</small></span></div>
          <div className="sos-button-row"><button className="sos-secondary-button" type="button" onClick={() => setStep(2)}><ArrowLeft size={15} /> ย้อนกลับ</button><button className="sos-primary-button" type="submit" disabled={submitting}>{submitting ? 'กำลังส่งข้อมูล...' : 'ส่งคำขอความช่วยเหลือ'} <Send size={15} /></button></div>
        </section>
      )}
    </form>
  );
}

function PanelHeading({ number, title, description }: { number: string; title: string; description: string }) {
  return <div className="sos-panel-heading"><span>{number}</span><div><h2>{title}</h2><p>{description}</p></div></div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="sos-field"><span>{label}{hint && <small>{hint}</small>}</span>{children}</label>;
}

function Counter({ label, value, setValue }: { label: string; value: number; setValue: (value: number) => void }) {
  return <div><span><Users size={14} /> {label}</span><div><button type="button" onClick={() => setValue(Math.max(0, value - 1))}><Minus size={14} /></button><strong>{value}</strong><button type="button" className="add" onClick={() => setValue(Math.min(20, value + 1))}><Plus size={14} /></button></div></div>;
}
