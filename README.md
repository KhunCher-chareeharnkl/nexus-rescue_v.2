# Nexus Rescue

แอป Next.js สำหรับระบบประสานงานช่วยเหลือผู้ประสบภัย ใช้ Supabase เป็น backend

## Supabase Local Development

Supabase Local ใช้ Docker และแยกฐานข้อมูลออกจากโปรเจกต์ hosted เหมาะสำหรับพัฒนาและทดสอบโดยไม่แก้ข้อมูลจริง

1. ติดตั้งและเปิด Docker Desktop ให้ Docker engine ทำงาน
2. ติดตั้ง dependencies ของแอปด้วย `npm install`
3. เริ่ม Supabase Local:

```bash
npm run supabase:start
```

4. ดู URL และ API keys ของ Supabase Local:

```bash
npm run supabase:status
```

5. คัดลอก `.env.development.local.example` เป็น `.env.development.local` แล้วแทนค่า `NEXT_PUBLIC_SUPABASE_ANON_KEY` และ `SUPABASE_SERVICE_ROLE_KEY` ด้วย keys ที่แสดงจากคำสั่งก่อนหน้า ไฟล์นี้ถูก ignore โดย Git
6. เริ่มแอป:

```bash
npm run dev
```

เปิด [http://localhost:3000](http://localhost:3000) สำหรับแอป, [http://127.0.0.1:54323](http://127.0.0.1:54323) สำหรับ Supabase Studio และ [http://127.0.0.1:54324](http://127.0.0.1:54324) สำหรับกล่องอีเมลทดสอบ (Inbucket)

Next.js จะใช้ `.env.development.local` ก่อน `.env.local` ในโหมด development จึงใช้ Local ได้โดยไม่ต้องแก้หรือเขียนทับ credentials ของ hosted ใน `.env.local` ตรวจสอบให้แน่ใจว่า `.env.development.local` มีค่า Local เท่านั้น

หยุด Supabase Local เมื่อเลิกใช้งาน:

```bash
npm run supabase:stop
```

### ข้อควรรู้เรื่องฐานข้อมูล

ไฟล์ใน `supabase/migrations` ปัจจุบันเป็น migrations ที่ต่อจาก schema และ RPC ของฐานข้อมูลเดิม ไม่ใช่ชุดสร้าง schema ตั้งต้นสำหรับฐานข้อมูลว่าง ดังนั้นการเริ่ม Supabase Local อย่างเดียวจะยังไม่มีตาราง/ข้อมูลของแอป และการ `supabase db reset` บนฐานข้อมูลว่างอาจล้มเหลวตั้งแต่ migration แรก

ก่อน reset ฐานข้อมูล Local หรือใช้แอปกับข้อมูลจริงใน Local ต้องเพิ่มและตรวจสอบ baseline migration ของ schema เดิมก่อน การดึง schema จาก hosted ต้องใช้สิทธิ์ฐานข้อมูลของโปรเจกต์นั้น และควรเก็บเป็น schema-only (ไม่ดึงข้อมูลผู้ใช้หรือ secrets) ห้ามใช้ service-role key ในคำสั่งดึง schema และห้ามชี้คำสั่ง reset ไปยังฐานข้อมูล hosted การตั้งค่านี้ไม่ทำการเปลี่ยนแปลงใด ๆ กับ hosted Supabase

ฐานข้อมูล Local เป็นคนละชุดกับ hosted และไม่มีข้อมูลบัญชี/รหัสเข้าใช้งานของ hosted โดยอัตโนมัติ ให้ใช้เฉพาะข้อมูลทดสอบที่ไม่ใช่ข้อมูลส่วนบุคคลจริง

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
