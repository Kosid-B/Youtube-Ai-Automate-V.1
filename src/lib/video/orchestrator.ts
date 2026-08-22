/**
 * ตรรกะธุรกิจของการสร้างวิดีโอ
 *
 * ⚠️ ชั้นนี้ห้ามรู้จักชื่อเจ้าใดเจ้าหนึ่ง — ทั้งไฟล์ไม่มีคำว่า Veo หรือ Runway
 * รู้จักแค่ VideoProvider กับ router · นั่นคือสิ่งที่ทำให้เสียบเจ้าใหม่ได้
 * โดยไม่ต้องแตะไฟล์นี้
 *
 * หน้าที่: ตรวจงบ → เลือกเจ้า → สั่ง → บันทึก → รายงาน
 * ไม่รวมการเก็บลงฐานข้อมูล (อยู่ที่ชั้น API) เพื่อให้เทสต์ได้โดยไม่ต้องมี Supabase
 */
import { route, maxDurationSeconds, VideoCostExceeded, type Route, type RouteRequest } from '@/lib/video/router'
import { logVideo } from '@/lib/video/log'
import {
  VideoProviderError,
  type StartedJob,
  type VideoJobState,
  type VideoProviderId,
} from '@/lib/video/types'
import { getProvider } from '@/lib/video/registry'

export type DispatchInput = RouteRequest & {
  /** ใช้ในบันทึกเท่านั้น ไม่ได้ส่งไปให้ผู้ให้บริการ */
  orgId: string
  generationId: string
}

export type Dispatched = StartedJob & {
  provider: VideoProviderId
  seconds: number
  downgraded: boolean
}

/**
 * ตรวจงบและความยาวก่อนเลือกเจ้า
 *
 * ⚠️ ห้ามเชื่อค่าที่ผู้ใช้ส่งมาเรื่องราคาเด็ดขาด — ราคาคิดจาก provider ฝั่งเรา
 * เท่านั้น · ผู้ใช้ส่งได้แค่ "อยากได้อะไร" ไม่ใช่ "ราคาเท่าไร"
 */
export function planGeneration(input: RouteRequest, fetchImpl?: typeof fetch): Route {
  const ceiling = maxDurationSeconds()

  if (input.seconds > ceiling) {
    throw new VideoProviderError(
      'invalid_input',
      `ขอคลิปยาว ${input.seconds} วินาที เกินเพดาน ${ceiling} วินาทีต่อชิ้น`,
    )
  }

  return route(input, fetchImpl)
}

/**
 * สั่งงานจริง
 *
 * บันทึกทุกก้าวเพราะเป็นเส้นทางที่ใช้เงิน — เวลามีบิลผิดปกติ ต้องย้อนได้ว่า
 * ชิ้นไหนไปเจ้าไหน ราคาประมาณเท่าไร และใช้เวลาเท่าไร
 */
export async function dispatchGeneration(
  input: DispatchInput,
  fetchImpl?: typeof fetch,
): Promise<Dispatched> {
  const startedAt = Date.now()

  logVideo('generation_requested', {
    generationId: input.generationId,
    orgId: input.orgId,
    policy: input.policy,
    seconds: input.seconds,
    aspect: input.aspect,
    promptChars: input.prompt.length,
  })

  let plan: Route
  try {
    plan = planGeneration(input, fetchImpl)
  } catch (error) {
    const code = error instanceof VideoProviderError ? error.code : 'unknown'
    logVideo('generation_failed', {
      generationId: input.generationId,
      orgId: input.orgId,
      errorCode: code,
      reason: error instanceof Error ? error.message.slice(0, 200) : undefined,
      latencyMs: Date.now() - startedAt,
    })
    throw error
  }

  logVideo('provider_selected', {
    generationId: input.generationId,
    orgId: input.orgId,
    provider: plan.provider.id,
    model: plan.model,
    policy: input.policy,
    seconds: plan.input.seconds,
    estimatedCostUsd: plan.estimatedCostUsd,
    downgraded: plan.downgraded,
  })

  try {
    const started = await plan.provider.generate(plan.input)

    logVideo('provider_job_started', {
      generationId: input.generationId,
      orgId: input.orgId,
      provider: plan.provider.id,
      model: started.model,
      estimatedCostUsd: started.estimatedCostUsd,
      latencyMs: Date.now() - startedAt,
    })

    return {
      ...started,
      provider: plan.provider.id,
      seconds: plan.input.seconds,
      downgraded: plan.downgraded,
    }
  } catch (error) {
    const code = error instanceof VideoProviderError ? error.code : 'unknown'
    logVideo('generation_failed', {
      generationId: input.generationId,
      orgId: input.orgId,
      provider: plan.provider.id,
      errorCode: code,
      reason: error instanceof Error ? error.message.slice(0, 200) : undefined,
      latencyMs: Date.now() - startedAt,
    })
    throw error
  }
}

/** ถามสถานะผ่านชั้นกลาง — ผู้เรียกไม่ต้องรู้ว่าเป็นเจ้าไหน */
export async function checkGeneration(
  providerId: VideoProviderId,
  providerJobId: string,
  fetchImpl?: typeof fetch,
): Promise<VideoJobState> {
  const provider = getProvider(providerId, fetchImpl)

  if (!provider) {
    return {
      status: 'failed',
      errorCode: 'invalid_input',
      errorMessage: `ยังไม่ได้ตั้งคีย์ของ ${providerId} — ถามสถานะงานเดิมไม่ได้`,
    }
  }

  return provider.getStatus(providerJobId)
}

/** ยกเลิก — คืน false เมื่อเจ้านั้นไม่รองรับ ไม่ใช่โยน error */
export async function cancelGeneration(
  providerId: VideoProviderId,
  providerJobId: string,
  fetchImpl?: typeof fetch,
): Promise<boolean> {
  const provider = getProvider(providerId, fetchImpl)
  if (!provider?.supportsCancel || !provider.cancel) return false

  await provider.cancel(providerJobId)
  logVideo('generation_cancelled', { provider: providerId })
  return true
}

export { VideoCostExceeded }
