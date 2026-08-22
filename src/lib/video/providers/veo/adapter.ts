/**
 * Google Veo ผ่าน Gemini API
 *
 * ราคาที่ประกาศไว้ (ตรวจ ส.ค. 2569) คิดตาม "วินาทีที่ผลิตได้จริง" รวมเสียงแล้ว:
 *   Lite $0.05/วินาที (720p) · Fast $0.10/วินาที (720p) · Standard $0.40/วินาที (720p/1080p)
 *
 * ⚠️ ยังไม่ได้ยิงกับ API จริง (ไม่มีคีย์ในเครื่องพัฒนา) รูปแบบคำขอ/คำตอบอ้างจากเอกสาร
 * ⚠️ ชื่อรุ่นตั้งผ่าน env ได้ทุกตัว — Google เปลี่ยนชื่อรุ่นบ่อยและต่างกันตามบัญชี
 *    เดาไว้ตายตัวแล้วผิดจะได้ 404 ที่ไม่บอกว่าให้แก้ตรงไหน
 */
import { fetchBytes, fetchJson } from '@/lib/video/http'
import type { VideoProvider } from '@/lib/video/provider'
import {
  VideoProviderError,
  type GenerateVideoInput,
  type StartedJob,
  type VideoJobState,
  type VideoTier,
} from '@/lib/video/types'
import type { VeoOperation } from '@/lib/video/providers/veo/types'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** USD ต่อวินาทีของวิดีโอที่ผลิตได้ (รวมเสียง) */
export const VEO_USD_PER_SECOND: Record<VideoTier, number> = {
  lite: 0.05,
  fast: 0.1,
  quality: 0.4,
}

/** Veo สร้างได้ครั้งละ ~8 วินาที — คลิปยาวกว่านั้นต้องสร้างหลายท่อนแล้วต่อกัน */
export const VEO_MAX_SECONDS = 8

const DEFAULT_MODELS: Record<VideoTier, string> = {
  lite: 'veo-3.1-lite',
  fast: 'veo-3.1-fast',
  quality: 'veo-3.1',
}

/**
 * อ่าน env ตอนเรียก ไม่ใช่ตอนโหลดโมดูล
 * `const X = process.env...` ระดับบนสุดจะถูกตรึงก่อน loadEnv() เสมอ
 * ได้ค่า default ไปทั้งที่ตั้งไว้แล้ว โดยไม่มีอะไรฟ้อง
 */
export function veoModel(tier: VideoTier): string {
  const overrides: Record<VideoTier, string | undefined> = {
    lite: process.env.VEO_MODEL_LITE,
    fast: process.env.VEO_MODEL_FAST,
    quality: process.env.VEO_MODEL_QUALITY,
  }
  return overrides[tier] || DEFAULT_MODELS[tier]
}

export function veoApiKey(): string {
  const key = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY
  if (!key) {
    throw new VideoProviderError('auth', 'ไม่ได้ตั้ง GOOGLE_AI_API_KEY (สำหรับ Veo)', 'veo')
  }
  return key
}

export function createVeoProvider(fetchImpl?: typeof fetch): VideoProvider {
  return {
    id: 'veo',
    maxSeconds: VEO_MAX_SECONDS,
    // Gemini ยังไม่มีปลายทางยกเลิก long-running operation ของ Veo
    supportsCancel: false,

    modelFor: veoModel,

    estimateCostUsd(input: GenerateVideoInput): number {
      return Math.round(input.seconds * VEO_USD_PER_SECOND[input.tier] * 10000) / 10000
    },

    async generate(input: GenerateVideoInput): Promise<StartedJob> {
      const model = veoModel(input.tier)

      const operation = await fetchJson<VeoOperation>(
        `${BASE}/models/${model}:predictLongRunning`,
        {
          providerId: 'veo',
          method: 'POST',
          headers: { 'x-goog-api-key': veoApiKey(), 'content-type': 'application/json' },
          body: {
            instances: [{ prompt: input.prompt }],
            parameters: { aspectRatio: input.aspect, durationSeconds: input.seconds },
          },
          // ⚠️ ห้าม retry — คำขอนี้ไม่ idempotent ลองใหม่หลัง timeout อาจได้สองงาน
          // ที่คิดเงินสองรอบ โดยเรารู้จัก id แค่อันเดียว
          retry: false,
          fetchImpl,
        },
      )

      /**
       * ไม่มีชื่อ operation กลับมา = ถามสถานะไม่ได้ตลอดกาล และเงินออกไปแล้ว
       * ต้องล้มตรงนี้ให้ดัง ไม่ใช่คืนค่าว่างแล้วไปพังตอน getStatus
       */
      if (!operation.name) {
        throw new VideoProviderError('provider', 'Veo ไม่ได้คืนชื่อ operation — ถามสถานะต่อไม่ได้', 'veo')
      }

      return {
        providerJobId: operation.name,
        model,
        estimatedCostUsd: this.estimateCostUsd(input),
      }
    },

    async getStatus(providerJobId: string): Promise<VideoJobState> {
      const operation = await fetchJson<VeoOperation>(`${BASE}/${providerJobId}`, {
        providerId: 'veo',
        headers: { 'x-goog-api-key': veoApiKey() },
        // ถามสถานะ idempotent — retry ได้ปลอดภัย
        retry: true,
        fetchImpl,
      })

      if (!operation.done) return { status: 'running' }

      if (operation.error) {
        return {
          status: 'failed',
          errorCode: 'provider',
          errorMessage: operation.error.message ?? 'ไม่ทราบสาเหตุ',
        }
      }

      const uri =
        operation.response?.generatedVideos?.[0]?.video?.uri ??
        operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri

      if (!uri) {
        return { status: 'failed', errorCode: 'provider', errorMessage: 'งานเสร็จแต่ไม่มีลิงก์วิดีโอ' }
      }

      return { status: 'done', outputUrl: uri }
    },

    async getResult(outputUrl: string): Promise<Uint8Array> {
      // ลิงก์ของ Gemini ต้องแนบคีย์ ไม่ใช่ลิงก์สาธารณะ
      return fetchBytes(outputUrl, {
        providerId: 'veo',
        headers: { 'x-goog-api-key': veoApiKey() },
        fetchImpl,
      })
    },
  }
}
