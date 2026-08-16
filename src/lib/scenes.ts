/**
 * แบ่งสคริปต์เป็นฉาก — หนึ่งฉาก = ภาพหนึ่งใบ + เสียงบรรยายท่อนหนึ่ง
 *
 * ภาษาไทยไม่เว้นวรรคระหว่างคำ แต่เว้นวรรคระหว่างวลี/ประโยค
 * เราจึงตัดที่ขึ้นบรรทัดใหม่ก่อน แล้วค่อยตัดที่ช่องว่าง ไม่ตัดกลางคำเด็ดขาด
 * เพราะตัดกลางคำแล้วซับไตเติลจะอ่านไม่รู้เรื่อง
 */

/**
 * ความเร็วอ่านของเสียงบรรยายไทย (ตัวอักษรต่อวินาที)
 * ใช้ประมาณความยาวคลิปและต้นทุนก่อนกดสร้างเท่านั้น
 * เวลาจริงมาจากไฟล์เสียงที่ TTS คืนมา ไม่ได้ใช้ค่านี้
 */
export const THAI_CHARS_PER_SECOND = 14

export type Scene = {
  index: number
  text: string
  charCount: number
  /** ประมาณความยาวเป็นวินาที ใช้วางแผนล่วงหน้า */
  estimatedSeconds: number
}

export type SplitOptions = {
  /** ความยาวที่อยากได้ต่อฉาก — ราว 15 วินาทีของเสียงบรรยาย */
  targetChars?: number
  /** เพดานแข็ง ถ้าเกินนี้ต้องตัดแม้จะไม่เจอจุดตัดที่สวย */
  maxChars?: number
}

const DEFAULTS = { targetChars: 210, maxChars: 320 } as const

/** ตัดช่องว่างซ้ำและ normalize บรรทัด แต่คงย่อหน้าไว้เป็นสัญญาณการแบ่ง */
function normalize(body: string): string[] {
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
}

/**
 * ตัดข้อความหนึ่งย่อหน้าเป็นชิ้นที่ไม่เกิน maxChars
 * พยายามตัดที่ช่องว่างที่ใกล้ targetChars ที่สุด
 */
function chunkParagraph(text: string, targetChars: number, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]

  const chunks: string[] = []
  let rest = text

  while (rest.length > maxChars) {
    // หาช่องว่างตัวสุดท้ายที่ยังอยู่ในเพดาน และไม่สั้นกว่าครึ่งหนึ่งของเป้าหมาย
    const window = rest.slice(0, maxChars)
    const minCut = Math.floor(targetChars / 2)

    let cut = -1
    for (let i = window.length - 1; i >= minCut; i--) {
      if (window[i] === ' ') {
        cut = i
        break
      }
    }

    // ไม่เจอช่องว่างเลย (ไทยเขียนติดกันยาว ๆ ได้) — จำใจตัดที่เพดาน
    if (cut === -1) cut = maxChars

    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }

  if (rest.length > 0) chunks.push(rest)
  return chunks
}

/**
 * รวมย่อหน้าสั้น ๆ ที่ติดกันเข้าด้วยกันจนใกล้ targetChars
 * ย่อหน้าเดียวสั้น ๆ ไม่ควรกลายเป็นฉากที่ภาพค้างแค่ 2 วินาที
 */
function mergeShort(pieces: string[], targetChars: number, maxChars: number): string[] {
  const merged: string[] = []

  for (const piece of pieces) {
    const last = merged[merged.length - 1]
    if (last !== undefined && last.length < targetChars && last.length + 1 + piece.length <= maxChars) {
      merged[merged.length - 1] = `${last} ${piece}`
    } else {
      merged.push(piece)
    }
  }

  return merged
}

export function splitIntoScenes(body: string, options: SplitOptions = {}): Scene[] {
  const targetChars = options.targetChars ?? DEFAULTS.targetChars
  const maxChars = options.maxChars ?? DEFAULTS.maxChars

  const paragraphs = normalize(body)
  const chunked = paragraphs.flatMap((p) => chunkParagraph(p, targetChars, maxChars))
  const merged = mergeShort(chunked, targetChars, maxChars)

  return merged.map((text, index) => ({
    index,
    text,
    charCount: text.length,
    estimatedSeconds: Math.round((text.length / THAI_CHARS_PER_SECOND) * 10) / 10,
  }))
}

/** ความยาวคลิปโดยประมาณ ใช้เตือนก่อนสร้างว่าจะได้คลิปกี่นาที */
export function estimateDurationSeconds(scenes: Scene[]): number {
  return Math.round(scenes.reduce((sum, scene) => sum + scene.estimatedSeconds, 0))
}
