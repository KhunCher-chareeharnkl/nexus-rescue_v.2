import { createClient } from '@supabase/supabase-js'; // เพิ่มบรรทัดนี้ครับ

// ในไฟล์ utils/supabase.ts ของคุณ
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// ตอนนี้ createClient จะใช้งานได้แล้ว
export const supabase = createClient(supabaseUrl, supabaseKey);