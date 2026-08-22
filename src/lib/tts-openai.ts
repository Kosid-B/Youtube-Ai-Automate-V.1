/**
 * แปลงข้อความเป็นเสียงพูดด้วย OpenAI
 *
 * ขอเป็น WAV เหมือนฝั่ง Google ด้วยเหตุผลเดียวกันเป๊ะ: อ่านความยาวเสียงได้จาก
 * หัวไฟล์เลย ไม่ต้องพึ่ง ffprobe · ซับไตเติลต้องใช้ความยาวจริงของทุกฉาก
 * ขอเป็น mp3 เมื่อไรจะต้องไปเรียก ffprobe เพิ่มทุกฉาก ซึ่งช้ากว่าและพังได้อีกทาง
 *
 * ⚠️ ภาษาไทย: OpenAI โฆษณาว่ารองรับ 50+ ภาษา แต่เอกสารไม่ได้ระบุไทยไว้ชัด
 * ผมยืนยันไม่ได้ว่าเสียงไทยออกมาดีแค่ไหน — ต้องฟังเอง (pnpm voice-sample-openai)
 * ก่อนเอาไปใช้จริง อย่าเชื่อว่ามันดีเพราะโฆษณาบอกว่ารองรับ
 */
import { wavDurationSeconds, type SynthesizedAudio } from '@/lib/tts'

const ENDPOINT = 'https://api.openai.com/v1/audio/speech'

/** gpt-4o-mini-tts รับ instructions ได้ ซึ่งเป็นทางเดียวที่บอกให้พูดสำเนียงไทยชัด ๆ */
export const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts'

/** เพดานต่อคำขอ — ฉากของเรายาว ~210 ตัวอักษร จึงไม่เคยชน แต่ตรวจไว้กันเงียบ */
export const MAX_INPUT_CHARS = 4096

/**
 * เสียงที่มีให้เลือก — ชื่อเป็นค่าคงที่ ไม่มี API ให้ list เหมือนฝั่ง Google
 * จึงต้องเขียนไว้เอง และอาจล้าสมัยได้เมื่อ OpenAI เพิ่มเสียงใหม่
 */
export const OPENAI_VOICES = [
  'alloy', 'ash', 'ballad', 'coral', 'echo',
  'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse',
] as const

export type OpenAiVoice = (typeof OPENAI_VOICES)[number]

/**
 * คำสั่งกำกับน้ำเสียงเริ่มต้น
 *
 * บอกให้พูดไทยชัด ๆ ตรงนี้สำคัญกว่าที่คิด — โมเดลเดาภาษาจากข้อความเอง
 * แต่ข้อความไทยที่มีคำอังกฤษปนอยู่ (ชื่อแบรนด์ ศัพท์เทคนิค) ทำให้มันสลับสำเนียงกลางประโยคได้
 */
export const DEFAULT_INSTRUCTIONS =
  'Speak in natural, clear Thai with a calm, confident narrator tone. ' +
  'Keep a steady pace suitable for an educational business video. ' +
  'Pronounce Thai words with correct tones; read embedded English terms naturally.'

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('ไม่ได้ตั้ง OPENAI_API_KEY')
  return key
}

export type OpenAiTtsOptions = {
  voice?: string
  /** ความเร็วพูด 0.25–4.0 · 1 = ปกติ */
  speed?: number
  instructions?: string
}

export async function synthesizeOpenAi(
  text: string,
  options: OpenAiTtsOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<SynthesizedAudio> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('ข้อความว่าง')

  if (trimmed.length > MAX_INPUT_CHARS) {
    throw new Error(
      `ข้อความยาว ${trimmed.length} ตัวอักษร เกินเพดาน ${MAX_INPUT_CHARS} ต่อคำขอ ` +
        '— แบ่งเป็นฉากย่อยก่อน (src/lib/scenes.ts)',
    )
  }

  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      input: trimmed,
      voice: options.voice ?? process.env.OPENAI_TTS_VOICE ?? 'alloy',
      // WAV เท่านั้น — ต้องอ่านความยาวจากหัวไฟล์โดยไม่เรียก ffprobe
      response_format: 'wav',
      speed: options.speed ?? 1,
      instructions: options.instructions ?? DEFAULT_INSTRUCTIONS,
    }),
  })

  if (!response.ok) {
    throw new Error(
      `สังเคราะห์เสียงไม่สำเร็จ (${response.status}): ${(await response.text()).slice(0, 300)}`,
    )
  }

  // ตอบกลับเป็นไบต์เสียงดิบ ไม่ใช่ JSON แบบฝั่ง Google
  const bytes = new Uint8Array(await response.arrayBuffer())

  if (bytes.byteLength === 0) throw new Error('OpenAI ไม่ได้ส่งเสียงกลับมา')

  return { bytes, durationSec: wavDurationSeconds(bytes) }
}
