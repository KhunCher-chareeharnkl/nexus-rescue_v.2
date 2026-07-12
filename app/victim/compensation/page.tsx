'use client';

import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';

// เพิ่ม 'create' เข้ามา — สำหรับกรณีค้นหาแล้วไม่เจอเคสเดิม ต้องแจ้งความเสียหายใหม่
type Step = 'lookup' | 'select' | 'confirm' | 'create' | 'done';

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
  status: 'pending' | 'verified' | 'approved' | 'rejected';
  incident_date?: string | null;
  id_card_number?: string | null;
  id_card_image_url?: string | null;
  victim_confirmed: boolean;
  victim_confirmed_at?: string | null;
  created_at: string;
}

const DAMAGE_TYPE_LABEL: Record<string, string> = {
  housing: '🏠 ที่อยู่อาศัย',
  vehicle: '🚗 ยานพาหนะ',
  agriculture: '🌾 พืชผล/ปศุสัตว์',
  property: '📦 ทรัพย์สินอื่น',
  other: '📋 อื่นๆ',
};

const HOME_STATUS_LABEL: Record<string, string> = {
  returned: '✅ กลับเข้าบ้านได้แล้ว',
  temporary_shelter: '🏕️ ยังอยู่ที่พักชั่วคราว',
  cannot_return: '❌ กลับเข้าบ้านไม่ได้',
};

const STATUS_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  pending: { text: 'รอตรวจสอบ', color: '#92400E', bg: '#FEF3C7' },
  verified: { text: 'ตรวจสอบแล้ว', color: '#1D4ED8', bg: '#DBEAFE' },
  approved: { text: 'อนุมัติเยียวยาแล้ว', color: '#15803D', bg: '#DCFCE7' },
  rejected: { text: 'ไม่อนุมัติ', color: '#B91C1C', bg: '#FEE2E2' },
};

export default function VictimCompensationConfirm() {
  const [step, setStep] = useState<Step>('lookup');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [noMatchFound, setNoMatchFound] = useState(false); // true = ค้นหาแล้วไม่เจอเลยสักเคส

  const [reports, setReports] = useState<DamageReport[]>([]);
  const [selected, setSelected] = useState<DamageReport | null>(null);

  // ── ข้อมูลที่อยู่ (ใช้เฉพาะตอนแจ้งใหม่ — เคสเดิมมีที่อยู่อยู่แล้วไม่ต้องกรอกซ้ำ) ──
  const [newFullName, setNewFullName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newProvince, setNewProvince] = useState('');
  const [newDistrict, setNewDistrict] = useState('');
  const [newSubDistrict, setNewSubDistrict] = useState('');
  const [newAddressDetails, setNewAddressDetails] = useState('');

  // ── ฟอร์มยืนยันตัวเอง (ใช้ร่วมกันทั้งเคส "ยืนยันของเดิม" และ "แจ้งใหม่") ──
  const [idCardNumber, setIdCardNumber] = useState('');
  const [incidentDate, setIncidentDate] = useState('');
  const [damageType, setDamageType] = useState('');
  const [damageValue, setDamageValue] = useState('');
  const [description, setDescription] = useState('');
  const [homeStatus, setHomeStatus] = useState('');
  const [idCardFile, setIdCardFile] = useState<File | null>(null);
  const [damagePhotos, setDamagePhotos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const resetAll = () => {
    setStep('lookup');
    setFullName('');
    setPhone('');
    setSelected(null);
    setNoMatchFound(false);
    setError('');
    setNewFullName(''); setNewPhone(''); setNewProvince(''); setNewDistrict('');
    setNewSubDistrict(''); setNewAddressDetails('');
    setIdCardNumber(''); setIncidentDate(''); setDamageType(''); setDamageValue('');
    setDescription(''); setHomeStatus(''); setIdCardFile(null); setDamagePhotos([]);
  };

  const goToCreate = () => {
    // เอาชื่อ-เบอร์ที่พิมพ์ไว้ตอนค้นหามาเติมให้ในฟอร์มแจ้งใหม่ ไม่ต้องพิมพ์ซ้ำ
    setNewFullName(fullName);
    setNewPhone(phone);
    setError('');
    setStep('create');
  };

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNoMatchFound(false);
    if (!fullName.trim() || !phone.trim()) {
      setError('กรุณากรอกชื่อ-นามสกุล และเบอร์โทรให้ครบ');
      return;
    }
    setLoading(true);
    try {
      const { data, error: qErr } = await supabase
        .from('damage_reports')
        .select('*')
        .eq('phone', phone.trim())
        .ilike('full_name', fullName.trim())
        .order('created_at', { ascending: false });

      if (qErr) throw qErr;
      if (!data || data.length === 0) {
        setError('ไม่พบข้อมูลการแจ้งความเสียหายที่ตรงกับชื่อและเบอร์โทรนี้');
        setNoMatchFound(true);
        return;
      }
      setReports(data as DamageReport[]);
      if (data.length === 1) {
        openConfirmOrDone(data[0] as DamageReport);
      } else {
        setStep('select');
      }
    } catch (err: any) {
      setError(`เกิดข้อผิดพลาด: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const openConfirmOrDone = (r: DamageReport) => {
    setSelected(r);
    if (r.victim_confirmed) {
      setStep('done');
    } else {
      setIdCardNumber(r.id_card_number ?? '');
      setIncidentDate(r.incident_date ?? '');
      setDamageType(r.damage_type ?? '');
      setDamageValue(r.damage_value != null ? String(r.damage_value) : '');
      setDescription(r.description ?? '');
      setHomeStatus(r.home_status ?? '');
      setStep('confirm');
    }
  };

  const uploadFile = async (file: File, prefix: string) => {
    const ext = file.name.split('.').pop();
    const path = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage.from('damage-photos').upload(path, file);
    if (upErr) throw upErr;
    const { data } = supabase.storage.from('damage-photos').getPublicUrl(path);
    return data.publicUrl;
  };

  // เช็คฟิลด์ยืนยันตัวตนที่ใช้ร่วมกันทั้ง 2 flow (บัตรประชาชน/วันที่/ประเภทความเสียหาย)
  const validateIdentityFields = () => {
    if (!idCardNumber.trim() || idCardNumber.trim().length !== 13) {
      setError('กรุณากรอกเลขบัตรประชาชนให้ครบ 13 หลัก');
      return false;
    }
    if (!incidentDate) {
      setError('กรุณาระบุวันที่เกิดความเสียหาย');
      return false;
    }
    if (!damageType) {
      setError('กรุณาเลือกประเภทความเสียหาย');
      return false;
    }
    return true;
  };

  // ── กรณีที่ 1: มีเคสอยู่แล้ว แค่มายืนยันตัวตน + เติมรายละเอียด ──
  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setError('');
    if (!validateIdentityFields()) return;

    setSaving(true);
    try {
      let idCardImageUrl = selected.id_card_image_url ?? null;
      if (idCardFile) {
        idCardImageUrl = await uploadFile(idCardFile, 'idcard');
      }

      const newDamagePhotoUrls: string[] = [];
      for (const f of damagePhotos) {
        newDamagePhotoUrls.push(await uploadFile(f, 'damage'));
      }
      const mergedImageUrls = [...(selected.image_urls ?? []), ...newDamagePhotoUrls];

      const { error: updErr } = await supabase
        .from('damage_reports')
        .update({
          id_card_number: idCardNumber.trim(),
          id_card_image_url: idCardImageUrl,
          incident_date: incidentDate,
          damage_type: damageType,
          damage_value: damageValue ? Number(damageValue) : null,
          description: description.trim() || null,
          home_status: homeStatus || null,
          image_urls: mergedImageUrls,
          victim_confirmed: true,
          victim_confirmed_at: new Date().toISOString(),
        })
        .eq('id', selected.id);

      if (updErr) throw updErr;

      setSelected({
        ...selected,
        id_card_number: idCardNumber.trim(),
        id_card_image_url: idCardImageUrl,
        incident_date: incidentDate,
        damage_type: damageType,
        damage_value: damageValue ? Number(damageValue) : null,
        description: description.trim() || null,
        home_status: homeStatus || null,
        image_urls: mergedImageUrls,
        victim_confirmed: true,
        victim_confirmed_at: new Date().toISOString(),
      });
      setStep('done');
    } catch (err: any) {
      setError(`บันทึกไม่สำเร็จ: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ── กรณีที่ 2: ไม่เคยมีเคสมาก่อน แจ้งความเสียหายใหม่ + ยืนยันตัวตนในขั้นตอนเดียว ──
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!newFullName.trim() || !newPhone.trim()) {
      setError('กรุณากรอกชื่อ-นามสกุล และเบอร์โทรให้ครบ');
      return;
    }
    if (!newProvince.trim() || !newDistrict.trim() || !newSubDistrict.trim()) {
      setError('กรุณากรอกที่อยู่ให้ครบ (จังหวัด / อำเภอ / ตำบล)');
      return;
    }
    if (!validateIdentityFields()) return;

    setSaving(true);
    try {
      let idCardImageUrl: string | null = null;
      if (idCardFile) {
        idCardImageUrl = await uploadFile(idCardFile, 'idcard');
      }

      const newDamagePhotoUrls: string[] = [];
      for (const f of damagePhotos) {
        newDamagePhotoUrls.push(await uploadFile(f, 'damage'));
      }

      const { data, error: insErr } = await supabase
        .from('damage_reports')
        .insert({
          full_name: newFullName.trim(),
          phone: newPhone.trim(),
          province: newProvince.trim(),
          district: newDistrict.trim(),
          sub_district: newSubDistrict.trim(),
          address_details: newAddressDetails.trim() || null,
          id_card_number: idCardNumber.trim(),
          id_card_image_url: idCardImageUrl,
          incident_date: incidentDate,
          damage_type: damageType,
          damage_value: damageValue ? Number(damageValue) : null,
          description: description.trim() || null,
          home_status: homeStatus || null,
          image_urls: newDamagePhotoUrls,
          victim_confirmed: true,
          victim_confirmed_at: new Date().toISOString(),
          status: 'pending',
        })
        .select()
        .single();

      if (insErr) throw insErr;

      setSelected(data as DamageReport);
      setStep('done');
    } catch (err: any) {
      setError(`บันทึกไม่สำเร็จ: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-white p-8 rounded-[2.5rem] shadow-[0_10px_30px_rgba(0,0,0,0.03)] border border-slate-200/80 space-y-6">

        <div className="text-center">
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-3xl font-bold mx-auto shadow-[inset_0_2px_4px_rgba(37,99,235,0.06)] border border-blue-100 mb-4">
            📋
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-800">ยืนยันตัวตนเพื่อยื่นเยียวยา</h1>
          <p className="text-xs text-slate-400 mt-1">ต้องยืนยันตัวตนก่อน จึงจะยื่นขอรับเงินเยียวยาได้</p>
        </div>

        {error && (
          <div className="text-xs font-bold p-4 bg-red-50/60 border border-red-100 rounded-2xl text-red-600 leading-relaxed">
            {error}
          </div>
        )}

        {/* STEP 1: ค้นหาด้วยชื่อ+เบอร์โทร */}
        {step === 'lookup' && (
          <div className="space-y-4">
            <form onSubmit={handleLookup} className="space-y-4 text-left">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 pl-1">ชื่อ-นามสกุล</label>
                <input
                  type="text" required value={fullName} onChange={e => setFullName(e.target.value)}
                  placeholder="เช่น สมชาย ใจดี"
                  className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 pl-1">เบอร์โทรที่แจ้งไว้</label>
                <input
                  type="tel" required value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="08xxxxxxxx"
                  className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>
              <button
                type="submit" disabled={loading}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold p-4 rounded-2xl text-sm shadow-[0_6px_16px_rgba(37,99,235,0.2)] active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {loading ? '⏳ กำลังค้นหา...' : '🔍 ค้นหาข้อมูลของฉัน'}
              </button>
            </form>

            {/* ค้นหาแล้วไม่เจอ -> เสนอทางแจ้งใหม่ทันที */}
            {noMatchFound && (
              <button
                type="button"
                onClick={goToCreate}
                className="w-full text-sm font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-100 rounded-2xl p-4 transition-all"
              >
                📝 ยังไม่เคยแจ้งไว้เลย — แจ้งความเสียหายใหม่
              </button>
            )}

            {/* ทางลัดสำหรับคนที่รู้อยู่แล้วว่ายังไม่เคยแจ้ง ไม่ต้องรอค้นหาก่อนก็ได้ */}
            {!noMatchFound && (
              <button
                type="button"
                onClick={goToCreate}
                className="w-full text-xs font-bold text-slate-400 hover:text-slate-600 underline underline-offset-2"
              >
                หรือถ้ายังไม่เคยแจ้งความเสียหายมาก่อนเลย กดที่นี่เพื่อแจ้งใหม่
              </button>
            )}
          </div>
        )}

        {/* STEP 2: เลือกเคส ถ้ามีมากกว่า 1 รายการ */}
        {step === 'select' && (
          <div className="space-y-3 text-left">
            <p className="text-xs font-bold text-slate-500">พบ {reports.length} รายการ กรุณาเลือกเคสที่ต้องการยื่นเยียวยา</p>
            {reports.map(r => {
              const st = STATUS_LABEL[r.status];
              return (
                <button
                  key={r.id}
                  onClick={() => openConfirmOrDone(r)}
                  className="w-full text-left bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-200 rounded-2xl p-4 transition-all"
                >
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <div className="text-sm font-bold text-slate-800">
                        {DAMAGE_TYPE_LABEL[r.damage_type ?? ''] ?? 'ยังไม่ระบุประเภทความเสียหาย'}
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        แจ้งเมื่อ {new Date(r.created_at).toLocaleDateString('th-TH')}
                      </div>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ color: st.color, background: st.bg }}>
                      {st.text}
                    </span>
                  </div>
                  {r.victim_confirmed && (
                    <div className="text-[11px] font-bold text-emerald-600 mt-2">✅ ยืนยันตัวตนแล้ว</div>
                  )}
                </button>
              );
            })}
            <button type="button" onClick={goToCreate} className="w-full text-xs font-bold text-blue-600 pt-1">
              📝 ไม่ใช่เคสของฉัน — แจ้งความเสียหายใหม่
            </button>
            <button type="button" onClick={() => setStep('lookup')} className="w-full text-xs font-bold text-slate-400">
              ← ค้นหาใหม่
            </button>
          </div>
        )}

        {/* STEP 3a: ฟอร์มยืนยันตัวตนของเคสที่มีอยู่แล้ว */}
        {step === 'confirm' && selected && (
          <form onSubmit={handleConfirm} className="space-y-4 text-left">
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-3 text-xs text-amber-700 font-bold leading-relaxed">
              ⚠️ ต้องกรอกและยืนยันให้ครบก่อน จึงจะเข้าสู่กระบวนการยื่นเยียวยาได้
            </div>
            <IdentityFields
              idCardNumber={idCardNumber} setIdCardNumber={setIdCardNumber}
              idCardExistingUrl={selected.id_card_image_url}
              setIdCardFile={setIdCardFile}
              incidentDate={incidentDate} setIncidentDate={setIncidentDate}
              damageType={damageType} setDamageType={setDamageType}
              damageValue={damageValue} setDamageValue={setDamageValue}
              description={description} setDescription={setDescription}
              setDamagePhotos={setDamagePhotos}
              existingPhotoCount={selected.image_urls?.length ?? 0}
              homeStatus={homeStatus} setHomeStatus={setHomeStatus}
            />
            <button
              type="submit" disabled={saving}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold p-4 rounded-2xl text-sm shadow-[0_6px_16px_rgba(37,99,235,0.2)] active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {saving ? '⏳ กำลังบันทึก...' : '✅ ยืนยันตัวตนและส่งข้อมูล'}
            </button>
            <button type="button" onClick={() => setStep(reports.length > 1 ? 'select' : 'lookup')} className="w-full text-xs font-bold text-slate-400">
              ← ย้อนกลับ
            </button>
          </form>
        )}

        {/* STEP 3b: ฟอร์มแจ้งความเสียหายใหม่ทั้งหมด + ยืนยันตัวตนในขั้นตอนเดียว */}
        {step === 'create' && (
          <form onSubmit={handleCreate} className="space-y-4 text-left">
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3 text-xs text-blue-700 font-bold leading-relaxed">
              📝 ยังไม่พบข้อมูลการแจ้งความเสียหายของคุณ กรอกแบบฟอร์มนี้เพื่อแจ้งใหม่ พร้อมยืนยันตัวตนในขั้นตอนเดียวกันเลย
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 pl-1">ชื่อ-นามสกุล</label>
              <input
                type="text" required value={newFullName} onChange={e => setNewFullName(e.target.value)}
                className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 pl-1">เบอร์โทร</label>
              <input
                type="tel" required value={newPhone} onChange={e => setNewPhone(e.target.value)}
                className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 gap-2">
              <input
                type="text" required placeholder="จังหวัด" value={newProvince} onChange={e => setNewProvince(e.target.value)}
                className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text" required placeholder="อำเภอ/เขต" value={newDistrict} onChange={e => setNewDistrict(e.target.value)}
                className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text" required placeholder="ตำบล/แขวง" value={newSubDistrict} onChange={e => setNewSubDistrict(e.target.value)}
                className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 pl-1">ที่อยู่เพิ่มเติม (บ้านเลขที่ / ถนน) — ไม่บังคับ</label>
              <textarea
                rows={2} value={newAddressDetails} onChange={e => setNewAddressDetails(e.target.value)}
                className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            <IdentityFields
              idCardNumber={idCardNumber} setIdCardNumber={setIdCardNumber}
              idCardExistingUrl={null}
              setIdCardFile={setIdCardFile}
              incidentDate={incidentDate} setIncidentDate={setIncidentDate}
              damageType={damageType} setDamageType={setDamageType}
              damageValue={damageValue} setDamageValue={setDamageValue}
              description={description} setDescription={setDescription}
              setDamagePhotos={setDamagePhotos}
              existingPhotoCount={0}
              homeStatus={homeStatus} setHomeStatus={setHomeStatus}
            />

            <button
              type="submit" disabled={saving}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold p-4 rounded-2xl text-sm shadow-[0_6px_16px_rgba(37,99,235,0.2)] active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {saving ? '⏳ กำลังบันทึก...' : '✅ แจ้งความเสียหายและยืนยันตัวตน'}
            </button>
            <button type="button" onClick={() => setStep('lookup')} className="w-full text-xs font-bold text-slate-400">
              ← ย้อนกลับ
            </button>
          </form>
        )}

        {/* STEP 4: เสร็จสิ้น */}
        {step === 'done' && selected && (
          <div className="text-center space-y-4">
            <div className="text-4xl">✅</div>
            <div className="text-base font-bold text-slate-800">ยืนยันตัวตนเรียบร้อยแล้ว</div>
            <p className="text-xs text-slate-500 leading-relaxed">
              ข้อมูลของคุณถูกส่งเข้าสู่กระบวนการพิจารณาเยียวยาแล้ว เจ้าหน้าที่จะตรวจสอบและติดต่อกลับตามเบอร์โทรที่แจ้งไว้
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left text-xs text-slate-600 space-y-1">
              <div>ประเภทความเสียหาย: {DAMAGE_TYPE_LABEL[selected.damage_type ?? ''] ?? '-'}</div>
              <div>สถานะคำขอ: <span className="font-bold">{STATUS_LABEL[selected.status].text}</span></div>
            </div>
            <button onClick={resetAll} className="text-xs font-bold text-blue-600">
              ← กลับไปหน้าค้นหา
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ฟิลด์ยืนยันตัวตน + รายละเอียดความเสียหาย ใช้ร่วมกันทั้งเคส "ยืนยันของเดิม" และ "แจ้งใหม่" ──
function IdentityFields({
  idCardNumber, setIdCardNumber, idCardExistingUrl, setIdCardFile,
  incidentDate, setIncidentDate, damageType, setDamageType,
  damageValue, setDamageValue, description, setDescription,
  setDamagePhotos, existingPhotoCount, homeStatus, setHomeStatus,
}: {
  idCardNumber: string; setIdCardNumber: (v: string) => void;
  idCardExistingUrl?: string | null; setIdCardFile: (f: File | null) => void;
  incidentDate: string; setIncidentDate: (v: string) => void;
  damageType: string; setDamageType: (v: string) => void;
  damageValue: string; setDamageValue: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  setDamagePhotos: (files: File[]) => void; existingPhotoCount: number;
  homeStatus: string; setHomeStatus: (v: string) => void;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-slate-500 pl-1">เลขบัตรประชาชน (13 หลัก)</label>
        <input
          type="text" inputMode="numeric" maxLength={13} required
          value={idCardNumber} onChange={e => setIdCardNumber(e.target.value.replace(/\D/g, ''))}
          className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-bold text-slate-500 pl-1">
          รูปบัตรประชาชน {idCardExistingUrl && '(มีอยู่แล้ว — อัปโหลดใหม่เพื่อแทนที่)'}
        </label>
        <input
          type="file" accept="image/*" capture="environment"
          onChange={e => setIdCardFile(e.target.files?.[0] ?? null)}
          className="w-full text-xs file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-blue-50 file:text-blue-600 file:font-bold"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-bold text-slate-500 pl-1">วันที่เกิดความเสียหาย</label>
        <input
          type="date" required value={incidentDate}
          max={new Date().toISOString().slice(0, 10)}
          onChange={e => setIncidentDate(e.target.value)}
          className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-bold text-slate-500 pl-1">ประเภทความเสียหาย</label>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(DAMAGE_TYPE_LABEL).map(([key, label]) => (
            <button
              key={key} type="button"
              onClick={() => setDamageType(key)}
              className={`p-3 rounded-xl text-xs font-bold border transition-all ${
                damageType === key ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-bold text-slate-500 pl-1">มูลค่าความเสียหายโดยประมาณ (บาท) — ไม่บังคับ</label>
        <input
          type="number" min={0} value={damageValue} onChange={e => setDamageValue(e.target.value)}
          placeholder="เช่น 15000"
          className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-bold text-slate-500 pl-1">รายละเอียดความเสียหาย</label>
        <textarea
          rows={3} value={description} onChange={e => setDescription(e.target.value)}
          placeholder="อธิบายความเสียหายที่เกิดขึ้น เช่น ผนังบ้านทรุด ของใช้ในบ้านเสียหาย ฯลฯ"
          className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-bold text-slate-500 pl-1">รูปภาพความเสียหาย (เลือกได้หลายรูป)</label>
        <input
          type="file" accept="image/*" multiple capture="environment"
          onChange={e => setDamagePhotos(Array.from(e.target.files ?? []))}
          className="w-full text-xs file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-blue-50 file:text-blue-600 file:font-bold"
        />
        {existingPhotoCount > 0 && (
          <p className="text-[11px] text-slate-400">มีรูปแนบอยู่แล้ว {existingPhotoCount} รูป</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-bold text-slate-500 pl-1">ตอนนี้กลับเข้าบ้านได้หรือยัง?</label>
        <div className="grid grid-cols-1 gap-2">
          {Object.entries(HOME_STATUS_LABEL).map(([key, label]) => (
            <button
              key={key} type="button"
              onClick={() => setHomeStatus(key)}
              className={`p-3 rounded-xl text-xs font-bold border text-left transition-all ${
                homeStatus === key ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
