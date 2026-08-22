/**
 * เลือกผู้ให้บริการและระดับคุณภาพให้งานหนึ่งชิ้น
 *
 * มี Router ของเราเอง ไม่พึ่ง Router ของผู้ให้บริการ ด้วยเหตุผลเดียว:
 * Router ของเขาเลือกได้เฉพาะในบ้านเขา วันที่เราอยากย้ายทั้งบ้านก็ย้ายไม่ได้
 *
 * ตัดสินจากสามอย่างตามลำดับ:
 * 1. เจ้าไหนตั้งคีย์ไว้บ้าง — เจ้าที่ไม่มีคีย์ถือว่าไม่มีอยู่
 * 2. ความตั้งใจของงาน (ถูก / สวย)
 * 3. งบต่อชิ้น — เกินเพดานแล้วลดระดับลงก่อน ไม่ใช่ปฏิเสธทันที
 */
import {
  maxCostUsd,
  VideoCostExceeded,
  clampSeconds,
  type GenerateVideoInput,
  type VideoProvider,
  type VideoProviderId,
  type VideoTier,
} from '@/lib/video-provider'
import { createVeoProvider } from '@/lib/video-veo'
import { createRunwayProvider } from '@/lib/video-runway'

/** เรียงจากถูกไปแพง — ใช้ตอนต้องลดระดับให้เข้างบ */
export const TIER_ORDER: VideoTier[] = ['lite', 'fast', 'quality']

export type RouteInput = Omit<GenerateVideoInput, 'tier'> & {
  /** ระดับที่อยากได้ · ไม่ระบุ = ถูกที่สุด (โฆษณาสั้นทำหลายชิ้นเพื่อคัด ไม่ใช่ทำชิ้นเดียวให้สวย) */
  tier?: VideoTier
  /** บังคับใช้เจ้านี้ · ไม่ระบุ = ให้ router เลือก */
  prefer?: VideoProviderId
}

export type Route = {
  provider: VideoProvider
  input: GenerateVideoInput
  costUsd: number
  /** true = ถูกลดระดับลงเพราะงบไม่พอ · UI ควรบอกผู้ใช้ ไม่ใช่เปลี่ยนเงียบ ๆ */
  downgraded: boolean
}

/** เจ้าที่ตั้งคีย์ไว้แล้วเท่านั้น — ไม่มีคีย์ = ไม่มีอยู่ ไม่ใช่ error */
export function availableProviders(): VideoProvider[] {
  const list: VideoProvider[] = []

  if (process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY) {
    list.push(createVeoProvider())
  }
  if (process.env.RUNWAY_API_KEY) {
    list.push(createRunwayProvider())
  }

  return list
}

/**
 * เลือกเส้นทางที่ถูกที่สุดที่ยังอยู่ในงบ
 *
 * ลดระดับก่อนปฏิเสธ เพราะผู้ใช้ที่ขอคลิปแล้วได้ "ไม่ได้ เกินงบ" กลับมา
 * ไม่รู้ว่าต้องแก้อะไร ส่วนคนที่ได้คลิประดับ lite พร้อมคำอธิบายว่าลดให้เพราะอะไร
 * ตัดสินใจต่อเองได้ · แต่ต้องบอกเสมอ — เปลี่ยนคุณภาพเงียบ ๆ คือหลอกผู้ใช้
 */
export function route(input: RouteInput): Route {
  const providers = availableProviders()

  if (providers.length === 0) {
    throw new Error(
      'ยังไม่ได้ตั้งคีย์ผู้ให้บริการวิดีโอสักเจ้า — ตั้ง GOOGLE_AI_API_KEY (Veo) หรือ RUNWAY_API_KEY',
    )
  }

  const pool = input.prefer ? providers.filter((p) => p.id === input.prefer) : providers

  if (pool.length === 0) {
    throw new Error(`ยังไม่ได้ตั้งคีย์ของ ${input.prefer}`)
  }

  const wanted = input.tier ?? 'lite'
  const startAt = TIER_ORDER.indexOf(wanted)

  const ceiling = maxCostUsd()

  let cheapest: { route: Route; cost: number } | null = null
  let lastError: Error | null = null

  // ไล่จากระดับที่ขอลงมาหาถูกสุด · ระดับแรกที่เข้างบคือคำตอบ
  for (let i = startAt; i >= 0; i -= 1) {
    const tier = TIER_ORDER[i]

    for (const provider of pool) {
      const candidate: GenerateVideoInput = {
        prompt: input.prompt,
        aspect: input.aspect,
        seconds: clampSeconds(provider, input.seconds),
        tier,
      }

      let cost: number
      try {
        cost = provider.costUsd(candidate)
      } catch (error) {
        // เจ้าที่ยังไม่ได้ตั้งราคา (เช่น Runway) ข้ามไป ไม่ใช่ทำให้ทั้งงานล้ม
        lastError = error instanceof Error ? error : new Error(String(error))
        continue
      }

      if (cost > ceiling) continue

      if (!cheapest || cost < cheapest.cost) {
        cheapest = {
          cost,
          route: { provider, input: candidate, costUsd: cost, downgraded: tier !== wanted },
        }
      }
    }

    if (cheapest) return cheapest.route
  }

  /**
   * ไม่มีเจ้าไหนเข้างบเลยแม้ระดับถูกสุด — ต้องบอกตัวเลขที่ทำให้ตกงบ
   * ไม่ใช่แค่ "เกินงบ" ผู้ใช้จะได้รู้ว่าต้องลดความยาวเท่าไรถึงจะผ่าน
   */
  if (lastError) throw lastError

  const sample = pool[0]
  const cheapestPossible = sample.costUsd({
    prompt: input.prompt,
    aspect: input.aspect,
    seconds: clampSeconds(sample, input.seconds),
    tier: 'lite',
  })

  throw new VideoCostExceeded(cheapestPossible, ceiling)
}
