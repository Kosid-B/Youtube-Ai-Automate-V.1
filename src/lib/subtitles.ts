/**
 * สร้างซับไตเติลจากฉากและความยาวเสียงจริง
 *
 * คนไทยดูคลิปแบบปิดเสียงเยอะ ซับจึงไม่ใช่ของแถม
 * และซับยังช่วยให้ YouTube เข้าใจเนื้อหาคลิปด้วย
 */

/** จำนวนตัวอักษรต่อหนึ่งคำบรรยาย — ยาวกว่านี้อ่านไม่ทันบนจอมือถือ */
export const MAX_CHARS_PER_CUE = 42

export type Cue = {
  /** วินาทีจากต้นคลิป */
  start: number
  end: number
  text: string
}

/**
 * ตัดข้อความหนึ่งฉากเป็นคำบรรยายสั้น ๆ แล้วปันเวลาตามสัดส่วนความยาวตัวอักษร
 *
 * ปันตามสัดส่วนแทนการหารเท่ากัน เพราะท่อนที่ยาวกว่าย่อมใช้เวลาพูดนานกว่า
 * ถ้าหารเท่ากัน ซับจะเริ่มเพี้ยนตั้งแต่ฉากที่สอง
 */
export function cuesFromScene(
  text: string,
  startSec: number,
  durationSec: number,
  maxCharsPerCue: number = MAX_CHARS_PER_CUE,
): Cue[] {
  const parts = splitForReading(text, maxCharsPerCue)
  if (parts.length === 0) return []

  const totalChars = parts.reduce((sum, part) => sum + part.length, 0)
  const cues: Cue[] = []
  let cursor = startSec

  parts.forEach((part, i) => {
    const share = totalChars === 0 ? 1 / parts.length : part.length / totalChars
    // ท่อนสุดท้ายจบตรงกับปลายเสียงพอดี ไม่ให้ error สะสมจากการปัดเศษ
    const end = i === parts.length - 1 ? startSec + durationSec : cursor + durationSec * share

    cues.push({ start: round(cursor), end: round(end), text: part })
    cursor = end
  })

  return cues
}

/** ตัดที่ช่องว่างเสมอ ไม่ตัดกลางคำไทย */
function splitForReading(text: string, maxChars: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length === 0) return []
  if (clean.length <= maxChars) return [clean]

  const parts: string[] = []
  let rest = clean

  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars)
    const cut = window.lastIndexOf(' ')
    const at = cut > maxChars / 3 ? cut : maxChars

    parts.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }

  if (rest.length > 0) parts.push(rest)
  return parts
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000
}

/** รวมคำบรรยายของทุกฉากตามลำดับ โดยรู้ความยาวเสียงจริงของแต่ละฉาก */
export function buildCues(
  scenes: { text: string }[],
  durationsSec: number[],
): Cue[] {
  if (scenes.length !== durationsSec.length) {
    throw new Error(`จำนวนฉาก (${scenes.length}) ไม่ตรงกับจำนวนไฟล์เสียง (${durationsSec.length})`)
  }

  const cues: Cue[] = []
  let cursor = 0

  scenes.forEach((scene, i) => {
    cues.push(...cuesFromScene(scene.text, cursor, durationsSec[i]))
    cursor += durationsSec[i]
  })

  return cues
}

/** SRT ใช้ comma เป็นตัวคั่นมิลลิวินาที และนับเวลาจาก 1 ไม่ใช่ 0 */
export function toSrt(cues: Cue[]): string {
  return (
    cues
      .map((cue, i) => `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}`)
      .join('\n\n') + '\n'
  )
}

function srtTime(seconds: number): string {
  const ms = Math.round(seconds * 1000)
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const milli = ms % 1000

  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`
}
