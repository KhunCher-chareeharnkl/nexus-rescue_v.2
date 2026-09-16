'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
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
import { saveSosSession } from '@/lib/session';
import {
  getPendingSosCount,
  isNetworkError,
  queueSosRequest,
  submitSosRequest,
  syncPendingSosRequests,
  type SosRequestPayload,
} from '@/lib/offline-sos-queue';
import thaiAddressData from '@riz007/thai-address-data';

const AVAILABLE_ITEMS = [
  'อาหารและน้ำดื่ม',
  'ยารักษาโรค',
  'ชุดสุขอนามัย/ผ้าอนามัย',
  'ไฟฉาย/แบตเตอรี่สำรอง',
  'เสื้อผ้าแห้ง',
  'แพชูชีพ/ชูชีพ',
];

const MAX_PEOPLE_PER_GROUP = 99;
const SOS_DRAFT_KEY = 'nexus_sos_draft_v1';

type SosDraft = {
  sosRequestId: string;
  firstName: string;
  lastName: string;
  phone: string;
  province: string;
  district: string;
  subDistrict: string;
  houseNumber: string;
  villageNumber: string;
  soi: string;
  road: string;
  landmark: string;
  lat: number | null;
  lng: number | null;
  waterLevel: number;
  adultCount: number;
  childCount: number;
  elderCount: number;
  specialNeeds: string;
  neededItems: string[];
  customItem: string;
};

function createSosRequestId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function unique(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'th'));
}

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
  const [sosRequestId, setSosRequestId] = useState(createSosRequestId);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [province, setProvince] = useState('');
  const [district, setDistrict] = useState('');
  const [subDistrict, setSubDistrict] = useState('');
  const [houseNumber, setHouseNumber] = useState('');
  const [villageNumber, setVillageNumber] = useState('');
  const [soi, setSoi] = useState('');
  const [road, setRoad] = useState('');
  const [landmark, setLandmark] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsNotice, setGpsNotice] = useState('');
  const [triedLocationStep, setTriedLocationStep] = useState(false);
  const [waterLevel, setWaterLevel] = useState(1);
  const [adultCount, setAdultCount] = useState(1);
  const [childCount, setChildCount] = useState(0);
  const [elderCount, setElderCount] = useState(0);
  const [specialNeeds, setSpecialNeeds] = useState('');
  const [neededItems, setNeededItems] = useState<string[]>([]);
  const [customItem, setCustomItem] = useState('');
  const [isOnline, setIsOnline] = useState(true);
  const [pendingSosCount, setPendingSosCount] = useState(0);
  const [queueNotice, setQueueNotice] = useState('');
  const [draftReady, setDraftReady] = useState(false);
  const hasGpsCoordinates = lat !== null && lng !== null;
  const hasAddressDetails = [houseNumber, villageNumber, soi, road, landmark].some((value) => value.trim().length > 0);
  const hasLocationDetails = hasGpsCoordinates || hasAddressDetails;
  const provinces = useMemo(() => unique(thaiAddressData.map((item) => item.province)), []);
  const districts = useMemo(() => unique(thaiAddressData.filter((item) => item.province === province).map((item) => item.district)), [province]);
  const subDistrictRows = useMemo(() => thaiAddressData.filter((item) => item.province === province && item.district === district), [province, district]);
  const subDistricts = useMemo(() => unique(subDistrictRows.map((item) => item.subdistrict)), [subDistrictRows]);

  useEffect(() => {
    const refreshNetworkState = () => setIsOnline(navigator.onLine);
    const refreshQueueCount = () => setPendingSosCount(getPendingSosCount());
    const onSosSent = (event: Event) => {
      const detail = (event as CustomEvent<{ phone?: string }>).detail;
      if (detail?.phone && detail.phone === phone) {
        clearSosDraft();
        onSubmitted(detail.phone);
      }
    };

    const hydrate = window.setTimeout(() => {
      try {
        const savedDraft = JSON.parse(window.localStorage.getItem(SOS_DRAFT_KEY) ?? 'null') as SosDraft | null;
        if (savedDraft) {
          setSosRequestId(savedDraft.sosRequestId || createSosRequestId());
          setFirstName(savedDraft.firstName ?? ''); setLastName(savedDraft.lastName ?? ''); setPhone(savedDraft.phone ?? '');
          setProvince(savedDraft.province ?? ''); setDistrict(savedDraft.district ?? ''); setSubDistrict(savedDraft.subDistrict ?? '');
          setHouseNumber(savedDraft.houseNumber ?? ''); setVillageNumber(savedDraft.villageNumber ?? ''); setSoi(savedDraft.soi ?? '');
          setRoad(savedDraft.road ?? ''); setLandmark(savedDraft.landmark ?? ''); setLat(savedDraft.lat ?? null); setLng(savedDraft.lng ?? null);
          setWaterLevel(savedDraft.waterLevel ?? 1); setAdultCount(savedDraft.adultCount ?? 1); setChildCount(savedDraft.childCount ?? 0);
          setElderCount(savedDraft.elderCount ?? 0); setSpecialNeeds(savedDraft.specialNeeds ?? ''); setNeededItems(savedDraft.neededItems ?? []);
          setCustomItem(savedDraft.customItem ?? '');
        }
      } catch {
        window.localStorage.removeItem(SOS_DRAFT_KEY);
      }
      refreshNetworkState(); refreshQueueCount(); setDraftReady(true);
    }, 0);

    window.addEventListener('online', refreshNetworkState);
    window.addEventListener('offline', refreshNetworkState);
    window.addEventListener('nexus:sos-queue-changed', refreshQueueCount);
    window.addEventListener('nexus:sos-sent', onSosSent);
    return () => {
      window.clearTimeout(hydrate);
      window.removeEventListener('online', refreshNetworkState);
      window.removeEventListener('offline', refreshNetworkState);
      window.removeEventListener('nexus:sos-queue-changed', refreshQueueCount);
      window.removeEventListener('nexus:sos-sent', onSosSent);
    };
  }, [onSubmitted, phone]);

  useEffect(() => {
    if (!draftReady) return;
    const draft: SosDraft = {
      sosRequestId, firstName, lastName, phone, province, district, subDistrict, houseNumber, villageNumber, soi, road,
      landmark, lat, lng, waterLevel, adultCount, childCount, elderCount, specialNeeds, neededItems, customItem,
    };
    const hasDraftData = Boolean(
      firstName || lastName || phone || province || district || subDistrict || houseNumber || villageNumber || soi || road
      || landmark || lat !== null || lng !== null || neededItems.length || specialNeeds || customItem,
    );
    if (hasDraftData) window.localStorage.setItem(SOS_DRAFT_KEY, JSON.stringify(draft));
    else clearSosDraft();
  }, [adultCount, childCount, customItem, district, draftReady, elderCount, firstName, houseNumber, landmark, lastName, lat, lng, neededItems, phone, province, road, soi, sosRequestId, specialNeeds, subDistrict, villageNumber, waterLevel]);

  const handlePhoneChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 10);
    setPhone(digits);
    if (digits.length === 10) setPhoneError('');
  };

  const handleProvinceChange = (value: string) => {
    setProvince(value);
    setDistrict('');
    setSubDistrict('');
  };

  const handleDistrictChange = (value: string) => {
    setDistrict(value);
    setSubDistrict('');
  };

  const getLocation = () => {
    setGpsNotice('');
    const isMessengerWebView = /(Messenger|FBAN|FBAV|FB_IAB)/i.test(navigator.userAgent);

    if (!window.isSecureContext) {
      setGpsNotice('ลิงก์นี้ต้องเปิดผ่าน HTTPS จึงจะขอใช้ตำแหน่งได้ กรุณาเปิดด้วยเบราว์เซอร์ของเครื่อง');
      return;
    }

    if (!navigator.geolocation) {
      if (isMessengerWebView) {
        setGpsNotice('Messenger ไม่รองรับการขอใช้ตำแหน่งบนเครื่องนี้ ให้กดเมนู ⋮ แล้วเลือก “เปิดในเบราว์เซอร์” จากนั้นกดปุ่มนี้อีกครั้ง');
        return;
      }
      setGpsNotice('เบราว์เซอร์นี้ไม่รองรับการดึงพิกัด GPS กรุณากรอกจุดสังเกตให้ละเอียดแทน');
      return;
    }

    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(position.coords.latitude);
        setLng(position.coords.longitude);
        setTriedLocationStep(false);
        setGpsLoading(false);
      },
      (error) => {
        setGpsLoading(false);
        if (isMessengerWebView && error.code === error.PERMISSION_DENIED) {
          setGpsNotice('Messenger ไม่แสดงหน้าต่างขอใช้ตำแหน่งในบางเครื่อง ให้กดเมนู ⋮ แล้วเลือก “เปิดในเบราว์เซอร์” จากนั้นกดปุ่มนี้อีกครั้ง');
          return;
        }
        setGpsNotice('ไม่สามารถอ่านพิกัดได้ กรุณาอนุญาตตำแหน่ง หรือกรอกรายละเอียดสถานที่และจุดสังเกตให้ครบถ้วน');
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  const copyCurrentLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setGpsNotice('คัดลอกลิงก์แล้ว — วางลิงก์ใน Chrome หรือ Safari เพื่ออนุญาตตำแหน่ง');
    } catch {
      setGpsNotice('กรุณาคัดลอกลิงก์จากแถบด้านบน แล้วเปิดด้วย Chrome หรือ Safari เพื่ออนุญาตตำแหน่ง');
    }
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
    if (!hasLocationDetails) {
      setTriedLocationStep(true);
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

  const totalPeople = adultCount + childCount + elderCount;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (totalPeople < 1) {
      alert('กรุณาระบุจำนวนผู้ประสบภัยอย่างน้อย 1 คน');
      return;
    }
    if (!hasLocationDetails) {
      setTriedLocationStep(true);
      setStep(2);
      return;
    }
    setSubmitting(true);

    try {
      const addressDetails = [
        houseNumber.trim() && `บ้านเลขที่ ${houseNumber.trim()}`,
        villageNumber.trim() && `หมู่ ${villageNumber.trim()}`,
        soi.trim() && `ซอย ${soi.trim()}`,
        road.trim() && `ถนน ${road.trim()}`,
        landmark.trim() && `จุดสังเกต: ${landmark.trim()}`,
      ].filter(Boolean).join(' · ');
      const urgencyLevel = calculateUrgency({
        waterLevel,
        adultCount,
        childCount,
        elderCount,
        specialNeeds,
        neededItems,
      });

      const payload: SosRequestPayload = {
        client_request_id: sosRequestId,
        full_name: `${firstName.trim()} ${lastName.trim()}`,
        phone,
        province,
        district,
        sub_district: subDistrict,
        address_details: addressDetails || null,
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
      };

      if (!navigator.onLine) {
        queueSosRequest(payload);
        setPendingSosCount(getPendingSosCount());
        setQueueNotice('บันทึกคำขอไว้ในเครื่องแล้ว ระบบจะส่งถึงเจ้าหน้าที่ทันทีเมื่อเชื่อมต่ออินเทอร์เน็ตได้');
        return;
      }

      const id = await submitSosRequest(payload);
      clearSosDraft();
      saveSosSession(id, phone);
      onSubmitted(phone);
    } catch (error) {
      if (isNetworkError(error)) {
        const addressDetails = [
          houseNumber.trim() && `บ้านเลขที่ ${houseNumber.trim()}`,
          villageNumber.trim() && `หมู่ ${villageNumber.trim()}`,
          soi.trim() && `ซอย ${soi.trim()}`,
          road.trim() && `ถนน ${road.trim()}`,
          landmark.trim() && `จุดสังเกต: ${landmark.trim()}`,
        ].filter(Boolean).join(' · ');
        queueSosRequest({
          client_request_id: sosRequestId, full_name: `${firstName.trim()} ${lastName.trim()}`, phone, province, district,
          sub_district: subDistrict, address_details: addressDetails || null, lat, lng, adult_count: adultCount,
          child_count: childCount, elder_count: elderCount,
          urgency_level: calculateUrgency({ waterLevel, adultCount, childCount, elderCount, specialNeeds, neededItems }),
          water_level: waterLevel, special_needs: specialNeeds.trim() || null, needed_items: neededItems, status: 'pending',
        });
        setPendingSosCount(getPendingSosCount());
        setQueueNotice('เชื่อมต่อเครือข่ายไม่ได้ จึงบันทึกคำขอไว้ในเครื่องและจะส่งอัตโนมัติเมื่อกลับมาออนไลน์');
        return;
      }
      const message = error instanceof Error ? error.message : 'ไม่สามารถส่งข้อมูลได้';
      alert(`ส่งข้อมูลไม่สำเร็จ: ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="sos-form" onSubmit={handleSubmit}>
      {(!isOnline || pendingSosCount > 0 || queueNotice) && <div className="sos-offline-notice" role="status">
        <Send size={18} />
        <span>
          <strong>{!isOnline ? 'กำลังใช้งานแบบออฟไลน์' : pendingSosCount > 0 ? `มีคำขอ SOS รอส่ง ${pendingSosCount} รายการ` : 'คำขอถูกเก็บไว้ในเครื่องแล้ว'}</strong>
          <small>{queueNotice || (!isOnline ? 'กรอกข้อมูลต่อได้ เมื่อกดส่งระบบจะเก็บไว้และส่งเมื่ออินเทอร์เน็ตกลับมา' : 'ระบบกำลังส่งคำขอที่ค้างอยู่')}</small>
        </span>
        {isOnline && pendingSosCount > 0 && <button type="button" onClick={() => void syncPendingSosRequests().then(() => setPendingSosCount(getPendingSosCount()))}>ลองส่งตอนนี้</button>}
      </div>}
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
          <Field label="จังหวัด"><select value={province} onChange={(event) => handleProvinceChange(event.target.value)}><option value="">เลือกจังหวัด</option>{provinces.map((item) => <option key={item}>{item}</option>)}</select></Field>
          <div className="sos-field-grid two">
            <Field label="อำเภอ"><select value={district} disabled={!province} onChange={(event) => handleDistrictChange(event.target.value)}><option value="">เลือกอำเภอ</option>{districts.map((item) => <option key={item}>{item}</option>)}</select></Field>
            <Field label="ตำบล"><select value={subDistrict} disabled={!district} onChange={(event) => setSubDistrict(event.target.value)}><option value="">เลือกตำบล</option>{subDistricts.map((item) => <option key={item}>{item}</option>)}</select></Field>
          </div>
          <div className="sos-field-grid two">
            <Field label="บ้านเลขที่"><input value={houseNumber} onChange={(event) => setHouseNumber(event.target.value)} placeholder="เช่น 123/45" autoComplete="address-line1" /></Field>
            <Field label="หมู่ที่"><input value={villageNumber} onChange={(event) => setVillageNumber(event.target.value)} placeholder="เช่น 4" inputMode="numeric" /></Field>
          </div>
          <div className="sos-field-grid two">
            <Field label="ซอย"><input value={soi} onChange={(event) => setSoi(event.target.value)} placeholder="เช่น ซอยสุขใจ 2" /></Field>
            <Field label="ถนน"><input value={road} onChange={(event) => setRoad(event.target.value)} placeholder="เช่น ถนนเพชรเกษม" /></Field>
          </div>
          <Field label="จุดสังเกตหรือรายละเอียดเพิ่มเติม" hint="ถ้ามี จะช่วยให้ทีมกู้ภัยหาคุณได้เร็วขึ้น"><textarea rows={3} value={landmark} onChange={(event) => setLandmark(event.target.value)} placeholder="เช่น บ้านชั้นเดียวติดร้านขายยา หลังคาสีน้ำเงิน" /></Field>
          {triedLocationStep && !hasLocationDetails && <div className="sos-location-required" role="alert">กรุณาเพิ่มพิกัด GPS หรือกรอกรายละเอียดที่อยู่/จุดสังเกตอย่างน้อย 1 รายการ</div>}
          <div className={`sos-location-box ${hasGpsCoordinates ? 'success' : ''}`}>
            <span><Crosshair size={20} /></span>
            <div><strong>{hasGpsCoordinates ? 'บันทึกพิกัดแล้ว' : 'เพิ่มพิกัด GPS'}</strong><small>{hasGpsCoordinates ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'ช่วยให้ทีมกู้ภัยนำทางมาถึงได้แม่นยำขึ้น'}</small></div>
            <button type="button" onClick={getLocation} disabled={gpsLoading}>{gpsLoading ? 'กำลังอ่าน...' : hasGpsCoordinates ? 'อัปเดต' : 'ใช้ตำแหน่งนี้'}</button>
          </div>
          {gpsNotice && (
            <div className="sos-location-help" role="status">
              <span>{gpsNotice}</span>
              {/(Messenger|HTTPS|เบราว์เซอร์ของเครื่อง)/.test(gpsNotice) && <button type="button" onClick={copyCurrentLink}>คัดลอกลิงก์</button>}
            </div>
          )}
          <div className="sos-button-row"><button className="sos-secondary-button" type="button" onClick={() => setStep(1)}><ArrowLeft size={15} /> ย้อนกลับ</button><button className="sos-primary-button" type="button" onClick={goToSituationStep}>รายละเอียดเหตุการณ์ <ArrowRight size={15} /></button></div>
        </section>
      )}

      {step === 3 && (
        <section className="sos-panel">
          <PanelHeading number="03" title="รายละเอียดสถานการณ์" description="ข้อมูลนี้ช่วยให้เจ้าหน้าที่เตรียมกำลังคนและอุปกรณ์ได้เหมาะสม" />
          <Field label="ระดับน้ำโดยประมาณ"><div className="sos-choice-grid five">{[1, 2, 3, 4, 5].map((level) => <button type="button" className={waterLevel === level ? 'selected' : ''} key={level} onClick={() => setWaterLevel(level)}><strong>{level}</strong><small>เมตร</small></button>)}</div></Field>
          <Field label="จำนวนผู้ประสบภัย"><div className="sos-people-list"><Counter label="เด็ก" ageRange="อายุ 0–17 ปี" value={childCount} setValue={setChildCount} /><Counter label="ผู้ใหญ่" ageRange="อายุ 18–59 ปี" value={adultCount} setValue={setAdultCount} /><Counter label="ผู้สูงอายุ" ageRange="อายุ 60 ปีขึ้นไป" value={elderCount} setValue={setElderCount} /></div>{totalPeople < 1 && <div className="sos-field-error" role="alert">กรุณาระบุจำนวนผู้ประสบภัยอย่างน้อย 1 คน</div>}</Field>
          <Field label="สิ่งของบรรเทาทุกข์ที่ต้องการ"><div className="sos-chip-list">{AVAILABLE_ITEMS.map((item) => <button type="button" className={neededItems.includes(item) ? 'selected' : ''} key={item} onClick={() => toggleItem(item)}>{neededItems.includes(item) && <Check size={13} />}{item}</button>)}</div></Field>
          <div className="sos-custom-item"><PackageOpen size={17} /><input value={customItem} onChange={(event) => setCustomItem(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomItem(); } }} placeholder="เพิ่มสิ่งของอื่น ๆ" /><button type="button" onClick={addCustomItem}>เพิ่ม</button></div>
          {neededItems.some((item) => !AVAILABLE_ITEMS.includes(item)) && <div className="sos-custom-chips">{neededItems.filter((item) => !AVAILABLE_ITEMS.includes(item)).map((item) => <span key={item}>{item}<button type="button" onClick={() => toggleItem(item)} aria-label={`ลบ ${item}`}><X size={12} /></button></span>)}</div>}
          <Field label="ความต้องการพิเศษหรือหมายเหตุ"><textarea rows={3} value={specialNeeds} onChange={(event) => setSpecialNeeds(event.target.value)} placeholder="เช่น มีผู้ป่วยติดเตียง ผู้พิการ หญิงตั้งครรภ์ หรือยาที่จำเป็น" /></Field>
          <div className="sos-submit-note"><Send size={17} /><span><strong>ระบบจะประเมินความเร่งด่วนให้อัตโนมัติ</strong><small>ประเมินจากระดับน้ำ จำนวนผู้ประสบภัย กลุ่มเปราะบาง และความต้องการพิเศษ</small></span></div>
          <div className="sos-button-row"><button className="sos-secondary-button" type="button" onClick={() => setStep(2)}><ArrowLeft size={15} /> ย้อนกลับ</button><button className="sos-primary-button" type="submit" disabled={submitting || totalPeople < 1}>{submitting ? 'กำลังส่งข้อมูล...' : isOnline ? 'ส่งคำขอความช่วยเหลือ' : 'บันทึกและรอส่ง'} <Send size={15} /></button></div>
        </section>
      )}
    </form>
  );
}

function clearSosDraft() {
  if (typeof window !== 'undefined') window.localStorage.removeItem(SOS_DRAFT_KEY);
}

function PanelHeading({ number, title, description }: { number: string; title: string; description: string }) {
  return <div className="sos-panel-heading"><span>{number}</span><div><h2>{title}</h2><p>{description}</p></div></div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="sos-field"><span>{label}{hint && <small>{hint}</small>}</span>{children}</label>;
}

function Counter({ label, ageRange, value, setValue }: { label: string; ageRange: string; value: number; setValue: (value: number) => void }) {
  return <div><span><Users size={14} /><span><b>{label}</b><small>{ageRange}</small></span></span><div><button type="button" aria-label={`ลดจำนวน${label}`} onClick={() => setValue(Math.max(0, value - 1))}><Minus size={14} /></button><strong>{value}</strong><button type="button" className="add" aria-label={`เพิ่มจำนวน${label}`} onClick={() => setValue(Math.min(MAX_PEOPLE_PER_GROUP, value + 1))}><Plus size={14} /></button></div></div>;
}
