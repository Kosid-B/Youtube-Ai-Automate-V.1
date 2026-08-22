/**
 * Runway — ทางเลือกที่สอง และเป็น "ประกัน" ของระบบ
 *
 * เหตุผลที่มีเจ้าที่สองตั้งแต่ต้น ไม่รอให้เจ้าแรกพัง: บทเรียนจาก OpenAI
 * ที่ประกาศเลิก Videos API ล่วงหน้าแค่ 6 เดือน · มีเจ้าที่สองอยู่แล้วแปลว่า
 * วันที่เจ้าแรกขึ้นราคาหรือปิด เราสลับได้ในหนึ่งบรรทัด ไม่ต้องรื้อเส้นทาง
 *
 * ⚠️ ราคาไม่ตั้งค่าตายตัวในโค้ด — ผมยืนยันราคาต่อวินาทีของ Runway จากแหล่ง
 * ทางการไม่ได้ (คิดเป็นเครดิต ซึ่งราคาต่อเครดิตต่างกันตามแพ็ก) ตั้งผ่าน env
 * แล้วด่านคุมงบจะทำงานถูก · ไม่ตั้ง = ปฏิเสธไปเลย ดีกว่าเดาราคาแล้วงบบานโดยไม่รู้ตัว
 *
 * ⚠️ ยังไม่ได้ยิงกับ API จริง รูปแบบคำขอ/คำตอบอ้างจากเอกสาร
 */
import type {
  GenerateVideoInput,
  VideoJobState,
  VideoProvider,
  VideoTier,
} from '@/lib/video-provider'

const BASE = 'https://api.dev.runwayml.com/v1'

/** Runway บังคับให้ระบุเวอร์ชัน API ในหัวคำขอ ไม่ใส่ = ถูกปฏิเสธ */
// อ่าน env ตอนเรียกทั้งหมด ไม่ใช่ตอนโหลดโมดูล (ดู video-provider.ts → maxCostUsd)
function apiVersion(): string {
  return process.env.RUNWAY_API_VERSION || '2024-11-06'
}

export function runwayModel(tier: VideoTier): string {
  const overrides: Record<VideoTier, string | undefined> = {
    lite: process.env.RUNWAY_MODEL_LITE,
    fast: process.env.RUNWAY_MODEL_FAST,
    quality: process.env.RUNWAY_MODEL_QUALITY,
  }
  const defaults: Record<VideoTier, string> = {
    lite: 'gen4_turbo',
    fast: 'gen4_turbo',
    quality: 'gen4',
  }
  return overrides[tier] || defaults[tier]
}

export function runwayMaxSeconds(): number {
  const raw = Number(process.env.RUNWAY_MAX_SECONDS)
  return Number.isFinite(raw) && raw > 0 ? raw : 10
}

/**
 * ราคาต่อวินาที — ต้องตั้งเอง
 *
 * ปล่อยว่าง = costUsd() โยน error ซึ่งทำให้ด่านคุมงบปฏิเสธงานนั้นไปเลย
 * เป็นพฤติกรรมที่ตั้งใจ: ไม่รู้ราคา = ไม่ให้ใช้ ดีกว่าเดาแล้วบิลมาเกินคาด
 */
function usdPerSecond(tier: VideoTier): number {
  const raw = process.env[`RUNWAY_USD_PER_SECOND_${tier.toUpperCase()}`] ?? process.env.RUNWAY_USD_PER_SECOND

  const value = Number(raw)
  if (!raw || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `ไม่ได้ตั้งราคาต่อวินาทีของ Runway (RUNWAY_USD_PER_SECOND) — ` +
        'ด่านคุมงบทำงานไม่ได้ถ้าไม่รู้ราคา จึงไม่อนุญาตให้เรียก',
    )
  }

  return value
}

function apiKey(): string {
  const key = process.env.RUNWAY_API_KEY
  if (!key) throw new Error('ไม่ได้ตั้ง RUNWAY_API_KEY')
  return key
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey()}`,
    'X-Runway-Version': apiVersion(),
    'content-type': 'application/json',
  }
}

/** Runway รับเป็นอัตราส่วนพิกเซล ไม่ใช่ "9:16" — แปลงให้ตรงกับที่ระบบเราใช้ */
function ratio(aspect: GenerateVideoInput['aspect']): string {
  return aspect === '9:16' ? '720:1280' : '1280:720'
}

export function createRunwayProvider(fetchImpl: typeof fetch = fetch): VideoProvider {
  return {
    id: 'runway',
    maxSeconds: runwayMaxSeconds(),

    costUsd(input: GenerateVideoInput): number {
      return Math.round(input.seconds * usdPerSecond(input.tier) * 1000) / 1000
    },

    async start(input: GenerateVideoInput): Promise<string> {
      // เรียก costUsd ก่อนเสมอ — ถ้าไม่ได้ตั้งราคาไว้ ต้องล้มก่อนเงินออก ไม่ใช่หลัง
      this.costUsd(input)

      const response = await fetchImpl(`${BASE}/text_to_video`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          model: runwayModel(input.tier),
          promptText: input.prompt,
          ratio: ratio(input.aspect),
          duration: input.seconds,
        }),
      })

      if (!response.ok) {
        throw new Error(
          `เริ่มงานสร้างวิดีโอไม่สำเร็จ (${response.status}): ${(await response.text()).slice(0, 300)}`,
        )
      }

      const body = (await response.json()) as { id?: string }
      if (!body.id) throw new Error('Runway ไม่ได้คืน id ของงานกลับมา — ถามสถานะต่อไม่ได้')

      return body.id
    },

    async poll(providerJobId: string): Promise<VideoJobState> {
      const response = await fetchImpl(`${BASE}/tasks/${providerJobId}`, { headers: headers() })

      if (!response.ok) {
        return { status: 'failed', error: `ถามสถานะไม่สำเร็จ (${response.status})` }
      }

      const body = (await response.json()) as {
        status?: string
        output?: string[]
        failure?: string
        failureCode?: string
      }

      switch (body.status) {
        case 'SUCCEEDED': {
          const url = body.output?.[0]
          if (!url) return { status: 'failed', error: 'งานเสร็จแต่ไม่มีลิงก์วิดีโอกลับมา' }
          return { status: 'done', videoUrl: url }
        }
        case 'FAILED':
        case 'CANCELLED':
          return { status: 'failed', error: body.failure ?? body.failureCode ?? 'ไม่ทราบสาเหตุ' }
        default:
          // PENDING / RUNNING / THROTTLED — ยังไม่จบ ถามใหม่รอบหน้า
          return { status: 'running' }
      }
    },

    async download(videoUrl: string): Promise<Uint8Array> {
      // ลิงก์ผลลัพธ์ของ Runway เป็น URL ชั่วคราวที่เปิดได้ตรง ๆ ไม่ต้องแนบคีย์
      const response = await fetchImpl(videoUrl)
      if (!response.ok) throw new Error(`โหลดวิดีโอไม่สำเร็จ (${response.status})`)
      return new Uint8Array(await response.arrayBuffer())
    },
  }
}
