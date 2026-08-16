/**
 * แปลงข้อความเป็นเสียงพูดไทย
 *
 * เลือก LINEAR16 (WAV) ไม่ใช่ MP3 ด้วยเหตุผลเดียว: อ่านความยาวเสียงได้จากตัวไฟล์เลย
 * ไม่ต้องพึ่ง ffprobe — ซับไตเติลต้องใช้ความยาวจริงของทุกฉาก ถ้าอ่านไม่ได้ก็ทำซับไม่ได้
 * ไฟล์ใหญ่กว่า MP3 แต่เป็นไฟล์ชั่วคราวระหว่างประกอบคลิป ไม่ได้เก็บถาวร
 */

/** เพดานของ Google Cloud TTS ต่อหนึ่งคำขอ — นับเป็น "ไบต์" ไม่ใช่ตัวอักษร */
export const MAX_REQUEST_BYTES = 5000

/** ภาษาไทยใน UTF-8 กินตัวละ 3 ไบต์ เพดานจริงจึงเหลือราว 1,600 ตัวอักษร */
export const THAI_BYTES_PER_CHAR = 3

export type TtsVoice = {
  languageCode: string
  /** ชื่อเสียงเต็ม เช่น th-TH-Chirp3-HD-Achernar */
  name: string
}

export type SynthesizeOptions = {
  voice: TtsVoice
  /** ความเร็วพูด 0.25–4.0 · 1 = ปกติ */
  speakingRate?: number
  sampleRateHertz?: number
}

export type SynthesizedAudio = {
  /** ไฟล์ WAV ทั้งก้อน */
  bytes: Uint8Array
  durationSec: number
}

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** true = ข้อความนี้ยาวเกินที่ Google รับได้ในคำขอเดียว */
export function exceedsRequestLimit(text: string): boolean {
  return utf8ByteLength(text) > MAX_REQUEST_BYTES
}

/**
 * อ่านความยาวเสียงจากหัวไฟล์ WAV
 *
 * ไม่เดินตามลำดับ chunk แบบตายตัว เพราะ WAV มี chunk แทรกได้ (LIST, fact ฯลฯ)
 * ต้องไล่หา 'fmt ' กับ 'data' จริง ๆ ไม่งั้นได้ความยาวผิดแล้วซับเลื่อนทั้งคลิป
 */
export function wavDurationSeconds(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  if (bytes.byteLength < 12 || readTag(view, 0) !== 'RIFF' || readTag(view, 8) !== 'WAVE') {
    throw new Error('ไม่ใช่ไฟล์ WAV ที่อ่านได้')
  }

  let channels = 0
  let sampleRate = 0
  let bitsPerSample = 0
  let dataBytes = -1

  let offset = 12
  while (offset + 8 <= bytes.byteLength) {
    const tag = readTag(view, offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8

    if (tag === 'fmt ' && body + 16 <= bytes.byteLength) {
      channels = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
      bitsPerSample = view.getUint16(body + 14, true)
    } else if (tag === 'data') {
      // บาง encoder เขียนขนาดเป็น 0 หรือเกินไฟล์จริง ให้ยึดขนาดไฟล์ที่เหลืออยู่
      const remaining = bytes.byteLength - body
      dataBytes = size > 0 && size <= remaining ? size : remaining
      break
    }

    // ทุก chunk ปัดขึ้นให้เป็นเลขคู่เสมอตามสเปก RIFF
    offset = body + size + (size % 2)
  }

  if (dataBytes < 0) throw new Error('ไฟล์ WAV ไม่มี data chunk')
  if (!channels || !sampleRate || !bitsPerSample) throw new Error('ไฟล์ WAV ไม่มี fmt chunk')

  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8)
  if (bytesPerSecond <= 0) throw new Error('ค่าใน fmt chunk ไม่สมเหตุสมผล')

  return Math.round((dataBytes / bytesPerSecond) * 1000) / 1000
}

function readTag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}

const ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize'
const VOICES_ENDPOINT = 'https://texttospeech.googleapis.com/v1/voices'

function apiKey(): string {
  const key = process.env.GOOGLE_TTS_API_KEY
  if (!key) throw new Error('ไม่ได้ตั้ง GOOGLE_TTS_API_KEY')
  return key
}

/** อ่านรายชื่อเสียงไทยที่ใช้ได้จริง ใช้ตอนตั้งค่าครั้งแรก ไม่ต้องเดาชื่อเสียงเอง */
export async function listThaiVoices(): Promise<TtsVoice[]> {
  const response = await fetch(`${VOICES_ENDPOINT}?languageCode=th-TH&key=${apiKey()}`)

  if (!response.ok) {
    throw new Error(`อ่านรายชื่อเสียงไม่สำเร็จ (${response.status}): ${await response.text()}`)
  }

  const body = (await response.json()) as {
    voices?: { name: string; languageCodes: string[] }[]
  }

  return (body.voices ?? []).map((voice) => ({
    name: voice.name,
    languageCode: voice.languageCodes[0] ?? 'th-TH',
  }))
}

export async function synthesize(
  text: string,
  options: SynthesizeOptions,
): Promise<SynthesizedAudio> {
  if (exceedsRequestLimit(text)) {
    throw new Error(
      `ข้อความยาว ${utf8ByteLength(text)} ไบต์ เกินเพดาน ${MAX_REQUEST_BYTES} ไบต์ต่อคำขอ ` +
        '— แบ่งเป็นฉากย่อยก่อน (src/lib/scenes.ts)',
    )
  }

  const response = await fetch(`${ENDPOINT}?key=${apiKey()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: options.voice.languageCode, name: options.voice.name },
      audioConfig: {
        audioEncoding: 'LINEAR16',
        speakingRate: options.speakingRate ?? 1,
        sampleRateHertz: options.sampleRateHertz ?? 24000,
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`สังเคราะห์เสียงไม่สำเร็จ (${response.status}): ${await response.text()}`)
  }

  const body = (await response.json()) as { audioContent?: string }
  if (!body.audioContent) throw new Error('Google ไม่ได้ส่งเสียงกลับมา')

  const bytes = Uint8Array.from(Buffer.from(body.audioContent, 'base64'))

  return { bytes, durationSec: wavDurationSeconds(bytes) }
}
