/**
 * บันทึกเหตุการณ์ของงานสร้างวิดีโอแบบมีโครงสร้าง
 *
 * ออกเป็น JSON บรรทัดเดียวเพื่อให้ค้นและรวมยอดได้ · console.log ธรรมดา
 * อ่านด้วยตาได้แต่ตอบคำถาม "เดือนนี้ Veo ล้มกี่ครั้ง" ไม่ได้
 *
 * ⚠️ ห้ามใส่ลงในนี้เด็ดขาด: คีย์ API, โทเคน, อีเมล/ชื่อผู้ใช้, prompt เต็ม
 * prompt อาจมีข้อมูลธุรกิจของลูกค้า — เก็บแค่ความยาวไว้ดูว่าสั้นผิดปกติไหม
 */
import type { RoutingPolicy, VideoErrorCode, VideoProviderId } from '@/lib/video/types'

export type VideoLogEvent =
  | 'generation_requested'
  | 'provider_selected'
  | 'provider_job_started'
  | 'generation_completed'
  | 'generation_failed'
  | 'generation_retry'
  | 'generation_cancelled'

export type VideoLogFields = {
  generationId?: string
  orgId?: string
  provider?: VideoProviderId
  model?: string
  policy?: RoutingPolicy
  seconds?: number
  aspect?: string
  estimatedCostUsd?: number
  actualCostUsd?: number
  latencyMs?: number
  attempt?: number
  errorCode?: VideoErrorCode
  /** ข้อความสั้น ๆ พอให้ตามต่อ ไม่ใช่ stack เต็ม */
  reason?: string
  downgraded?: boolean
  /** ความยาว prompt — ไม่ใช่ตัว prompt */
  promptChars?: number
}

export function logVideo(event: VideoLogEvent, fields: VideoLogFields = {}): void {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    scope: 'video',
    event,
    ...fields,
  })

  if (event === 'generation_failed') console.error(line)
  else console.log(line)
}
