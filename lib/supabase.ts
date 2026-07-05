import { createClient } from '@supabase/supabase-js';

// ใช้ค่าว่างเป็น Default ถ้าหาตัวแปรไม่เจอ เพื่อไม่ให้ Build พัง
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

export const supabase = createClient(supabaseUrl, supabaseKey);