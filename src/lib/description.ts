/**
 * ประกอบคำอธิบายใต้คลิป
 *
 * ลำดับสำคัญกว่าที่คิด: YouTube ตัดคำอธิบายเหลือราว 2–3 บรรทัดแรก
 * ที่เหลือซ่อนหลังปุ่ม "แสดงเพิ่มเติม" ซึ่งคนส่วนใหญ่ไม่กด
 *
 * ลิงก์จึงต้องอยู่ "บนสุด" ไม่ใช่ท้ายสุด — วางไว้ล่างเท่ากับไม่ได้วาง
 * ส่วนเครดิตช่างภาพอยู่ท้ายสุดได้ เพราะหน้าที่คือให้ตรวจสอบได้ ไม่ใช่ให้คนกด
 */

/** YouTube แสดงราวนี้ก่อนตัด — ใช้เตือนเมื่อ CTA ยาวจนลิงก์ตกไปอยู่ใต้รอยตัด */
export const VISIBLE_CHARS = 150

/** เพดานของ YouTube เอง */
export const MAX_DESCRIPTION_CHARS = 5000

export type DescriptionParts = {
  /** ข้อความชวนให้ทำอะไรต่อ + ลิงก์ — ผู้ใช้เขียนเอง */
  cta: string | null
  /** หมุดเวลาแยกบท (คลิปยาวเท่านั้น) */
  chapters: string | null
  /** เนื้อหาสรุปของคลิป */
  body: string | null
  /** เครดิตช่างภาพ Pexels — สัญญาไว้ตอนขอ API key ว่าจะใส่ทุกคลิป */
  credits: string | null
}

export function buildDescription(parts: DescriptionParts): string {
  const blocks = [parts.cta, parts.chapters, parts.body, parts.credits]
    .map((block) => block?.trim())
    .filter((block): block is string => Boolean(block))

  const text = blocks.join('\n\n')

  // ตัดจากท้ายเสมอ — ท้ายคือเครดิต ซึ่งเสียไปยังพอรับได้
  // ถ้าตัดจากหัวจะเสียลิงก์ ซึ่งเป็นเหตุผลทั้งหมดของการทำคลิป
  return text.length > MAX_DESCRIPTION_CHARS ? text.slice(0, MAX_DESCRIPTION_CHARS) : text
}

/**
 * เตือนเมื่อ CTA จะไม่ถูกมองเห็น
 *
 * ปัญหาที่มองไม่เห็นด้วยตาเปล่า: คำอธิบายดูครบดีในฐานข้อมูล แต่บนหน้า YouTube
 * ลิงก์ตกไปอยู่ใต้รอยตัดแล้วไม่มีใครกด — ยอดคลิกเป็นศูนย์โดยไม่มีอะไรผิดพลาดให้เห็น
 */
export function ctaWarning(cta: string | null): string | null {
  const text = cta?.trim()
  if (!text) return 'ยังไม่ได้ตั้งข้อความชวนคลิก — คลิปจะไม่มีลิงก์พาคนไปไหนเลย'

  const linkAt = text.search(/https?:\/\//)

  if (linkAt < 0) return 'ข้อความชวนคลิกยังไม่มีลิงก์'

  if (linkAt > VISIBLE_CHARS) {
    return `ลิงก์อยู่ที่ตัวอักษรที่ ${linkAt} — YouTube ตัดคำอธิบายราวตัวที่ ${VISIBLE_CHARS} ลิงก์จะถูกซ่อน ให้ย้ายขึ้นต้น`
  }

  return null
}

/**
 * บล็อกหมุดเวลาสำหรับคำอธิบายใต้คลิป
 *
 * YouTube จะแปลงเป็นบทในแถบเลื่อนให้ก็ต่อเมื่อ: หมุดแรกเป็น 0:00 · มีอย่างน้อย 3 หมุด ·
 * แต่ละบทยาวอย่างน้อย 10 วินาที · เรียงจากน้อยไปมาก
 * ไม่ครบเงื่อนไข YouTube ไม่แจ้งอะไรเลย — มันแค่แสดงเป็นข้อความธรรมดาแล้วเงียบไป
 * จึงคืน null ไปเลยดีกว่าใส่หมุดที่ไม่ทำงานให้รกคำอธิบาย
 *
 * ตรวจแค่สองข้อแรกตรงนี้ อีกสองข้อรับประกันมาจากต้นทางแล้ว: ท่อนหนึ่งยาวอย่างน้อย
 * 4 นาที (SECTION_SECONDS.min) เวลาจึงเพิ่มขึ้นเสมอและห่างเกิน 10 วินาทีเสมอ
 */
export function chapterBlock(marks: { time: string; heading: string }[]): string | null {
  if (marks.length < 3) return null
  if (marks[0].time !== '0:00') return null

  return marks.map((mark) => `${mark.time} ${mark.heading}`).join('\n')
}
