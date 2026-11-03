# คู่มือการติดตั้งและพัฒนาระบบ Nexus Rescue

## 1. วัตถุประสงค์

คู่มือนี้อธิบายเครื่องมือ ขั้นตอนติดตั้ง การตั้งค่า และวิธีตรวจสอบระบบ Nexus Rescue ในสภาพแวดล้อมพัฒนาบน Windows โดยเลือกเชื่อมต่อได้ทั้ง Supabase Local หรือ Supabase ที่โฮสต์ไว้

> **สถานะความพร้อม:** โค้ดแอปทำงานบนเครื่องผู้พัฒนาได้ทั้งสองแบบ แต่ฐานข้อมูล Local ที่สร้างใหม่ยังไม่มี schema ตั้งต้น เนื่องจาก migrations ที่มีอยู่เป็น migration ต่อจาก schema เดิม ส่วนการใช้ Supabase ที่โฮสต์ไว้ทำได้เฉพาะเมื่อผู้ดูแลจัดเตรียม URL/keys และฐานข้อมูลนั้นมี schema ที่เข้ากันกับโค้ดแล้ว โปรดอ่านหัวข้อ 6 ก่อนทดสอบฟังก์ชันที่ใช้ฐานข้อมูล

## 2. เทคโนโลยีและเครื่องมือ

- Windows 10/11 และ PowerShell
- Git
- Node.js 20.9 ขึ้นไป และ npm
- Docker Desktop ซึ่งเปิด Docker Engine แล้ว
- Supabase CLI ซึ่งติดตั้งเป็น dependency ในโปรเจกต์และเรียกผ่าน npm scripts
- เว็บเบราว์เซอร์สมัยใหม่

โครงการล็อกเวอร์ชัน dependencies ไว้ใน `package-lock.json` จึงใช้ `npm ci` เพื่อติดตั้งตาม lockfile ได้ Next.js เวอร์ชันที่ระบุใน `package.json` ต้องการ Node.js อย่างน้อย 20.9

## 3. ดาวน์โหลดโค้ดและติดตั้ง dependencies

เปิด PowerShell แล้วรัน:

```powershell
git clone https://github.com/KhunCher-chareeharnkl/nexus-rescue_v.2.git
Set-Location nexus-rescue_v.2
npm ci
```

ตรวจเวอร์ชันเครื่องมือ:

```powershell
node --version
npm --version
```

Node.js ต้องเป็นเวอร์ชัน 20.9 ขึ้นไป

## 4. เลือกฐานข้อมูลและตั้งค่า environment

แอป Next.js ยังคงรันบนเครื่องผู้พัฒนาด้วย `npm run dev` ทั้งสองกรณี คำว่า **Local** ในคู่มือนี้หมายถึงบริการฐานข้อมูล Supabase ที่รันบนเครื่องผ่าน Docker ไม่ได้หมายถึงต้องใช้ฐานข้อมูล Local เท่านั้น

เลือกหนึ่งวิธีต่อไปนี้:

- **Supabase Local (แนะนำสำหรับพัฒนา/ทดลอง):** ฐานข้อมูลแยกจากระบบออนไลน์และใช้ข้อมูลทดสอบ แต่ต้องเปิด Docker และเตรียม schema ตั้งต้นตามข้อจำกัดในหัวข้อ 6
- **Supabase hosted:** สะดวกเมื่อทีมมีโปรเจกต์ออนไลน์ที่เตรียมไว้แล้ว ไม่ต้องเปิด Docker แต่ต้องได้รับอนุญาตใช้ URL/keys และข้อมูลที่เขียนจะไปยังฐานข้อมูลออนไลน์นั้น

ทั้งสองวิธีใช้ไฟล์ `.env.development.local` สำหรับการรัน development ห้าม commit ไฟล์นี้

### 4.1 ตั้งค่า Supabase Local

1. เปิด Docker Desktop และรอจน Docker Engine ทำงาน
2. จากโฟลเดอร์รากของโปรเจกต์ เริ่มบริการ Supabase Local:

   ```powershell
   npm run supabase:start
   ```

3. แสดง URL และ keys ของบริการ Local:

   ```powershell
   npm run supabase:status
   ```

4. สร้างไฟล์ environment สำหรับ development:

   ```powershell
   Copy-Item .env.development.local.example .env.development.local
   notepad .env.development.local
   ```

5. ใช้ URL และ keys ที่แสดงจาก `supabase:status` แทนค่าตัวอย่างในไฟล์:

   | ตัวแปร | ค่าที่ต้องกำหนด |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | URL ของ Supabase Local โดยปกติคือ `http://127.0.0.1:54321` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key ของ Supabase Local |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key ของ Supabase Local |
   | `NEXT_PUBLIC_SITE_URL` | URL ของแอป โดยปกติคือ `http://localhost:3000` |

   ใช้ keys จาก Local เท่านั้นเมื่อเลือกวิธีนี้ `SUPABASE_SERVICE_ROLE_KEY` เป็น secret สำหรับฝั่ง server ห้ามเปิดเผยใน browser, prompt, ภาพหน้าจอ หรือเอกสารที่เผยแพร่

### 4.2 ตั้งค่า Supabase hosted

ใช้วิธีนี้เฉพาะเมื่อเจ้าของ/ผู้ดูแลโปรเจกต์อนุญาตให้เชื่อมต่อฐานข้อมูลออนไลน์สำหรับ development:

1. ขอ project URL และ anon/publishable key จากผู้ดูแลโปรเจกต์
2. ขอ service-role key ผ่านช่องทางลับที่ได้รับอนุญาต หากการทดสอบเส้นทางฝั่ง server ของระบบต้องใช้สิทธิ์นี้ ห้ามนำ service-role key ไปใส่ในโค้ดฝั่ง browser
3. สร้าง `.env.development.local` ตามขั้นตอนข้างต้น แล้วแทนค่าตัวอย่างด้วยค่า hosted:

   | ตัวแปร | ค่าที่ต้องกำหนด |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL ของ Supabase hosted |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key หรือ publishable key ที่ผู้ดูแลอนุญาต |
   | `SUPABASE_SERVICE_ROLE_KEY` | service-role key ที่ได้รับอนุญาต ใช้ฝั่ง server เท่านั้น |
   | `NEXT_PUBLIC_SITE_URL` | URL ของแอปที่ใช้ทดสอบ โดยปกติคือ `http://localhost:3000` |

   ค่าที่ขึ้นต้นด้วย `NEXT_PUBLIC_` จะถูกใช้ในฝั่ง browser ด้วย ห้ามใส่ secret ในตัวแปรกลุ่มนี้ ส่วน service-role key ต้องเก็บเป็นความลับและห้าม commit, ส่งใน prompt หรือเผยแพร่

4. ตรวจสอบกับผู้ดูแลว่า hosted project มี schema/migrations ที่เข้ากับโค้ดและอนุญาตให้ใช้กับ development แล้ว ห้ามรัน `supabase db reset` หรือแก้ schema hosted เอง

ไฟล์ `.env.development.local.example` ตั้ง URL เป็น Local เพื่อเป็นค่าเริ่มต้นที่แยกจากระบบออนไลน์ หากเลือก hosted ต้องเปลี่ยน URL และ keys ให้เป็นของ hosted เอง อย่าใช้ค่าตัวอย่างหรือผสม keys ระหว่าง Local กับ hosted

ไฟล์ `.env.development.local` ถูก Git ignore และ Next.js จะอ่านไฟล์ environment สำหรับโหมด development จากโฟลเดอร์รากของโปรเจกต์ ตรวจ URL และ keys ให้เป็นของ backend แบบเดียวกันทั้งหมดก่อนเริ่มแอป หากสลับระหว่าง Local กับ hosted ให้แก้ไฟล์นี้แล้วเริ่ม dev server ใหม่

## 5. เริ่มแอปและตรวจการเชื่อมต่อ

จากโฟลเดอร์รากของโปรเจกต์:

```powershell
npm run dev
```

เปิด:

- แอป: [http://localhost:3000](http://localhost:3000)
- Supabase Studio: [http://127.0.0.1:54323](http://127.0.0.1:54323) (เฉพาะเมื่อใช้ Supabase Local)
- Inbucket สำหรับอีเมลทดสอบ: [http://127.0.0.1:54324](http://127.0.0.1:54324) (เฉพาะเมื่อใช้ Supabase Local)

การเปิดหน้าเว็บได้ยืนยันเพียงว่า dev server เริ่มทำงาน ไม่ได้ยืนยันว่า schema ของแอปพร้อมใช้งาน หากฐานข้อมูลยังไม่มีตาราง แอปอาจแสดงหน้าเว็บได้แต่คำขอที่อ่านหรือเขียนข้อมูลจะไม่ทำงานครบ

หยุดแอปด้วย `Ctrl+C` ในหน้าต่างที่รัน `npm run dev` หากใช้ Supabase Local ให้หยุดบริการด้วย:

```powershell
npm run supabase:stop
```

## 6. ข้อจำกัดของ schema และ migrations

ไฟล์ใน `supabase/migrations` ที่มีอยู่เป็นการปรับ schema เดิม เช่น migration แรกอ้างถึงตาราง `public.sos_reports`, `public.assignments`, `public.profiles` และ `public.shelters` ที่ต้องมีอยู่ก่อน จึงไม่ใช่ชุดสร้างฐานข้อมูลว่างตั้งแต่ต้น

ผลที่ตามมาสำหรับ Supabase Local:

- `npm run supabase:start` เพียงอย่างเดียวไม่ได้สร้าง schema และข้อมูลแอปที่ migrations เหล่านี้ต้องใช้
- การสั่ง `supabase db reset` กับฐานข้อมูลว่างอาจหยุดที่ migration แรก
- ไม่ควรสร้าง baseline จากการคาดเดา และไม่ควรนำข้อมูลผู้ใช้จริงมาใส่เป็น seed
- อย่าชี้คำสั่ง reset หรือคำสั่ง migration ไปยัง Supabase hosted/production

ก่อนอ้างว่าติดตั้งระบบ Local ได้ครบ ต้องจัดเตรียมและทดสอบ baseline migration ที่สร้าง schema, enum, function/RPC, policy และ dependency ที่ migrations ปัจจุบันต้องใช้ จากนั้นจึงเพิ่ม seed สำหรับทดสอบที่ไม่มีข้อมูลส่วนบุคคล และยืนยันด้วยการ reset ฐานข้อมูล Local จากสภาพว่าง

สำหรับ Supabase hosted ผู้ดูแลต้องยืนยันว่า project มี schema และ migrations ที่เข้ากับ source code อยู่แล้ว ผู้พัฒนาที่เพียงต้องการรันแอปไม่ควรใช้ hosted project ว่าง และไม่ควรสั่ง reset หรือ migration กับ hosted/production เพื่อทดลอง

หากจะสร้าง baseline จากฐานข้อมูลเดิม ให้ใช้ schema-only ที่ผ่านการตรวจสอบและมีสิทธิ์ใช้งาน ห้ามส่ง service-role key, รหัสผ่าน, ข้อมูลผู้ใช้ หรือ dump ที่มีข้อมูลจริงเข้า prompt หรือ commit ใน repository การทำขั้นตอนนี้ยังไม่อยู่ในคู่มือฉบับที่ตรวจสอบแล้ว

**รายการที่ต้องขอจากผู้ดูแลฐานข้อมูล:** ไฟล์ SQL สำหรับสร้าง schema ตั้งต้นบน Supabase Local ที่มีเฉพาะโครงสร้างที่โครงการต้องใช้ เช่น ตาราง, enum/type, functions/RPC, triggers, indexes, constraints, RLS policies และ grants ที่เกี่ยวข้อง โดยไม่มี `INSERT`/ข้อมูลแถว, credentials, secrets หรือข้อมูลส่วนบุคคล ก่อนนำเข้า repository ต้องตรวจเนื้อหาไฟล์และทดสอบกับฐานข้อมูล Local ว่าง รวมทั้งยืนยันว่า migrations ปัจจุบันทำงานต่อจาก baseline ได้ตามลำดับ

## 7. คำสั่งตรวจสอบโค้ด

ตรวจรูปแบบและข้อผิดพลาดด้วย ESLint:

```powershell
npm run lint
```

สคริปต์ `npm run build` สร้าง production build แต่ไม่ใช่การทดสอบ schema หรือการเชื่อมต่อฐานข้อมูล และต้องจัด environment สำหรับ production/local build ให้ถูกต้องก่อนใช้:

```powershell
npm run build
```

บันทึกผลตรวจสอบพร้อมวันที่ ระบบปฏิบัติการ เวอร์ชัน Node.js/npm คำสั่งที่ใช้ และผลลัพธ์จริง ห้ามบันทึก keys หรือข้อมูลส่วนบุคคลในหลักฐานการทดสอบ

## 8. แนวทางพัฒนาระบบ

1. ตรวจโครงสร้างที่เกี่ยวข้องก่อนแก้ไข โดยหน้าและ API อยู่ภายใต้ `app/`, ส่วนประกอบ UI อยู่ใน `components/`, โค้ดที่ใช้ร่วมกันอยู่ใน `lib/` และ schema changes อยู่ใน `supabase/migrations/`
2. ทำการเปลี่ยนแปลงใน branch สำหรับงานนั้น และหลีกเลี่ยงการ hard-code credentials
3. เมื่อแก้ database ให้เพิ่ม migration ใหม่ตามลำดับ ห้ามแก้ migration เก่าที่ถูกใช้งานไปแล้วโดยไม่มีแผนรองรับฐานข้อมูลเดิม
4. รัน `npm run lint` และทดสอบเส้นทางการทำงานที่เปลี่ยนด้วยข้อมูลทดสอบใน Local
5. บันทึกสิ่งที่แก้ วิธีทดสอบ ผลลัพธ์ และข้อจำกัดที่ยังเหลือ

## 9. การบันทึก prompts สำหรับเล่มรายงาน

ให้แนบ prompts ที่ใช้จริงเป็นหลักฐาน ไม่แต่ง prompt ย้อนหลังให้เหมือนเป็นต้นฉบับ หาก prompt มี credentials, ข้อมูลส่วนบุคคล หรือข้อมูลอ่อนไหว ให้ตัดข้อมูลนั้นออกก่อนจัดทำเล่ม และระบุว่ามีการปกปิดข้อมูล

สำหรับแต่ละ prompt ให้บันทึก:

- วันที่และขั้นตอนการพัฒนาที่ใช้ prompt
- เครื่องมือ/โมเดลที่ใช้ หากทราบ
- prompt ฉบับที่ใช้จริง โดยลบข้อมูลอ่อนไหว
- ไฟล์หรือส่วนงานที่ได้จากผลลัพธ์
- การตรวจทานหรือแก้ไขโดยผู้พัฒนา
- คำสั่ง/กรณีทดสอบและผลที่ใช้ยืนยัน

Prompt ไม่ใช่หลักฐานว่าผลลัพธ์ถูกต้องด้วยตัวเอง ต้องแนบผลการตรวจสอบจริงแยกต่างหาก และห้ามใส่ keys หรือข้อมูลผู้ประสบภัยจริงลงใน prompt หรือเล่มรายงาน

## 10. ปัญหาที่พบบ่อย

| อาการ | วิธีตรวจสอบ |
|---|---|
| Supabase เริ่มไม่ได้และแจ้งเชื่อมต่อ Docker ไม่ได้ | เปิด Docker Desktop แล้วรอให้ Docker Engine พร้อม จากนั้นตรวจด้วย `npm run supabase:status` |
| แอปแจ้งให้กำหนด Supabase environment variables | ตรวจชื่อไฟล์ `.env.development.local` และค่าตัวแปรทั้งสี่ในหัวข้อ 4 แล้วเริ่ม dev server ใหม่ |
| เปิดหน้าเว็บได้แต่ข้อมูลไม่โหลด | ตรวจว่า Supabase Local ทำงานและ keys เป็นของ Local; จากนั้นตรวจข้อจำกัด schema ในหัวข้อ 6 |
| `supabase db reset` ล้มเหลวกับฐานข้อมูลใหม่ | ยังไม่มี baseline migration ที่รองรับฐานข้อมูลว่าง หยุดการ reset และอย่าชี้คำสั่งไปยังฐานข้อมูล hosted |
| พอร์ต 3000 หรือพอร์ต Supabase ถูกใช้งานอยู่ | ปิดบริการเดิมที่ใช้พอร์ต หรือจัดการพอร์ตตามการตั้งค่าใน `supabase/config.toml` ก่อนเริ่มใหม่ |
