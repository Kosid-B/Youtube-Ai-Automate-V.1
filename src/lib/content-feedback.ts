/**
 * ป้อนผลงานที่ผ่านมากลับเข้าไปตอนเขียนสคริปต์ใหม่
 *
 * ระบบรู้อยู่แล้วว่าคลิปไหนได้ผล (content_performance) แต่ความรู้นั้นไม่เคยถูกใช้
 * ตอนเขียนสคริปต์ถัดไป ทุกคลิปจึงเริ่มจากศูนย์เหมือนไม่เคยทำอะไรมาก่อน
 *
 * ⚠️ อันตรายของการป้อนกลับคือมันทำให้คอนเทนต์ลู่เข้าหาสิ่งที่เคยได้ผล แล้วหยุดค้นหา
 * ของที่ดีกว่า — และถ้าข้อมูลยังน้อย สิ่งที่ "เคยได้ผล" อาจเป็นแค่ความบังเอิญ
 * โมดูลนี้จึงมีกติกากันไว้สองข้อ ดูค่าคงที่ข้างล่าง
 */

/**
 * ต่ำกว่านี้ไม่ป้อนอะไรเลย
 *
 * เพดานผลิตของระบบคือ ~5 คลิป/วัน กว่าจะได้ 10 คลิปที่มีผลวัดแล้วใช้เวลาหลายวัน
 * ป้อนข้อมูล 3 คลิปเข้าไปแล้วบอกโมเดลว่า "แบบนี้ได้ผล" คือการสอนความบังเอิญ
 */
export const MIN_SAMPLE_FOR_GUIDANCE = 10

/** ค่าหนึ่งของคุณลักษณะต้องมีอย่างน้อยเท่านี้ ถึงจะเรียกว่า "ได้ผล" ได้ */
export const MIN_SAMPLE_PER_VALUE = 3

/**
 * ทุก ๆ กี่คลิปให้ลองของใหม่หนึ่งครั้ง
 *
 * ถ้าเลียนแบบสิ่งที่ได้ผลอย่างเดียว จะไม่มีวันรู้ว่ามีอะไรดีกว่านั้น
 * กันโควตาไว้ทดลอง 1 ใน 5 — จ่ายค่าคลิปที่อาจไม่ปังเพื่อแลกกับการได้เรียนรู้
 */
export const EXPLORE_EVERY = 5

export type FeaturePerformance = {
  feature_value: string
  sample_size: number
  median_views: number | null
}

export type Guidance =
  | { mode: 'none'; reason: string }
  | { mode: 'explore'; avoid: string[] }
  | { mode: 'exploit'; best: string; runnerUp: string | null; sampleSize: number }

/**
 * ตัดสินว่ารอบนี้จะบอกอะไรโมเดล
 *
 * @param rows       ผลจาก rpc content_feature_summary (เรียงตาม median_views มาก→น้อย)
 * @param clipsMade  จำนวนคลิปที่ช่องนี้ทำมาแล้ว — ใช้กำหนดว่ารอบไหนถึงคิวทดลอง
 */
export function buildGuidance(rows: FeaturePerformance[], clipsMade: number): Guidance {
  const usable = rows.filter(
    (r) => r.sample_size >= MIN_SAMPLE_PER_VALUE && r.median_views !== null,
  )
  const total = usable.reduce((sum, r) => sum + r.sample_size, 0)

  if (total < MIN_SAMPLE_FOR_GUIDANCE) {
    return {
      mode: 'none',
      reason: `มีผลวัดแล้ว ${total} คลิป ยังไม่ถึง ${MIN_SAMPLE_FOR_GUIDANCE} คลิป`,
    }
  }

  // ถึงคิวทดลอง — บอกให้เลี่ยงของเดิม ไม่ใช่แค่ "ไม่บอกอะไร"
  // ถ้าเงียบเฉย ๆ โมเดลก็จะเดาไปทางที่คุ้นเคยอยู่ดี ซึ่งมักเป็นทางเดิม
  if (clipsMade > 0 && clipsMade % EXPLORE_EVERY === 0) {
    return { mode: 'explore', avoid: usable.slice(0, 2).map((r) => r.feature_value) }
  }

  const [best, second] = usable
  return {
    mode: 'exploit',
    best: best.feature_value,
    runnerUp: second?.feature_value ?? null,
    sampleSize: best.sample_size,
  }
}

/**
 * แปลงเป็นข้อความสำหรับใส่ prompt
 *
 * บอกขนาดตัวอย่างไปด้วยเสมอ ให้โมเดลรู้ว่าหลักฐานหนักแค่ไหน
 * ไม่ใช่สั่งลอย ๆ ว่า "ใช้แบบนี้" ทั้งที่มาจากคลิปไม่กี่คลิป
 */
export function guidanceText(guidance: Guidance): string | null {
  switch (guidance.mode) {
    case 'none':
      return null

    case 'explore':
      return [
        'รอบนี้เป็นรอบทดลอง — ตั้งใจลองมุมเปิดเรื่องที่ช่องนี้ยังไม่เคยใช้',
        guidance.avoid.length > 0
          ? `เลี่ยงแบบที่ใช้บ่อยแล้ว: ${guidance.avoid.join(', ')}`
          : null,
        'ไม่ต้องกังวลว่าจะได้ผลน้อยกว่าเดิม รอบนี้มีไว้หาของใหม่',
      ]
        .filter(Boolean)
        .join('\n')

    case 'exploit':
      return [
        `จากคลิปที่วัดผลแล้วของช่องนี้ มุมเปิดเรื่องแบบ "${guidance.best}" ทำได้ดีที่สุด`,
        `(จาก ${guidance.sampleSize} คลิป — ยังเป็นตัวอย่างไม่มาก ใช้เป็นแนวทาง ไม่ใช่กฎ)`,
        guidance.runnerUp ? `รองลงมาคือ "${guidance.runnerUp}"` : null,
        'ถ้าหัวข้อนี้เหมาะกับแบบอื่นมากกว่า ให้เลือกแบบที่เหมาะกับเนื้อหาก่อน',
      ]
        .filter(Boolean)
        .join('\n')
  }
}
