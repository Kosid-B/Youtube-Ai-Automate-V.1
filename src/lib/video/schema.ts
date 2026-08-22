/**
 * สคีมาของคำขอที่มาจากเบราว์เซอร์
 *
 * ⚠️ กติกาข้อเดียวที่สำคัญที่สุดในไฟล์นี้: ผู้ใช้ส่งได้แค่ "อยากได้อะไร"
 * ห้ามมีช่องราคา ช่องชื่อเจ้า หรือช่องชื่อรุ่นที่ผู้ใช้กำหนดเองได้
 * ราคาคิดจากฝั่งเราเท่านั้น (video/router.ts) — เชื่อราคาจากเบราว์เซอร์เมื่อไร
 * ก็เท่ากับให้ใครก็ได้สั่งงานราคาเท่าไรก็ได้แล้วบอกว่า "ฟรี"
 *
 * org_id ก็ไม่รับจากเบราว์เซอร์ด้วยเหตุผลเดียวกัน — หาจากสมาชิกภาพของ session
 */
import { z } from 'zod'

export const PLATFORMS = [
  'youtube_shorts',
  'tiktok',
  'instagram_reels',
  'facebook',
  'website',
] as const

export const createProjectSchema = z.object({
  title: z.string().trim().min(1, 'ต้องมีชื่อโปรเจค').max(200, 'ชื่อยาวเกิน 200 ตัวอักษร'),
  objective: z.string().trim().max(2000).optional(),
  audience: z.string().trim().max(2000).optional(),
  platform: z.enum(PLATFORMS).default('youtube_shorts'),
  aspectRatio: z.enum(['9:16', '16:9']).default('9:16'),
})

export const generateVideoSchema = z.object({
  projectId: z.uuid('รหัสโปรเจคไม่ถูกต้อง'),
  prompt: z.string().trim().min(10, 'คำสั่งภาพสั้นเกินไป').max(2000, 'คำสั่งภาพยาวเกิน 2000 ตัวอักษร'),
  seconds: z.number().int().min(1).max(60),
  aspect: z.enum(['9:16', '16:9']),
  policy: z.enum(['cheap', 'fast', 'quality', 'auto']).default('auto'),
  /**
   * กุญแจกันสั่งซ้ำ — ฝั่ง client สร้างครั้งเดียวต่อการกดหนึ่งครั้ง
   * กดปุ่มรัว ๆ หรือเน็ตกระตุกแล้ว retry จะได้ไม่กลายเป็นสองงานที่คิดเงินสองรอบ
   */
  idempotencyKey: z.string().trim().min(8).max(128),
})

/**
 * สั่งให้ AI วางแผนโฆษณาให้ทั้งชิ้น
 *
 * ไม่มีช่องความยาว ช่องจำนวนช็อต หรือช่องแพลตฟอร์มให้กรอกตรงนี้ — ทั้งหมดอ่านจาก
 * โปรเจคฝั่งเซิร์ฟเวอร์ ผู้ใช้ตั้งค่าพวกนั้นตอนสร้างโปรเจคไปแล้ว
 * รับซ้ำที่นี่ = มีสองแหล่งความจริงที่ขัดกันได้ และไม่มีอะไรบอกว่าอันไหนถูก
 */
export const planProjectSchema = z.object({
  projectId: z.uuid('รหัสโปรเจคไม่ถูกต้อง'),
  notes: z.string().trim().max(1000, 'โน้ตยาวเกิน 1000 ตัวอักษร').optional(),
})

export const generationIdSchema = z.object({ generationId: z.uuid() })
export const projectIdSchema = z.object({ projectId: z.uuid() })

export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type GenerateVideoInputDto = z.infer<typeof generateVideoSchema>
export type PlanProjectInput = z.infer<typeof planProjectSchema>
