/**
 * สัญญากลางของผู้ให้บริการสร้างวิดีโอ
 *
 * เขียนเป็น interface ตั้งแต่ต้นเพราะบทเรียนที่เพิ่งเจอมา: OpenAI ประกาศเลิก
 * Videos API ล่วงหน้า 6 เดือน ผู้ให้บริการวิดีโอเปลี่ยนเร็วกว่าโมเดลภาษามาก
 * ผูกโค้ดกับเจ้าใดเจ้าหนึ่งตรง ๆ แล้ววันที่เขาปิด เราต้องรื้อทั้งเส้นทาง
 *
 * ⚠️ ข้อที่ต่างจาก provider layer อื่นในโปรเจคนี้ (llm.ts / tts / image-gen):
 * งานสร้างวิดีโอเป็น "งานยาว" ไม่ใช่ request-response — เรียกแล้วได้ id กลับมา
 * ต้องถามสถานะเป็นระยะจนเสร็จ (นาที ไม่ใช่วินาที) จึงต้องแยก start กับ poll
 * ออกจากกัน · เขียนเป็นฟังก์ชันเดียวที่รอจนเสร็จจะค้าง worker ไว้ทั้งตัว
 * และ retry ทีไรก็เสียเงินสร้างใหม่ทุกครั้งเพราะไม่มี id ให้กลับไปถาม
 */

export type VideoProviderId = 'veo' | 'runway'

/**
 * ระดับคุณภาพที่เทียบข้ามเจ้าได้
 *
 * ไม่ใช้ชื่อรุ่นของแต่ละเจ้าตรง ๆ เพราะชื่อรุ่นเปลี่ยนทุกไม่กี่เดือน
 * ส่วนความหมายของ "ถูก/เร็ว/สวย" ไม่เปลี่ยน — ให้ adapter แปลเป็นชื่อรุ่นเอง
 */
export type VideoTier = 'lite' | 'fast' | 'quality'

export type VideoAspect = '9:16' | '16:9'

export type GenerateVideoInput = {
  prompt: string
  /** ความยาวที่ขอ (วินาที) — ผู้ให้บริการส่วนใหญ่จำกัดไว้ราว 8 วินาทีต่อครั้ง */
  seconds: number
  aspect: VideoAspect
  tier: VideoTier
}

export type VideoJobStatus = 'running' | 'done' | 'failed'

export type VideoJobState = {
  status: VideoJobStatus
  /** มีเมื่อ status = done · เป็นลิงก์ชั่วคราวของผู้ให้บริการ ต้องรีบโหลดเก็บ */
  videoUrl?: string
  error?: string
}

export interface VideoProvider {
  readonly id: VideoProviderId

  /** ความยาวสูงสุดต่อการเรียกหนึ่งครั้ง — เกินนี้ต้องสร้างหลายท่อนแล้วต่อกัน */
  readonly maxSeconds: number

  /**
   * ราคาโดยประมาณ "ก่อน" เรียก — ต้องคำนวณได้โดยไม่ต้องยิงเน็ต
   * เพราะด่านคุมงบต้องตัดสินก่อนที่เงินจะออก ไม่ใช่หลังจากนั้น
   */
  costUsd(input: GenerateVideoInput): number

  /** เริ่มงาน คืน id ของฝั่งผู้ให้บริการไว้ถามสถานะทีหลัง */
  start(input: GenerateVideoInput): Promise<string>

  /** ถามสถานะงาน — ปลอดภัยที่จะเรียกซ้ำ ไม่มีค่าใช้จ่ายเพิ่ม */
  poll(providerJobId: string): Promise<VideoJobState>

  /** โหลดไฟล์วิดีโอจากลิงก์ที่ poll คืนมา */
  download(videoUrl: string): Promise<Uint8Array>
}

/**
 * เพดานค่าใช้จ่ายต่อการสร้างหนึ่งครั้ง
 *
 * ด่านนี้มีไว้กันความผิดพลาดที่แพงที่สุด: ขอคลิปยาวเกินตั้งใจ
 * คลิป 8 วินาทีราคา $0.40 แต่ถ้ามีบั๊กส่ง 800 วินาทีไป = $40 ในคำสั่งเดียว
 * เครดิตของระบบกันได้แค่ "จำนวนงาน" ไม่ได้กันขนาดของงานแต่ละชิ้น
 */
/**
 * ⚠️ อ่าน env ตอนเรียก ไม่ใช่ตอนโหลดโมดูล
 *
 * เขียนเป็น `const X = Number(process.env...)` ระดับบนสุดของไฟล์แล้วค่านั้น
 * จะถูกตรึงตั้งแต่ ESM ประเมิน import ซึ่งเกิดก่อน loadEnv() เสมอ
 * ผลคือได้ค่า default ไปทั้งที่ตั้งไว้ใน .env.local แล้ว โดยไม่มีอะไรฟ้อง
 * (worker/env.ts เตือนกับดักนี้ไว้แล้ว และเทสต์ชุดนี้จับได้อีกรอบ)
 */
export function maxCostUsd(): number {
  const raw = Number(process.env.VIDEO_MAX_COST_USD)
  return Number.isFinite(raw) && raw > 0 ? raw : 5
}

export class VideoCostExceeded extends Error {
  constructor(
    readonly costUsd: number,
    readonly ceiling: number,
  ) {
    super(
      `คลิปนี้จะเสีย $${costUsd.toFixed(2)} เกินเพดาน $${ceiling.toFixed(2)} ต่อครั้ง ` +
        '— ลดความยาว ลดคุณภาพ หรือขยายเพดานด้วย VIDEO_MAX_COST_USD',
    )
  }
}

/**
 * ตรวจงบก่อนเริ่มงานเสมอ
 *
 * แยกออกมาเป็นฟังก์ชันเพื่อให้ทั้ง UI (แสดงราคาก่อนกด) และ worker (กันจริง)
 * ใช้กติกาเดียวกัน — ถ้า UI คิดคนละสูตรกับ worker ผู้ใช้จะเห็นราคาหนึ่ง
 * แล้วโดนอีกราคาหนึ่ง ซึ่งเป็นบั๊กที่ผู้ใช้ไม่มีทางเข้าใจ
 */
export function guardCost(provider: VideoProvider, input: GenerateVideoInput): number {
  const cost = provider.costUsd(input)
  const ceiling = maxCostUsd()

  if (cost > ceiling) throw new VideoCostExceeded(cost, ceiling)

  return cost
}

/** ตรวจว่าขอความยาวเกินที่เจ้านั้นทำได้ต่อครั้งหรือเปล่า */
export function clampSeconds(provider: VideoProvider, seconds: number): number {
  return Math.max(1, Math.min(Math.round(seconds), provider.maxSeconds))
}
