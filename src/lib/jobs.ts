import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, JobKind, JobRow } from '@/lib/database.types'
import { JOB_COST } from '@/lib/credits'

type Client = SupabaseClient<Database>

/** payload ของแต่ละชนิดงาน — handler อ่านค่าจากตรงนี้ */
export type JobPayloads = {
  idea_generate: { channel_id: string; count: number; segment?: string }
  script_generate: { script_id: string; channel_id: string; brief?: string }
  video_render: { video_id: string; script_id: string }
  youtube_upload: { video_id: string; channel_id: string }
  metrics_sync: { channel_id: string; day?: string }
}

export type JobPayload<K extends JobKind = JobKind> = JobPayloads[K]

/**
 * เข้าคิวงาน + ตัดเครดิตในทรานแซกชันเดียวกัน (RPC enqueue_job)
 * เครดิตตัดตอนเข้าคิวเพื่อกันการยิงซ้ำ
 */
export async function enqueueJob<K extends JobKind>(
  db: Client,
  orgId: string,
  kind: K,
  payload: JobPayloads[K],
  options: { runAfter?: Date; cost?: number } = {},
): Promise<JobRow> {
  // คลาย generic ให้เป็นชนิดตายตัวก่อน ไม่งั้น supabase-js จับคู่ overload ของ rpc ไม่ได้
  const args = {
    p_org_id: orgId,
    p_kind: kind as string,
    p_payload: payload as Record<string, unknown>,
    p_cost: options.cost ?? JOB_COST[kind],
    p_run_after: (options.runAfter ?? new Date()).toISOString(),
  }

  const { data, error } = await db.rpc('enqueue_job', args)

  if (error) throw new Error(`เข้าคิวงานไม่สำเร็จ: ${error.message}`)
  return data as JobRow
}

/** worker ดึงงานผ่าน claim_job เท่านั้น (FOR UPDATE SKIP LOCKED) */
export async function claimJob(
  db: Client,
  workerId: string,
  kinds?: JobKind[],
): Promise<JobRow | null> {
  const { data, error } = await db.rpc('claim_job', {
    p_worker_id: workerId,
    p_kinds: kinds ?? null,
  })

  if (error) throw new Error(`ดึงงานไม่สำเร็จ: ${error.message}`)
  return (data as JobRow | null) ?? null
}

/** ปิดงานเสมอ แม้ handler จะ throw — ไม่งั้นงานค้างสถานะ claimed ตลอดไป */
export async function completeJob(
  db: Client,
  jobId: string,
  ok: boolean,
  errorMessage?: string,
): Promise<JobRow> {
  const { data, error } = await db.rpc('complete_job', {
    p_job_id: jobId,
    p_ok: ok,
    p_error: errorMessage ?? null,
  })

  if (error) throw new Error(`ปิดงานไม่สำเร็จ: ${error.message}`)
  return data as JobRow
}

/**
 * เลื่อนงานโดยไม่นับเป็นความล้มเหลว (คืน attempt ให้ด้วย)
 * ใช้ตอนโควตา YouTube เต็ม
 */
export async function deferJob(
  db: Client,
  jobId: string,
  runAfter: string | Date,
  reason?: string,
): Promise<JobRow> {
  const { data, error } = await db.rpc('defer_job', {
    p_job_id: jobId,
    p_run_after: typeof runAfter === 'string' ? runAfter : runAfter.toISOString(),
    p_reason: reason ?? null,
  })

  if (error) throw new Error(`เลื่อนงานไม่สำเร็จ: ${error.message}`)
  return data as JobRow
}

/** ให้ handler สั่งเลื่อนงานได้โดยไม่ต้องรู้จัก db — worker เป็นคนจัดการต่อ */
export class DeferJobSignal extends Error {
  constructor(
    readonly runAfter: string,
    readonly detail: string,
  ) {
    super(detail)
    this.name = 'DeferJobSignal'
  }
}
