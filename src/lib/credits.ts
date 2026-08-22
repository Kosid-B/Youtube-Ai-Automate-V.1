import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, JobKind } from '@/lib/database.types'

type Client = SupabaseClient<Database>

/** เครดิตที่ตัดต่องาน 1 ชิ้น — ตัดตอนเข้าคิว ไม่ใช่ตอนงานเสร็จ */
export const JOB_COST: Record<JobKind, number> = {
  // คิดหัวข้อเรียกโมเดลครั้งเดียวได้หลายหัวข้อ ถูกกว่าเขียนสคริปต์มาก
  idea_generate: 1,
  script_generate: 1,
  video_render: 5,
  youtube_upload: 1,
  metrics_sync: 0,
  // การวนถามสถานะไม่คิดเครดิต — เงินออกไปแล้วตอนสั่งสร้าง
  // คิดซ้ำตรงนี้เท่ากับเก็บเงินผู้ใช้สำหรับการรอ ซึ่งไม่ใช่บริการอะไร
  video_poll: 0,
  // วางแผนทั้งชิ้นเรียกโมเดลครั้งเดียว ราคาพอ ๆ กับเขียนสคริปต์หนึ่งบท
  video_plan: 1,
}

export class InsufficientCreditsError extends Error {
  constructor() {
    super('เครดิตไม่พอ')
    this.name = 'InsufficientCreditsError'
  }
}

/** รหัสที่ consume_credits ใช้บอกว่าเครดิตไม่พอ (raise ... using errcode = 'P0002') */
const INSUFFICIENT_CREDITS_CODE = 'P0002'

/**
 * ตัดเครดิตผ่าน RPC เท่านั้น — ห้าม `update organizations set credits = ...` ตรง ๆ
 * (trigger ในฐานข้อมูลจะปฏิเสธถ้าไม่ได้มาทาง RPC)
 */
export async function consumeCredits(
  db: Client,
  orgId: string,
  amount: number,
  reason: string,
  refId?: string,
): Promise<number> {
  const { data, error } = await db.rpc('consume_credits', {
    p_org_id: orgId,
    p_amount: amount,
    p_reason: reason,
    p_ref_id: refId ?? null,
  })

  if (error) {
    if (error.code === INSUFFICIENT_CREDITS_CODE) throw new InsufficientCreditsError()
    throw new Error(`ตัดเครดิตไม่สำเร็จ: ${error.message}`)
  }

  return data as number
}

/**
 * คืนเครดิต — ใช้กับงานที่ตายถาวร (สถานะ dead) และการเติมเครดิตจาก Stripe
 * ป้องกันการคืนซ้ำด้วย ref_id ฝั่งฐานข้อมูล
 */
export async function grantCredits(
  db: Client,
  orgId: string,
  amount: number,
  reason: string,
  refId?: string,
): Promise<number> {
  const { data, error } = await db.rpc('grant_credits', {
    p_org_id: orgId,
    p_amount: amount,
    p_reason: reason,
    p_ref_id: refId ?? null,
  })

  if (error) throw new Error(`คืนเครดิตไม่สำเร็จ: ${error.message}`)
  return data as number
}
