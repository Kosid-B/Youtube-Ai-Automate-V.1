/**
 * AI Marketing Director — แปลง "เป้าหมายธุรกิจ" เป็นแผนโฆษณาที่สั่งสร้างได้จริง
 *
 * ก่อนมีไฟล์นี้ ผู้ใช้ต้องเขียนคำสั่งภาพเองทีละช็อต ซึ่งเป็นงานที่ต้องรู้ทั้ง
 * การตลาดและวิธีสั่งโมเดลวิดีโอพร้อมกัน · คนที่มีปัญหาธุรกิจจริง ๆ ไม่ได้มีทักษะนั้น
 * และไม่ควรต้องมี — เขารู้แค่ว่า "อยากได้ลูกค้าโรงงานเพิ่ม"
 *
 * ลำดับที่ไฟล์นี้บังคับ:
 *   เป้าหมายธุรกิจ → ลูกค้าที่ใช่ (ICP) → ความเจ็บของเขา → คำสัญญา → hook → บทพูด → CTA → สตอรีบอร์ด
 *
 * ทำไมต้องเรียงแบบนี้ ไม่กระโดดไปที่ hook เลย: hook ที่ดีคือประโยคที่พูดกับ "คนคนหนึ่ง"
 * เรื่อง "ความเจ็บข้อหนึ่ง" ข้ามสองขั้นแรกไปแล้วจะได้ hook ที่ฟังดูดีแต่ไม่โดนใคร
 * ซึ่งเป็นคลิปโฆษณาส่วนใหญ่ในโลก
 *
 * ⚠️ ไฟล์นี้บริสุทธิ์ทั้งไฟล์ ยกเว้น runDirector() ตัวเดียวที่เรียกโมเดล
 * และ runDirector รับ completeImpl เข้ามาได้ เพื่อให้เทสต์ไม่ต้องยิงเน็ต
 */
import { complete, type CompleteInput } from '@/lib/llm'
import { THAI_CHARS_PER_SECOND } from '@/lib/scenes'
import type { VideoAspect } from '@/lib/video/types'
import type { PLATFORMS } from '@/lib/video/schema'

export type Platform = (typeof PLATFORMS)[number]

/**
 * ผู้ให้บริการวิดีโอสร้างได้ครั้งละ ~8 วินาที · ช็อตที่ยาวกว่านั้นสั่งไม่ได้ในครั้งเดียว
 * และช็อตที่สั้นกว่า 3 วินาทีคนดูยังไม่ทันเห็นว่าเป็นภาพอะไรก็ตัดแล้ว
 */
export const SHOT_SECONDS = { min: 3, target: 6, max: 8 } as const

/**
 * เพดานจำนวนช็อต — หนึ่งช็อต = การเรียกผู้ให้บริการหนึ่งครั้ง = เงินหนึ่งก้อน
 * แผน 20 ช็อตอ่านแล้วดูดี แต่แปลว่าคลิปเดียวเสีย $16 ซึ่งไม่มีใครตั้งใจ
 */
export const MAX_SHOTS = 8

/** hook ต้องจบก่อนคนเลื่อนผ่าน — สามวินาทีคือเวลาที่มีจริง ไม่ใช่เป้าหมายที่ตั้งไว้สวย ๆ */
export const HOOK_SECONDS = 3
/** เป้าที่บอกโมเดล */
export const HOOK_MAX_CHARS = HOOK_SECONDS * THAI_CHARS_PER_SECOND

/**
 * เกินเท่านี้ถึงเตือน — เผื่อไว้หนึ่งวินาที
 *
 * 14 ตัวอักษรต่อวินาทีเป็นค่าประมาณ เวลาจริงขึ้นกับคำที่ใช้ · เตือนตั้งแต่เกินเป้า
 * หนึ่งตัวอักษรจะทำให้แทบทุกแผนมีคำเตือน แล้วคนจะเลิกอ่านคำเตือนทั้งกล่อง
 * ซึ่งทำให้คำเตือนเรื่องตัวเลขไม่มีที่มา (ข้อที่สำคัญจริง) ถูกมองข้ามไปด้วย
 */
export const HOOK_WARN_CHARS = (HOOK_SECONDS + 1) * THAI_CHARS_PER_SECOND

/** ความยาวรวมที่เหมาะกับแต่ละที่ — คนดูคนละอารมณ์กัน คลิปเดียวใช้ทุกที่ไม่ได้ผล */
const PLATFORM_SECONDS: Record<Platform, number> = {
  youtube_shorts: 20,
  tiktok: 20,
  instagram_reels: 20,
  facebook: 30,
  website: 30,
}

export function platformSeconds(platform: Platform): number {
  return PLATFORM_SECONDS[platform] ?? 20
}

/** จำนวนช็อตที่ควรมี ให้ได้ความยาวรวมตามเป้า */
export function plannedShots(totalSeconds: number): number {
  const raw = Math.ceil(totalSeconds / SHOT_SECONDS.target)
  return Math.min(Math.max(raw, 2), MAX_SHOTS)
}

export type MarketingBrief = {
  title: string
  /** เป้าหมายธุรกิจ — ต้นทางของทุกอย่าง ไม่มีข้อนี้ Director ทำงานไม่ได้ */
  objective: string | null
  audience: string | null
  platform: Platform
  aspect: VideoAspect
  /** โน้ตเพิ่มเติมตอนสั่ง เช่น "เน้นราคา ไม่ต้องพูดถึงคู่แข่ง" */
  notes?: string | null
  totalSeconds: number
}

export type StoryboardShot = {
  /** ลำดับช็อต เริ่มที่ 1 */
  shot: number
  seconds: number
  /**
   * คำสั่งภาพ — ภาษาอังกฤษโดยตั้งใจ
   * Veo/Runway ตอบสนองคำสั่งภาษาอังกฤษดีกว่ามาก (ข้อมูลฝึกเป็นอังกฤษเกือบทั้งหมด)
   * ส่วนบทพูดต้องเป็นไทยเพราะคนดูเป็นคนไทย — สองช่องนี้จึงคนละภาษากันโดยเจตนา
   */
  prompt: string
  /** บทพูดไทยของช็อตนี้ — ต่อกันทุกช็อตแล้วต้องได้ script ทั้งคลิป */
  voiceover: string
}

export type DirectorPlan = {
  /** ลูกค้าที่ใช่ที่สุดหนึ่งคน ไม่ใช่ "ผู้ประกอบการทั่วไป" */
  icp: string
  /** ความเจ็บที่เขามีอยู่จริงตอนนี้ */
  pain: string
  /** ดูจบแล้วเขาได้อะไร */
  promise: string
  hook: string
  script: string
  cta: string
  storyboard: StoryboardShot[]
}

/** ทุกชั้นตั้ง additionalProperties:false เพราะ OpenAI strict mode บังคับ (ดู llm.ts) */
export const DIRECTOR_SCHEMA = {
  type: 'object',
  properties: {
    icp: { type: 'string' },
    pain: { type: 'string' },
    promise: { type: 'string' },
    hook: { type: 'string' },
    script: { type: 'string' },
    cta: { type: 'string' },
    storyboard: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          shot: { type: 'integer' },
          seconds: { type: 'integer' },
          prompt: { type: 'string' },
          voiceover: { type: 'string' },
        },
        required: ['shot', 'seconds', 'prompt', 'voiceover'],
        additionalProperties: false,
      },
    },
  },
  required: ['icp', 'pain', 'promise', 'hook', 'script', 'cta', 'storyboard'],
  additionalProperties: false,
} as const

const SYSTEM = `คุณเป็นผู้อำนวยการการตลาดที่วางแผนคลิปโฆษณาสั้นภาษาไทยให้ธุรกิจ SME

เริ่มจากเป้าหมายธุรกิจเสมอ แล้วไล่ลงมาตามลำดับนี้ ห้ามข้ามขั้น:
1. ลูกค้าที่ใช่ที่สุด "หนึ่งคน" — ระบุให้เจาะจงจนนึกหน้าออก ไม่ใช่ "ผู้ประกอบการทั่วไป"
2. ความเจ็บที่เขามีอยู่จริงตอนนี้ — เขียนเป็นสิ่งที่เขาพูดกับตัวเอง ไม่ใช่ศัพท์การตลาด
3. คำสัญญา — ดูจบแล้วเขาได้อะไร
4. hook — สามวินาทีแรก พูดกับคนคนนั้นเรื่องความเจ็บข้อนั้นโดยตรง
5. บทพูดทั้งคลิป แล้วซอยเป็นช็อต

ข้อห้ามที่สำคัญที่สุด — ผิดข้อนี้แล้วลูกค้าโดนฟ้องได้จริงตามกฎหมายโฆษณาไทย:
- ห้ามแต่งตัวเลข เปอร์เซ็นต์ จำนวนลูกค้า ราคา หรือรางวัลใด ๆ ที่ไม่ได้อยู่ในบรีฟ
- ไม่มีตัวเลขในบรีฟ = เขียนคลิปที่ไม่มีตัวเลขเลย ซึ่งทำได้และดีกว่าการแต่ง
- ห้ามใช้คำรับประกันผล เช่น "การันตี" "ได้ผล 100%" ถ้าบรีฟไม่ได้บอกว่ารับประกันจริง
- ห้ามอ้างถึงคู่แข่งในทางเสียหาย

กติกาของสตอรีบอร์ด:
- prompt เป็นภาษาอังกฤษ บรรยาย "สิ่งที่กล้องเห็น" อย่างเดียว — มุมกล้อง แสง สถานที่ การเคลื่อนไหว
  ห้ามใส่ข้อความบนจอ ห้ามใส่โลโก้ ห้ามสั่งให้ตัวละครพูด (โมเดลวิดีโอทำตัวหนังสือไทยไม่ได้)
- voiceover เป็นภาษาไทย เป็นบทพูดของช็อตนั้น ต่อกันทุกช็อตต้องได้ script ทั้งคลิปพอดี
- ความยาวช็อตต้องพอดีกับบทพูด (ภาษาไทยพูดได้ราว 14 ตัวอักษรต่อวินาที)
- ช็อตแรกต้องเป็นภาพที่หยุดนิ้วคนเลื่อนได้ ไม่ใช่ภาพโลโก้หรือภาพเปิดเรื่องแบบสารคดี

ตอบเป็น JSON ตามสคีมาเท่านั้น`

export function directorSystem(): string {
  return SYSTEM
}

/** เรียงบรีฟเป็นข้อความเดียว — ใช้ทั้งส่ง prompt และใช้ตรวจว่าตัวเลขที่โมเดลอ้างมีที่มาไหม */
export function briefText(brief: MarketingBrief): string {
  return [
    `ชื่องาน: ${brief.title}`,
    brief.objective ? `เป้าหมายธุรกิจ: ${brief.objective}` : null,
    brief.audience ? `กลุ่มเป้าหมาย: ${brief.audience}` : null,
    brief.notes ? `โน้ตเพิ่มเติม: ${brief.notes}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

export function directorUser(brief: MarketingBrief): string {
  const shots = plannedShots(brief.totalSeconds)

  return [
    briefText(brief),
    '',
    `แพลตฟอร์ม: ${brief.platform} · สัดส่วนภาพ ${brief.aspect}`,
    `ความยาวรวมที่ต้องการ: ${brief.totalSeconds} วินาที · แบ่งเป็น ${shots} ช็อต`,
    `ช็อตหนึ่งยาวได้ ${SHOT_SECONDS.min}–${SHOT_SECONDS.max} วินาที`,
    `hook ต้องพูดจบใน ${HOOK_SECONDS} วินาที (ไม่เกิน ${HOOK_MAX_CHARS} ตัวอักษร)`,
  ].join('\n')
}

/**
 * อ่านคำตอบของโมเดลแบบไม่เชื่อรูปร่างล่วงหน้า
 *
 * แม้จะบังคับสคีมาไว้แล้วก็ยังต้องตรวจ — สคีมาคุมได้แค่ "ชนิดข้อมูล"
 * ไม่ได้คุมว่าเนื้อในใช้ได้จริงไหม และวันที่สลับไปใช้เจ้าอื่นที่ไม่มี strict mode
 * ชั้นนี้คือชั้นเดียวที่เหลือ
 */
export function parsePlan(raw: string): DirectorPlan {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('โมเดลตอบกลับมาไม่ใช่ JSON — ลองสั่งใหม่อีกครั้ง')
  }

  if (typeof data !== 'object' || data === null) {
    throw new Error('โมเดลตอบกลับมาไม่ใช่แผน')
  }

  const record = data as Record<string, unknown>

  return {
    icp: text(record.icp),
    pain: text(record.pain),
    promise: text(record.promise),
    hook: text(record.hook),
    script: text(record.script),
    cta: text(record.cta),
    storyboard: parseShots(record.storyboard),
  }
}

/** อ่านสตอรีบอร์ดจาก jsonb หรือจากคำตอบของโมเดล — ทางเดียวกันทั้งสองแหล่ง */
export function parseShots(raw: unknown): StoryboardShot[] {
  if (!Array.isArray(raw)) return []

  return raw.map((item, index) => {
    const shot = (item ?? {}) as Record<string, unknown>
    return {
      // ไม่เชื่อเลขช็อตที่ให้มา ใช้ลำดับจริงในอาร์เรย์ — โมเดลนับข้ามบ้าง
      // และเลขที่ข้ามจะทำให้ปุ่ม "สร้างคลิปช็อตนี้" ชี้ผิดช็อต
      shot: index + 1,
      seconds: seconds(shot.seconds),
      prompt: text(shot.prompt),
      voiceover: text(shot.voiceover),
    }
  })
}

/**
 * ตารางเก็บบทเป็นข้อความก้อนเดียว แต่แผนมี "พูดกับใคร" กับ "ความเจ็บ" ที่ต้องไม่หาย
 *
 * ทิ้งสองบรรทัดนี้ไปแล้ว รอบหน้าที่มีคนแก้บท เขาจะแก้โดยไม่รู้ว่ากำลังพูดกับใคร
 * แล้วบทจะค่อย ๆ กลายเป็นกลาง ๆ จนไม่โดนใคร — ซึ่งเป็นวิธีที่โฆษณาตายโดยไม่มีใครสังเกต
 *
 * ⚠️ scriptWithContext กับ planFromRow ต้องอยู่คู่กันเสมอ แก้ตัวหนึ่งต้องแก้อีกตัว
 * (มีเทสต์ round-trip บังคับไว้)
 */
const ICP_TAG = '[พูดกับ]'
const PAIN_TAG = '[ความเจ็บ]'
const NOTES_TAG = '[โน้ต]'

/**
 * เก็บโน้ตของผู้ใช้ไว้ด้วย ไม่ใช่แค่ ICP กับความเจ็บ
 *
 * โน้ตเป็นส่วนหนึ่งของบรีฟ และบรีฟคือสิ่งที่ unverifiedClaims() ใช้ตัดสินว่าตัวเลข
 * ในบทมีที่มาไหม · ทิ้งโน้ตไปแล้วตัวเลขที่ผู้ใช้พิมพ์มาเองจะถูกเตือนว่า "ไม่มีที่มา"
 * ทุกครั้งที่เปิดหน้า ซึ่งเป็นคำเตือนปลอม และคำเตือนปลอมทำให้คนเลิกอ่านคำเตือนจริง
 */
export function scriptWithContext(plan: DirectorPlan, notes?: string | null): string {
  return [
    `${ICP_TAG} ${plan.icp}`,
    `${PAIN_TAG} ${plan.pain}`,
    ...(notes?.trim() ? [`${NOTES_TAG} ${notes.trim()}`] : []),
    '',
    plan.script,
  ].join('\n')
}

/** แผนที่อ่านกลับมาจากตาราง — พ่วงโน้ตของบรีฟมาด้วยเพื่อตรวจตัวเลขได้ครบเหมือนตอนวางแผน */
export type StoredPlan = DirectorPlan & { notes: string }

/** อ่านแผนกลับจากแถวในฐานข้อมูล เพื่อคำนวณคำเตือนใหม่ทุกครั้งที่เปิดหน้า */
export function planFromRow(row: {
  hook: string | null
  script: string | null
  cta: string | null
  storyboard: unknown
}): StoredPlan {
  const lines = (row.script ?? '').split('\n')
  const tagged = new Map<string, string>()
  let cursor = 0

  for (const tag of [ICP_TAG, PAIN_TAG, NOTES_TAG]) {
    if (lines[cursor]?.startsWith(tag)) {
      tagged.set(tag, lines[cursor].slice(tag.length).trim())
      cursor += 1
    }
  }

  return {
    icp: tagged.get(ICP_TAG) ?? '',
    pain: tagged.get(PAIN_TAG) ?? '',
    notes: tagged.get(NOTES_TAG) ?? '',
    // promise ไม่ได้เก็บลงตาราง — ใช้ตอนวางแผนแล้วจบ ไม่มีใครอ่านซ้ำ
    promise: '',
    hook: row.hook ?? '',
    script: lines.slice(cursor).join('\n').trim(),
    cta: row.cta ?? '',
    storyboard: parseShots(row.storyboard),
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function seconds(value: unknown): number {
  const raw = Math.round(Number(value))
  if (!Number.isFinite(raw)) return SHOT_SECONDS.target
  return Math.min(Math.max(raw, SHOT_SECONDS.min), SHOT_SECONDS.max)
}

/**
 * ตัวเลขที่ "ฟังเหมือนคำโฆษณา" — เปอร์เซ็นต์ เงิน จำนวนเท่า และจำนวนหลักร้อยขึ้นไป
 *
 * ไม่จับเลขเล็ก ๆ อย่าง "3 ข้อ" หรือ "2 นาที" โดยตั้งใจ — พวกนั้นเป็นโครงของประโยค
 * ไม่ใช่คำกล่าวอ้าง จับหมดแล้วคำเตือนจะเยอะจนไม่มีใครอ่าน ซึ่งแย่กว่าไม่เตือนเลย
 */
const CLAIM_PATTERNS: readonly RegExp[] = [
  /\d[\d,.]*\s*%/g,
  /\d[\d,.]*\s*เปอร์เซ็นต์/g,
  /฿\s*\d[\d,.]*/g,
  /\$\s*\d[\d,.]*/g,
  /\d[\d,.]*\s*บาท/g,
  /\d[\d,.]*\s*(ล้าน|แสน|หมื่น|พัน)/g,
  /\d[\d,.]*\s*เท่า/g,
  /\d{3,}/g,
]

/** ปี พ.ศ./ค.ศ. ไม่ใช่คำกล่าวอ้าง — จับด้วยจะได้คำเตือนปลอมทุกครั้งที่พูดถึงปี */
const YEAR_PATTERN = /(?:ปี|พ\.ศ\.|ค\.ศ\.)\s*\d{4}/g

function digitRuns(source: string): Set<string> {
  return new Set(source.match(/\d+/g) ?? [])
}

/**
 * ตัวเลขในแผนที่ไม่มีที่มาในบรีฟ
 *
 * ทำไมต้องตรวจทั้งที่สั่งห้ามไว้ใน prompt แล้ว: คำสั่งใน prompt เป็นคำขอ ไม่ใช่การบังคับ
 * โมเดลเติมตัวเลขที่ "ฟังดูสมเหตุสมผล" ให้เองเป็นเรื่องปกติ และตัวเลขที่ฟังดูสมเหตุสมผล
 * คือตัวเลขที่คนอ่านผ่านโดยไม่เอะใจ — อันตรายกว่าตัวเลขที่ผิดจนสังเกตได้
 */
export function unverifiedClaims(plan: DirectorPlan, brief: string): string[] {
  const claimed = [plan.hook, plan.script, plan.cta].join('\n')
  const withoutYears = claimed.replace(YEAR_PATTERN, ' ')
  const allowed = digitRuns(brief)
  const found = new Set<string>()

  for (const pattern of CLAIM_PATTERNS) {
    for (const match of withoutYears.match(new RegExp(pattern.source, 'g')) ?? []) {
      const digits = match.match(/\d+/g) ?? []
      if (digits.every((run) => allowed.has(run))) continue
      found.add(match.trim())
    }
  }

  return [...found]
}

/**
 * ตรวจแผนก่อนบันทึก
 *
 * คืนเป็นรายการปัญหา ไม่ throw — แผนที่มีปัญหายังมีค่าให้คนแก้ต่อได้
 * ทิ้งทั้งแผนเพราะช็อตเดียวยาวเกินไปคือเผาเงินที่จ่ายให้โมเดลไปแล้วทิ้ง
 */
export function planProblems(plan: DirectorPlan, brief: MarketingBrief): string[] {
  const problems: string[] = []

  if (plan.storyboard.length === 0) {
    problems.push('ไม่มีสตอรีบอร์ด — สั่งสร้างคลิปต่อไม่ได้')
  }

  if (plan.storyboard.length > MAX_SHOTS) {
    problems.push(`มี ${plan.storyboard.length} ช็อต เกิน ${MAX_SHOTS} ช็อตที่รับได้`)
  }

  if (!plan.hook.trim()) problems.push('ไม่มี hook')

  if (plan.hook.length > HOOK_WARN_CHARS) {
    const spoken = Math.round((plan.hook.length / THAI_CHARS_PER_SECOND) * 10) / 10
    problems.push(
      `hook พูดประมาณ ${spoken} วินาที ยาวเกิน ${HOOK_SECONDS} วินาทีที่คนดูให้ ` +
        `— ตัดให้เหลือราว ${HOOK_MAX_CHARS} ตัวอักษร`,
    )
  }

  if (!plan.cta.trim()) problems.push('ไม่มี CTA — คนดูจบแล้วไม่รู้ว่าต้องทำอะไรต่อ')
  if (!plan.icp.trim()) problems.push('ไม่ได้ระบุว่าคลิปนี้พูดกับใคร')

  plan.storyboard.forEach((shot) => {
    if (!shot.prompt.trim()) problems.push(`ช็อต ${shot.shot}: ไม่มีคำสั่งภาพ`)
    if (!shot.voiceover.trim()) problems.push(`ช็อต ${shot.shot}: ไม่มีบทพูด`)

    // บทพูดยาวเกินเวลาช็อต = เสียงจะถูกตัดกลางประโยคตอนประกอบจริง
    const needed = Math.ceil(shot.voiceover.length / THAI_CHARS_PER_SECOND)
    if (needed > shot.seconds + 1) {
      problems.push(
        `ช็อต ${shot.shot}: บทพูดยาว ${needed} วินาที แต่ช็อตยาว ${shot.seconds} วินาที`,
      )
    }
  })

  const total = totalShotSeconds(plan)
  const target = brief.totalSeconds
  if (total > 0 && Math.abs(total - target) > target * 0.4) {
    problems.push(`ความยาวรวม ${total} วินาที ต่างจากที่ขอไว้ ${target} วินาทีมาก`)
  }

  for (const claim of unverifiedClaims(plan, briefText(brief))) {
    problems.push(`อ้าง "${claim}" แต่ไม่มีตัวเลขนี้ในบรีฟ — ต้องยืนยันก่อนใช้`)
  }

  return problems
}

export function totalShotSeconds(plan: DirectorPlan): number {
  return plan.storyboard.reduce((sum, shot) => sum + shot.seconds, 0)
}

/**
 * เรียกโมเดลให้วางแผน
 *
 * completeImpl ใส่เข้ามาได้เพื่อให้เทสต์ไม่ต้องยิงเน็ต — รูปแบบเดียวกับ route(request, fetchImpl)
 */
export async function runDirector(
  brief: MarketingBrief,
  completeImpl: (input: CompleteInput) => Promise<string> = complete,
): Promise<DirectorPlan> {
  if (!brief.objective?.trim()) {
    throw new Error('ยังไม่ได้เขียนเป้าหมายธุรกิจ — Director ไม่มีอะไรให้เริ่มคิด')
  }

  const raw = await completeImpl({
    system: directorSystem(),
    user: directorUser(brief),
    // แผนทั้งชิ้นยาวกว่าที่คิด: สตอรีบอร์ด 8 ช็อตมีทั้งคำสั่งภาพและบทพูดของทุกช็อต
    maxTokens: 8000,
    // วางแผนคือขั้นที่ผิดแล้วพังทั้งเส้น ไม่ใช่ขั้นที่แปลงข้อความ — ใช้ high
    effort: 'high',
    schema: DIRECTOR_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'marketing_plan',
  })

  return parsePlan(raw)
}
