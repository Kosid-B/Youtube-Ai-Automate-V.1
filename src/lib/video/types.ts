/**
 * ชนิดข้อมูลกลางของงานสร้างวิดีโอ
 *
 * ทุกอย่างในไฟล์นี้เป็น "ภาษาของเรา" ไม่ใช่ของผู้ให้บริการเจ้าไหน
 * ตรรกะธุรกิจอ้างเฉพาะชนิดในไฟล์นี้ · adapter เป็นคนแปลไป-กลับ
 *
 * ทำไมสำคัญ: OpenAI ประกาศเลิก Videos API ล่วงหน้าแค่ 6 เดือน ผู้ให้บริการวิดีโอ
 * เปลี่ยนเร็วกว่าโมเดลภาษามาก · ถ้าชนิดข้อมูลของเราหน้าตาเหมือนของเจ้าใดเจ้าหนึ่ง
 * วันที่เขาปิด เราต้องรื้อทั้งเส้นทาง ไม่ใช่แค่เปลี่ยน adapter
 */

export type VideoProviderId = 'veo' | 'runway' | 'openai'

/**
 * ระดับคุณภาพที่เทียบข้ามเจ้าได้
 * ไม่ใช้ชื่อรุ่นตรง ๆ เพราะชื่อรุ่นเปลี่ยนทุกไม่กี่เดือน ส่วนความหมายของ
 * "ถูก/เร็ว/สวย" ไม่เปลี่ยน — ให้ adapter แปลเป็นชื่อรุ่นเอง
 */
export type VideoTier = 'lite' | 'fast' | 'quality'

/** นโยบายการเลือกเจ้า — ผู้ใช้เลือกความตั้งใจ ไม่ใช่เลือกยี่ห้อ */
export type RoutingPolicy = 'cheap' | 'fast' | 'quality' | 'auto'

export type VideoAspect = '9:16' | '16:9'

export type GenerateVideoInput = {
  prompt: string
  /** ความยาวที่ขอ (วินาที) — ผู้ให้บริการส่วนใหญ่จำกัดราว 8–10 วินาทีต่อครั้ง */
  seconds: number
  aspect: VideoAspect
  tier: VideoTier
}

export type VideoJobStatus = 'running' | 'done' | 'failed' | 'cancelled'

/**
 * รหัสข้อผิดพลาดกลาง — ตรรกะธุรกิจตัดสินจากรหัสนี้ ไม่ใช่จากข้อความ
 * ข้อความของแต่ละเจ้าต่างกันและเปลี่ยนได้ตลอด แมตช์ข้อความคือบั๊กที่รอเกิด
 */
export type VideoErrorCode =
  | 'auth'          // คีย์ผิด/หมดอายุ — ลองใหม่ไม่ช่วย
  | 'not_found'     // ชื่อรุ่นผิด หรือบัญชีไม่มีสิทธิ์ใช้รุ่นนั้น
  | 'rate_limit'    // ชนโควตา — ลองใหม่ทีหลังช่วยได้
  | 'invalid_input' // prompt/พารามิเตอร์ไม่ผ่าน — ลองใหม่ไม่ช่วยจนกว่าจะแก้
  | 'content_policy'// เนื้อหาถูกปฏิเสธ — ลองใหม่ไม่ช่วย
  | 'timeout'       // รอนานเกินเพดาน
  | 'provider'      // ฝั่งผู้ให้บริการพัง — ลองใหม่ช่วยได้
  | 'unknown'

/** รหัสที่ "ลองใหม่แล้วมีโอกาสสำเร็จ" — ที่เหลือลองซ้ำก็เสียเวลาและเงินเปล่า */
export const RETRYABLE_ERRORS: readonly VideoErrorCode[] = ['rate_limit', 'provider', 'timeout']

export function isRetryable(code: VideoErrorCode): boolean {
  return RETRYABLE_ERRORS.includes(code)
}

export class VideoProviderError extends Error {
  constructor(
    readonly code: VideoErrorCode,
    message: string,
    readonly providerId?: VideoProviderId,
    /** สถานะ HTTP ถ้ามี — เก็บไว้ debug ไม่ได้ใช้ตัดสินใจ */
    readonly status?: number,
  ) {
    super(message)
    this.name = 'VideoProviderError'
  }

  get retryable(): boolean {
    return isRetryable(this.code)
  }
}

export type VideoJobState = {
  status: VideoJobStatus
  /** มีเมื่อ status = done · เป็นลิงก์ชั่วคราวของผู้ให้บริการ ต้องรีบโหลดเก็บ */
  outputUrl?: string
  errorCode?: VideoErrorCode
  errorMessage?: string
  /** ราคาจริงถ้าผู้ให้บริการบอก — ส่วนใหญ่ไม่บอก ต้องใช้ค่าประมาณแทน */
  actualCostUsd?: number
}

export type StartedJob = {
  providerJobId: string
  model: string
  estimatedCostUsd: number
}
