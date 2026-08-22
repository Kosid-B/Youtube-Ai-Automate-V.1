/**
 * ตรวจว่าตั้งค่าครบและ "ใช้ได้จริง" ก่อนสั่งผลิตคลิปแรก
 *
 * ทำไมต้องมี: การตั้งค่าผิดในโปรเจคนี้ไม่ค่อยฟ้องตอนตั้ง มันไปฟ้องตอนกลางทาง —
 * service role key ว่างทำให้ worker เงียบ · URL ผิดทำให้แอปคุยกับตัวเอง ·
 * ชื่อฟอนต์ผิดทำให้ซับหน้าตาเพี้ยนโดย ffmpeg ไม่คืน error เลย
 * ไปเจอตอนเรนเดอร์ไป 20 นาทีแล้วแพงกว่าตรวจตรงนี้มาก
 *
 * กติกาสำคัญ: ตรวจให้ครบทุกข้อแล้วค่อยรายงานทีเดียว ห้ามหยุดที่ข้อแรกที่พัง
 * ไฟล์ตั้งค่าที่ผิดมักผิดหลายจุดพร้อมกัน หยุดทีละข้อ = ผู้ใช้ต้องวนแก้หลายรอบ
 *
 * ⚠️ ชื่อสคริปต์ห้ามเป็น "doctor" — pnpm มีคำสั่ง `pnpm doctor` ในตัวอยู่แล้ว
 * ซึ่งจะถูกเรียกแทนสคริปต์เราโดยไม่มีอะไรเตือน (เจอมาแล้ว) และผลลัพธ์ที่ขึ้น
 * ก็ดูเหมือนผ่านหมดเสียด้วย เพราะมันตรวจ pnpm ไม่ได้ตรวจการตั้งค่าของเรา
 */
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { loadEnv } from '../worker/env'

loadEnv()

const run = promisify(execFile)

type Status = 'ok' | 'fail' | 'warn' | 'skip'
type Result = { status: Status; detail: string; fix?: string }

const ICON: Record<Status, string> = { ok: '✅', fail: '❌', warn: '⚠️ ', skip: '➖' }

function ok(detail: string): Result {
  return { status: 'ok', detail }
}
function fail(detail: string, fix?: string): Result {
  return { status: 'fail', detail, fix }
}
function warn(detail: string, fix?: string): Result {
  return { status: 'warn', detail, fix }
}
function skip(detail: string): Result {
  return { status: 'skip', detail }
}

/** อ่าน payload ของ JWT โดยไม่ตรวจลายเซ็น — ใช้ดูว่าคีย์เป็นของ project ไหนและ role อะไร */
function jwtPayload(token: string): { ref?: string; role?: string } | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function projectRef(url: string): string | null {
  return /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)?.[1] ?? null
}

async function checkSupabaseUrl(): Promise<Result> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return fail('ไม่ได้ตั้ง', 'Supabase → Project Settings → API → Project URL')

  /**
   * จับกรณีที่เคยเกิดจริง: ใส่ localhost ไว้ แล้วแอปยิงหาตัวเอง
   * ไม่มีอะไรฟ้องจนกว่าจะกดอะไรสักอย่างแล้วได้ 404 ที่ไม่บอกสาเหตุ
   */
  if (!projectRef(url)) {
    return fail(`"${url}" ไม่ใช่ URL ของ Supabase`, 'ต้องเป็น https://<project-ref>.supabase.co')
  }

  const response = await fetch(`${url}/auth/v1/health`).catch(() => null)
  return response?.ok ? ok(url) : fail(`ต่อ ${url} ไม่ได้`, 'ตรวจว่า project ไม่ได้ถูก pause')
}

function checkAnonKey(): Result {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (!key) return fail('ไม่ได้ตั้ง')

  const payload = jwtPayload(key)
  if (!payload) return ok('รูปแบบใหม่ (ตรวจ ref ไม่ได้)')

  if (payload.role !== 'anon') {
    return fail(`คีย์นี้เป็น role "${payload.role}" ไม่ใช่ anon`, 'หยิบมาผิดช่อง')
  }

  const ref = projectRef(url)
  if (ref && payload.ref !== ref) {
    return fail(`คีย์เป็นของ project ${payload.ref} แต่ URL ชี้ ${ref}`, 'คนละ project กัน')
  }

  return ok(`project ${payload.ref}`)
}

async function checkServiceKey(): Promise<Result> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

  if (!key) {
    return fail('ไม่ได้ตั้ง — worker รันไม่ได้เลย', 'Project Settings → API → service_role')
  }

  /**
   * จับกรณีที่เคยเกิดจริง: ก๊อป anon key มาใส่ช่อง service_role
   * ทั้งสองเป็น JWT หน้าตาคล้ายกัน แต่ worker จะโดน RLS ปฏิเสธทุก query
   * โดย error ที่ได้ไม่ได้บอกว่าเป็นเพราะคีย์ผิดช่อง
   */
  const payload = jwtPayload(key)
  if (payload && payload.role !== 'service_role') {
    return fail(`คีย์นี้เป็น role "${payload.role}" ไม่ใช่ service_role`, 'หยิบมาผิดช่อง')
  }

  const ref = projectRef(url)
  if (payload && ref && payload.ref !== ref) {
    return fail(`คีย์เป็นของ project ${payload.ref} แต่ URL ชี้ ${ref}`)
  }

  // ยิงจริงหนึ่งครั้ง — ตาราง jobs เปิด RLS ไว้ ถ้าอ่านได้แปลว่าข้าม RLS ได้จริง
  const response = await fetch(`${url}/rest/v1/jobs?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  }).catch(() => null)

  if (!response) return fail('ต่อไม่ได้')
  if (!response.ok) return fail(`ใช้ไม่ได้ (${response.status})`, (await response.text()).slice(0, 120))

  return ok('ข้าม RLS ได้จริง')
}

/** คอลัมน์/ตารางที่เพิ่มมาล่าสุด — ไม่มี = ยังไม่ได้ db push */
async function checkMigrations(): Promise<Result> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key || !projectRef(url)) return skip('ต้องตั้ง Supabase ให้ผ่านก่อน')

  const probes: [string, string][] = [
    ['videos', 'render_total'],
    ['channels', 'script_style'],
    ['channels', 'image_source'],
  ]

  const missing: string[] = []

  for (const [table, column] of probes) {
    const response = await fetch(`${url}/rest/v1/${table}?select=${column}&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    }).catch(() => null)

    if (!response?.ok) missing.push(`${table}.${column}`)
  }

  return missing.length === 0
    ? ok('สคีมาตรงกับโค้ด')
    : fail(`ไม่มี ${missing.join(', ')}`, 'รัน: pnpm dlx supabase db push')
}

async function checkAnthropic(): Promise<Result> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return fail('ไม่ได้ตั้ง — เขียนสคริปต์ไม่ได้')

  // ขอโทเคนเดียว ถูกที่สุดเท่าที่จะยืนยันว่าคีย์ใช้ได้จริง
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  }).catch(() => null)

  if (!response) return fail('ต่อไม่ได้')
  if (response.status === 401) return fail('คีย์ไม่ถูกต้องหรือถูกเพิกถอนแล้ว')
  if (response.status === 400) return ok('คีย์ใช้ได้')
  if (!response.ok) return fail(`(${response.status}) ${(await response.text()).slice(0, 120)}`)

  return ok('คีย์ใช้ได้')
}

async function checkGoogleTts(): Promise<Result> {
  const key = process.env.GOOGLE_TTS_API_KEY
  const voice = process.env.GOOGLE_TTS_VOICE

  if (!key) return fail('ไม่ได้ตั้ง — พากย์เสียงไม่ได้')

  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/voices?languageCode=th-TH&key=${key}`,
  ).catch(() => null)

  if (!response) return fail('ต่อไม่ได้')
  if (response.status === 403) {
    return fail('คีย์ใช้ไม่ได้', 'ยังไม่ได้เปิด Text-to-Speech API หรือคีย์ถูกจำกัดไว้')
  }
  if (!response.ok) return fail(`(${response.status}) ${(await response.text()).slice(0, 120)}`)

  const body = (await response.json()) as { voices?: { name: string }[] }
  const names = (body.voices ?? []).map((v) => v.name)

  if (!voice) return warn(`คีย์ใช้ได้ (${names.length} เสียง) แต่ยังไม่ได้เลือกเสียง`, 'pnpm voices')

  /**
   * ตรวจว่าชื่อเสียง "มีอยู่จริง" ไม่ใช่แค่มีคีย์
   * เดาชื่อเสียงแล้วจะได้ 400 ตอนพากย์ ซึ่งเกิดหลังจากเขียนสคริปต์เสร็จแล้ว
   * (เสียค่าโมเดลไปแล้ว) และ error ของ Google ไม่ได้บอกว่าชื่อไหนใช้ได้บ้าง
   */
  return names.includes(voice)
    ? ok(`${voice}`)
    : fail(`ไม่มีเสียงชื่อ "${voice}" ในบัญชีนี้`, 'ดูชื่อที่ใช้ได้จริง: pnpm voices')
}

async function checkPexels(): Promise<Result> {
  const key = process.env.PEXELS_API_KEY
  if (!key) return warn('ไม่ได้ตั้ง', 'ช่องที่ใช้ภาพสต็อกจะหาภาพไม่ได้')

  const response = await fetch('https://api.pexels.com/v1/search?query=office&per_page=1', {
    headers: { Authorization: key },
  }).catch(() => null)

  if (!response) return fail('ต่อไม่ได้')
  if (!response.ok) return fail(`ใช้ไม่ได้ (${response.status})`)

  const left = response.headers.get('X-Ratelimit-Remaining')
  return ok(left ? `เหลือโควตา ${left} คำขอ` : 'คีย์ใช้ได้')
}

async function checkOpenAi(): Promise<Result> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return skip('ไม่ได้ตั้ง — ใช้ภาพสต็อกอย่างเดียว')

  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  }).catch(() => null)

  if (!response) return fail('ต่อไม่ได้')
  if (response.status === 401) return fail('คีย์ไม่ถูกต้องหรือถูกเพิกถอนแล้ว')
  if (!response.ok) return fail(`(${response.status}) ${(await response.text()).slice(0, 120)}`)

  const body = (await response.json()) as { data?: { id: string }[] }
  const ids = new Set((body.data ?? []).map((m) => m.id))

  /**
   * มีคีย์ไม่ได้แปลว่าเรียกโมเดลนั้นได้ — บัญชีที่ยังไม่ได้เติมเงินหรืออยู่ tier ต่ำ
   * จะไม่เห็นโมเดลบางตัว แล้วไปพังตอนใช้งานจริงกลางคลิป
   */
  const wants: [string, string, boolean][] = [
    ['ภาพ', process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2', true],
    ['เสียง', process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts', process.env.TTS_PROVIDER === 'openai'],
    ['เขียนสคริปต์', process.env.OPENAI_TEXT_MODEL || 'gpt-5.6-terra', process.env.LLM_PROVIDER === 'openai'],
  ]

  const missing = wants.filter(([, id, required]) => required && !ids.has(id))
  const present = wants.filter(([, id]) => ids.has(id)).map(([label]) => label)

  if (missing.length > 0) {
    return fail(
      `บัญชีนี้ไม่มีโมเดล: ${missing.map(([label, id]) => `${id} (${label})`).join(', ')}`,
      `รุ่นที่บัญชีนี้เรียกได้จริงมี ${ids.size} ตัว — ตั้งชื่อรุ่นให้ตรงหรือเติมเงินใน billing`,
    )
  }

  return ok(present.length > 0 ? `คีย์ใช้ได้ · มีโมเดล${present.join('/')}` : 'คีย์ใช้ได้')
}

/** ผู้ให้บริการที่เลือกไว้ตอนนี้ — ให้เห็นชัดว่ากำลังจะใช้อะไร ไม่ต้องไปเดาจาก env */
function checkProviders(): Result {
  const llm = process.env.LLM_PROVIDER === 'openai' ? 'OpenAI' : 'Anthropic'
  const tts = process.env.TTS_PROVIDER === 'openai' ? 'OpenAI' : 'Google'

  const detail = `เขียนสคริปต์: ${llm} · เสียง: ${tts} · ภาพ: เลือกต่อช่องที่หน้าตั้งค่า`

  /**
   * เตือนเมื่อเลือกเสียง OpenAI — ภาษาไทยยังไม่มีใครยืนยันคุณภาพ
   * (เอกสารบอกแค่ "50+ ภาษา" ไม่ได้ระบุไทยไว้ชัด) ต้องฟังเองก่อน
   */
  if (process.env.TTS_PROVIDER === 'openai') {
    return warn(detail, 'เสียงไทยของ OpenAI ยังไม่ยืนยันคุณภาพ — ฟังเทียบก่อน: pnpm voice-sample-openai')
  }

  return ok(detail)
}

/**
 * ผู้ให้บริการสร้างคลิปโฆษณา — ไม่ตั้งคีย์เลย = ฟีเจอร์ปิด ไม่ใช่ error
 *
 * ตรวจว่า "ตั้งครบพอให้ด่านคุมงบทำงาน" ไม่ใช่แค่มีคีย์ — Runway ที่มีคีย์
 * แต่ไม่ได้ตั้งราคา ระบบจะปฏิเสธไม่ให้ใช้อยู่ดี ซึ่งดูเหมือนพร้อมแต่ใช้ไม่ได้
 */
async function checkVideoProviders(): Promise<Result> {
  const hasVeo = Boolean(process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY)
  const hasRunway = Boolean(process.env.RUNWAY_API_KEY)

  if (!hasVeo && !hasRunway) return skip('ไม่ได้ตั้งคีย์ — ฟีเจอร์คลิปโฆษณาปิดอยู่')

  const notes: string[] = []
  const problems: string[] = []

  if (hasVeo) {
    const key = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
    ).catch(() => null)

    if (!response) {
      problems.push('Veo: ต่อไม่ได้')
    } else if (!response.ok) {
      problems.push(`Veo: คีย์ใช้ไม่ได้ (${response.status})`)
    } else {
      const body = (await response.json()) as { models?: { name?: string }[] }
      const ids = (body.models ?? []).map((m) => (m.name ?? '').replace('models/', ''))
      const veo = ids.filter((id) => id.includes('veo'))
      notes.push(veo.length > 0 ? `Veo: มี ${veo.length} รุ่น` : 'Veo: คีย์ใช้ได้แต่ยังไม่เห็นรุ่น veo')
    }
  }

  if (hasRunway) {
    // ราคาสำคัญกว่าคีย์ — ไม่มีราคา ด่านคุมงบทำงานไม่ได้ ระบบจะปฏิเสธเอง
    const priced = Number(process.env.RUNWAY_USD_PER_SECOND) > 0
    if (priced) notes.push('Runway: พร้อม')
    else problems.push('Runway: มีคีย์แต่ไม่ได้ตั้ง RUNWAY_USD_PER_SECOND — ระบบจะไม่ยอมใช้')
  }

  const ceiling = Number(process.env.VIDEO_MAX_COST_USD) > 0
    ? Number(process.env.VIDEO_MAX_COST_USD)
    : 5
  notes.push(`เพดาน $${ceiling.toFixed(2)}/คลิป`)

  if (problems.length > 0) return warn(problems.join(' · '), notes.join(' · '))
  return ok(notes.join(' · '))
}

async function checkFfmpeg(): Promise<Result[]> {
  let version: string
  try {
    const { stdout } = await run('ffmpeg', ['-version'])
    version = stdout
  } catch {
    return [fail('เรียก ffmpeg ไม่ได้', 'Windows: winget install Gyan.FFmpeg แล้วเปิด terminal ใหม่')]
  }

  const results: Result[] = []
  const first = version.split('\n')[0].replace('ffmpeg version ', '').split(' ')[0]

  results.push(
    version.includes('--enable-libass')
      ? ok(`${first} · มี libass`)
      : fail(`${first} แต่ไม่มี libass`, 'ซับจะไม่ติดลงคลิป ต้องลง build ที่มี libass'),
  )

  results.push(await checkSubtitleFont())
  return results
}

/**
 * ตรวจฟอนต์ซับสองชั้น
 *
 * ชั้นที่ 1 — "อักษรไทยวาดออกมาได้ไหม" เรนเดอร์จริงหนึ่งเฟรมแล้ววัดความสว่าง
 *
 * ชั้นที่ 2 — "ใช้ฟอนต์ที่ตั้งไว้จริงหรือเปล่า" ตั้งชื่อฟอนต์ที่ไม่มีอยู่จริง
 * ffmpeg ไม่คืน error เลย (exit 0) แล้ว libass ไปหยิบฟอนต์อื่นมาวาดแทนเงียบ ๆ
 *
 * วิธีจับ: libass บอกเองใน log ระดับ verbose ว่าเลือกไฟล์ไหนมาใช้
 *   fontselect: (Leelawadee UI, 400, 0) -> /path/DejaVuSans.ttf, 0, DejaVuSans
 * เทียบชื่อที่ขอกับชื่อที่ได้ ต่างกัน = ถูกสับเปลี่ยน
 *
 * ⚠️ เคยเขียนเช็คนี้สองแบบแล้วพลาดทั้งคู่:
 * - วัดความสว่างอย่างเดียว → ขึ้น ✅ ให้ฟอนต์ที่ไม่มีอยู่จริง (แย่กว่าไม่มีเช็ค)
 * - เทียบพิกเซลกับตอนตั้งชื่อมั่ว → ขึ้นเตือนให้ฟอนต์ที่ถูกต้อง เมื่อฟอนต์นั้น
 *   บังเอิญเป็นตัวเดียวกับฟอนต์สำรองของเครื่อง
 * อ่านจาก log ของ libass ตรง ๆ เป็นวิธีเดียวที่ตอบได้จริง
 */
function normalizeFontName(name: string): string {
  return name.toLowerCase().replace(/[\s\-_]/g, '')
}

async function checkSubtitleFont(): Promise<Result> {
  const font = process.env.SUBTITLE_FONT?.trim()
  const requested = font || 'Loma'
  const dir = await mkdtemp(join(tmpdir(), 'ytf-preflight-'))

  try {
    const srt = join(dir, 'probe.srt')
    await writeFile(srt, '1\n00:00:00,000 --> 00:00:02,000\nทดสอบซับไตเติลภาษาไทย\n\n', 'utf8')

    const escaped = srt.replace(/\\/g, '\\\\\\\\').replace(/:/g, '\\\\:')
    const style = [
      `FontName=${requested}`,
      'FontSize=28',
      'PrimaryColour=&H00FFFFFF',
      'Alignment=2',
      'MarginV=20',
    ].join(',')

    const args = [
      '-v', 'verbose',
      '-f', 'lavfi', '-i', 'color=c=0x101820:s=640x360:d=1',
      '-vf', `subtitles=${escaped}:force_style='${style}',crop=640:80:0:270`,
      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
    ]

    // stderr มี log ของ libass · stdout มีพิกเซลดิบ ต้องแยกอ่านคนละทาง
    const { stdout, stderr } = await run('ffmpeg', args, {
      encoding: 'buffer',
      maxBuffer: 20 * 1024 * 1024,
    })

    const pixels = stdout as unknown as Buffer
    const log = (stderr as unknown as Buffer).toString('utf8')

    if (pixels.length === 0 || Math.max(...pixels) < 120) {
      return fail(
        'ไม่มีอักษรไทยวาดออกมาเลย',
        'เครื่องนี้ไม่มีฟอนต์ที่มีอักษรไทยที่ libass หาเจอ',
      )
    }

    const picked = /fontselect: \((.+?), \d+, \d+\) -> .*?, \d+, (.+?)\s*$/m.exec(log)

    if (!picked) {
      // อ่าน log ไม่ได้ (รูปแบบเปลี่ยน หรือ build ไม่ได้ log) — ยังยืนยันชั้นที่ 1 ได้
      return warn(
        `อักษรไทยวาดได้ แต่ตรวจไม่ได้ว่าใช้ "${requested}" จริงไหม`,
        'อ่าน log ของ libass ไม่ออก — ดูซับในคลิปจริงอีกที',
      )
    }

    const [, asked, got] = picked

    if (normalizeFontName(asked) !== normalizeFontName(got)) {
      return warn(
        `ขอ "${asked}" แต่ libass ใช้ "${got}" แทน`,
        font
          ? 'เครื่องนี้ไม่มีฟอนต์ชื่อนี้ — คลิปยังอ่านออก แต่หน้าตาซับไม่ใช่ที่เลือกไว้'
          : 'Windows ให้ตั้ง SUBTITLE_FONT=Leelawadee UI',
      )
    }

    return font
      ? ok(`ใช้ "${got}" จริง และวาดอักษรไทยได้`)
      : warn(`ใช้ "${got}" (ค่าเริ่มต้น ฝั่ง Linux)`, 'Windows ให้ตั้ง SUBTITLE_FONT=Leelawadee UI')
  } catch (error) {
    return fail(`ทดสอบซับไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const CHECKS: [string, () => Promise<Result | Result[]>][] = [
  ['Supabase URL', checkSupabaseUrl],
  ['Supabase anon key', async () => checkAnonKey()],
  ['Supabase service role', checkServiceKey],
  ['สคีมาฐานข้อมูล', checkMigrations],
  ['Anthropic (เขียนสคริปต์)', checkAnthropic],
  ['Google TTS (เสียงพากย์)', checkGoogleTts],
  ['Pexels (ภาพสต็อก)', checkPexels],
  ['OpenAI (วาดภาพ)', checkOpenAi],
  ['ffmpeg + ฟอนต์ซับ', checkFfmpeg],
  ['ผู้ให้บริการที่เลือก', async () => checkProviders()],
  ['คลิปโฆษณา (Veo/Runway)', checkVideoProviders],
]

console.log('\nตรวจการตั้งค่า yt-factory\n')

let failed = 0
let warned = 0

for (const [name, check] of CHECKS) {
  // ตรวจให้ครบทุกข้อแล้วค่อยสรุป — หยุดที่ข้อแรกที่พังทำให้ต้องวนแก้หลายรอบ
  let results: Result[]
  try {
    const value = await check()
    results = Array.isArray(value) ? value : [value]
  } catch (error) {
    results = [fail(error instanceof Error ? error.message : String(error))]
  }

  for (const result of results) {
    console.log(`${ICON[result.status]} ${name.padEnd(26)} ${result.detail}`)
    if (result.fix) console.log(`${' '.repeat(30)}→ ${result.fix}`)
    if (result.status === 'fail') failed += 1
    if (result.status === 'warn') warned += 1
  }
}

console.log('')

if (failed > 0) {
  console.log(`❌ มี ${failed} จุดที่ต้องแก้ก่อนสั่งผลิตคลิป${warned > 0 ? ` (และ ${warned} จุดที่ควรดู)` : ''}\n`)
  process.exit(1)
}

if (warned > 0) {
  console.log(`⚠️  ผ่านแล้ว แต่มี ${warned} จุดที่ควรดู\n`)
} else {
  console.log('✅ พร้อมสั่งผลิตคลิปแล้ว\n')
}
