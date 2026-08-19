'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  CalendarDays,
  Camera,
  Car,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleEllipsis,
  ClipboardCheck,
  FileText,
  Home,
  House,
  IdCard,
  LoaderCircle,
  MapPin,
  Package,
  Phone,
  RotateCcw,
  Search,
  ShieldCheck,
  Sprout,
  TentTree,
  Upload,
  UserRound,
  XCircle,
} from 'lucide-react';
import { PROJECT_NAME } from '@/lib/brand';
import { supabase } from '@/lib/supabase';
import styles from './page.module.css';

type Step = 'lookup' | 'select' | 'confirm' | 'create' | 'done';
type DamageStatus = 'pending' | 'verified' | 'approved' | 'rejected';

interface DamageReport {
  id: string;
  full_name: string;
  phone: string;
  province: string;
  district: string;
  sub_district: string;
  address_details?: string | null;
  damage_type?: string | null;
  damage_value?: number | null;
  description?: string | null;
  image_urls: string[];
  home_status?: string | null;
  status: DamageStatus;
  incident_date?: string | null;
  id_card_number?: string | null;
  id_card_image_url?: string | null;
  victim_confirmed: boolean;
  victim_confirmed_at?: string | null;
  created_at: string;
}

interface UploadResult {
  path: string;
  publicUrl: string;
}

interface IdentityFieldsProps {
  idCardNumber: string;
  setIdCardNumber: (value: string) => void;
  idCardExistingUrl?: string | null;
  idCardFile: File | null;
  setIdCardFile: (file: File | null) => void;
  incidentDate: string;
  setIncidentDate: (value: string) => void;
  damageType: string;
  setDamageType: (value: string) => void;
  damageValue: string;
  setDamageValue: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  damagePhotos: File[];
  setDamagePhotos: (files: File[]) => void;
  existingPhotoCount: number;
  homeStatus: string;
  setHomeStatus: (value: string) => void;
  onFileError: (message: string) => void;
}

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_DAMAGE_PHOTOS = 6;

const DAMAGE_OPTIONS = [
  { value: 'housing', label: 'ที่อยู่อาศัย', description: 'บ้าน อาคาร หรือส่วนประกอบ', icon: House },
  { value: 'vehicle', label: 'ยานพาหนะ', description: 'รถยนต์ รถจักรยานยนต์', icon: Car },
  { value: 'agriculture', label: 'เกษตรกรรม', description: 'พืชผล ปศุสัตว์ หรือพื้นที่', icon: Sprout },
  { value: 'property', label: 'ทรัพย์สินอื่น', description: 'เครื่องใช้และทรัพย์สิน', icon: Package },
  { value: 'other', label: 'อื่น ๆ', description: 'ความเสียหายประเภทอื่น', icon: CircleEllipsis },
] as const;

const HOME_STATUS_OPTIONS = [
  { value: 'returned', label: 'กลับเข้าบ้านได้แล้ว', description: 'บ้านปลอดภัยและสามารถพักอาศัยได้', icon: Home },
  { value: 'temporary_shelter', label: 'ยังอยู่ที่พักชั่วคราว', description: 'ยังพักอยู่ที่ศูนย์หรือที่พักชั่วคราว', icon: TentTree },
  { value: 'cannot_return', label: 'กลับเข้าบ้านไม่ได้', description: 'บ้านไม่ปลอดภัยหรือเสียหายรุนแรง', icon: XCircle },
] as const;

const STATUS_META: Record<DamageStatus, { text: string; description: string; className: string }> = {
  pending: { text: 'รอตรวจสอบ', description: 'เจ้าหน้าที่กำลังตรวจสอบเอกสาร', className: styles.statusPending },
  verified: { text: 'ตรวจสอบแล้ว', description: 'ข้อมูลผ่านการตรวจสอบเบื้องต้น', className: styles.statusVerified },
  approved: { text: 'อนุมัติเยียวยาแล้ว', description: 'คำขอของคุณได้รับการอนุมัติ', className: styles.statusApproved },
  rejected: { text: 'ไม่อนุมัติ', description: 'กรุณาติดต่อเจ้าหน้าที่เพื่อสอบถาม', className: styles.statusRejected },
};

export default function VictimCompensationPage() {
  const router = useRouter();
  const errorRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<Step>('lookup');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [noMatchFound, setNoMatchFound] = useState(false);
  const [reports, setReports] = useState<DamageReport[]>([]);
  const [selected, setSelected] = useState<DamageReport | null>(null);

  const [newFullName, setNewFullName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newProvince, setNewProvince] = useState('');
  const [newDistrict, setNewDistrict] = useState('');
  const [newSubDistrict, setNewSubDistrict] = useState('');
  const [newAddressDetails, setNewAddressDetails] = useState('');

  const [idCardNumber, setIdCardNumber] = useState('');
  const [incidentDate, setIncidentDate] = useState('');
  const [damageType, setDamageType] = useState('');
  const [damageValue, setDamageValue] = useState('');
  const [description, setDescription] = useState('');
  const [homeStatus, setHomeStatus] = useState('');
  const [idCardFile, setIdCardFile] = useState<File | null>(null);
  const [damagePhotos, setDamagePhotos] = useState<File[]>([]);

  useEffect(() => {
    if (!error) return;
    errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error]);

  const clearSharedForm = () => {
    setIdCardNumber('');
    setIncidentDate('');
    setDamageType('');
    setDamageValue('');
    setDescription('');
    setHomeStatus('');
    setIdCardFile(null);
    setDamagePhotos([]);
  };

  const resetAll = () => {
    setStep('lookup');
    setFullName('');
    setPhone('');
    setReports([]);
    setSelected(null);
    setNoMatchFound(false);
    setError('');
    setNewFullName('');
    setNewPhone('');
    setNewProvince('');
    setNewDistrict('');
    setNewSubDistrict('');
    setNewAddressDetails('');
    clearSharedForm();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const changeStep = (nextStep: Step) => {
    setError('');
    setStep(nextStep);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goToCreate = () => {
    setNewFullName(fullName.trim());
    setNewPhone(normalizePhone(phone));
    clearSharedForm();
    changeStep('create');
  };

  const handleLookup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNoMatchFound(false);

    const name = fullName.trim().replace(/\s+/g, ' ');
    const normalizedPhone = normalizePhone(phone);
    if (!name) {
      setError('กรุณากรอกชื่อ–นามสกุล');
      return;
    }
    if (!isValidPhone(normalizedPhone)) {
      setError('กรุณากรอกเบอร์โทรให้ถูกต้อง 9–10 หลัก');
      return;
    }

    setLoading(true);
    try {
      const { data, error: queryError } = await supabase
        .from('damage_reports')
        .select('*')
        .eq('phone', normalizedPhone)
        .ilike('full_name', name)
        .order('created_at', { ascending: false });
      if (queryError) throw queryError;

      const matches = (data as DamageReport[] | null) ?? [];
      if (matches.length === 0) {
        setNoMatchFound(true);
        setError('ไม่พบคำร้องที่ตรงกับชื่อและเบอร์โทรนี้ คุณสามารถตรวจสอบข้อมูลอีกครั้งหรือแจ้งความเสียหายใหม่ได้');
        return;
      }

      setFullName(name);
      setPhone(normalizedPhone);
      setReports(matches);
      if (matches.length === 1) openReport(matches[0]);
      else changeStep('select');
    } catch (lookupError) {
      setError(getErrorMessage(lookupError, 'ค้นหาข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setLoading(false);
    }
  };

  const openReport = (report: DamageReport) => {
    setSelected(report);
    if (report.victim_confirmed) {
      changeStep('done');
      return;
    }

    setIdCardNumber(report.id_card_number ?? '');
    setIncidentDate(toDateInput(report.incident_date));
    setDamageType(report.damage_type ?? '');
    setDamageValue(report.damage_value != null ? String(report.damage_value) : '');
    setDescription(report.description ?? '');
    setHomeStatus(report.home_status ?? '');
    setIdCardFile(null);
    setDamagePhotos([]);
    changeStep('confirm');
  };

  const uploadFile = async (file: File, prefix: 'idcard' | 'damage'): Promise<UploadResult> => {
    validateImageFile(file);
    const extension = getSafeExtension(file);
    const path = `${prefix}/${Date.now()}-${createRandomId()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from('damage-photos').upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from('damage-photos').getPublicUrl(path);
    return { path, publicUrl: data.publicUrl };
  };

  const validateIdentityFields = (hasExistingIdCard: boolean) => {
    if (!/^\d{13}$/.test(idCardNumber.trim())) {
      setError('เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก');
      return false;
    }
    if (!hasExistingIdCard && !idCardFile) {
      setError('กรุณาถ่ายหรือเลือกรูปบัตรประชาชนเพื่อยืนยันตัวตน');
      return false;
    }
    if (!incidentDate) {
      setError('กรุณาระบุวันที่เกิดความเสียหาย');
      return false;
    }
    if (new Date(`${incidentDate}T00:00:00`).getTime() > Date.now()) {
      setError('วันที่เกิดความเสียหายต้องไม่เกินวันที่ปัจจุบัน');
      return false;
    }
    if (!damageType) {
      setError('กรุณาเลือกประเภทความเสียหาย');
      return false;
    }
    if (damageValue && (!Number.isFinite(Number(damageValue)) || Number(damageValue) < 0)) {
      setError('มูลค่าความเสียหายต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
      return false;
    }
    if (!homeStatus) {
      setError('กรุณาระบุสถานะที่พักอาศัยปัจจุบัน');
      return false;
    }
    try {
      if (idCardFile) validateImageFile(idCardFile);
      damagePhotos.forEach(validateImageFile);
    } catch (fileError) {
      setError(getErrorMessage(fileError, 'ไฟล์รูปภาพไม่ถูกต้อง'));
      return false;
    }
    return true;
  };

  const handleConfirm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || saving) return;
    setError('');
    if (!validateIdentityFields(Boolean(selected.id_card_image_url))) return;

    setSaving(true);
    const uploadedPaths: string[] = [];
    try {
      let idCardImageUrl = selected.id_card_image_url ?? null;
      if (idCardFile) {
        const uploaded = await uploadFile(idCardFile, 'idcard');
        uploadedPaths.push(uploaded.path);
        idCardImageUrl = uploaded.publicUrl;
      }

      const photoUploads = await Promise.all(damagePhotos.map(file => uploadFile(file, 'damage')));
      uploadedPaths.push(...photoUploads.map(item => item.path));
      const imageUrls = [...(selected.image_urls ?? []), ...photoUploads.map(item => item.publicUrl)];
      const confirmedAt = new Date().toISOString();

      const update = {
        id_card_number: idCardNumber.trim(),
        id_card_image_url: idCardImageUrl,
        incident_date: incidentDate,
        damage_type: damageType,
        damage_value: damageValue ? Number(damageValue) : null,
        description: description.trim() || null,
        home_status: homeStatus,
        image_urls: imageUrls,
        victim_confirmed: true,
        victim_confirmed_at: confirmedAt,
      };

      const { data, error: updateError } = await supabase
        .from('damage_reports')
        .update(update)
        .eq('id', selected.id)
        .eq('victim_confirmed', false)
        .select('*')
        .maybeSingle();
      if (updateError) throw updateError;
      if (!data) throw new Error('คำร้องนี้ถูกยืนยันไปแล้ว กรุณาค้นหาใหม่เพื่อตรวจสอบสถานะ');

      setSelected(data as DamageReport);
      changeStep('done');
    } catch (submitError) {
      if (uploadedPaths.length > 0) await supabase.storage.from('damage-photos').remove(uploadedPaths);
      setError(getErrorMessage(submitError, 'บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่'));
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setError('');

    const applicantName = newFullName.trim().replace(/\s+/g, ' ');
    const applicantPhone = normalizePhone(newPhone);
    if (!applicantName) {
      setError('กรุณากรอกชื่อ–นามสกุล');
      return;
    }
    if (!isValidPhone(applicantPhone)) {
      setError('กรุณากรอกเบอร์โทรให้ถูกต้อง 9–10 หลัก');
      return;
    }
    if (!newProvince.trim() || !newDistrict.trim() || !newSubDistrict.trim()) {
      setError('กรุณากรอกจังหวัด อำเภอ และตำบลให้ครบ');
      return;
    }
    if (!validateIdentityFields(false)) return;

    setSaving(true);
    const uploadedPaths: string[] = [];
    try {
      const idUpload = await uploadFile(idCardFile as File, 'idcard');
      uploadedPaths.push(idUpload.path);
      const photoUploads = await Promise.all(damagePhotos.map(file => uploadFile(file, 'damage')));
      uploadedPaths.push(...photoUploads.map(item => item.path));

      const { data, error: insertError } = await supabase
        .from('damage_reports')
        .insert({
          full_name: applicantName,
          phone: applicantPhone,
          province: newProvince.trim(),
          district: newDistrict.trim(),
          sub_district: newSubDistrict.trim(),
          address_details: newAddressDetails.trim() || null,
          id_card_number: idCardNumber.trim(),
          id_card_image_url: idUpload.publicUrl,
          incident_date: incidentDate,
          damage_type: damageType,
          damage_value: damageValue ? Number(damageValue) : null,
          description: description.trim() || null,
          home_status: homeStatus,
          image_urls: photoUploads.map(item => item.publicUrl),
          victim_confirmed: true,
          victim_confirmed_at: new Date().toISOString(),
          status: 'pending',
        })
        .select('*')
        .single();
      if (insertError) throw insertError;

      setFullName(applicantName);
      setPhone(applicantPhone);
      setSelected(data as DamageReport);
      changeStep('done');
    } catch (submitError) {
      if (uploadedPaths.length > 0) await supabase.storage.from('damage-photos').remove(uploadedPaths);
      setError(getErrorMessage(submitError, 'ส่งคำร้องไม่สำเร็จ กรุณาลองใหม่'));
    } finally {
      setSaving(false);
    }
  };

  const activeProgress = step === 'done' ? 3 : step === 'confirm' || step === 'create' ? 2 : 1;
  const pageTitle = step === 'lookup' ? 'ยื่นขอรับการเยียวยา' : step === 'select' ? 'เลือกคำร้องของคุณ' : step === 'confirm' ? 'ตรวจสอบและยืนยันข้อมูล' : step === 'create' ? 'แจ้งความเสียหายใหม่' : 'ส่งข้อมูลเรียบร้อย';
  const pageDescription = step === 'lookup'
    ? 'ค้นหาคำร้องเดิมด้วยชื่อและเบอร์โทร หรือเริ่มแจ้งความเสียหายใหม่'
    : step === 'select'
      ? 'พบคำร้องมากกว่าหนึ่งรายการ กรุณาเลือกรายการที่ต้องการดำเนินการ'
      : step === 'confirm'
        ? 'เติมข้อมูลที่จำเป็นและยืนยันว่าเป็นคำร้องของคุณ'
        : step === 'create'
          ? 'กรอกข้อมูลผู้ยื่น ที่อยู่ และรายละเอียดความเสียหายให้ครบ'
          : 'เจ้าหน้าที่จะตรวจสอบข้อมูลและติดต่อกลับตามเบอร์โทรที่แจ้งไว้';

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <button onClick={() => router.push('/')} aria-label="กลับหน้าหลัก"><ArrowLeft size={21} /></button>
        <div><ShieldCheck size={20} /><span>{PROJECT_NAME}</span></div>
        <span className={styles.secureBadge}>ข้อมูลปลอดภัย</span>
      </header>

      <div className={styles.backdropShape} aria-hidden="true" />
      <div className={styles.layout}>
        <aside className={styles.guidePanel}>
          <span className={styles.guideIcon}><Banknote size={26} /></span>
          <p>COMPENSATION SUPPORT</p>
          <h2>ยื่นข้อมูลได้ง่าย<br />จบในโทรศัพท์เครื่องเดียว</h2>
          <p className={styles.guideDescription}>ระบบจะช่วยตรวจสอบคำร้องเดิมก่อน เพื่อลดการกรอกข้อมูลซ้ำและช่วยให้เจ้าหน้าที่ดำเนินการได้เร็วขึ้น</p>
          <ul>
            <li><Check size={16} /><span><strong>เตรียมบัตรประชาชน</strong><small>ถ่ายรูปให้เห็นข้อมูลชัดเจน</small></span></li>
            <li><Check size={16} /><span><strong>เตรียมรูปความเสียหาย</strong><small>แนบได้สูงสุด {MAX_DAMAGE_PHOTOS} รูป</small></span></li>
            <li><Check size={16} /><span><strong>ใช้เบอร์โทรที่ติดต่อได้</strong><small>เจ้าหน้าที่จะใช้สำหรับติดต่อกลับ</small></span></li>
          </ul>
          <div className={styles.privacyNote}><ShieldCheck size={17} /><span>ข้อมูลใช้เพื่อพิจารณาคำขอเยียวยาเท่านั้น</span></div>
        </aside>

        <section className={styles.formCard}>
          <div className={styles.mobileBrand}><span><Banknote size={21} /></span><div><small>บริการประชาชน</small><strong>ระบบยื่นเยียวยา</strong></div></div>

          <ProgressSteps active={activeProgress} />

          <div className={styles.heading}>
            <span>{step === 'done' ? <CheckCircle2 size={22} /> : <ClipboardCheck size={22} />}</span>
            <div><h1>{pageTitle}</h1><p>{pageDescription}</p></div>
          </div>

          {error && <div ref={errorRef} className={styles.errorBox} role="alert"><AlertCircle size={19} /><span>{error}</span></div>}

          {step === 'lookup' && (
            <div className={styles.flowContent}>
              <form className={styles.form} onSubmit={handleLookup}>
                <Field label="ชื่อ–นามสกุล" required icon={<UserRound size={18} />}>
                  <input autoFocus value={fullName} onChange={event => setFullName(event.target.value)} placeholder="เช่น สมชาย ใจดี" autoComplete="name" maxLength={120} />
                </Field>
                <Field label="เบอร์โทรที่ใช้แจ้งข้อมูล" required icon={<Phone size={18} />} hint="กรอกเฉพาะตัวเลข 9–10 หลัก">
                  <input value={phone} onChange={event => setPhone(formatPhoneInput(event.target.value))} placeholder="08x xxx xxxx" inputMode="tel" autoComplete="tel" maxLength={12} />
                </Field>
                <button className={styles.primaryButton} type="submit" disabled={loading}>{loading ? <><LoaderCircle className={styles.spinning} size={19} />กำลังค้นหา</> : <><Search size={19} />ค้นหาคำร้องของฉัน</>}</button>
              </form>

              <div className={styles.divider}><span>หรือ</span></div>
              <button className={`${styles.secondaryButton} ${noMatchFound ? styles.secondaryEmphasis : ''}`} type="button" onClick={goToCreate}><FileText size={19} /><span><strong>แจ้งความเสียหายใหม่</strong><small>สำหรับผู้ที่ยังไม่เคยแจ้งข้อมูล</small></span><ChevronRight size={18} /></button>
            </div>
          )}

          {step === 'select' && (
            <div className={styles.flowContent}>
              <div className={styles.resultSummary}><Search size={18} /><span>พบ <strong>{reports.length} คำร้อง</strong> ที่ตรงกับข้อมูลของคุณ</span></div>
              <div className={styles.reportList}>
                {reports.map(report => <ReportButton key={report.id} report={report} onClick={() => openReport(report)} />)}
              </div>
              <button className={styles.secondaryButton} type="button" onClick={goToCreate}><FileText size={19} /><span><strong>ไม่ใช่คำร้องของฉัน</strong><small>เริ่มแจ้งความเสียหายใหม่</small></span><ChevronRight size={18} /></button>
              <button className={styles.textButton} type="button" onClick={() => changeStep('lookup')}><ArrowLeft size={17} />กลับไปค้นหาใหม่</button>
            </div>
          )}

          {step === 'confirm' && selected && (
            <form className={styles.longForm} onSubmit={handleConfirm}>
              <div className={styles.caseSummary}>
                <span><FileText size={19} /></span>
                <div><small>คำร้องที่เลือก</small><strong>{getDamageLabel(selected.damage_type)}</strong><p>{formatThaiDate(selected.created_at)} · {selected.province || 'ไม่ระบุจังหวัด'}</p></div>
                <StatusBadge status={selected.status} />
              </div>
              <div className={styles.infoBox}><ShieldCheck size={19} /><span><strong>ยืนยันข้อมูลให้ครบก่อนส่ง</strong><small>ตรวจสอบเลขบัตร วันที่ และรายละเอียดความเสียหายให้ถูกต้อง</small></span></div>
              <IdentityFields idCardNumber={idCardNumber} setIdCardNumber={setIdCardNumber} idCardExistingUrl={selected.id_card_image_url} idCardFile={idCardFile} setIdCardFile={setIdCardFile} incidentDate={incidentDate} setIncidentDate={setIncidentDate} damageType={damageType} setDamageType={setDamageType} damageValue={damageValue} setDamageValue={setDamageValue} description={description} setDescription={setDescription} damagePhotos={damagePhotos} setDamagePhotos={setDamagePhotos} existingPhotoCount={selected.image_urls?.length ?? 0} homeStatus={homeStatus} setHomeStatus={setHomeStatus} onFileError={setError} />
              <StickyActions saving={saving} submitLabel="ยืนยันและส่งข้อมูล" onBack={() => changeStep(reports.length > 1 ? 'select' : 'lookup')} />
            </form>
          )}

          {step === 'create' && (
            <form className={styles.longForm} onSubmit={handleCreate}>
              <FormSection icon={<UserRound size={19} />} title="ข้อมูลผู้ยื่นคำร้อง" description="ใช้สำหรับตรวจสอบและติดต่อกลับ">
                <Field label="ชื่อ–นามสกุล" required><input value={newFullName} onChange={event => setNewFullName(event.target.value)} autoComplete="name" placeholder="ชื่อและนามสกุลตามบัตรประชาชน" maxLength={120} /></Field>
                <Field label="เบอร์โทรศัพท์" required hint="เจ้าหน้าที่จะติดต่อกลับผ่านเบอร์นี้"><input value={newPhone} onChange={event => setNewPhone(formatPhoneInput(event.target.value))} inputMode="tel" autoComplete="tel" placeholder="08x xxx xxxx" maxLength={12} /></Field>
              </FormSection>

              <FormSection icon={<MapPin size={19} />} title="ที่อยู่ที่ได้รับความเสียหาย" description="ระบุพื้นที่ให้เจ้าหน้าที่ตรวจสอบได้ถูกต้อง">
                <div className={styles.addressGrid}>
                  <Field label="จังหวัด" required><input value={newProvince} onChange={event => setNewProvince(event.target.value)} placeholder="เช่น สงขลา" maxLength={80} /></Field>
                  <Field label="อำเภอ/เขต" required><input value={newDistrict} onChange={event => setNewDistrict(event.target.value)} placeholder="เช่น หาดใหญ่" maxLength={80} /></Field>
                  <Field label="ตำบล/แขวง" required><input value={newSubDistrict} onChange={event => setNewSubDistrict(event.target.value)} placeholder="เช่น คอหงส์" maxLength={80} /></Field>
                </div>
                <Field label="บ้านเลขที่ ถนน หรือจุดสังเกต" hint="ไม่บังคับ"><textarea rows={2} value={newAddressDetails} onChange={event => setNewAddressDetails(event.target.value)} placeholder="รายละเอียดเพิ่มเติมเพื่อช่วยให้ค้นหาสถานที่ได้ง่าย" maxLength={500} /></Field>
              </FormSection>

              <IdentityFields idCardNumber={idCardNumber} setIdCardNumber={setIdCardNumber} idCardExistingUrl={null} idCardFile={idCardFile} setIdCardFile={setIdCardFile} incidentDate={incidentDate} setIncidentDate={setIncidentDate} damageType={damageType} setDamageType={setDamageType} damageValue={damageValue} setDamageValue={setDamageValue} description={description} setDescription={setDescription} damagePhotos={damagePhotos} setDamagePhotos={setDamagePhotos} existingPhotoCount={0} homeStatus={homeStatus} setHomeStatus={setHomeStatus} onFileError={setError} />
              <StickyActions saving={saving} submitLabel="ส่งคำร้องเยียวยา" onBack={() => changeStep('lookup')} />
            </form>
          )}

          {step === 'done' && selected && (
            <div className={styles.doneContent}>
              <span className={styles.successIcon}><CheckCircle2 size={38} /></span>
              <h2>{selected.victim_confirmed ? 'ข้อมูลของคุณถูกส่งแล้ว' : 'พบคำร้องของคุณ'}</h2>
              <p>เก็บเบอร์โทรที่ใช้ยื่นคำร้องไว้สำหรับค้นหาและติดตามสถานะในครั้งถัดไป</p>

              <div className={styles.statusCard}>
                <div><small>สถานะปัจจุบัน</small><StatusBadge status={selected.status} /></div>
                <strong>{STATUS_META[selected.status].description}</strong>
                <div className={styles.statusTrack}><i className={selected.status === 'pending' ? styles.trackOne : selected.status === 'verified' ? styles.trackTwo : styles.trackThree} /></div>
                <div className={styles.statusSteps}><span>ส่งข้อมูล</span><span>ตรวจสอบ</span><span>ผลพิจารณา</span></div>
              </div>

              <dl className={styles.confirmationDetails}>
                <div><dt>ผู้ยื่นคำร้อง</dt><dd>{selected.full_name}</dd></div>
                <div><dt>ประเภทความเสียหาย</dt><dd>{getDamageLabel(selected.damage_type)}</dd></div>
                <div><dt>วันที่แจ้ง</dt><dd>{formatThaiDate(selected.created_at)}</dd></div>
                <div><dt>พื้นที่</dt><dd>{[selected.sub_district, selected.district, selected.province].filter(Boolean).join(' · ') || 'ไม่ระบุ'}</dd></div>
              </dl>

              <div className={styles.doneActions}><button className={styles.primaryButton} onClick={() => router.push('/')}><Home size={19} />กลับหน้าหลัก</button><button className={styles.textButton} onClick={resetAll}><RotateCcw size={17} />ค้นหาคำร้องอื่น</button></div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ProgressSteps({ active }: { active: number }) {
  const steps = ['ค้นหาข้อมูล', 'กรอกและยืนยัน', 'ส่งคำร้อง'];
  return <div className={styles.progress} aria-label={`ขั้นตอนที่ ${active} จาก 3`}>{steps.map((label, index) => { const number = index + 1; return <React.Fragment key={label}><div className={`${styles.progressStep} ${number <= active ? styles.progressActive : ''} ${number < active ? styles.progressComplete : ''}`}><span>{number < active ? <Check size={14} /> : number}</span><small>{label}</small></div>{number < 3 && <i className={number < active ? styles.progressLineActive : ''} />}</React.Fragment>; })}</div>;
}

function Field({ label, required = false, hint, icon, children }: { label: string; required?: boolean; hint?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return <label className={styles.field}><span className={styles.fieldLabel}>{icon}{label}{required && <b>*</b>}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function FormSection({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return <section className={styles.formSection}><div className={styles.sectionHeading}><span>{icon}</span><div><h2>{title}</h2><p>{description}</p></div></div><div className={styles.sectionBody}>{children}</div></section>;
}

function ReportButton({ report, onClick }: { report: DamageReport; onClick: () => void }) {
  const DamageIcon = DAMAGE_OPTIONS.find(option => option.value === report.damage_type)?.icon ?? FileText;
  return <button className={styles.reportButton} type="button" onClick={onClick}><span className={styles.reportIcon}><DamageIcon size={21} /></span><div><strong>{getDamageLabel(report.damage_type)}</strong><small>{formatThaiDate(report.created_at)} · {report.province || 'ไม่ระบุพื้นที่'}</small>{report.victim_confirmed && <em><CheckCircle2 size={13} />ยืนยันตัวตนแล้ว</em>}</div><StatusBadge status={report.status} /><ChevronRight size={18} /></button>;
}

function StatusBadge({ status }: { status: DamageStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.pending;
  return <span className={`${styles.statusBadge} ${meta.className}`}>{meta.text}</span>;
}

function IdentityFields(props: IdentityFieldsProps) {
  const handleIdCardFile = (file: File | null) => {
    if (!file) { props.setIdCardFile(null); return; }
    try { validateImageFile(file); props.setIdCardFile(file); }
    catch (error) { props.onFileError(getErrorMessage(error, 'รูปบัตรประชาชนไม่ถูกต้อง')); }
  };

  const handleDamageFiles = (files: File[]) => {
    try {
      if (files.length > MAX_DAMAGE_PHOTOS) throw new Error(`แนบรูปความเสียหายได้สูงสุด ${MAX_DAMAGE_PHOTOS} รูป`);
      files.forEach(validateImageFile);
      props.setDamagePhotos(files);
    } catch (error) {
      props.onFileError(getErrorMessage(error, 'รูปความเสียหายไม่ถูกต้อง'));
    }
  };

  return (
    <>
      <FormSection icon={<IdCard size={19} />} title="ยืนยันตัวตน" description="ข้อมูลต้องตรงกับบัตรประชาชนของผู้ยื่นคำร้อง">
        <Field label="เลขบัตรประชาชน" required hint="ตัวเลข 13 หลัก ไม่มีขีดหรือเว้นวรรค"><input value={props.idCardNumber} onChange={event => props.setIdCardNumber(event.target.value.replace(/\D/g, '').slice(0, 13))} inputMode="numeric" autoComplete="off" placeholder="x xxxx xxxxx xx x" maxLength={13} className={styles.idInput} /></Field>
        <FilePicker id="id-card-file" icon={<IdCard size={22} />} title={props.idCardExistingUrl ? 'เปลี่ยนรูปบัตรประชาชน' : 'ถ่ายรูปบัตรประชาชน'} description={props.idCardExistingUrl ? 'มีรูปเดิมแล้ว เลือกใหม่เมื่อต้องการเปลี่ยน' : 'วางบัตรบนพื้นเรียบและถ่ายให้เห็นข้อมูลชัดเจน'} fileLabel={props.idCardFile?.name} accept="image/*" capture="environment" onChange={files => handleIdCardFile(files[0] ?? null)} />
      </FormSection>

      <FormSection icon={<CalendarDays size={19} />} title="รายละเอียดความเสียหาย" description="ช่วยให้เจ้าหน้าที่ประเมินและจัดลำดับการตรวจสอบ">
        <Field label="วันที่เกิดความเสียหาย" required><input type="date" value={props.incidentDate} max={toDateInput(new Date().toISOString())} onChange={event => props.setIncidentDate(event.target.value)} /></Field>
        <div className={styles.optionField}><span>ประเภทความเสียหาย <b>*</b></span><div className={styles.damageGrid}>{DAMAGE_OPTIONS.map(option => { const Icon = option.icon; const active = props.damageType === option.value; return <button key={option.value} type="button" className={active ? styles.optionSelected : ''} onClick={() => props.setDamageType(option.value)}><span><Icon size={20} /></span><strong>{option.label}</strong><small>{option.description}</small>{active && <Check size={14} />}</button>; })}</div></div>
        <Field label="มูลค่าความเสียหายโดยประมาณ" hint="ไม่บังคับ สามารถใส่เป็นตัวเลขคร่าว ๆ ได้"><div className={styles.moneyInput}><input type="number" min={0} step={1} value={props.damageValue} onChange={event => props.setDamageValue(event.target.value)} inputMode="decimal" placeholder="0" /><span>บาท</span></div></Field>
        <Field label="อธิบายความเสียหาย" hint="ระบุส่วนที่เสียหายและผลกระทบที่เกิดขึ้น"><textarea rows={4} value={props.description} onChange={event => props.setDescription(event.target.value)} placeholder="เช่น น้ำท่วมชั้นล่าง เครื่องใช้ไฟฟ้าและผนังบ้านเสียหาย" maxLength={1000} /></Field>
        <FilePicker id="damage-files" icon={<Camera size={22} />} title="แนบรูปความเสียหาย" description={`เลือกได้สูงสุด ${MAX_DAMAGE_PHOTOS} รูป รูปละไม่เกิน 8 MB`} fileLabel={props.damagePhotos.length > 0 ? `เลือกแล้ว ${props.damagePhotos.length} รูป` : props.existingPhotoCount > 0 ? `มีรูปเดิม ${props.existingPhotoCount} รูป` : undefined} accept="image/*" capture="environment" multiple onChange={handleDamageFiles} />
      </FormSection>

      <FormSection icon={<Home size={19} />} title="สถานะที่พักอาศัย" description="ตอนนี้คุณสามารถกลับเข้าพักที่บ้านได้หรือไม่">
        <div className={styles.homeOptions}>{HOME_STATUS_OPTIONS.map(option => { const Icon = option.icon; const active = props.homeStatus === option.value; return <button key={option.value} type="button" className={active ? styles.optionSelected : ''} onClick={() => props.setHomeStatus(option.value)}><span><Icon size={20} /></span><div><strong>{option.label}</strong><small>{option.description}</small></div>{active && <Check size={15} />}</button>; })}</div>
      </FormSection>
    </>
  );
}

function FilePicker({ id, icon, title, description, fileLabel, accept, capture, multiple = false, onChange }: { id: string; icon: React.ReactNode; title: string; description: string; fileLabel?: string; accept: string; capture: 'environment'; multiple?: boolean; onChange: (files: File[]) => void }) {
  return <label className={styles.filePicker} htmlFor={id}><input id={id} type="file" accept={accept} capture={capture} multiple={multiple} onChange={event => onChange(Array.from(event.target.files ?? []))} /><span>{icon}</span><div><strong>{fileLabel || title}</strong><small>{fileLabel ? 'แตะเพื่อเลือกไฟล์ใหม่' : description}</small></div><Upload size={18} /></label>;
}

function StickyActions({ saving, submitLabel, onBack }: { saving: boolean; submitLabel: string; onBack: () => void }) {
  return <div className={styles.stickyActions}><button type="button" onClick={onBack} disabled={saving}><ArrowLeft size={18} />ย้อนกลับ</button><button className={styles.primaryButton} type="submit" disabled={saving}>{saving ? <><LoaderCircle className={styles.spinning} size={19} />กำลังส่งข้อมูล</> : <><ShieldCheck size={19} />{submitLabel}</>}</button></div>;
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, '').slice(0, 10);
}

function formatPhoneInput(value: string) {
  const digits = normalizePhone(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

function isValidPhone(value: string) {
  return /^\d{9,10}$/.test(value);
}

function validateImageFile(file: File) {
  if (!file.type.startsWith('image/')) throw new Error(`ไฟล์ ${file.name} ไม่ใช่รูปภาพ`);
  if (file.size > MAX_FILE_SIZE) throw new Error(`ไฟล์ ${file.name} มีขนาดเกิน 8 MB`);
}

function getSafeExtension(file: File) {
  const mimeExtension = file.type.split('/')[1]?.toLowerCase().replace('jpeg', 'jpg');
  return mimeExtension?.replace(/[^a-z0-9]/g, '') || 'jpg';
}

function createRandomId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2, 12);
}

function toDateInput(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatThaiDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'ไม่ระบุวันที่' : date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getDamageLabel(value?: string | null) {
  return DAMAGE_OPTIONS.find(option => option.value === value)?.label ?? 'ยังไม่ระบุประเภทความเสียหาย';
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
