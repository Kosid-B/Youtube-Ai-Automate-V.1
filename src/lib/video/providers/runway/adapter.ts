/**
 * Runway — เจ้าที่สอง และเป็น "ประกัน" ของระบบ
 *
 * เหตุผลที่มีเจ้าที่สองตั้งแต่ต้น ไม่รอให้เจ้าแรกพัง: OpenAI ประกาศเลิก Videos API
 * ล่วงหน้าแค่ 6 เดือน · มีเจ้าที่สองอยู่แล้วแปลว่าวันที่เจ้าแรกขึ้นราคาหรือปิด
 * เราสลับได้โดยไม่แตะตรรกะธุรกิจเลย
 *
 * ⚠️ ราคาต้องตั้งเอง — Runway คิดเป็นเครดิตซึ่งราคาต่อเครดิตต่างกันตามแพ็ก
 *    ยืนยันราคาต่อวินาทีจากแหล่งทางการไม่ได้ · ไม่รู้ราคา = ด่านคุมงบทำงานไม่ได้
 *    = ไม่ให้ใช้ ดีกว่าเดาแล้วงบบานโดยไม่มีใครรู้
 * ⚠️ ยังไม่ได้ยิงกับ API จริง รูปแบบคำขอ/คำตอบอ้างจากเอกสาร
 */
import { fetchBytes, fetchJson } from '@/lib/video/http'
import type { VideoProvider } from '@/lib/video/provider'
import {
  VideoProviderError,
  type GenerateVideoInput,
  type StartedJob,
  type VideoAspect,
  type VideoJobState,
  type VideoTier,
} from '@/lib/video/types'
import type { RunwayTask } from '@/lib/video/providers/runway/types'

const BASE = 'https://api.dev.runwayml.com/v1'

const DEFAULT_MODELS: Record<VideoTier, string> = {
  lite: 'gen4_turbo',
  fast: 'gen4_turbo',
  quality: 'gen4',
}

/** Runway บังคับให้ระบุเวอร์ชัน API ในหัวคำขอ ไม่ใส่ = ถูกปฏิเสธ */
function apiVersion(): string {
  return process.env.RUNWAY_API_VERSION || '2024-11-06'
}

export function runwayModel(tier: VideoTier): string {
  const overrides: Record<VideoTier, string | undefined> = {
    lite: process.env.RUNWAY_MODEL_LITE,
    fast: process.env.RUNWAY_MODEL_FAST,
    quality: process.env.RUNWAY_MODEL_QUALITY,
  }
  return overrides[tier] || DEFAULT_MODELS[tier]
}

export function runwayMaxSeconds(): number {
  const raw = Number(process.env.RUNWAY_MAX_SECONDS)
  return Number.isFinite(raw) && raw > 0 ? raw : 10
}

function apiKey(): string {
  const key = process.env.RUNWAY_API_KEY
  if (!key) throw new VideoProviderError('auth', 'ไม่ได้ตั้ง RUNWAY_API_KEY', 'runway')
  return key
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey()}`,
    'X-Runway-Version': apiVersion(),
    'content-type': 'application/json',
  }
}

/** Runway รับเป็นอัตราส่วนพิกเซล ไม่ใช่ "9:16" */
function ratio(aspect: VideoAspect): string {
  return aspect === '9:16' ? '720:1280' : '1280:720'
}

export function runwayUsdPerSecond(tier: VideoTier): number {
  const raw =
    process.env[`RUNWAY_USD_PER_SECOND_${tier.toUpperCase()}`] ?? process.env.RUNWAY_USD_PER_SECOND

  const value = Number(raw)
  if (!raw || !Number.isFinite(value) || value <= 0) {
    throw new VideoProviderError(
      'invalid_input',
      'ไม่ได้ตั้ง RUNWAY_USD_PER_SECOND — ด่านคุมงบทำงานไม่ได้ถ้าไม่รู้ราคา จึงไม่อนุญาตให้เรียก',
      'runway',
    )
  }

  return value
}

export function createRunwayProvider(fetchImpl?: typeof fetch): VideoProvider {
  return {
    id: 'runway',
    maxSeconds: runwayMaxSeconds(),
    supportsCancel: true,

    modelFor: runwayModel,

    estimateCostUsd(input: GenerateVideoInput): number {
      return Math.round(input.seconds * runwayUsdPerSecond(input.tier) * 10000) / 10000
    },

    async generate(input: GenerateVideoInput): Promise<StartedJob> {
      // คิดราคาก่อนเสมอ — ไม่ได้ตั้งราคาไว้ต้องล้มก่อนเงินออก ไม่ใช่หลัง
      const estimatedCostUsd = this.estimateCostUsd(input)
      const model = runwayModel(input.tier)

      const task = await fetchJson<RunwayTask>(`${BASE}/text_to_video`, {
        providerId: 'runway',
        method: 'POST',
        headers: headers(),
        body: {
          model,
          promptText: input.prompt,
          ratio: ratio(input.aspect),
          duration: input.seconds,
        },
        // ห้าม retry ด้วยเหตุผลเดียวกับ Veo — คำขอนี้ไม่ idempotent
        retry: false,
        fetchImpl,
      })

      if (!task.id) {
        throw new VideoProviderError('provider', 'Runway ไม่ได้คืน id ของงาน — ถามสถานะต่อไม่ได้', 'runway')
      }

      return { providerJobId: task.id, model, estimatedCostUsd }
    },

    async getStatus(providerJobId: string): Promise<VideoJobState> {
      const task = await fetchJson<RunwayTask>(`${BASE}/tasks/${providerJobId}`, {
        providerId: 'runway',
        headers: headers(),
        retry: true,
        fetchImpl,
      })

      switch (task.status) {
        case 'SUCCEEDED': {
          const url = task.output?.[0]
          if (!url) {
            return { status: 'failed', errorCode: 'provider', errorMessage: 'งานเสร็จแต่ไม่มีลิงก์วิดีโอ' }
          }
          return { status: 'done', outputUrl: url }
        }
        case 'CANCELLED':
          return { status: 'cancelled' }
        case 'FAILED':
          return {
            status: 'failed',
            // Runway ใช้ failureCode บอกว่าเป็นเรื่องนโยบายเนื้อหาหรือปัญหาระบบ
            errorCode: task.failureCode?.includes('SAFETY') ? 'content_policy' : 'provider',
            errorMessage: task.failure ?? task.failureCode ?? 'ไม่ทราบสาเหตุ',
          }
        default:
          // PENDING / RUNNING / THROTTLED — ยังไม่จบ
          return { status: 'running' }
      }
    },

    async cancel(providerJobId: string): Promise<void> {
      await fetchJson(`${BASE}/tasks/${providerJobId}`, {
        providerId: 'runway',
        method: 'DELETE',
        headers: headers(),
        retry: true,
        fetchImpl,
      })
    },

    async getResult(outputUrl: string): Promise<Uint8Array> {
      // ลิงก์ผลลัพธ์ของ Runway เป็น URL ชั่วคราวที่เปิดได้ตรง ๆ ไม่ต้องแนบคีย์
      return fetchBytes(outputUrl, { providerId: 'runway', fetchImpl })
    },
  }
}
