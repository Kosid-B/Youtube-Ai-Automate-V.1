/**
 * ตัดข้อความไทยโดยไม่ทำให้สระกับวรรณยุกต์หลุดจากพยัญชนะ
 *
 * ⚠️ ห้ามใช้ .length หรือ .slice() กับข้อความไทยเพื่อจัดบรรทัด
 *
 * "ขึ้น" มี .length = 4 แต่แสดงผลจริงเป็น 2 ตัว (ข+ึ+้ รวมเป็นตัวเดียว แล้ว น)
 * ผลของการใช้ .slice() ตรง ๆ มีสองอย่างพร้อมกัน:
 *
 * 1. ตัดกลางกลุ่ม — "ขึ้นทุกเดือน".slice(0,2) ได้ "ขึ" ส่วน "้นทุกเดือน" ขึ้นบรรทัดใหม่
 *    โดยมีวรรณยุกต์ลอยเดี่ยวนำหน้า อ่านไม่ออกและดูเหมือนระบบพัง
 * 2. นับความกว้างผิด — บรรทัดที่ตั้งไว้ 18 ตัวอักษร จริง ๆ กว้างแค่ ~12 ตัว
 *    เพราะสระบน/ล่างไม่กินความกว้างแนวนอน
 *
 * เจอครั้งแรกตอนเรนเดอร์ปกคลิปแล้วเปิดภาพดู — เทสที่ตรวจแต่ความยาวสตริงจับไม่ได้เลย
 */

const segmenter = new Intl.Segmenter('th', { granularity: 'grapheme' })

/** ตัดเป็นกลุ่มอักขระที่แสดงผลเป็นตัวเดียว (พยัญชนะ + สระ + วรรณยุกต์ = 1 กลุ่ม) */
export function graphemes(text: string): string[] {
  return [...segmenter.segment(text)].map((s) => s.segment)
}

/** ความยาวที่ตาเห็นจริง ไม่ใช่จำนวน code unit */
export function visibleLength(text: string): number {
  return graphemes(text).length
}

/**
 * ตัดข้อความเป็นบรรทัดตามจำนวนตัวที่มองเห็น
 *
 * ตัดที่ช่องว่างก่อนถ้ามีและไม่สั้นเกินไป — อ่านง่ายกว่าตัดกลางคำ
 * ภาษาไทยมักไม่มีช่องว่าง จึงต้องยอมตัดกลางคำได้ แต่ห้ามตัดกลาง "ตัวอักษร"
 */
export function wrapByGraphemes(
  text: string,
  maxPerLine: number,
  /** ตัดที่ช่องว่างได้ ถ้าช่องว่างอยู่หลังจุดนี้ (สัดส่วนของบรรทัด) */
  minSpaceRatio = 1 / 3,
): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []

  const chars = graphemes(clean)
  if (chars.length <= maxPerLine) return [clean]

  const lines: string[] = []
  let index = 0

  while (index < chars.length) {
    const window = chars.slice(index, index + maxPerLine)

    let take = window.length
    if (index + maxPerLine < chars.length) {
      const space = window.lastIndexOf(' ')
      if (space > maxPerLine * minSpaceRatio) take = space
    }

    const line = window.slice(0, take).join('').trim()
    if (line) lines.push(line)

    index += take
    // ข้ามช่องว่างที่จุดตัด ไม่ให้บรรทัดถัดไปขึ้นต้นด้วยช่องว่าง
    while (chars[index] === ' ') index += 1
  }

  return lines
}

/** ตัดท้ายด้วย … โดยนับตามตัวที่มองเห็น */
export function truncateGraphemes(text: string, maxPerLine: number): string {
  const chars = graphemes(text)
  if (chars.length <= maxPerLine) return text
  return `${chars.slice(0, Math.max(0, maxPerLine - 1)).join('').trim()}…`
}
