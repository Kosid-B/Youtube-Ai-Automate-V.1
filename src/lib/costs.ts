/**
 * ประมาณต้นทุนต่อคลิปก่อนกดสร้าง
 *
 * มีไว้เพราะเพดานงบเป็นข้อจำกัดจริงของโปรเจคนี้ ไม่ใช่ของประดับ
 * ผู้ใช้ควรเห็นตัวเลขก่อนสั่งผลิต ไม่ใช่มารู้ตอนบิลมา
 *
 * ⚠️ ราคาด้านล่างตรวจเมื่อ ส.ค. 2569 — ผู้ให้บริการเปลี่ยนราคาได้ตลอด
 * ก่อนใช้ตัวเลขนี้ตัดสินใจเรื่องเงินจริง ให้ไปเช็คหน้าราคาปัจจุบันก่อน
 */

/**
 * อัตราแลกเปลี่ยนโดยประมาณ ตั้งผ่าน env ได้เพื่อไม่ต้องแก้โค้ดตอนค่าเงินขยับ
 * อ่านตอนเรียก ไม่ใช่ตอนโหลดโมดูล (ดู __tests__/env-at-module-load.test.ts)
 */
export function thbPerUsd(): number {
  const raw = Number(process.env.THB_PER_USD)
  return Number.isFinite(raw) && raw > 0 ? raw : 36
}

export type TtsProviderId =
  | 'google-neural2'
  | 'google-chirp3-hd'
  | 'elevenlabs-flash'
  | 'elevenlabs-multilingual-v2'

export type TtsPricing = {
  id: TtsProviderId
  label: string
  usdPerMillionChars: number
  /** จำนวนตัวอักษรที่ใช้ได้ฟรีต่อเดือน */
  freeCharsPerMonth: number
  /** ยืนยันแล้วว่ามีเสียงภาษาไทยหรือยัง */
  thaiConfirmed: boolean
}

export const TTS_PRICING: Record<TtsProviderId, TtsPricing> = {
  'google-neural2': {
    id: 'google-neural2',
    label: 'Google Neural2',
    usdPerMillionChars: 16,
    freeCharsPerMonth: 1_000_000,
    // ยังไม่ได้ยืนยันว่ามีเสียงไทยใน Neural2 — ให้ระบบ list เสียงจริงตอนตั้งค่า
    thaiConfirmed: false,
  },
  'google-chirp3-hd': {
    id: 'google-chirp3-hd',
    label: 'Google Chirp 3 HD',
    usdPerMillionChars: 30,
    freeCharsPerMonth: 1_000_000,
    thaiConfirmed: true,
  },
  'elevenlabs-flash': {
    id: 'elevenlabs-flash',
    label: 'ElevenLabs Flash/Turbo',
    usdPerMillionChars: 50,
    freeCharsPerMonth: 0,
    thaiConfirmed: true,
  },
  'elevenlabs-multilingual-v2': {
    id: 'elevenlabs-multilingual-v2',
    label: 'ElevenLabs Multilingual v2',
    usdPerMillionChars: 100,
    freeCharsPerMonth: 0,
    thaiConfirmed: true,
  },
}

export type ScriptModelId = 'claude-opus-5' | 'claude-sonnet-5' | 'claude-haiku-4-5'

/** ราคา token ต่อล้าน (input, output) */
export const MODEL_PRICING: Record<ScriptModelId, { inUsd: number; outUsd: number }> = {
  'claude-opus-5': { inUsd: 5, outUsd: 25 },
  'claude-sonnet-5': { inUsd: 3, outUsd: 15 },
  'claude-haiku-4-5': { inUsd: 1, outUsd: 5 },
}

export type CostEstimate = {
  scriptThb: number
  ttsThb: number
  totalThb: number
  /** true = ยังอยู่ในโควตาฟรีของ TTS เดือนนี้ */
  ttsWithinFreeTier: boolean
}

export type EstimateInput = {
  /** จำนวนตัวอักษรของสคริปต์ */
  scriptChars: number
  model: ScriptModelId
  tts: TtsProviderId
  /** ตัวอักษรที่ใช้ TTS ไปแล้วในเดือนนี้ */
  ttsCharsUsedThisMonth?: number
  /**
   * token ที่โมเดลผลิตจริงต่อสคริปต์หนึ่งชิ้น
   * ภาษาไทยกินโทเคนมากกว่าอังกฤษ และ thinking token ก็นับเป็น output ด้วย
   * ค่าเริ่มต้นเป็นการประมาณ ให้แทนที่ด้วยค่าจริงจาก usage เมื่อมีข้อมูลแล้ว
   */
  outputTokens?: number
  inputTokens?: number
}

export function estimateClipCost(input: EstimateInput): CostEstimate {
  const model = MODEL_PRICING[input.model]

  // ประมาณจากตัวอักษร ถ้าไม่ได้ส่ง token จริงมา — ไทยราว 1 โทเคนต่อ 1 ตัวอักษร
  const outputTokens = input.outputTokens ?? input.scriptChars
  const inputTokens = input.inputTokens ?? 2000

  const scriptUsd = (inputTokens * model.inUsd + outputTokens * model.outUsd) / 1_000_000

  const tts = TTS_PRICING[input.tts]
  const used = input.ttsCharsUsedThisMonth ?? 0
  const freeLeft = Math.max(tts.freeCharsPerMonth - used, 0)
  const billableChars = Math.max(input.scriptChars - freeLeft, 0)
  const ttsUsd = (billableChars * tts.usdPerMillionChars) / 1_000_000

  const rate = thbPerUsd()
  const scriptThb = round2(scriptUsd * rate)
  const ttsThb = round2(ttsUsd * rate)

  return {
    scriptThb,
    ttsThb,
    totalThb: round2(scriptThb + ttsThb),
    ttsWithinFreeTier: billableChars === 0,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** เครดิตที่ใช้ต่อคลิปหนึ่งเรื่อง = script 1 + render 5 + upload 1 (ดู JOB_COST) */
export const CREDITS_PER_CLIP = 7

/**
 * แปลงเครดิตที่ใช้ไปเป็นเงินบาทโดยประมาณ
 *
 * ⚠️ เป็นค่าประมาณ ไม่ใช่ยอดบิลจริง และตั้งใจให้เห็นชัดว่าประมาณ
 * ระบบยังไม่ได้บันทึก token ที่โมเดลใช้จริงหรือจำนวนตัวอักษรที่ส่งเข้า TTS จริง
 * ตัวเลขนี้จึงเป็น "จำนวนคลิป × ต้นทุนของคลิปมาตรฐาน" — คลิป 3 นาทีกับ 10 นาที
 * ถูกนับเท่ากันทั้งที่ต้นทุนต่างกันหลายเท่า
 *
 * ใช้ดูแนวโน้มว่าเดือนนี้ใช้มากกว่าเดือนก่อนไหมได้ ห้ามใช้กระทบยอดกับบิลจริง
 */
export function estimateSpendThb(
  creditsUsed: number,
  clip: EstimateInput = {
    scriptChars: 6700,
    model: 'claude-opus-5',
    tts: 'google-chirp3-hd',
  },
): number {
  const perClip = estimateClipCost(clip)
  return Math.round((creditsUsed / CREDITS_PER_CLIP) * perClip.totalThb)
}
