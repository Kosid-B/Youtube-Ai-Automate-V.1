# CLAUDE.md

บริบทถาวรของโปรเจค yt-factory — อ่านไฟล์นี้ก่อนแก้โค้ดทุกครั้ง

## โปรเจคนี้คืออะไร

SaaS สายการผลิตคลิป YouTube ด้วย AI สำหรับตลาดไทย ผู้ใช้เป็นเจ้าของช่องที่ไม่ออกกล้อง
Stack: Next.js 15 App Router · Supabase (Postgres + RLS + Storage) · Anthropic API · YouTube Data API v3
Deploy: Next.js บน Vercel, worker แยกบน Railway/Fly (render กินเวลาเกิน timeout ของ serverless)

จุดขายไม่ใช่ "AI เขียนสคริปต์" แต่คือสายการผลิตที่ไม่พังตอนสเกล ถ้าฟีเจอร์ไหนไม่ช่วยเรื่อง
ความซ้ำของเนื้อหา โควตา API หรือคิวงานค้าง ให้ตั้งคำถามก่อนว่าจำเป็นจริงไหม

## ภาษา

- ผู้ใช้สื่อสารภาษาไทย ตอบภาษาไทย
- comment ในโค้ดและ UI string เป็นภาษาไทย
- ชื่อตัวแปร ฟังก์ชัน ตาราง คอลัมน์ เป็นภาษาอังกฤษเสมอ
- commit message ภาษาอังกฤษ

## กติกาที่ห้ามละเมิด

### 1. RLS
- ทุกตารางที่มีข้อมูลผู้ใช้ต้องมี `org_id` และเปิด RLS
- policy เรียกผ่าน `is_org_member(org_id)` หรือ `has_org_role(org_id, roles[])` เท่านั้น
  ห้ามเขียน subquery ไปที่ `org_members` ตรง ๆ ใน policy เพราะจะเกิด RLS เรียกซ้ำตัวเอง
- helper function ทุกตัวต้องเป็น `security definer` + `set search_path = public`
- ห่อ `auth.uid()` ด้วย `(select auth.uid())` เสมอ ไม่งั้น planner เรียกซ้ำทุกแถว
- เพิ่มตารางใหม่ = ต้องเขียน policy ในคอมมิตเดียวกัน ห้ามค้างไว้ทีหลัง

### 2. service role key
- `createServiceClient()` ข้าม RLS ทั้งหมด ใช้ได้เฉพาะใน `worker/` และ route handler ฝั่ง server
- ห้าม import `@/lib/supabase/server` จากไฟล์ที่มี `"use client"`
  (ไฟล์นั้น import `server-only` ไว้ ถ้าเผลอ import จาก client build จะพังทันที)
- ตรวจสิทธิ์ผู้ใช้ด้วย `createClient()` (ผูก session) ก่อนเสมอ แล้วค่อยใช้ service client ทำงานจริง
  ดูตัวอย่างที่ `src/app/api/scripts/generate/route.ts`
- `worker/` ใช้ `createWorkerClient()` ใน `worker/supabase.ts` แทน เพราะ `server-only` รันนอก Next ไม่ได้

### 3. Originality Guard
- ทุกเส้นทางที่นำสคริปต์ไป render หรืออัป ต้องผ่าน originality check ก่อน
  (`src/app/api/videos/render/route.ts` และ `worker/handlers/youtube-upload.ts`)
- verdict `block` = หยุดที่ API layer ตอบ 409 ห้ามมี flag ให้ผู้ใช้กดข้าม
- เกณฑ์อยู่ที่ `src/lib/originality.ts` (similarity ≥ 0.4 หรือ checklist ผ่าน < 3/5 = block)
  แก้เกณฑ์ได้ แต่ต้องคุยกับเจ้าของโปรเจคก่อน เพราะเป็นตัวกันช่องโดนตัดรายได้
- similarity ใช้ Jaccard บน character 5-gram ไม่ใช่ระดับคำ เพราะภาษาไทยไม่เว้นวรรคระหว่างคำ
- เหตุผล: นโยบาย Inauthentic Content ของ YouTube (ก.ค. 2025)

### 4. โควตา YouTube API
- โควตา 10,000 units/วัน/project · `videos.insert` = 1,600 units → ~6 คลิป/project/วัน
- ต้องเรียก `reserveQuota()` ก่อนยิง API จริงทุกครั้ง ห้ามยิงแล้วค่อยนับ
- นับวันตามเวลาแปซิฟิก (`quota_day()`) เพราะ YouTube รีเซ็ตโควตาเที่ยงคืนโซนนั้น
- โควตาเต็ม = เลื่อน job ไปวันถัดไปด้วย `defer_job` ห้าม retry ทันที
  (จะเผาโควตา project อื่นเปล่า ๆ) · `defer_job` คืน attempt ให้ด้วย ไม่นับเป็นความล้มเหลว
- ถ้าจองโควตาแล้วยิงไม่ถึง Google ให้ `releaseQuota()` คืน

### 5. เครดิต
- ตัดเครดิตด้วย RPC `consume_credits` เท่านั้น ห้าม `update organizations set credits = ...` ตรง ๆ
  (มี trigger `organizations_guard_credits` ปฏิเสธการแก้ที่ไม่ได้มาทาง RPC)
- ตัดตอนเข้าคิว ไม่ใช่ตอนงานเสร็จ เพื่อกันการยิงซ้ำ (`enqueue_job` ทำในทรานแซกชันเดียวกัน)
- งานล้มเหลวถาวร (`dead`) คืนเครดิตผ่าน `grant_credits` ใน `worker/index.ts`
  กันคืนซ้ำด้วย `ref_id` = job id ฝั่งฐานข้อมูล

### 6. คิวงาน
- worker ดึงงานผ่าน `claim_job` เท่านั้น (ใช้ `FOR UPDATE SKIP LOCKED`)
- handler ทุกตัวต้อง idempotent เพราะ retry ได้ถึง 3 ครั้ง
- จบงานด้วย `complete_job` เสมอ แม้ throw — ไม่งั้นงานค้างสถานะ `claimed` ตลอดไป
- retry ใช้ backoff แบบทวีคูณ (2^attempts นาที) ครบ `max_attempts` แล้วเป็น `dead`

## คำสั่งที่ใช้บ่อย

```bash
pnpm dev                 # Next.js
pnpm worker              # worker คิวงาน (ต้องรันคู่กัน)
supabase db push         # apply migration
pnpm db:types            # regen database.types.ts — รันทุกครั้งหลังแก้ schema
supabase db reset        # ล้าง local db แล้ว apply ใหม่ทั้งหมด
pnpm typecheck           # tsc --noEmit
```

## แนวทางแก้ schema

- แก้ schema = สร้าง migration ใหม่เสมอ ห้ามแก้ไฟล์ migration เดิมที่ push ไปแล้ว
- ตั้งชื่อ `YYYYMMDDHHMMSS_คำอธิบายสั้น.sql`
- หลัง push ต้องรัน `pnpm db:types` แล้ว commit `database.types.ts` ไปด้วย
- `src/lib/database.types.ts` ตอนนี้เป็นฉบับเขียนมือ ให้ทับด้วยของจริงเมื่อลิงก์ Supabase ได้แล้ว

## งานค้าง (เรียงตามลำดับความสำคัญ)

1. OAuth flow YouTube + เก็บ refresh token ใน Supabase Vault
   (schema เว้นช่อง `channels.oauth_secret_id` ไว้แล้ว ห้ามเก็บ token เป็น plaintext)
   `getChannelAccessToken()` ใน `worker/handlers/youtube-upload.ts` รอตรงนี้อยู่
2. `video_render` handler จริง — ffmpeg บน worker หรือเรียก render service ภายนอก
3. `metrics_sync` ดึง CTR / AVD / RPM จาก YouTube Analytics API ลง `video_metrics` (รอข้อ 1)
4. Stripe webhook → เติม `organizations.credits` ผ่าน `grant_credits` + บันทึก `credit_ledger`
5. Realtime subscription บน `jobs` ให้บอร์ด dashboard ขยับเอง
6. หน้า UI สำหรับติ๊ก checklist ความเป็นต้นฉบับก่อนสั่ง render
   (ตอนนี้ API รับ `checklist` มาแล้วแต่ยังไม่มีหน้าจอให้ติ๊ก)

## สไตล์ UI

- dark เป็นค่าเริ่มต้น token อยู่ใน `src/app/globals.css` (`@theme`)
- signal (เหลืองส้ม) = กำลังผลิต · live (เขียวมิ้นต์) = เผยแพร่แล้ว · block (แดง) = ถูกบล็อก/strike
  ห้ามใช้สีทั้งสามนี้เพื่อการตกแต่ง ใช้สื่อสถานะเท่านั้น
- สถานะที่ไม่มีอะไรให้ทำใช้สีเทา (`quiet`) ไม่ใช่สีสถานะ — ดูเหตุผลที่ Von Restorff ข้างล่าง
- ฟอนต์ไทย IBM Plex Sans Thai · ตัวเลขและโค้ดใช้ JetBrains Mono
- เขียน copy จากมุมผู้ใช้ ไม่ใช่มุมระบบ — "ตั้งเวลาเผยแพร่" ไม่ใช่ "สร้าง scheduled job"

## หลักการออกแบบ (Laws of UX)

ออกแบบหน้าจอด้วยกฎเหล่านี้ ไม่ใช่ด้วยความรู้สึก เวลารีวิว UI ให้ถามว่าข้อไหนถูกละเมิด
กฎแต่ละข้อด้านล่างมีที่ใช้จริงในโค้ดแล้ว อย่าเพิ่มกฎใหม่เข้ามาถ้าไม่ได้ใช้จริง

| กฎ | แปลเป็นข้อปฏิบัติในโปรเจคนี้ | ที่ใช้อยู่ |
|---|---|---|
| **Tesler's Law** | ความซับซ้อนที่ตัดออกไม่ได้ ต้องอยู่ฝั่งระบบ ไม่ใช่ฝั่งผู้ใช้ · ผู้ใช้ไม่ต้องรู้ว่า `dead` ต่างจาก `failed` ยังไง หรือ `attempts` คือเลขอะไร | `src/lib/pipeline.ts` แปลสถานะดิบเป็นประโยคเดียวที่คนอ่านรู้เรื่อง |
| **Von Restorff Effect** | ถ้าทุกอย่างมีสี จะไม่มีอะไรเด่น · สงวนสีสถานะไว้ให้สิ่งที่มีความหมายจริง ที่เหลือเป็นเทา | `components/status-pill.tsx` โทน `quiet` |
| **Serial Position Effect** | คนจำหัวกับท้ายรายการได้ดีสุด · ของที่ต้องลงมือทำไว้บนสุด ผลงานที่เสร็จแล้วไว้ล่างสุด | ลำดับหมวดในหน้าแรก |
| **Miller's Law** | ตัดรายการที่ 7 แล้วบอกว่าเหลืออีกเท่าไร อย่าเทหางว่าว | `MAX_PER_GROUP` |
| **Law of Common Region / Proximity** | ของพวกเดียวกันอยู่ในกรอบเดียวกันและชิดกัน · ระยะห่างสื่อความสัมพันธ์ได้ดีกว่าเส้นและหัวข้อ | `<Section>` |
| **Goal-Gradient Effect** | บอกว่าอยู่ขั้นไหนจาก 4 ขั้น ไม่ใช่บอกแค่ชื่อสถานะ · คนเร่งเข้าหาเป้าเมื่อเห็นว่าใกล้ถึง | `components/progress-bar.tsx` |
| **Zeigarnik Effect** | งานค้างจะค้างในหัวคนอยู่แล้ว บอกจำนวนไปเลยว่าค้างกี่ชิ้น อย่าให้ต้องเดา | บรรทัดสรุปใต้หัวข้อหน้าแรก |
| **Doherty Threshold** | ระบบตอบช้ากว่า ~400ms ความสนใจหลุด · งานที่กินเวลาเป็นนาที ต้องทำให้หน้าจอขยับเองแทนการให้ผู้ใช้กดรีเฟรช | `components/auto-refresh.tsx` (หยุดโพลเมื่อสลับแท็บ) |
| **Selective Attention** | มีบรรทัดเดียวที่ตอบว่า "ตอนนี้เป็นยังไง" ก่อนผู้ใช้จะเริ่มไล่อ่านรายการ | บรรทัดสรุปหน้าแรก |
| **Postel's Law** | ใจกว้างกับ input และสภาพที่ยังไม่พร้อม · empty state ต้องบอกว่าทำอะไรต่อ ไม่ใช่บอกแค่ว่า "ไม่มีข้อมูล" | หน้าตอนยังไม่ตั้งค่า / ยังไม่ล็อกอิน / รายการว่าง |
| **Jakob's Law** | ผู้ใช้ใช้เว็บอื่นมากกว่าเว็บเรา · ใช้รูปแบบที่คุ้นเคย อย่าประดิษฐ์ pattern ใหม่โดยไม่จำเป็น | ป้ายสถานะซ้าย–ชื่อเรื่องขวา, แถบความคืบหน้าแนวนอน |
| **Hick's Law** | หนึ่งหน้าจอมีปุ่มหลักได้ปุ่มเดียว · ตัวเลือกยิ่งเยอะ ยิ่งตัดสินใจช้า | ยังไม่มีปุ่มในหน้าแรก — เพิ่มได้ทีละปุ่มเมื่อมีหน้าปลายทางจริง |
| **Fitts's Law** | ปุ่มหลักต้องใหญ่พอและอยู่ใกล้มือ · บนมือถือให้เต็มความกว้าง | ใช้เมื่อเริ่มมีปุ่ม |
| **Aesthetic-Usability Effect** | หน้าตาที่ดูดีทำให้คนอดทนกับข้อบกพร่องมากขึ้น แต่มันกลบปัญหา usability ในการเทสต์ด้วย · อย่าใช้ความสวยแทนการแก้ปัญหาจริง | — |

ข้อห้ามที่มาจากกฎพวกนี้:
- ห้ามใส่ปุ่มที่กดแล้วไม่มีอะไรเกิดขึ้น หรือลิงก์ไปหน้าที่ยังไม่มี (Jakob's Law: ผิดความคาดหวังที่คนมีติดตัวมา)
- ห้ามโชว์ศัพท์ระบบใน UI: job, queue, RLS, quota units, attempts, dead
- ห้ามแสดงงานในคิวกับคลิปเป็นสองรายการซ้อนกัน ถ้ามันคือของสิ่งเดียวกันในสายตาผู้ใช้
