# yt-factory

สายการผลิตคลิป YouTube ด้วย AI สำหรับตลาดไทย — โครงเริ่มต้น

บริบทถาวรและกติกาที่ห้ามละเมิดอยู่ใน [CLAUDE.md](./CLAUDE.md) อ่านก่อนแก้โค้ดทุกครั้ง

## เริ่มใช้งาน

```bash
pnpm install
cp .env.example .env.local        # เติมค่า Supabase / Anthropic

supabase link --project-ref <ref>
supabase db push                  # apply migration ทั้งหมด
pnpm db:types                     # ทับ src/lib/database.types.ts ด้วยของจริง

pnpm dev                          # Next.js
pnpm worker                       # worker คิวงาน (ต้องรันคู่กัน)
```

> `src/lib/database.types.ts` ตอนนี้เขียนมือไว้ให้ typecheck ผ่านตั้งแต่ยังไม่ได้ลิงก์ Supabase
> ให้ทับด้วยผลของ `pnpm db:types` แล้ว commit ไปด้วย

## โครงไฟล์

```
supabase/migrations/     0001 org+RLS · 0002 content · 0003 jobs · 0004 credits+quota
src/lib/originality.ts   Originality Guard (เกณฑ์กันโดนตัดรายได้)
src/lib/jobs.ts          enqueue / claim / complete / defer
src/lib/credits.ts       ตัดและคืนเครดิตผ่าน RPC เท่านั้น
src/lib/quota.ts         จองโควตา YouTube ก่อนยิง API
src/lib/anthropic.ts     เขียนสคริปต์ด้วย Claude
src/lib/supabase/        client (browser) · server (session + service role)
src/app/api/             scripts/generate · videos/render (ด่าน originality → 409)
worker/                  ลูปดึงงาน + handler รายชนิด
```

## ที่ต้องรู้ก่อนแก้

**RLS** — ทุกตารางมี `org_id` และเปิด RLS แล้ว policy เรียกผ่าน `is_org_member()` /
`has_org_role()` ซึ่งเป็น `security definer` จึงไม่วน RLS กลับมาที่ `org_members`

**เครดิต** — `organizations.credits` มี trigger กันการ `update` ตรง ๆ แม้เป็น owner หรือ
service role ทางเดียวที่แก้ได้คือ rpc `consume_credits` / `grant_credits`

**โควตา** — `reserve_quota()` ล็อกแถวก่อนบวก จึงกันสอง worker จองพร้อมกันจนเกินเพดาน
นับวันตามเวลาแปซิฟิกเพราะ YouTube รีเซ็ตโควตาเที่ยงคืนโซนนั้น โควตาเต็ม = `defer_job`
ไปรอบถัดไป ไม่ใช่ retry

**คิวงาน** — handler ทุกตัว idempotent (เช็คผลลัพธ์ก่อนทำ) เพราะ retry ได้ถึง 3 ครั้ง
worker ปิดงานด้วย `complete_job` เสมอ แม้ handler จะ throw

## สถานะงานค้าง

| # | งาน | สถานะ |
|---|---|---|
| 1 | OAuth flow YouTube + refresh token ใน Vault | ยังไม่ทำ — `channels.oauth_secret_id` เว้นช่องไว้แล้ว |
| 2 | `video_render` handler จริง (ffmpeg หรือ render service) | ยังไม่ทำ — handler โยน error พร้อมชี้ทางเลือก |
| 3 | คืนเครดิตเมื่อ job สถานะ `dead` | **ทำแล้ว** — `worker/index.ts` เรียก `grant_credits` (กันคืนซ้ำด้วย `ref_id`) |
| 4 | `metrics_sync` ดึง CTR / AVD / RPM | ยังไม่ทำ — รอข้อ 1 |
| 5 | Stripe webhook เติมเครดิต | ยังไม่ทำ — `grant_credits` พร้อมใช้แล้ว |
| 6 | Realtime subscription บน `jobs` | ยังไม่ทำ — หน้าแรกยังเป็น server render |
