/**
 * จัดฉากที่ติดกันเข้ากลุ่มตามความยาวเป้าหมาย โดยไม่ตัดกลางฉาก
 *
 * ใช้ร่วมกันสองที่ที่มีความหมายคนละอย่างแต่ตรรกะเดียวกันเป๊ะ:
 *   - "ช็อต" (lib/shots.ts)        — ภาพหนึ่งใบครอบกี่ฉาก
 *   - "ช่วงเรนเดอร์" (lib/render-chunks.ts) — หนึ่งคำสั่ง ffmpeg ครอบกี่ช็อต
 *
 * เขียนแยกกันสองชุดเมื่อไร วันหนึ่งจะแก้ที่เดียวแล้วอีกที่เพี้ยนตาม
 */

export type Group = {
  /** ดัชนีเริ่มต้น (รวม) */
  start: number
  /** ดัชนีสุดท้าย (ไม่รวม) */
  end: number
  seconds: number
}

/**
 * ปิดกลุ่ม "ก่อน" จะเกินเป้า ไม่ใช่หลังเกิน
 *
 * รายการที่ยาวเกินเป้าด้วยตัวเองยังต้องได้อยู่ในกลุ่มของตัวเอง — กลุ่มจึงยาวเกินเป้าได้
 * ดีกว่าทิ้งของหรือหั่นจนเสีย
 */
export function groupByDuration(durationsSec: number[], targetSeconds: number): Group[] {
  if (durationsSec.length === 0) return []

  const groups: Group[] = []
  let start = 0
  let seconds = 0

  durationsSec.forEach((duration, i) => {
    if (seconds > 0 && seconds + duration > targetSeconds) {
      groups.push({ start, end: i, seconds: round(seconds) })
      start = i
      seconds = 0
    }

    seconds += duration
  })

  groups.push({ start, end: durationsSec.length, seconds: round(seconds) })

  return groups
}

/** ความยาวรวมของแต่ละกลุ่ม — ใช้ต่อเป็นอินพุตของการจัดกลุ่มชั้นถัดไป */
export function groupSeconds(groups: Group[]): number[] {
  return groups.map((group) => group.seconds)
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000
}
