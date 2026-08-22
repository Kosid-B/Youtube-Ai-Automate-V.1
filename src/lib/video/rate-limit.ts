/**
 * จำกัดอัตราการสั่งงาน
 *
 * เขียนเป็นชั้นนามธรรมตั้งแต่ต้นเพราะตัวนับในหน่วยความจำใช้ได้แค่ตอนมีเครื่องเดียว
 * — Vercel รันหลาย instance ตัวนับจะแยกกันคนละก้อน แปลว่าเพดานจริงคือ
 * (เพดานที่ตั้ง × จำนวน instance) ซึ่งไม่ใช่สิ่งที่ใครตั้งใจ
 *
 * ตอนนี้ใช้ในหน่วยความจำไปก่อนเพราะยังไม่มี Redis · วันที่ต้องการของจริง
 * เปลี่ยนแค่ตัว implement ไม่ต้องแตะที่เรียก
 */

export interface RateLimiter {
  /** true = ผ่าน · false = เกินเพดาน */
  check(key: string): Promise<boolean>
}

export type RateLimitConfig = {
  /** จำนวนครั้งที่ทำได้ในหนึ่งช่วงเวลา */
  limit: number
  windowMs: number
}

export const GENERATE_LIMIT: RateLimitConfig = {
  limit: Number(process.env.VIDEO_RATE_LIMIT) || 10,
  windowMs: 60 * 60 * 1000,
}

/**
 * ตัวนับในหน่วยความจำ — ใช้ได้จริงเมื่อรัน instance เดียว
 * ⚠️ อย่าเข้าใจผิดว่านี่คือการกันจริงบน serverless (ดูหมายเหตุหัวไฟล์)
 */
export function createMemoryRateLimiter(config: RateLimitConfig): RateLimiter {
  const hits = new Map<string, number[]>()

  return {
    async check(key: string): Promise<boolean> {
      const now = Date.now()
      const cutoff = now - config.windowMs
      const recent = (hits.get(key) ?? []).filter((at) => at > cutoff)

      if (recent.length >= config.limit) {
        hits.set(key, recent)
        return false
      }

      recent.push(now)
      hits.set(key, recent)
      return true
    },
  }
}

let shared: RateLimiter | null = null

export function generateRateLimiter(): RateLimiter {
  if (!shared) shared = createMemoryRateLimiter(GENERATE_LIMIT)
  return shared
}
