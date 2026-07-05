// จัดการ "เซสชัน" ของผู้ประสบภัย (ไม่ต้อง login)
// หลักการ: เก็บ id ของ sos_reports ที่เพิ่งสร้างไว้ที่เครื่อง (localStorage)
// แล้วใช้ id นี้เป็นกุญแจเชื่อมไปยังหน้า "ฉัน" และหน้ายื่นเยียวยาในภายหลัง

const SOS_REPORT_ID_KEY = 'nexus_sos_report_id';
const PHONE_KEY = 'nexus_sos_phone';

export function saveSosSession(sosReportId: string, phone?: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SOS_REPORT_ID_KEY, sosReportId);
  if (phone) window.localStorage.setItem(PHONE_KEY, phone);
}

export function getSosReportId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(SOS_REPORT_ID_KEY);
}

export function getSavedPhone(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(PHONE_KEY);
}

export function clearSosSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SOS_REPORT_ID_KEY);
  window.localStorage.removeItem(PHONE_KEY);
}