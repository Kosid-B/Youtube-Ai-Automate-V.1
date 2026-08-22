'use server'

/**
 * Server actions ของสายงานคลิปโฆษณา
 *
 * ทุกตัวทำสามอย่างตามลำดับนี้เสมอ ห้ามสลับ:
 *   1. ยืนยันตัวตนจาก session (ไม่ใช่จากอะไรที่ browser ส่งมา)
 *   2. หาองค์กรจากสมาชิกภาพของ session (ไม่ใช่จาก org_id ที่ browser ส่งมา)
 *   3. ตรวจ payload ด้วย Zod
 *
 * ⚠️ ทำไมไม่รับ org_id จาก browser: RLS กันชั้นสุดท้ายให้อยู่แล้ว แต่การเขียน
 * ต้องใช้ service client (ข้าม RLS) เพราะ video_generations เปิดให้ client อ่านอย่างเดียว
 * ถ้ารับ org_id มาแล้วเอาไปเขียนตรง ๆ ชั้นกันนั้นก็หายไปทั้งชั้น
 * — หา org จาก session ทำให้ไม่มีทางที่ค่าจาก browser จะกลายเป็นสิทธิ์
 */
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { createProjectSchema, generateVideoSchema, planProjectSchema } from '@/lib/video/schema'
import { generateRateLimiter } from '@/lib/video/rate-limit'
import { cancelGeneration, dispatchGeneration } from '@/lib/video/orchestrator'
import { VideoProviderError, type VideoProviderId } from '@/lib/video/types'
import { logVideo } from '@/lib/video/log'
import { enqueueJob } from '@/lib/jobs'

export type ActionState = { error: string | null; ok: string | null }

type Actor = { userId: string; orgId: string }

/** หาผู้ใช้และองค์กรที่แก้ข้อมูลได้ — คืน error เป็นข้อความไทย ไม่ throw */
async function actor(): Promise<Actor | { error: string }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: 'ต้องเข้าสู่ระบบก่อน' }

  // RLS คัดให้เหลือเฉพาะองค์กรที่ผู้ใช้เป็นสมาชิกอยู่แล้ว กรอง role ซ้ำอีกชั้นตรงนี้
  const { data: membership } = await supabase
    .from('org_members')
    .select('org_id, role')
    .in('role', ['owner', 'admin', 'editor'])
    .limit(1)
    .maybeSingle()

  if (!membership) return { error: 'ไม่มีสิทธิ์สร้างงานในองค์กรนี้' }

  return { userId: user.id, orgId: membership.org_id }
}

/** แปลง error ของ provider เป็นข้อความที่ผู้ใช้อ่านแล้วรู้ว่าต้องทำอะไรต่อ */
function readableError(error: unknown): string {
  if (!(error instanceof VideoProviderError)) {
    return error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'
  }

  switch (error.code) {
    case 'auth':
      return 'คีย์ของผู้ให้บริการใช้ไม่ได้ ตรวจการตั้งค่าฝั่งเซิร์ฟเวอร์'
    case 'not_found':
      return 'บัญชีนี้ยังเรียกรุ่นที่ตั้งไว้ไม่ได้ ตรวจชื่อรุ่นหรือการเติมเงิน'
    case 'rate_limit':
      return 'ผู้ให้บริการกำลังรับงานเต็ม ลองใหม่อีกสักครู่'
    case 'content_policy':
      return 'เนื้อหาถูกปฏิเสธโดยผู้ให้บริการ ลองปรับคำสั่งภาพ'
    case 'timeout':
      return 'ผู้ให้บริการไม่ตอบในเวลาที่กำหนด ลองใหม่อีกครั้ง'
    default:
      return error.message
  }
}

export async function createProject(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const found = await actor()
  if ('error' in found) return { error: found.error, ok: null }

  const parsed = createProjectSchema.safeParse({
    title: formData.get('title'),
    objective: formData.get('objective') || undefined,
    audience: formData.get('audience') || undefined,
    platform: formData.get('platform') || undefined,
    aspectRatio: formData.get('aspectRatio') || undefined,
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง', ok: null }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('video_projects').insert({
    org_id: found.orgId,
    created_by: found.userId,
    title: parsed.data.title,
    objective: parsed.data.objective ?? null,
    audience: parsed.data.audience ?? null,
    platform: parsed.data.platform,
    aspect_ratio: parsed.data.aspectRatio,
  })

  if (error) return { error: error.message, ok: null }

  revalidatePath('/dashboard/video')
  return { error: null, ok: `สร้างโปรเจค "${parsed.data.title}" แล้ว` }
}

/**
 * สั่งสร้างคลิป
 *
 * ลำดับสำคัญ: จำกัดอัตรา -> บันทึกแถว -> เลือกเจ้าและสั่ง -> อัปเดตแถว
 *
 * บันทึกแถวก่อนสั่งเสมอ เพราะถ้าสั่งสำเร็จแต่บันทึกไม่สำเร็จ เราจะมีงานที่
 * เสียเงินไปแล้วโดยไม่มี id ให้ตามกลับ สลับลำดับแล้วเงินหายเงียบ
 *
 * กันสั่งซ้ำด้วย unique index ที่ระดับฐานข้อมูล ไม่ใช่การเช็คก่อน insert
 * เพราะการเช็คก่อนมีช่องว่างให้สองคำขอพร้อมกันหลุดไปได้ทั้งคู่
 */
export async function generateVideo(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const found = await actor()
  if ('error' in found) return { error: found.error, ok: null }

  const parsed = generateVideoSchema.safeParse({
    projectId: formData.get('projectId'),
    prompt: formData.get('prompt'),
    seconds: Number(formData.get('seconds')),
    aspect: formData.get('aspect'),
    policy: formData.get('policy') || undefined,
    idempotencyKey: formData.get('idempotencyKey'),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง', ok: null }
  }

  const supabase = await createClient()

  // โปรเจคต้องเป็นขององค์กรเดียวกัน อ่านผ่าน client ที่ผูก session ให้ RLS คัดให้
  const { data: project } = await supabase
    .from('video_projects')
    .select('id, org_id')
    .eq('id', parsed.data.projectId)
    .maybeSingle()

  if (!project || project.org_id !== found.orgId) {
    return { error: 'ไม่พบโปรเจคนี้ หรือไม่มีสิทธิ์เข้าถึง', ok: null }
  }

  const limiter = generateRateLimiter()
  if (!(await limiter.check(found.orgId))) {
    return { error: 'สั่งงานถี่เกินไป ลองใหม่ในอีกสักครู่', ok: null }
  }

  const admin = createServiceClient()

  const { data: row, error: insertError } = await admin
    .from('video_generations')
    .insert({
      org_id: found.orgId,
      project_id: parsed.data.projectId,
      idempotency_key: parsed.data.idempotencyKey,
      prompt: parsed.data.prompt,
      aspect: parsed.data.aspect,
      seconds: parsed.data.seconds,
      routing_policy: parsed.data.policy,
      // เติมของจริงหลังเลือกเจ้าได้แล้ว ตอนนี้ยังไม่รู้ว่าจะไปเจ้าไหน
      provider: 'pending',
      model: 'pending',
      tier: 'lite',
      status: 'queued',
    })
    .select('id')
    .single()

  if (insertError || !row) {
    // 23505 = ชน unique index ของ idempotency_key แปลว่าสั่งซ้ำ ไม่ใช่ error จริง
    if (insertError?.code === '23505') {
      return { error: null, ok: 'งานนี้สั่งไปแล้ว กำลังทำอยู่' }
    }
    return { error: `บันทึกงานไม่สำเร็จ: ${insertError?.message}`, ok: null }
  }

  try {
    const dispatched = await dispatchGeneration({
      orgId: found.orgId,
      generationId: row.id,
      prompt: parsed.data.prompt,
      seconds: parsed.data.seconds,
      aspect: parsed.data.aspect,
      policy: parsed.data.policy,
    })

    await admin
      .from('video_generations')
      .update({
        provider: dispatched.provider,
        model: dispatched.model,
        seconds: dispatched.seconds,
        provider_job_id: dispatched.providerJobId,
        estimated_cost_usd: dispatched.estimatedCostUsd,
        status: 'running',
      })
      .eq('id', row.id)

    /**
     * เข้าคิวให้ worker วนถามสถานะจนจบแล้วโหลดไฟล์เก็บ
     *
     * ⚠️ ล้มตรงนี้ต้องไม่ทำให้คำขอล้ม — เงินออกไปแล้วและงานฝั่งผู้ให้บริการเดินอยู่
     * บอกผู้ใช้ว่าล้มทั้งที่คลิปกำลังถูกสร้างคือทำให้เขาสั่งซ้ำแล้วจ่ายสองรอบ
     * แถวมี provider_job_id แล้ว เก็บกู้ทีหลังได้เสมอ
     */
    try {
      await enqueueJob(admin, found.orgId, 'video_poll', { generation_id: row.id })
    } catch (queueError) {
      console.error(`[video] เข้าคิวติดตามงาน ${row.id} ไม่สำเร็จ:`, queueError)
    }

    revalidatePath('/dashboard/video')

    return {
      error: null,
      ok: dispatched.downgraded
        ? `เริ่มสร้างแล้ว ลดคุณภาพลงให้เข้างบ (ประมาณ $${dispatched.estimatedCostUsd.toFixed(2)})`
        : `เริ่มสร้างแล้ว (ประมาณ $${dispatched.estimatedCostUsd.toFixed(2)})`,
    }
  } catch (error) {
    const code = error instanceof VideoProviderError ? error.code : 'unknown'

    await admin
      .from('video_generations')
      .update({ status: 'failed', error_code: code, error: readableError(error) })
      .eq('id', row.id)

    revalidatePath('/dashboard/video')
    return { error: readableError(error), ok: null }
  }
}

/**
 * สั่ง AI Marketing Director ให้วางแผนทั้งชิ้น
 *
 * เข้าคิวแทนที่จะเรียกโมเดลตรงนี้ เพราะการวางแผนใช้เวลาเป็นนาที (effort สูง
 * สตอรีบอร์ดหลายช็อต) ซึ่งเกินเวลาที่ server action มีให้บนโฮสต์ส่วนใหญ่
 * เรียกตรงนี้แล้วจะได้ timeout ที่ไม่บอกอะไร ทั้งที่โมเดลยังทำงานอยู่และคิดเงินไปแล้ว
 */
export async function planProject(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const found = await actor()
  if ('error' in found) return { error: found.error, ok: null }

  const parsed = planProjectSchema.safeParse({
    projectId: formData.get('projectId'),
    notes: formData.get('notes') || undefined,
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง', ok: null }
  }

  const supabase = await createClient()

  const { data: project } = await supabase
    .from('video_projects')
    .select('id, org_id, objective')
    .eq('id', parsed.data.projectId)
    .maybeSingle()

  if (!project || project.org_id !== found.orgId) {
    return { error: 'ไม่พบโปรเจคนี้ หรือไม่มีสิทธิ์เข้าถึง', ok: null }
  }

  /**
   * ไม่มีเป้าหมายธุรกิจ = ไม่มีอะไรให้ Director เริ่มคิด
   * ปล่อยผ่านแล้วโมเดลจะเดาเป้าหมายให้เอง ซึ่งได้แผนที่ดูดีแต่ไม่ใช่ธุรกิจของผู้ใช้
   * — แย่กว่าไม่ได้แผนเลย เพราะอ่านแล้วเชื่อ
   */
  if (!project.objective?.trim()) {
    return { error: 'ยังไม่ได้เขียนเป้าหมายธุรกิจของงานนี้ — Director ไม่มีอะไรให้เริ่มคิด', ok: null }
  }

  // หนึ่งโปรเจคหนึ่งแผน · handler ก็ตรวจซ้ำอีกชั้น (กันสองคนกดพร้อมกัน)
  const { data: existing } = await supabase
    .from('video_scripts')
    .select('id')
    .eq('project_id', project.id)
    .limit(1)
    .maybeSingle()

  if (existing) return { error: null, ok: 'งานนี้มีแผนอยู่แล้ว' }

  const admin = createServiceClient()

  try {
    await enqueueJob(admin, found.orgId, 'video_plan', {
      project_id: project.id,
      ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
    })
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'เข้าคิวไม่สำเร็จ',
      ok: null,
    }
  }

  revalidatePath('/dashboard/video')
  return { error: null, ok: 'เข้าคิวแล้ว — AI กำลังวางแผน ใช้เวลาสักครู่' }
}

/** ยกเลิกงาน เจ้าที่ไม่รองรับจะบอกตรง ไม่ใช่เงียบไปเฉย */
export async function cancelVideo(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const found = await actor()
  if ('error' in found) return { error: found.error, ok: null }

  const generationId = String(formData.get('generationId') ?? '')
  if (!generationId) return { error: 'ไม่มีรหัสงาน', ok: null }

  const supabase = await createClient()
  const { data: row } = await supabase
    .from('video_generations')
    .select('id, org_id, provider, provider_job_id, status')
    .eq('id', generationId)
    .maybeSingle()

  if (!row || row.org_id !== found.orgId) {
    return { error: 'ไม่พบงานนี้ หรือไม่มีสิทธิ์เข้าถึง', ok: null }
  }

  if (row.status !== 'running' || !row.provider_job_id) {
    return { error: 'งานนี้ยกเลิกไม่ได้แล้ว', ok: null }
  }

  const cancelled = await cancelGeneration(row.provider as VideoProviderId, row.provider_job_id)

  if (!cancelled) {
    return { error: `${row.provider} ไม่รองรับการยกเลิกกลางคัน`, ok: null }
  }

  const admin = createServiceClient()
  await admin
    .from('video_generations')
    .update({ status: 'failed', error_code: 'cancelled' })
    .eq('id', row.id)

  logVideo('generation_cancelled', { generationId: row.id, orgId: found.orgId })
  revalidatePath('/dashboard/video')

  return { error: null, ok: 'ยกเลิกงานแล้ว' }
}
