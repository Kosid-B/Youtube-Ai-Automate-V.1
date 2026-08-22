/**
 * Google Veo ผ่าน Gemini API
 *
 * ราคาที่ประกาศไว้ (ตรวจ ส.ค. 2569) — คิดตาม "วินาทีที่ผลิตได้จริง" รวมเสียงแล้ว:
 *   Lite     $0.05/วินาที (720p)
 *   Fast     $0.10/วินาที (720p)
 *   Standard $0.40/วินาที (720p/1080p)
 *
 * ⚠️ ยังไม่ได้ยิงกับ API จริง (ไม่มีคีย์ในเครื่องพัฒนา) รูปแบบคำขอ/คำตอบ
 * อ้างจากเอกสาร · เรียกครั้งแรกให้ดู log ว่าตรงไหม โดยเฉพาะชื่อฟิลด์ของ operation
 *
 * ⚠️ ชื่อรุ่นไม่ตั้งค่าตายตัวในโค้ด — Google เปลี่ยนชื่อรุ่นบ่อยและต่างกันตาม
 * สิ่งที่บัญชีเปิดใช้ได้ · ตั้งผ่าน env แล้ว preflight ตรวจให้ว่าเรียกได้จริงไหม
 */
import type {
  GenerateVideoInput,
  VideoJobState,
  VideoProvider,
  VideoTier,
} from '@/lib/video-provider'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * ชื่อรุ่นต่อระดับคุณภาพ — ตั้งทับได้ทีละตัวเมื่อ Google ออกรุ่นใหม่
 * อ่าน env ตอนเรียก ไม่ใช่ตอนโหลดโมดูล (ดูเหตุผลใน video-provider.ts → maxCostUsd)
 */
export function veoModel(tier: VideoTier): string {
  const overrides: Record<VideoTier, string | undefined> = {
    lite: process.env.VEO_MODEL_LITE,
    fast: process.env.VEO_MODEL_FAST,
    quality: process.env.VEO_MODEL_QUALITY,
  }
  const defaults: Record<VideoTier, string> = {
    lite: 'veo-3.1-lite',
    fast: 'veo-3.1-fast',
    quality: 'veo-3.1',
  }
  return overrides[tier] || defaults[tier]
}

/** USD ต่อวินาทีของวิดีโอที่ผลิตได้ (รวมเสียง) */
export const VEO_USD_PER_SECOND: Record<VideoTier, number> = {
  lite: 0.05,
  fast: 0.1,
  quality: 0.4,
}

/** Veo สร้างได้ครั้งละ ~8 วินาที — คลิปยาวกว่านั้นต้องสร้างหลายท่อนแล้วต่อกัน */
export const VEO_MAX_SECONDS = 8

function apiKey(): string {
  const key = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY
  if (!key) throw new Error('ไม่ได้ตั้ง GOOGLE_AI_API_KEY (สำหรับ Veo)')
  return key
}

export function createVeoProvider(fetchImpl: typeof fetch = fetch): VideoProvider {
  return {
    id: 'veo',
    maxSeconds: VEO_MAX_SECONDS,

    costUsd(input: GenerateVideoInput): number {
      const cost = input.seconds * VEO_USD_PER_SECOND[input.tier]
      return Math.round(cost * 1000) / 1000
    },

    async start(input: GenerateVideoInput): Promise<string> {
      const model = veoModel(input.tier)

      const response = await fetchImpl(`${BASE}/models/${model}:predictLongRunning`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey(), 'content-type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt: input.prompt }],
          parameters: {
            aspectRatio: input.aspect,
            durationSeconds: input.seconds,
          },
        }),
      })

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300)

        // 404 = ชื่อรุ่นผิดหรือบัญชียังไม่เปิดให้ใช้ · error ดิบไม่บอกว่าให้แก้ตรงไหน
        if (response.status === 404) {
          throw new Error(
            `บัญชีนี้เรียกรุ่น "${model}" ไม่ได้ — ตั้ง VEO_MODEL_${input.tier.toUpperCase()} ` +
              'ให้ตรงกับที่บัญชีมี (ดูด้วย pnpm preflight)',
          )
        }

        throw new Error(`เริ่มงานสร้างวิดีโอไม่สำเร็จ (${response.status}): ${detail}`)
      }

      const body = (await response.json()) as { name?: string }

      /**
       * ไม่มีชื่อ operation กลับมา = ถามสถานะไม่ได้ตลอดกาล และเงินออกไปแล้ว
       * ต้องล้มตรงนี้ให้ดัง ไม่ใช่คืนค่าว่างแล้วไปพังตอน poll
       */
      if (!body.name) throw new Error('Veo ไม่ได้คืนชื่อ operation กลับมา — ถามสถานะต่อไม่ได้')

      return body.name
    },

    async poll(providerJobId: string): Promise<VideoJobState> {
      const response = await fetchImpl(`${BASE}/${providerJobId}`, {
        headers: { 'x-goog-api-key': apiKey() },
      })

      if (!response.ok) {
        return { status: 'failed', error: `ถามสถานะไม่สำเร็จ (${response.status})` }
      }

      const body = (await response.json()) as {
        done?: boolean
        error?: { message?: string }
        response?: {
          generatedVideos?: { video?: { uri?: string } }[]
          generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[] }
        }
      }

      if (!body.done) return { status: 'running' }
      if (body.error) return { status: 'failed', error: body.error.message ?? 'ไม่ทราบสาเหตุ' }

      // รูปแบบคำตอบต่างกันตามรุ่น — รับทั้งสองแบบไว้ ดีกว่าพังเพราะรุ่นใหม่ย้ายฟิลด์
      const uri =
        body.response?.generatedVideos?.[0]?.video?.uri ??
        body.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri

      if (!uri) return { status: 'failed', error: 'งานเสร็จแต่ไม่มีลิงก์วิดีโอกลับมา' }

      return { status: 'done', videoUrl: uri }
    },

    async download(videoUrl: string): Promise<Uint8Array> {
      // ลิงก์ของ Gemini ต้องแนบคีย์ด้วย ไม่ใช่ลิงก์สาธารณะ
      const response = await fetchImpl(videoUrl, { headers: { 'x-goog-api-key': apiKey() } })

      if (!response.ok) {
        throw new Error(`โหลดวิดีโอไม่สำเร็จ (${response.status})`)
      }

      return new Uint8Array(await response.arrayBuffer())
    },
  }
}
