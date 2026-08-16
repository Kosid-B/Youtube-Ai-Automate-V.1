# ติดตั้ง yt-factory บน Windows (D:\Youtube Ai Automate)

โค้ดอยู่ในสาขา `claude/yt-factory-context-d4y1cq` ของ repo `Kosid-B/vite-react`
เอกสารนี้พาลงเครื่องตัวเองจนเรนเดอร์คลิปแรกได้

---

## 1. สิ่งที่ต้องมีก่อน

เปิด **PowerShell** (ไม่ต้อง Administrator ยกเว้นตอนลง winget package)

```powershell
node --version     # ต้อง 20 ขึ้นไป
git --version
```

ถ้ายังไม่มี:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

**pnpm** (โปรเจคนี้ใช้ pnpm ไม่ใช่ npm — มี `pnpm-lock.yaml` และ `pnpm-workspace.yaml`):

```powershell
npm install -g pnpm
pnpm --version
```

> ในเน็ตจะเจอวิธี `corepack enable` เป็นส่วนใหญ่ — ใช้ไม่ได้กับ Node 25 ขึ้นไป
> เพราะ Node เลิกแถม corepack มาให้ตั้งแต่รุ่น 25 (รุ่น 24 LTS ลงมายังมี)
> ลงผ่าน `npm install -g pnpm` ได้ผลเหมือนกันและใช้ได้กับ Node ทุกรุ่น

**ffmpeg** — หัวใจของการประกอบคลิป ไม่มีตัวนี้ worker รันไม่ได้:

```powershell
winget install Gyan.FFmpeg
```

ปิด PowerShell แล้วเปิดใหม่ (ให้ PATH อัปเดต) จากนั้นตรวจ:

```powershell
ffmpeg -version
```

ต้องขึ้นเวอร์ชัน **6.0 ขึ้นไป** และในบรรทัด `configuration:` ต้องมี `--enable-libass`
(libass = ตัววาดซับ ถ้าไม่มี ซับจะไม่ติดลงคลิป)

---

## 2. ดึงโค้ดลง D:\Youtube Ai Automate

```powershell
cd D:\
git clone -b claude/yt-factory-context-d4y1cq https://github.com/Kosid-B/vite-react.git "Youtube Ai Automate"
cd "D:\Youtube Ai Automate\yt-factory"
```

> repo นี้เก็บสองโปรเจครวมกัน — CEO AI Thailand อยู่ที่ราก ส่วน yt-factory อยู่ในโฟลเดอร์
> `yt-factory` **ทุกคำสั่งด้านล่างต้องรันใน `D:\Youtube Ai Automate\yt-factory`**
> อย่ารันที่รากโปรเจค เพราะที่รากใช้ npm คนละตัวจัดการ แล้วจะได้ lockfile ผิดตัว

ติดตั้ง dependency:

```powershell
pnpm install
```

---

## 3. ตั้งค่า .env.local

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

`.env.local` อยู่ใน `.gitignore` แล้ว — **ห้าม commit และห้ามวางคีย์ลงแชท**

ค่าที่ต้องเติมเพื่อให้เรนเดอร์คลิปได้:

| ตัวแปร | เอามาจากไหน |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ที่เดียวกัน (publishable key เป็น public โดยดีไซน์) |
| `SUPABASE_SERVICE_ROLE_KEY` | ที่เดียวกัน — **ข้าม RLS ทั้งหมด** ใช้เฉพาะฝั่ง server |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `GOOGLE_TTS_API_KEY` | Google Cloud → เปิด Text-to-Speech API แล้วสร้าง API key |
| `GOOGLE_TTS_VOICE` | **อย่าเดา** — ดูวิธีอ่านรายชื่อจริงในข้อ 4 |
| `PEXELS_API_KEY` | คีย์ที่เพิ่งได้มา |
| `SUBTITLE_FONT` | ใส่ `Leelawadee UI` (ดูข้อ 5) |

---

## 4. เลือกเสียงพากย์ไทย (อย่าเดาชื่อเสียง)

ชื่อเสียงของ Google เปลี่ยนตามรุ่นและตามภูมิภาค เดาแล้วจะได้ 400 จาก API
อ่านรายชื่อที่บัญชีคุณใช้ได้จริงก่อน:

```powershell
pnpm exec tsx --env-file-if-exists=.env.local -e "import('./src/lib/tts.ts').then(m => m.listThaiVoices()).then(v => console.table(v))"
```

เอาค่าในคอลัมน์ชื่อเสียงที่ขึ้นต้นด้วย `th-TH-Chirp3-HD-` ไปใส่ `GOOGLE_TTS_VOICE`

---

## 5. ฟอนต์ซับไทย

ค่าเริ่มต้นในโค้ดคือ `Loma` ซึ่งเป็นฟอนต์ฝั่ง Linux — Windows ไม่มี

ตั้งใน `.env.local`:

```
SUBTITLE_FONT=Leelawadee UI
```

(`Tahoma` ก็ใช้ได้ ทั้งคู่ติดมากับ Windows และมีอักษรไทยครบ)

**ทำไมต้องตั้งเอง ไม่ปล่อยให้ระบบจัดการ** — ผมทดสอบแล้วว่าตั้งชื่อฟอนต์ที่ไม่มีอยู่จริง
ffmpeg ไม่ฟ้อง error เลย (exit 0) และ libass จะไปหยิบฟอนต์อื่นที่มีอักษรไทยมาวาดแทนเงียบ ๆ
ผลคือคลิปยังอ่านออก แต่หน้าตาซับไม่ใช่ที่เลือกไว้ และไม่มีอะไรเตือน
เพราะฉะนั้นถ้าซับออกมาหน้าตาแปลก ให้สงสัยค่านี้เป็นอันดับแรก

---

## 6. เตรียมฐานข้อมูล

```powershell
pnpm dlx supabase login
pnpm dlx supabase link --project-ref <project-ref>
pnpm dlx supabase db push        # apply migration ทั้ง 7 ไฟล์
pnpm db:types                    # ทับ database.types.ts ด้วยของจริง
```

> `src/lib/database.types.ts` ตอนนี้เขียนมือไว้ให้ typecheck ผ่านก่อนลิงก์ Supabase
> หลัง `pnpm db:types` ให้ commit ไฟล์ที่ได้ไปด้วย
>
> ⚠️ ทุก row type ในไฟล์นั้นต้องเป็น `type` ไม่ใช่ `interface` — `interface` ไม่มี
> implicit index signature ทำให้ supabase-js มองสคีมาเป็น `never` แล้วพังทั้งโปรเจค

---

## 7. รัน

ต้องเปิด **สอง** หน้าต่าง PowerShell รันคู่กัน:

```powershell
# หน้าต่างที่ 1 — เว็บ
cd "D:\Youtube Ai Automate\yt-factory"
pnpm dev
```

```powershell
# หน้าต่างที่ 2 — worker คิวงาน (เขียนสคริปต์ / เรนเดอร์คลิป)
cd "D:\Youtube Ai Automate\yt-factory"
pnpm worker
```

เปิด http://localhost:3000

---

## 8. ตรวจว่าทุกอย่างพร้อม

```powershell
pnpm test        # 78 เทส
pnpm typecheck
pnpm lint
```

เทสชุด ffmpeg เรนเดอร์คลิปจริงและวัดความสว่างเพื่อยืนยันว่าซับติดลงภาพ

⚠️ **ต้องได้ 78 ผ่าน ไม่มี skip** ถ้าขึ้น `76 passed | 2 skipped` แปลว่าเรียก ffmpeg
บนเครื่องไม่ได้ สองตัวที่ข้ามคือชุดเรนเดอร์จริง — ผลรวมจะขึ้นเขียวทั้งที่ ffmpeg
ยังไม่เคยถูกเรียกเลย กลับไปทำข้อ 1 ให้เสร็จก่อน (ลง ffmpeg แล้วเปิด PowerShell ใหม่)

---

## เรื่องที่ยังไม่เสร็จ (ทำต่อได้จากตรงนี้)

- **เครดิตเริ่มต้น = 0** — องค์กรที่สร้างใหม่ยังไม่มีเครดิต ต้องเติมให้ตัวเองก่อนสั่งงานแรก
  ผ่าน RPC `grant_credits` เท่านั้น (ห้าม `update organizations set credits = ...`
  มี trigger กันไว้และจะโดนปฏิเสธ)
- **อัปขึ้น YouTube** — `getChannelAccessToken()` กับ `insertVideo()` ใน
  `worker/handlers/youtube-upload.ts` ยัง throw อยู่ รอทำ OAuth + เก็บ refresh token
  ลง Supabase Vault (**ห้ามเก็บ token เป็น plaintext**)
- **ปกคลิป (thumbnail)** ยังไม่ได้ทำ
- **metrics_sync** (CTR/AVD/RPM) รอ OAuth เหมือนกัน

---

## ปัญหาที่เจอบ่อยบน Windows

| อาการ | สาเหตุ |
|---|---|
| `ffmpeg : The term ... is not recognized` | ยังไม่ได้เปิด PowerShell ใหม่หลังลง winget |
| `pnpm : ... cannot be loaded because running scripts is disabled` | รัน `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `corepack : The term 'corepack' is not recognized` | Node 25+ ไม่มี corepack แล้ว — ใช้ `npm install -g pnpm` แทน (ข้อ 1) |
| ซับหน้าตาไม่เหมือนที่ตั้งไว้ | `SUBTITLE_FONT` (ดูข้อ 5) |
| งานค้างที่สถานะ `queued` ไม่ขยับ | ลืมรัน `pnpm worker` ในหน้าต่างที่สอง |
| ได้ lockfile แปลก ๆ โผล่ที่ราก repo | รัน pnpm ผิดโฟลเดอร์ — ต้องอยู่ใน `yt-factory` |
