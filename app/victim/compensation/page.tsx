'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Building2, Camera, Check, CheckCircle2, ChevronRight,
  FileText, Home, IdCard, ImagePlus, LoaderCircle, Pencil, RotateCcw,
  Search, ShieldCheck, Sprout, Trash2, Upload, UserRound, WalletCards,
} from 'lucide-react';
import { PROJECT_NAME } from '@/lib/brand';
import { getSavedPhone, getSosReportId, saveSosSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import styles from './page.module.css';

type ClaimCategory = 'housing_property' | 'agriculture_livelihood';
type ClaimStatus = 'pending' | 'verified' | 'approved' | 'rejected';
type Screen = 'home' | 'lookup' | 'wizard' | 'detail' | 'done';
type WizardStep = 1 | 2 | 3 | 4;

interface DamageReport {
  id: string;
  sos_report_id?: string | null;
  full_name: string;
  phone: string;
  province: string;
  district: string;
  sub_district: string;
  address_details?: string | null;
  claim_category?: ClaimCategory | null;
  housing_tenure?: string | null;
  farmer_registered_before_disaster?: boolean | null;
  farmer_registration_number?: string | null;
  agriculture_damage_types?: string[] | null;
  crop_area_rai?: number | null;
  fishery_area_rai?: number | null;
  livestock_count?: number | null;
  damage_value?: number | null;
  description?: string | null;
  image_urls: string[];
  home_status?: string | null;
  status: ClaimStatus;
  incident_date?: string | null;
  id_card_number?: string | null;
  id_card_image_url?: string | null;
  bank_book_image_url?: string | null;
  created_at: string;
  updated_at?: string | null;
}

interface SosLookupResult {
  id: string;
  full_name: string;
  phone: string;
  province: string;
  district: string;
  sub_district: string | null;
  address_details: string | null;
  status: 'pending' | 'assigned' | 'rescued' | 'cannot_reach' | 'closed';
}

interface Draft {
  category: ClaimCategory;
  fullName: string;
  phone: string;
  province: string;
  district: string;
  subDistrict: string;
  addressDetails: string;
  idCardNumber: string;
  incidentDate: string;
  housingTenure: '' | 'owner' | 'renter' | 'other_person';
  homeStatus: '' | 'returned' | 'temporary_shelter' | 'cannot_return';
  farmerRegistered: boolean;
  farmerRegistrationNumber: string;
  agricultureDamageTypes: string[];
  cropAreaRai: string;
  fisheryAreaRai: string;
  livestockCount: string;
  damageValue: string;
  description: string;
  existingIdCardUrl: string;
  existingBankBookUrl: string;
  existingImageUrls: string[];
  editingId: string;
}

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_DAMAGE_PHOTOS = 8;
const DRAFT_KEY = 'nexus_compensation_draft_v2';
const FILE_DB = 'nexus-compensation-drafts';
const FILE_STORE = 'draft-files';

const EMPTY_DRAFT: Draft = {
  category: 'housing_property', fullName: '', phone: '', province: '', district: '', subDistrict: '', addressDetails: '',
  idCardNumber: '', incidentDate: '', housingTenure: '', homeStatus: '', farmerRegistered: false,
  farmerRegistrationNumber: '', agricultureDamageTypes: [], cropAreaRai: '', fisheryAreaRai: '', livestockCount: '',
  damageValue: '', description: '', existingIdCardUrl: '', existingBankBookUrl: '', existingImageUrls: [], editingId: '',
};

const CATEGORY_META: Record<ClaimCategory, { title: string; short: string; description: string; icon: React.ReactNode }> = {
  housing_property: { title: 'ที่อยู่อาศัยและสิ่งของเสียหาย', short: 'ชีวิตและทรัพย์สิน', description: 'บ้าน อาคาร เครื่องใช้ และทรัพย์สินที่ได้รับความเสียหาย', icon: <Home size={24} /> },
  agriculture_livelihood: { title: 'เกษตรกรรม ประมง และปศุสัตว์', short: 'ด้านการประกอบอาชีพ', description: 'สำหรับเกษตรกรที่ขึ้นทะเบียนไว้ก่อนเกิดภัยพิบัติเท่านั้น', icon: <Sprout size={24} /> },
};

const STATUS_META: Record<ClaimStatus, { label: string; description: string }> = {
  pending: { label: 'รอตรวจสอบ', description: 'แก้ไขข้อมูลได้ก่อนเจ้าหน้าที่ตรวจสอบ' },
  verified: { label: 'ตรวจสอบแล้ว', description: 'ข้อมูลกำลังเข้าสู่ขั้นตอนพิจารณา' },
  approved: { label: 'อนุมัติแล้ว', description: 'คำร้องได้รับการอนุมัติ' },
  rejected: { label: 'ต้องแก้ไข', description: 'ตรวจสอบและแก้ไขข้อมูลแล้วส่งใหม่ได้' },
};

export default function CompensationPage() {
  const router = useRouter();
  const errorRef = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState<Screen>('home');
  const [step, setStep] = useState<WizardStep>(1);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [claims, setClaims] = useState<DamageReport[]>([]);
  const [selected, setSelected] = useState<DamageReport | null>(null);
  const [lookupName, setLookupName] = useState('');
  const [lookupPhone, setLookupPhone] = useState('');
  const [lookupTerm, setLookupTerm] = useState('');
  const [lookupResults, setLookupResults] = useState<SosLookupResult[]>([]);
  const [eligible, setEligible] = useState(false);
  const [contextLoaded, setContextLoaded] = useState(false);
  const [hasCachedDraft, setHasCachedDraft] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [idCardFile, setIdCardFile] = useState<File | null>(null);
  const [bankBookFile, setBankBookFile] = useState<File | null>(null);
  const [damageFiles, setDamageFiles] = useState<File[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const savedPhone = getSavedPhone() ?? '';
      const savedSosId = getSosReportId();
      const cached = readCachedDraft();
      if (!active) return;
      setLookupPhone(savedPhone);
      setLookupTerm(savedPhone);
      setHasCachedDraft(Boolean(cached));

      let base: Partial<Draft> = { phone: savedPhone };
      let canApply = false;
      if (savedSosId) {
        const [{ data: sos }, { data: destination }] = await Promise.all([
          supabase.from('sos_reports').select('id, full_name, phone, province, district, sub_district, address_details, status').eq('id', savedSosId).maybeSingle(),
          supabase.from('victim_status').select('status, notes').eq('sos_report_id', savedSosId).maybeSingle(),
        ]);
        if (sos) {
          base = {
            fullName: sos.full_name, phone: sos.phone, province: sos.province, district: sos.district,
            subDistrict: sos.sub_district ?? '', addressDetails: sos.address_details ?? '',
          };
          setLookupName(sos.full_name);
          setLookupPhone(sos.phone);
          canApply = (sos.status === 'rescued' || sos.status === 'closed')
            && hasReachedEligibleDestination(destination);
        }
      }
      if (savedPhone) {
        const { data } = await supabase
          .from('damage_reports')
          .select('*')
          .eq('phone', normalizePhone(savedPhone))
          .order('created_at', { ascending: false });
        if (active) setClaims((data as DamageReport[] | null) ?? []);
      }
      if (!active) return;
      setDraft(current => ({ ...current, ...base }));
      setEligible(canApply);
      setContextLoaded(true);
      setLoading(false);
    };
    void load();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (screen !== 'wizard' || !contextLoaded) return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, step }));
    void saveDraftFiles({ idCardFile, bankBookFile, damageFiles });
  }, [bankBookFile, contextLoaded, damageFiles, draft, idCardFile, screen, step]);

  useEffect(() => {
    if (!error) return;
    errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error]);

  const loadClaims = async (phone: string, active = true) => {
    const { data } = await supabase.from('damage_reports').select('*').eq('phone', normalizePhone(phone)).order('created_at', { ascending: false });
    if (active) setClaims((data as DamageReport[] | null) ?? []);
  };

  const startClaim = (category: ClaimCategory) => {
    const existing = claims.find(item => getCategory(item) === category);
    if (existing) { openClaim(existing); return; }
    if (!eligible) {
      setError('สามารถยื่นคำร้องใหม่ได้หลังภารกิจช่วยเหลือเสร็จ และออกจากศูนย์พักพิงหรือถึงจุดปลอดภัยแล้ว');
      return;
    }
    setDraft(current => ({ ...EMPTY_DRAFT, category, fullName: current.fullName || lookupName, phone: current.phone || lookupPhone, province: current.province, district: current.district, subDistrict: current.subDistrict, addressDetails: current.addressDetails }));
    setIdCardFile(null); setBankBookFile(null); setDamageFiles([]); setReviewConfirmed(false); setStep(1); setError(''); setScreen('wizard');
  };

  const openClaim = (claim: DamageReport) => { setSelected(claim); setScreen('detail'); setError(''); window.scrollTo(0, 0); };

  const editClaim = (claim: DamageReport) => {
    if (!['pending', 'rejected'].includes(claim.status)) return;
    setDraft({
      ...EMPTY_DRAFT, category: getCategory(claim), fullName: claim.full_name, phone: claim.phone,
      province: claim.province, district: claim.district, subDistrict: claim.sub_district, addressDetails: claim.address_details ?? '',
      idCardNumber: claim.id_card_number ?? '', incidentDate: toDateInput(claim.incident_date),
      housingTenure: (claim.housing_tenure as Draft['housingTenure']) ?? '', homeStatus: (claim.home_status as Draft['homeStatus']) ?? '',
      farmerRegistered: Boolean(claim.farmer_registered_before_disaster), farmerRegistrationNumber: claim.farmer_registration_number ?? '',
      agricultureDamageTypes: claim.agriculture_damage_types ?? [], cropAreaRai: numberString(claim.crop_area_rai),
      fisheryAreaRai: numberString(claim.fishery_area_rai), livestockCount: numberString(claim.livestock_count),
      damageValue: numberString(claim.damage_value), description: claim.description ?? '', existingIdCardUrl: claim.id_card_image_url ?? '',
      existingBankBookUrl: claim.bank_book_image_url ?? '', existingImageUrls: claim.image_urls ?? [], editingId: claim.id,
    });
    setIdCardFile(null); setBankBookFile(null); setDamageFiles([]); setReviewConfirmed(false); setStep(1); setSelected(null); setScreen('wizard');
  };

  const resumeDraft = async () => {
    const cached = readCachedDraft();
    if (!cached) return;
    const files = await loadDraftFiles();
    setDraft(cached.draft); setStep(cached.step); setReviewConfirmed(false); setError('');
    if (files) { setIdCardFile(files.idCardFile); setBankBookFile(files.bankBookFile); setDamageFiles(files.damageFiles); }
    setScreen('wizard');
  };

  const selectLookupResult = async (sos: SosLookupResult) => {
    setLoading(true); setError('');
    const { data: destination } = await supabase.from('victim_status').select('status, notes').eq('sos_report_id', sos.id).maybeSingle();
    const canApply = (sos.status === 'rescued' || sos.status === 'closed') && hasReachedEligibleDestination(destination);
    saveSosSession(sos.id, sos.phone);
    setLookupName(sos.full_name); setLookupPhone(sos.phone); setLookupTerm(sos.phone); setLookupResults([]);
    setDraft(current => ({ ...current, fullName: sos.full_name, phone: sos.phone, province: sos.province, district: sos.district, subDistrict: sos.sub_district ?? '', addressDetails: sos.address_details ?? '' }));
    await loadClaims(sos.phone);
    setEligible(canApply); setLoading(false); setScreen('home');
  };

  const lookup = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    setLookupResults([]);
    const term = lookupTerm.trim();
    const phone = normalizePhone(term);
    const isPhone = /^\d[\d\s-]*$/.test(term);
    if ((isPhone && !/^0\d{8,9}$/.test(phone)) || (!isPhone && term.length < 2)) {
      setError('กรุณากรอกชื่ออย่างน้อย 2 ตัวอักษร หรือเบอร์โทรศัพท์ให้ถูกต้อง'); return;
    }
    setLoading(true);
    let query = supabase.from('sos_reports').select('id, full_name, phone, province, district, sub_district, address_details, status').order('created_at', { ascending: false }).limit(10);
    query = isPhone
      ? query.eq('phone', phone)
      : query.ilike('full_name', `%${term.replace(/[%_]/g, '')}%`);
    const { data, error: lookupError } = await query;
    if (lookupError) {
      setLoading(false); setError('ค้นหาคำร้องไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'); return;
    }
    const matches = (data as SosLookupResult[] | null) ?? [];
    if (!matches.length) {
      setClaims([]); setEligible(false); setLoading(false);
      setError('ไม่พบคำขอจากชื่อหรือเบอร์โทรนี้ กรุณาตรวจสอบอีกครั้ง');
      return;
    }
    if (matches.length === 1) { await selectLookupResult(matches[0]); return; }
    setLookupResults(matches); setLoading(false);
  };

  const goNext = () => {
    const message = validateStep(draft, step, { idCardFile, bankBookFile, damageFiles });
    if (message) { setError(message); return; }
    setError(''); setStep(current => Math.min(4, current + 1) as WizardStep); window.scrollTo(0, 0);
  };

  const submitClaim = async () => {
    if (!reviewConfirmed) { setError('กรุณายืนยันว่าข้อมูลและเอกสารเป็นความจริงก่อนส่งคำร้อง'); return; }
    const message = validateAll(draft, { idCardFile, bankBookFile, damageFiles });
    if (message) { setError(message); return; }
    setSaving(true); setError('');
    const uploadedPaths: string[] = [];
    try {
      let idCardUrl = draft.existingIdCardUrl; let bankBookUrl = draft.existingBankBookUrl;
      if (idCardFile) { const item = await uploadFile(idCardFile, 'idcard'); idCardUrl = item.url; uploadedPaths.push(item.path); }
      if (bankBookFile) { const item = await uploadFile(bankBookFile, 'bankbook'); bankBookUrl = item.url; uploadedPaths.push(item.path); }
      const photos = await Promise.all(damageFiles.map(file => uploadFile(file, 'damage')));
      uploadedPaths.push(...photos.map(item => item.path));
      const imageUrls = [...draft.existingImageUrls, ...photos.map(item => item.url)].slice(0, MAX_DAMAGE_PHOTOS);
      const payload = {
        sos_report_id: getSosReportId(), full_name: draft.fullName.trim(), phone: normalizePhone(draft.phone),
        province: draft.province.trim(), district: draft.district.trim(), sub_district: draft.subDistrict.trim(), address_details: draft.addressDetails.trim(),
        claim_category: draft.category, housing_tenure: draft.category === 'housing_property' ? draft.housingTenure : null,
        farmer_registered_before_disaster: draft.category === 'agriculture_livelihood' ? draft.farmerRegistered : null,
        farmer_registration_number: draft.category === 'agriculture_livelihood' ? draft.farmerRegistrationNumber.trim() || null : null,
        agriculture_damage_types: draft.category === 'agriculture_livelihood' ? draft.agricultureDamageTypes : [],
        crop_area_rai: nullableNumber(draft.cropAreaRai), fishery_area_rai: nullableNumber(draft.fisheryAreaRai), livestock_count: nullableNumber(draft.livestockCount),
        damage_type: draft.category === 'housing_property' ? 'housing' : 'agriculture', damage_value: nullableNumber(draft.damageValue),
        description: draft.description.trim() || null, image_urls: imageUrls, home_status: draft.category === 'housing_property' ? draft.homeStatus : null,
        incident_date: draft.incidentDate, id_card_number: draft.idCardNumber, id_card_image_url: idCardUrl, bank_book_image_url: bankBookUrl,
        victim_confirmed: true, victim_confirmed_at: new Date().toISOString(), status: 'pending' as const,
      };
      const query = draft.editingId
        ? supabase.from('damage_reports').update(payload).eq('id', draft.editingId).select('*').single()
        : supabase.from('damage_reports').insert(payload).select('*').single();
      const { data, error: submitError } = await query;
      if (submitError) throw submitError;
      localStorage.removeItem(DRAFT_KEY); await clearDraftFiles(); setHasCachedDraft(false);
      await loadClaims(draft.phone); setSelected(data as DamageReport); setScreen('done');
    } catch (cause) {
      if (uploadedPaths.length) await supabase.storage.from('damage-photos').remove(uploadedPaths);
      setError(formatSubmitError(cause));
    } finally { setSaving(false); }
  };

  const addDamageFiles = (files: File[]) => {
    try {
      files.forEach(validateImage);
      setDamageFiles(current => {
        const merged = [...current];
        for (const file of files) if (!merged.some(item => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) merged.push(file);
        return merged.slice(0, Math.max(0, MAX_DAMAGE_PHOTOS - draft.existingImageUrls.length));
      });
    } catch (cause) { setError(getMessage(cause, 'รูปภาพไม่ถูกต้อง')); }
  };

  const categoryClaims = useMemo(() => new Map(claims.map(item => [getCategory(item), item])), [claims]);

  return (
    <main className={styles.page}>
      <header className={styles.topbar}><button onClick={() => screen === 'home' ? router.push('/') : setScreen('home')}><ArrowLeft size={19} /><span>ย้อนกลับ</span></button><div><ShieldCheck size={18} /><span>{PROJECT_NAME}</span></div><span className={styles.secure}><ShieldCheck size={14} /> ปกป้องข้อมูล</span></header>
      <div className={styles.shell}>
        <section className={styles.hero}><small>COMPENSATION SERVICE</small><h1>สำรวจความเสียหายและยื่นเยียวยา</h1><p>ทำทีละขั้น ตรวจสอบย้อนหลัง และกลับมาแก้ไขได้โดยไม่ต้องกรอกใหม่ทั้งหมด</p></section>

        {error && <div ref={errorRef} className={styles.error} role="alert">{error}</div>}
        {loading && <div className={styles.loading}><LoaderCircle className={styles.spin} /> กำลังโหลดข้อมูล</div>}

        {!loading && screen === 'home' && <section className={styles.panel}>
          <div className={styles.panelHeading}><div><small>คำร้องของคุณ</small><h2>ยื่นได้สูงสุด 2 ประเภท</h2><p>หนึ่งเลขบัตรประชาชนยื่นได้ประเภทละหนึ่งคำร้อง</p></div><button className={styles.lookupButton} onClick={() => setScreen('lookup')}><Search size={16} /> ค้นหาคำร้อง</button></div>
          {hasCachedDraft && <button className={styles.draftBanner} onClick={() => void resumeDraft()}><RotateCcw size={19} /><span><strong>มีแบบฟอร์มที่ยังกรอกไม่เสร็จ</strong><small>ข้อมูลถูกเก็บไว้ในเครื่องนี้</small></span><ChevronRight size={18} /></button>}
          {!eligible && <div className={styles.notice}><ShieldCheck size={18} /><span><strong>ยังไม่เปิดให้สร้างคำร้องใหม่</strong><small>ระบบจะเปิดหลังช่วยเหลือเสร็จและออกจากศูนย์หรือถึงจุดปลอดภัยแล้ว คำร้องเดิมยังตรวจสอบได้ตามปกติ</small></span></div>}
          <div className={styles.categoryGrid}>{(Object.keys(CATEGORY_META) as ClaimCategory[]).map(category => {
            const claim = categoryClaims.get(category); const meta = CATEGORY_META[category];
            return <article className={styles.categoryCard} key={category}><span>{meta.icon}</span><div><small>{meta.short}</small><h3>{meta.title}</h3><p>{meta.description}</p></div>{claim ? <><StatusBadge status={claim.status} /><button onClick={() => openClaim(claim)}>ดูคำร้องและรายละเอียด <ChevronRight size={16} /></button></> : <button disabled={!eligible} onClick={() => startClaim(category)}>เริ่มคำร้องประเภทนี้ <ChevronRight size={16} /></button>}</article>;
          })}</div>
        </section>}

        {!loading && screen === 'lookup' && <section className={styles.panel}><PageHeading icon={<Search />} title="ค้นหาและติดตามคำร้อง" description="ค้นหาได้ด้วยชื่อ–นามสกุล หรือเบอร์โทรศัพท์อย่างใดอย่างหนึ่ง" /><form className={styles.form} onSubmit={lookup}><Field label="ชื่อ–นามสกุล หรือเบอร์โทรศัพท์"><input type="search" autoComplete="off" placeholder="เช่น สมชาย ใจดี หรือ 0812345678" value={lookupTerm} onChange={e => { setLookupTerm(e.target.value); setLookupResults([]); setError(''); }} /></Field><button className={styles.primary} type="submit"><Search size={17} /> ค้นหาคำร้อง</button></form>{lookupResults.length > 0 && <div className={styles.lookupResults}><div><strong>พบ {lookupResults.length} รายการ</strong><small>เลือกคำขอที่เป็นของคุณ</small></div>{lookupResults.map(result => <button type="button" key={result.id} onClick={() => void selectLookupResult(result)}><span><strong>{result.full_name}</strong><small>{maskPhone(result.phone)} · {result.sub_district ? `ต.${result.sub_district} ` : ''}อ.{result.district} จ.{result.province}</small></span><ChevronRight size={18} /></button>)}</div>}</section>}

        {!loading && screen === 'wizard' && <section className={styles.panel}>
          <WizardProgress step={step} />
          <div className={styles.wizardTitle}><span>{CATEGORY_META[draft.category].icon}</span><div><small>{draft.editingId ? 'แก้ไขคำร้อง' : 'คำร้องใหม่'}</small><h2>{CATEGORY_META[draft.category].title}</h2></div></div>
          {step === 1 && <ApplicantStep draft={draft} setDraft={setDraft} />}
          {step === 2 && <DamageStep draft={draft} setDraft={setDraft} />}
          {step === 3 && <DocumentStep draft={draft} setDraft={setDraft} idCardFile={idCardFile} setIdCardFile={setIdCardFile} bankBookFile={bankBookFile} setBankBookFile={setBankBookFile} damageFiles={damageFiles} setDamageFiles={setDamageFiles} addDamageFiles={addDamageFiles} onError={setError} />}
          {step === 4 && <ReviewStep draft={draft} idCardFile={idCardFile} bankBookFile={bankBookFile} damageFiles={damageFiles} confirmed={reviewConfirmed} onConfirmed={setReviewConfirmed} />}
          <div className={styles.actions}><button type="button" onClick={() => step === 1 ? setScreen('home') : setStep(current => (current - 1) as WizardStep)}>ย้อนกลับ</button>{step < 4 ? <button className={styles.primary} type="button" onClick={goNext}>ถัดไป <ChevronRight size={17} /></button> : <button className={styles.primary} type="button" disabled={saving || !reviewConfirmed} onClick={() => void submitClaim()}>{saving ? <LoaderCircle className={styles.spin} /> : <CheckCircle2 size={18} />} {saving ? 'กำลังส่งข้อมูล' : draft.editingId ? 'บันทึกการแก้ไข' : 'ยืนยันส่งคำร้อง'}</button>}</div>
        </section>}

        {!loading && screen === 'detail' && selected && <ClaimDetail claim={selected} onBack={() => setScreen('home')} onEdit={() => editClaim(selected)} />}
        {!loading && screen === 'done' && selected && <section className={`${styles.panel} ${styles.done}`}><span><CheckCircle2 size={38} /></span><h2>{draft.editingId ? 'บันทึกการแก้ไขแล้ว' : 'ส่งคำร้องเรียบร้อยแล้ว'}</h2><p>คุณสามารถกลับมาตรวจสอบรายละเอียดและสถานะของทั้งสองคำร้องได้เสมอ</p><StatusBadge status={selected.status} /><button className={styles.primary} onClick={() => { setScreen('home'); setSelected(null); }}>ดูคำร้องทั้งหมด</button></section>}
      </div>
    </main>
  );
}

function ApplicantStep({ draft, setDraft }: { draft: Draft; setDraft: React.Dispatch<React.SetStateAction<Draft>> }) {
  const update = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));
  return <div className={styles.stepPage}><PageHeading icon={<UserRound />} title="ข้อมูลผู้ยื่นและสถานที่เสียหาย" description="ตรวจสอบข้อมูลให้ตรงกับเอกสารราชการ" /><div className={styles.twoCols}><Field label="ชื่อ–นามสกุล"><input value={draft.fullName} onChange={e => update({ fullName:e.target.value })} /></Field><Field label="เบอร์โทรศัพท์"><input type="tel" inputMode="numeric" maxLength={10} value={draft.phone} onChange={e => update({ phone:e.target.value.replace(/\D/g,'').slice(0,10) })} /></Field></div><Field label="เลขบัตรประชาชน 13 หลัก"><input inputMode="numeric" maxLength={13} value={draft.idCardNumber} onChange={e => update({ idCardNumber:e.target.value.replace(/\D/g,'').slice(0,13) })} /></Field><div className={styles.threeCols}><Field label="จังหวัด"><input value={draft.province} onChange={e => update({ province:e.target.value })} /></Field><Field label="อำเภอ"><input value={draft.district} onChange={e => update({ district:e.target.value })} /></Field><Field label="ตำบล"><input value={draft.subDistrict} onChange={e => update({ subDistrict:e.target.value })} /></Field></div><Field label={draft.category === 'housing_property' ? 'บ้านเลขที่ หมู่ ซอย ถนน และรายละเอียดบ้าน' : 'ที่ตั้งพื้นที่เกษตร/บ่อประมง/สถานที่เลี้ยงสัตว์'}><textarea rows={3} value={draft.addressDetails} onChange={e => update({ addressDetails:e.target.value })} /></Field><Field label="วันที่เกิดความเสียหาย"><input type="date" max={new Date().toISOString().slice(0,10)} value={draft.incidentDate} onChange={e => update({ incidentDate:e.target.value })} /></Field></div>;
}

function DamageStep({ draft, setDraft }: { draft: Draft; setDraft: React.Dispatch<React.SetStateAction<Draft>> }) {
  const update = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));
  const toggle = (value:string) => update({ agricultureDamageTypes: draft.agricultureDamageTypes.includes(value) ? draft.agricultureDamageTypes.filter(item => item !== value) : [...draft.agricultureDamageTypes, value] });
  return <div className={styles.stepPage}><PageHeading icon={draft.category === 'housing_property' ? <Building2 /> : <Sprout />} title="รายละเอียดความเสียหาย" description="ข้อมูลส่วนนี้ใช้ประกอบการตรวจสอบสิทธิ์" />{draft.category === 'housing_property' ? <><ChoiceGroup label="บ้านหลังนี้เป็นของใคร" options={[['owner','บ้านของตนเอง'],['renter','บ้านเช่า'],['other_person','บ้านของบุคคลอื่น']]} value={draft.housingTenure} onChange={value => update({ housingTenure:value as Draft['housingTenure'] })} /><ChoiceGroup label="สถานะการอยู่อาศัยปัจจุบัน" options={[['returned','พักอาศัยได้'],['temporary_shelter','ยังอยู่ที่พักชั่วคราว'],['cannot_return','บ้านยังพักไม่ได้']]} value={draft.homeStatus} onChange={value => update({ homeStatus:value as Draft['homeStatus'] })} /><div className={styles.rule}><ShieldCheck size={18} /><span>บ้านหนึ่งหลังยื่นได้หนึ่งคำร้องเท่านั้น ระบบจะตรวจจังหวัด อำเภอ ตำบล บ้านเลขที่และรายละเอียดที่อยู่ร่วมกัน</span></div></> : <><label className={styles.confirmCheck}><input type="checkbox" checked={draft.farmerRegistered} onChange={e => update({ farmerRegistered:e.target.checked })} /><span><strong>ขึ้นทะเบียนเกษตรกรไว้ก่อนเกิดภัยพิบัติแล้ว</strong><small>และข้อมูลทะเบียนได้รับการปรับปรุงให้เป็นปัจจุบัน</small></span></label><Field label="เลขทะเบียนเกษตรกร (ถ้ามี)"><input value={draft.farmerRegistrationNumber} onChange={e => update({ farmerRegistrationNumber:e.target.value })} /></Field><div className={styles.optionBlock}><span>ประเภทความเสียหาย</span><div className={styles.checkGrid}>{[['crop','พืชผล/พื้นที่เกษตร'],['fishery','ประมง'],['livestock','ปศุสัตว์']].map(([value,label]) => <label key={value}><input type="checkbox" checked={draft.agricultureDamageTypes.includes(value)} onChange={() => toggle(value)} />{label}</label>)}</div></div><div className={styles.threeCols}><Field label="พืชผลเสียหาย (ไร่)"><input type="number" min="0" step="0.01" value={draft.cropAreaRai} onChange={e => update({ cropAreaRai:e.target.value })} /></Field><Field label="ประมงเสียหาย (ไร่)"><input type="number" min="0" step="0.01" value={draft.fisheryAreaRai} onChange={e => update({ fisheryAreaRai:e.target.value })} /></Field><Field label="ปศุสัตว์เสียหาย (ตัว)"><input type="number" min="0" step="1" value={draft.livestockCount} onChange={e => update({ livestockCount:e.target.value })} /></Field></div></>}<Field label="ประเมินมูลค่าความเสียหาย (บาท)"><input type="number" min="0" value={draft.damageValue} onChange={e => update({ damageValue:e.target.value })} /></Field><Field label="อธิบายความเสียหาย"><textarea rows={5} maxLength={2000} value={draft.description} onChange={e => update({ description:e.target.value })} /></Field></div>;
}

function DocumentStep(props: { draft:Draft; setDraft:React.Dispatch<React.SetStateAction<Draft>>; idCardFile:File|null; setIdCardFile:(f:File|null)=>void; bankBookFile:File|null; setBankBookFile:(f:File|null)=>void; damageFiles:File[]; setDamageFiles:React.Dispatch<React.SetStateAction<File[]>>; addDamageFiles:(f:File[])=>void; onError:(m:string)=>void }) {
  const pickOne = (file:File|undefined, setter:(f:File|null)=>void) => { if (!file) return; try { validateImage(file); setter(file); } catch(cause) { props.onError(getMessage(cause,'ไฟล์ไม่ถูกต้อง')); } };
  return <div className={styles.stepPage}><PageHeading icon={<Upload />} title="เอกสารและรูปหลักฐาน" description="ถ่ายให้ชัด ไม่สะท้อนแสง และเห็นข้อมูลครบ" /><div className={styles.documentGrid}><FileBox id="id-card" icon={<IdCard />} title="บัตรประชาชน" required current={props.idCardFile?.name || (props.draft.existingIdCardUrl ? 'มีไฟล์เดิมแล้ว' : '')} onFiles={files => pickOne(files[0],props.setIdCardFile)} /><FileBox id="bank-book" icon={<WalletCards />} title="หน้าสมุดบัญชีธนาคาร" required current={props.bankBookFile?.name || (props.draft.existingBankBookUrl ? 'มีไฟล์เดิมแล้ว' : '')} onFiles={files => pickOne(files[0],props.setBankBookFile)} /></div><div className={styles.photoSection}><div><span><ImagePlus size={20} /></span><div><strong>รูปความเสียหาย</strong><small>เพิ่มต่อได้หลายครั้ง สูงสุด {MAX_DAMAGE_PHOTOS} รูป</small></div></div><FileBox id="damage-images" icon={<Camera />} title="เพิ่มรูปความเสียหาย" required multiple current={`${props.draft.existingImageUrls.length + props.damageFiles.length}/${MAX_DAMAGE_PHOTOS} รูป`} onFiles={props.addDamageFiles} /><div className={styles.fileList}>{props.draft.existingImageUrls.map((url,index) => <div key={url}><a href={url} target="_blank" rel="noreferrer">รูปเดิม {index+1}</a><button onClick={() => props.setDraft(current => ({...current,existingImageUrls:current.existingImageUrls.filter(item=>item!==url)}))}><Trash2 size={14} /></button></div>)}{props.damageFiles.map((file,index) => <div key={`${file.name}-${file.lastModified}`}><span>{file.name}</span><button onClick={() => props.setDamageFiles(current => current.filter((_,i)=>i!==index))}><Trash2 size={14} /></button></div>)}</div></div><div className={styles.cacheNote}><RotateCcw size={17} /> ข้อมูลและไฟล์ที่เลือกถูกพักไว้ในเครื่องนี้ หากรีเฟรชหน้าสามารถกลับมากรอกต่อได้</div></div>;
}

function ReviewStep({ draft, idCardFile, bankBookFile, damageFiles, confirmed, onConfirmed }: { draft:Draft; idCardFile:File|null; bankBookFile:File|null; damageFiles:File[]; confirmed:boolean; onConfirmed:(value:boolean)=>void }) {
  return <div className={styles.stepPage}><PageHeading icon={<FileText />} title="ตรวจสอบก่อนส่ง" description="กดแก้ไขย้อนกลับได้ หากข้อมูลยังไม่ถูกต้อง" /><dl className={styles.review}><div><dt>ประเภทคำร้อง</dt><dd>{CATEGORY_META[draft.category].title}</dd></div><div><dt>ผู้ยื่น</dt><dd>{draft.fullName} · {draft.phone}</dd></div><div><dt>พื้นที่เสียหาย</dt><dd>{draft.addressDetails} ต.{draft.subDistrict} อ.{draft.district} จ.{draft.province}</dd></div><div><dt>วันที่เกิดเหตุ</dt><dd>{formatDate(draft.incidentDate)}</dd></div>{draft.category==='housing_property'?<div><dt>ความเกี่ยวข้องกับบ้าน</dt><dd>{tenureLabel(draft.housingTenure)}</dd></div>:<div><dt>ทะเบียนเกษตรกร</dt><dd>{draft.farmerRegistered?'ขึ้นทะเบียนก่อนเกิดภัยแล้ว':'ไม่ผ่านเงื่อนไข'}</dd></div>}<div><dt>รายละเอียด</dt><dd>{draft.description || 'ไม่ได้ระบุ'}</dd></div><div><dt>เอกสาร</dt><dd>บัตรประชาชน {idCardFile||draft.existingIdCardUrl?'✓':'–'} · หน้าบุ๊กแบงก์ {bankBookFile||draft.existingBankBookUrl?'✓':'–'} · รูปความเสียหาย {damageFiles.length+draft.existingImageUrls.length} รูป</dd></div></dl><label className={styles.confirmCheck}><input type="checkbox" checked={confirmed} onChange={event => onConfirmed(event.target.checked)} /><span><strong>ยืนยันว่าข้อมูลเป็นความจริง</strong><small>เจ้าหน้าที่สามารถขอข้อมูลเพิ่มเติมภายหลังได้</small></span></label></div>;
}

function ClaimDetail({ claim, onBack, onEdit }: { claim:DamageReport; onBack:()=>void; onEdit:()=>void }) {
  const editable = claim.status==='pending'||claim.status==='rejected';
  const category = getCategory(claim);
  return <section className={styles.panel}>
    <PageHeading icon={CATEGORY_META[category].icon} title={CATEGORY_META[category].title} description={`ส่งเมื่อ ${new Date(claim.created_at).toLocaleString('th-TH')}`} />
    <StatusBadge status={claim.status} />
    <p className={styles.statusDescription}>{STATUS_META[claim.status].description}</p>
    <dl className={styles.review}>
      <div><dt>ผู้ยื่น</dt><dd>{claim.full_name} · {claim.phone}</dd></div>
      <div><dt>เลขบัตรประชาชน</dt><dd>{maskIdCard(claim.id_card_number)}</dd></div>
      <div><dt>สถานที่เสียหาย</dt><dd>{claim.address_details} ต.{claim.sub_district} อ.{claim.district} จ.{claim.province}</dd></div>
      <div><dt>วันที่เกิดเหตุ</dt><dd>{formatDate(claim.incident_date)}</dd></div>
      {category === 'housing_property' ? <>
        <div><dt>ความเกี่ยวข้องกับบ้าน</dt><dd>{tenureLabel((claim.housing_tenure ?? '') as Draft['housingTenure'])}</dd></div>
        <div><dt>สถานะบ้าน</dt><dd>{homeStatusLabel(claim.home_status)}</dd></div>
      </> : <>
        <div><dt>ทะเบียนเกษตรกร</dt><dd>{claim.farmer_registered_before_disaster ? `ขึ้นทะเบียนแล้ว${claim.farmer_registration_number ? ` · ${claim.farmer_registration_number}` : ''}` : 'ไม่ได้ระบุ'}</dd></div>
        <div><dt>ประเภทความเสียหาย</dt><dd>{agricultureTypeLabels(claim.agriculture_damage_types)}</dd></div>
        <div><dt>พืชผล / ประมง</dt><dd>{claim.crop_area_rai ?? 0} ไร่ / {claim.fishery_area_rai ?? 0} ไร่</dd></div>
        <div><dt>ปศุสัตว์</dt><dd>{claim.livestock_count ?? 0} ตัว</dd></div>
      </>}
      <div><dt>รายละเอียด</dt><dd>{claim.description||'ไม่ได้ระบุ'}</dd></div>
      <div><dt>มูลค่าที่ประเมิน</dt><dd>{claim.damage_value!=null?`${Number(claim.damage_value).toLocaleString('th-TH')} บาท`:'ไม่ได้ระบุ'}</dd></div>
    </dl>
    <div className={styles.documentLinks}>
      {claim.id_card_image_url && <a href={claim.id_card_image_url} target="_blank" rel="noreferrer"><IdCard size={17}/> ดูบัตรประชาชน</a>}
      {claim.bank_book_image_url && <a href={claim.bank_book_image_url} target="_blank" rel="noreferrer"><WalletCards size={17}/> ดูหน้าบุ๊กแบงก์</a>}
    </div>
    <div className={styles.evidence}>{claim.image_urls?.map((url,index)=><a key={url} href={url} target="_blank" rel="noreferrer"><Image src={url} alt={`หลักฐาน ${index+1}`} fill unoptimized sizes="(max-width: 700px) 45vw, 220px" /></a>)}</div>
    <div className={styles.actions}><button onClick={onBack}>กลับรายการทั้งหมด</button>{editable&&<button className={styles.primary} onClick={onEdit}><Pencil size={16} /> แก้ไขคำร้อง</button>}</div>
    {!editable&&<div className={styles.notice}><ShieldCheck size={17}/><span><strong>คำร้องอยู่ระหว่างการพิจารณา</strong><small>หากต้องแก้ไข โปรดติดต่อเจ้าหน้าที่ให้ตีกลับคำร้องก่อน</small></span></div>}
  </section>;
}

function PageHeading({icon,title,description}:{icon:React.ReactNode;title:string;description:string}) { return <div className={styles.pageHeading}><span>{icon}</span><div><h2>{title}</h2><p>{description}</p></div></div>; }
function Field({label,children}:{label:string;children:React.ReactNode}) { return <label className={styles.field}><span>{label}</span>{children}</label>; }
function ChoiceGroup({label,options,value,onChange}:{label:string;options:string[][];value:string;onChange:(v:string)=>void}) { return <div className={styles.optionBlock}><span>{label}</span><div className={styles.choiceGrid}>{options.map(([key,text])=><button type="button" className={value===key?styles.selected:''} onClick={()=>onChange(key)} key={key}><Check size={15}/>{text}</button>)}</div></div>; }
function WizardProgress({step}:{step:number}) { return <div className={styles.progress}>{['ข้อมูล','ความเสียหาย','เอกสาร','ตรวจสอบ'].map((label,index)=>{const n=index+1;return <React.Fragment key={label}><div className={n<=step?styles.active:''}><span>{n<step?<Check size={13}/>:n}</span><small>{label}</small></div>{n<4&&<i className={n<step?styles.activeLine:''}/>}</React.Fragment>;})}</div>; }
function StatusBadge({status}:{status:ClaimStatus}) { return <span className={`${styles.status} ${styles[`status_${status}`]}`}><i />{STATUS_META[status].label}</span>; }
function FileBox({id,icon,title,current,onFiles,multiple=false,required=false}:{id:string;icon:React.ReactNode;title:string;current:string;onFiles:(f:File[])=>void;multiple?:boolean;required?:boolean}) { return <label className={styles.fileBox} htmlFor={id}><span>{icon}</span><div><strong>{title}{required&&<b>*</b>}</strong><small>{current||'แตะเพื่อเลือกรูปภาพ'}</small></div><Upload size={17}/><input id={id} type="file" accept="image/jpeg,image/png,image/webp" multiple={multiple} onChange={e=>{onFiles(Array.from(e.target.files??[]));e.currentTarget.value='';}} /></label>; }

function validateStep(d:Draft, step:number, files:{idCardFile:File|null;bankBookFile:File|null;damageFiles:File[]}) {
  if(step===1){if(!d.fullName.trim()||!/^0\d{8,9}$/.test(normalizePhone(d.phone)))return'กรุณากรอกชื่อและเบอร์โทรให้ถูกต้อง';if(!/^\d{13}$/.test(d.idCardNumber))return'กรุณากรอกเลขบัตรประชาชน 13 หลัก';if(!d.province.trim()||!d.district.trim()||!d.subDistrict.trim()||!d.addressDetails.trim())return'กรุณากรอกที่อยู่หรือพื้นที่เสียหายให้ครบ';if(!d.incidentDate)return'กรุณาระบุวันที่เกิดความเสียหาย';}
  if(step===2){if(d.category==='housing_property'&&(!d.housingTenure||!d.homeStatus))return'กรุณาระบุความเกี่ยวข้องกับบ้านและสถานะการอยู่อาศัย';if(d.category==='agriculture_livelihood'&&!d.farmerRegistered)return'ประเภทนี้ต้องขึ้นทะเบียนเกษตรกรไว้ก่อนเกิดภัยพิบัติ';if(d.category==='agriculture_livelihood'&&!d.agricultureDamageTypes.length)return'กรุณาเลือกประเภทความเสียหายด้านการประกอบอาชีพ';if(d.agricultureDamageTypes.includes('crop')&&Number(d.cropAreaRai)<=0)return'กรุณาระบุจำนวนไร่ของพืชผลที่เสียหาย';if(d.agricultureDamageTypes.includes('fishery')&&Number(d.fisheryAreaRai)<=0)return'กรุณาระบุจำนวนไร่ของพื้นที่ประมงที่เสียหาย';if(d.agricultureDamageTypes.includes('livestock')&&Number(d.livestockCount)<=0)return'กรุณาระบุจำนวนปศุสัตว์ที่เสียหาย';if(!d.description.trim())return'กรุณาอธิบายความเสียหาย';}
  if(step===3){if(!files.idCardFile&&!d.existingIdCardUrl)return'กรุณาแนบรูปบัตรประชาชน';if(!files.bankBookFile&&!d.existingBankBookUrl)return'กรุณาแนบรูปหน้าสมุดบัญชีธนาคาร';if(files.damageFiles.length+d.existingImageUrls.length<1)return'กรุณาแนบรูปความเสียหายอย่างน้อย 1 รูป';}
  return'';
}
function validateAll(d:Draft,files:{idCardFile:File|null;bankBookFile:File|null;damageFiles:File[]}) { return validateStep(d,1,files)||validateStep(d,2,files)||validateStep(d,3,files); }
function validateImage(file:File){if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('รองรับเฉพาะ JPG, PNG และ WEBP');if(file.size>MAX_FILE_SIZE)throw new Error('แต่ละรูปต้องไม่เกิน 8 MB');}
async function uploadFile(file:File,prefix:'idcard'|'bankbook'|'damage'){validateImage(file);const ext=file.name.split('.').pop()?.toLowerCase()||'jpg';const path=`${prefix}/${Date.now()}-${crypto.randomUUID()}.${ext}`;const{error}=await supabase.storage.from('damage-photos').upload(path,file,{contentType:file.type,upsert:false});if(error)throw error;return{path,url:supabase.storage.from('damage-photos').getPublicUrl(path).data.publicUrl};}
function getCategory(report:DamageReport):ClaimCategory{return report.claim_category||(report.agriculture_damage_types?.length||report.farmer_registered_before_disaster?'agriculture_livelihood':'housing_property');}
function normalizePhone(value:string){return value.replace(/\D/g,'').slice(0,10);}
function nullableNumber(value:string){return value===''?null:Number(value);}
function numberString(value:number|null|undefined){return value==null?'':String(value);}
function toDateInput(value:string|null|undefined){return value?value.slice(0,10):'';}
function formatDate(value:string|null|undefined){return value?new Date(`${value.slice(0,10)}T00:00:00`).toLocaleDateString('th-TH'):'–';}
function tenureLabel(value:Draft['housingTenure']){return value==='owner'?'บ้านของตนเอง':value==='renter'?'บ้านเช่า':value==='other_person'?'บ้านของบุคคลอื่น':'–';}
function homeStatusLabel(value:string|null|undefined){return value==='returned'?'พักอาศัยได้':value==='temporary_shelter'?'ยังอยู่ที่พักชั่วคราว':value==='cannot_return'?'บ้านยังพักไม่ได้':'–';}
function agricultureTypeLabels(values:string[]|null|undefined){const labels:Record<string,string>={crop:'พืชผล/พื้นที่เกษตร',fishery:'ประมง',livestock:'ปศุสัตว์'};return values?.map(value=>labels[value]??value).join(', ')||'–';}
function maskIdCard(value:string|null|undefined){if(!value||value.length<13)return'–';return`${value.slice(0,1)}-${value.slice(1,5)}-XXXXX-${value.slice(-2)}`;}
function maskPhone(value:string){if(value.length<7)return value;return`${value.slice(0,3)}-XXX-${value.slice(-4)}`;}
function getMessage(cause:unknown,fallback:string){return cause instanceof Error?cause.message:fallback;}
function formatSubmitError(cause:unknown){const e=cause as {code?:string;message?:string};if(e.code==='23505'&&e.message?.includes('property_address'))return'ที่อยู่นี้มีผู้ยื่นคำร้องด้านที่อยู่อาศัยแล้ว บ้านหนึ่งหลังยื่นได้หนึ่งคน';if(e.code==='23505')return'เลขบัตรประชาชนนี้มีคำร้องประเภทเดียวกันแล้ว กรุณากลับไปตรวจสอบคำร้องเดิม';return getMessage(cause,'ส่งคำร้องไม่สำเร็จ กรุณาลองใหม่');}
function hasReachedEligibleDestination(destination:{status?:string|null;notes?:string|null}|null){if(!destination)return false;if(destination.status==='returned_home')return true;if(destination.status!=='rescued')return false;if(!destination.notes)return true;const all=[...destination.notes.matchAll(/(\d+)\s*คน/g)].reduce((sum,item)=>sum+Number(item[1]),0);const unavailable=[...destination.notes.matchAll(/(?:โรงพยาบาล|เสียชีวิต)\s*(\d+)\s*คน/g)].reduce((sum,item)=>sum+Number(item[1]),0);return all===0||all>unavailable;}

function readCachedDraft():{draft:Draft;step:WizardStep}|null{if(typeof window==='undefined')return null;try{const value=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null');return value?.draft?value:null;}catch{return null;}}
function openDraftDb():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open(FILE_DB,1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(FILE_STORE))request.result.createObjectStore(FILE_STORE);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function saveDraftFiles(value:{idCardFile:File|null;bankBookFile:File|null;damageFiles:File[]}){try{const db=await openDraftDb();const tx=db.transaction(FILE_STORE,'readwrite');tx.objectStore(FILE_STORE).put(value,'current');await transactionDone(tx);db.close();}catch{/* เบราว์เซอร์บางโหมดไม่เปิด IndexedDB */}}
async function loadDraftFiles():Promise<{idCardFile:File|null;bankBookFile:File|null;damageFiles:File[]}|null>{try{const db=await openDraftDb();const value=await new Promise<unknown>((resolve,reject)=>{const req=db.transaction(FILE_STORE,'readonly').objectStore(FILE_STORE).get('current');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});db.close();return value as {idCardFile:File|null;bankBookFile:File|null;damageFiles:File[]}|null;}catch{return null;}}
async function clearDraftFiles(){try{const db=await openDraftDb();const tx=db.transaction(FILE_STORE,'readwrite');tx.objectStore(FILE_STORE).delete('current');await transactionDone(tx);db.close();}catch{/* no-op */}}
function transactionDone(tx:IDBTransaction){return new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
