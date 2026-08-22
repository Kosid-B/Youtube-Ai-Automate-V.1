/**
 * เลือกผู้ให้บริการและระดับคุณภาพให้งานหนึ่งชิ้น
 *
 * มี Router ของเราเอง ไม่พึ่ง Router ของผู้ให้บริการ ด้วยเหตุผลเดียว:
 * Router ของเขาเลือกได้เฉพาะในบ้านเขา วันที่เราอยากย้ายทั้งบ้านก็ย้ายไม่ได้
 *
 * ⚠️ ต้อง deterministic — อินพุตเดียวกันต้องได้เจ้าเดียวกันเสมอ
 * ไม่งั้นผู้ใช้เห็นราคาตอนกด แล้วโดนอีกราคาตอนจ่าย ซึ่งเป็นบั๊กที่อธิบายไม่ได้
 * (ไม่มีการสุ่ม ไม่มีการอ่านเวลา ไม่มีการยิงเน็ตในไฟล์นี้)
 */
import { availableProviders, getProvider } from '@/lib/video/registry'
import type { VideoProvider } from '@/lib/video/provider'
import {
  VideoProviderError,
  type GenerateVideoInput,
  type RoutingPolicy,
  type VideoAspect,
  type VideoProviderId,
  type VideoTier,
} from '@/lib/video/types'

/** เรียงจากถูกไปแพง — ตรรกะลดระดับพึ่งลำดับนี้ */
export const TIER_ORDER: VideoTier[] = ['lite', 'fast', 'quality']

/** ระดับที่แต่ละนโยบายอยากได้ก่อน */
const POLICY_TIER: Record<Exclude<RoutingPolicy, 'auto'>, VideoTier> = {
  cheap: 'lite',
  fast: 'fast',
  quality: 'quality',
}

export function maxCostUsd(): number {
  const raw = Number(process.env.MAX_VIDEO_COST_USD)
  return Number.isFinite(raw) && raw > 0 ? raw : 5
}

export function maxDurationSeconds(): number {
  const raw = Number(process.env.MAX_VIDEO_DURATION_SECONDS)
  return Number.isFinite(raw) && raw > 0 ? raw : 30
}

export class VideoCostExceeded extends VideoProviderError {
  constructor(
    readonly costUsd: number,
    readonly ceiling: number,
  ) {
    super(
      'invalid_input',
      `คลิปนี้จะเสีย $${costUsd.toFixed(2)} เกินเพดาน $${ceiling.toFixed(2)} ต่อครั้ง ` +
        '— ลดความยาว ลดคุณภาพ หรือขยายเพดานด้วย MAX_VIDEO_COST_USD',
    )
    this.name = 'VideoCostExceeded'
  }
}

export type RouteRequest = {
  prompt: string
  seconds: number
  aspect: VideoAspect
  policy: RoutingPolicy
  /** บังคับใช้เจ้านี้ — ใช้ตอนทดสอบหรือเมื่อผู้ใช้เลือกเอง */
  prefer?: VideoProviderId
}

export type Route = {
  provider: VideoProvider
  input: GenerateVideoInput
  model: string
  estimatedCostUsd: number
  /** true = ถูกลดระดับเพราะงบไม่พอ · UI ต้องบอก ไม่ใช่เปลี่ยนเงียบ ๆ */
  downgraded: boolean
}

/** บีบความยาวให้อยู่ในทั้งเพดานของระบบและของเจ้านั้น */
export function clampSeconds(provider: VideoProvider, seconds: number): number {
  const ceiling = Math.min(provider.maxSeconds, maxDurationSeconds())
  return Math.max(1, Math.min(Math.round(seconds), ceiling))
}

/**
 * เลือกเส้นทาง
 *
 * cheap/fast/quality = ล็อกระดับที่ขอ · auto = เริ่มจาก quality แล้วลดลงจนเข้างบ
 * ทุกนโยบายลดระดับได้เมื่องบไม่พอ เพราะ "ไม่ได้ เกินงบ" ไม่บอกผู้ใช้ว่าต้องแก้อะไร
 * แต่ต้องติดธง downgraded เสมอ
 */
export function route(request: RouteRequest, fetchImpl?: typeof fetch): Route {
  const providers = request.prefer
    ? [getProvider(request.prefer, fetchImpl)].filter((p): p is VideoProvider => p !== null)
    : availableProviders(fetchImpl)

  if (providers.length === 0) {
    throw new VideoProviderError(
      'invalid_input',
      request.prefer
        ? `ยังไม่ได้ตั้งคีย์ของ ${request.prefer}`
        : 'ยังไม่ได้ตั้งคีย์ผู้ให้บริการวิดีโอสักเจ้า — ตั้ง GOOGLE_AI_API_KEY (Veo) หรือ RUNWAY_API_KEY',
    )
  }

  const wanted = request.policy === 'auto' ? 'quality' : POLICY_TIER[request.policy]
  const ceiling = maxCostUsd()

  let cheapestOverall: number | null = null

  // ไล่จากระดับที่ขอลงมา · ระดับแรกที่มีเจ้าเข้างบคือคำตอบ
  for (let i = TIER_ORDER.indexOf(wanted); i >= 0; i -= 1) {
    const tier = TIER_ORDER[i]
    let best: Route | null = null

    for (const provider of providers) {
      const input: GenerateVideoInput = {
        prompt: request.prompt,
        aspect: request.aspect,
        seconds: clampSeconds(provider, request.seconds),
        tier,
      }

      let cost: number
      try {
        cost = provider.estimateCostUsd(input)
      } catch {
        // เจ้าที่ยังตั้งราคาไม่ครบ ข้ามไป ไม่ใช่ทำให้ทั้งงานล้ม
        continue
      }

      cheapestOverall = cheapestOverall === null ? cost : Math.min(cheapestOverall, cost)
      if (cost > ceiling) continue

      if (!best || cost < best.estimatedCostUsd) {
        best = {
          provider,
          input,
          model: provider.modelFor(tier),
          estimatedCostUsd: cost,
          downgraded: tier !== wanted,
        }
      }
    }

    if (best) return best
  }

  if (cheapestOverall === null) {
    throw new VideoProviderError(
      'invalid_input',
      'ไม่มีผู้ให้บริการที่ตั้งราคาไว้ครบ — ตรวจ RUNWAY_USD_PER_SECOND',
    )
  }

  throw new VideoCostExceeded(cheapestOverall, ceiling)
}
