/**
 * สร้างภาพประกอบด้วย OpenAI แทนการค้นภาพสต็อก
 *
 * ทำไมถึงคุ้มกว่า Pexels สำหรับโปรเจคนี้:
 * - Pexels ให้ 200 คำค้นต่อชั่วโมง ซึ่งเป็นเพดานของ "ทั้งบัญชี" ไม่ใช่ต่อคลิป
 *   ทำสองคลิปยาวพิเศษในชั่วโมงเดียวกันไม่ได้ แม้จะลดเหลือ 45 ภาพต่อคลิปแล้ว
 * - ภาพสต็อกได้แค่ "ใกล้เคียง" กับเนื้อหา · ภาพที่สร้างตรงกับสิ่งที่กำลังพูดถึงจริง
 *
 * ⚠️ สิ่งที่แลกไป และต้องรู้ก่อนเปิดใช้:
 * - เสียเงินต่อภาพ (Pexels ฟรี) — ดู imageCostUsd()
 * - ต้องเปิดเผยว่าเป็นภาพ AI · YouTube บังคับเปิดเผยเนื้อหาสังเคราะห์ที่ดูสมจริง
 *   (นโยบาย Inauthentic Content) ระบบใส่บรรทัดเปิดเผยให้อัตโนมัติใน creditBlock
 * - โมเดลสร้างภาพเขียนตัวหนังสือไทยไม่ได้ ออกมาเป็นอักษรมั่ว — prompt ต้องสั่งห้ามมีตัวหนังสือ
 *
 * ⚠️ ยังไม่ได้ทดสอบกับ API จริง (ไม่มีคีย์ในเครื่องที่พัฒนา) ค่าพารามิเตอร์
 * อ้างจากเอกสารเดือน ส.ค. 2569 · เรียกครั้งแรกให้ดู log ว่าตอบกลับตรงรูปแบบไหม
 */

const ENDPOINT = 'https://api.openai.com/v1/images/generations'

/**
 * ตรวจเอกสาร ส.ค. 2569 — gpt-image-1 ประกาศเลิกใช้ 23 ต.ค. 2569 อย่าถอยกลับไปใช้
 * อ่านตอนเรียก ไม่ใช่ตอนโหลดโมดูล (ดู __tests__/env-at-module-load.test.ts)
 */
export function imageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2'
}

export type ImageQuality = 'low' | 'medium' | 'high'

/**
 * คุณภาพเริ่มต้น = medium
 *
 * high ไม่ได้แค่แพงกว่า — เอกสารระบุว่าใช้เวลา 30–50 เท่าของ low เพราะเดินกระบวนการ
 * เข้าใจ→วางแผน→สร้าง→ตรวจ ครบทุกขั้น · คลิปยาวพิเศษใช้ 45 ภาพ
 * เลือก high แล้วขั้นตอนหาภาพจะนานกว่าขั้นตอนเรนเดอร์เสียอีก
 */
export const DEFAULT_QUALITY: ImageQuality = 'medium'

/**
 * ราคาโดยประมาณต่อภาพ (USD)
 *
 * ⚠️ ตัวเลขนี้อ้างอิงช่วงราคาที่ประกาศไว้ ไม่ใช่ราคาที่ยืนยันจากบิลจริงของบัญชีเรา
 * ใช้ประมาณการก่อนกดสร้างเท่านั้น ห้ามเอาไปคิดกำไรขาดทุน
 */
const USD_PER_IMAGE: Record<ImageQuality, number> = {
  low: 0.02,
  medium: 0.07,
  high: 0.19,
}

export function imageCostUsd(count: number, quality: ImageQuality = DEFAULT_QUALITY): number {
  return Math.round(count * USD_PER_IMAGE[quality] * 1000) / 1000
}

/**
 * ขนาดภาพที่ขอ — ต้องใหญ่กว่าเฟรมปลายทางเสมอ
 *
 * ข้อบังคับของ API: ด้านละเป็นจำนวนเท่าของ 16 · ด้านยาวสุดไม่เกิน 3840 ·
 * จำนวนพิกเซลรวมอยู่ระหว่าง 655,360 ถึง 8,294,400
 *
 * 2048x1152 กับ 1152x2048 ผ่านครบทุกข้อ และเป็น 16:9 / 9:16 พอดีเป๊ะ
 * จึงไม่ต้อง crop ทิ้งเหมือนขนาดมาตรฐาน 1536x1024 ซึ่งเป็น 3:2 (เสียแนวตั้งไป ~11%)
 * และยังใหญ่กว่าเฟรม 1920x1080 / 1080x1920 พอให้ Ken Burns ซูมได้โดยไม่เบลอ
 */
export function imageSize(orientation: 'landscape' | 'portrait'): string {
  return orientation === 'landscape' ? '2048x1152' : '1152x2048'
}

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('ไม่ได้ตั้ง OPENAI_API_KEY')
  return key
}

export class ImageGenError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`สร้างภาพไม่สำเร็จ (${status}): ${detail}`)
    this.name = 'ImageGenError'
  }
}

export type GenerateImageOptions = {
  orientation: 'landscape' | 'portrait'
  quality?: ImageQuality
}

/**
 * สร้างภาพหนึ่งใบ คืนเป็นไบต์ของไฟล์ PNG
 *
 * ขอเป็น b64_json ไม่ใช่ url เพราะ url ที่ API คืนมามีอายุจำกัด และ worker
 * ต้องเขียนลงไฟล์อยู่แล้ว การรับ base64 มาตรง ๆ จึงตัดการยิงเน็ตรอบที่สองทิ้งได้
 */
export async function generateImage(
  prompt: string,
  options: GenerateImageOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  const trimmed = prompt.trim()
  if (!trimmed) throw new Error('prompt ว่าง')

  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: imageModel(),
      prompt: trimmed,
      size: imageSize(options.orientation),
      quality: options.quality ?? DEFAULT_QUALITY,
      n: 1,
      response_format: 'b64_json',
    }),
  })

  if (!response.ok) {
    throw new ImageGenError(response.status, (await response.text()).slice(0, 300))
  }

  const body = (await response.json()) as { data?: { b64_json?: string }[] }
  const b64 = body.data?.[0]?.b64_json

  /**
   * ตอบ 200 แต่ไม่มีภาพมาด้วยได้ (บางรุ่นคืน url แทนเมื่อไม่รองรับ response_format)
   * ปล่อยผ่านไปจะได้ไฟล์ขนาด 0 ไบต์ แล้วไปพังตอน ffmpeg ซึ่งไล่ย้อนกลับมายากกว่ามาก
   */
  if (!b64) {
    throw new ImageGenError(200, 'ตอบกลับสำเร็จแต่ไม่มี b64_json — ตรวจว่าโมเดลรองรับพารามิเตอร์นี้')
  }

  return Buffer.from(b64, 'base64')
}
