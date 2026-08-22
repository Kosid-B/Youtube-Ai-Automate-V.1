import type { WorkerClient } from '../supabase'
import { DeferJobSignal, type JobPayloads } from '@/lib/jobs'
import { checkGeneration } from '@/lib/video/orchestrator'
import { getProvider } from '@/lib/video/registry'
import { logVideo } from '@/lib/video/log'
import type { VideoProviderId } from '@/lib/video/types'
import { track } from '@/lib/analytics'

/**
 * วนถามผู้ให้บริการจนงานจบ แล้วโหลดไฟล์เก็บขึ้น Storage
 *
 * ⚠️ ทำไมต้องใช้ defer ไม่ใช่ setTimeout วนใน handler:
 * งานสร้างวิดีโอใช้เวลาเป็นนาที นั่งรอใน handler = ยึด worker ไว้ทั้งตัว
 * งานอื่นในคิวไม่ได้เดินเลยตลอดเวลานั้น · defer คืนงานเข้าคิวพร้อมเวลานัด
 * แล้ว worker ไปทำอย่างอื่นต่อได้
 *
 * ⚠️ defer_job ลด attempts ลงหนึ่งทุกครั้ง การวนถามจึงไม่กินโควตา retry
 * แต่แปลว่า "วนไม่รู้จบ" ได้ถ้าผู้ให้บริการค้าง — จึงต้องมีเพดานเวลาของเราเอง
 */

/** ถามทุกกี่วินาที — สั้นกว่านี้เปลืองคำขอ ยาวกว่านี้ผู้ใช้รอนานเกินจำเป็น */
function pollIntervalSec(): number {
  const raw = Number(process.env.VIDEO_POLL_INTERVAL_SEC)
  return Number.isFinite(raw) && raw > 0 ? raw : 20
}

/**
 * เลิกถามหลังจากนี้
 *
 * ไม่มีเพดานแล้วงานที่ผู้ให้บริการค้างจะวนอยู่ในคิวตลอดไป กินคำขอทุก 20 วินาที
 * ไปเรื่อย ๆ โดยไม่มีใครสังเกต · 30 นาทีเผื่อไว้เยอะจากที่ผู้ให้บริการใช้จริง (นาที)
 */
function pollDeadlineMs(): number {
  const raw = Number(process.env.VIDEO_POLL_DEADLINE_MIN)
  return (Number.isFinite(raw) && raw > 0 ? raw : 30) * 60 * 1000
}

export async function videoPoll(
  db: WorkerClient,
  payload: JobPayloads['video_poll'],
): Promise<void> {
  const { data: generation } = await db
    .from('video_generations')
    .select(
      'id, org_id, project_id, provider, provider_job_id, status, seconds, estimated_cost_usd, output_storage_path, created_at',
    )
    .eq('id', payload.generation_id)
    .single()

  if (!generation) throw new Error(`ไม่พบงานสร้างวิดีโอ ${payload.generation_id}`)

  // idempotent: มีไฟล์แล้ว = งานนี้ทำไปแล้ว · retry ไม่ต้องโหลดซ้ำ
  if (generation.output_storage_path) {
    console.log(`[video_poll] ${generation.id} มีไฟล์แล้ว ข้าม`)
    return
  }

  if (generation.status !== 'running' || !generation.provider_job_id) {
    console.log(`[video_poll] ${generation.id} สถานะ ${generation.status} ไม่ต้องถามต่อ`)
    return
  }

  const providerId = generation.provider as VideoProviderId
  const elapsedMs = Date.now() - new Date(generation.created_at).getTime()

  /**
   * เกินเพดานเวลาแล้ว — ปิดงานพร้อมบอกว่าเงินอาจออกไปแล้ว
   * ห้ามบอกแค่ "ไม่สำเร็จ" เพราะผู้ใช้จะเข้าใจว่าไม่ถูกคิดเงิน ซึ่งไม่จริง
   */
  const deadlineMs = pollDeadlineMs()

  if (elapsedMs > deadlineMs) {
    const minutes = Math.round(deadlineMs / 60000)

    await db
      .from('video_generations')
      .update({
        status: 'failed',
        error_code: 'timeout',
        error:
          `ผู้ให้บริการยังไม่ส่งงานคืนภายใน ${minutes} นาที เลิกรอแล้ว ` +
          '— ถ้าถูกคิดเงินไปแล้วต้องเช็คกับผู้ให้บริการเอง',
      })
      .eq('id', generation.id)

    logVideo('generation_failed', {
      generationId: generation.id,
      orgId: generation.org_id,
      provider: providerId,
      errorCode: 'timeout',
      latencyMs: elapsedMs,
    })
    return
  }

  const state = await checkGeneration(providerId, generation.provider_job_id)

  if (state.status === 'running') {
    // ยังไม่จบ — คืนงานเข้าคิวแล้วไปทำอย่างอื่นต่อ
    const interval = pollIntervalSec()
    throw new DeferJobSignal(
      new Date(Date.now() + interval * 1000).toISOString(),
      `รอ ${providerId} อีก ${interval} วินาที`,
    )
  }

  if (state.status !== 'done' || !state.outputUrl) {
    await db
      .from('video_generations')
      .update({
        status: 'failed',
        error_code: state.status === 'cancelled' ? 'cancelled' : (state.errorCode ?? 'unknown'),
        error: state.errorMessage ?? 'ผู้ให้บริการไม่ได้บอกสาเหตุ',
      })
      .eq('id', generation.id)

    logVideo('generation_failed', {
      generationId: generation.id,
      orgId: generation.org_id,
      provider: providerId,
      errorCode: state.errorCode,
      reason: state.errorMessage?.slice(0, 200),
      latencyMs: elapsedMs,
    })
    return
  }

  /**
   * เสร็จแล้ว — ต้องรีบโหลดเก็บ
   *
   * ลิงก์ที่ผู้ให้บริการคืนมาเป็น URL ชั่วคราว หมดอายุในไม่กี่ชั่วโมง
   * เก็บแค่ลิงก์ไว้ในฐานข้อมูลแล้วค่อยโหลดทีหลัง = วันหนึ่งจะพบว่าคลิปที่จ่ายเงินไปแล้ว
   * เปิดไม่ได้ทั้งหมด และไม่มีทางเอากลับมา
   */
  const provider = getProvider(providerId)
  if (!provider) throw new Error(`ยังไม่ได้ตั้งคีย์ของ ${providerId} — โหลดไฟล์ไม่ได้`)

  const bytes = await provider.getResult(state.outputUrl)

  // โครงพาธตามที่ policy ของบัคเก็ตอ่าน org_id จากส่วนแรก
  const storagePath = `${generation.org_id}/${generation.project_id ?? 'no-project'}/${generation.id}/output.mp4`

  const { error: uploadError } = await db.storage
    .from('video-assets')
    .upload(storagePath, bytes, { contentType: 'video/mp4', upsert: true })

  if (uploadError) throw new Error(`เก็บไฟล์ขึ้น Storage ไม่สำเร็จ: ${uploadError.message}`)

  /**
   * อัปไฟล์ก่อนแล้วค่อยบันทึกพาธเสมอ
   * สลับลำดับแล้วถ้าอัปล้ม แถวจะชี้ไปไฟล์ที่ไม่มีอยู่ และ retry รอบหน้าจะเชื่อว่า
   * มีไฟล์แล้ว (เพราะเช็ค output_storage_path) แล้วข้ามไป — คลิปหายถาวร
   */
  await db
    .from('video_generations')
    .update({
      status: 'done',
      output_storage_path: storagePath,
      provider_output_url: state.outputUrl,
      actual_cost_usd: state.actualCostUsd ?? null,
    })
    .eq('id', generation.id)

  logVideo('generation_completed', {
    generationId: generation.id,
    orgId: generation.org_id,
    provider: providerId,
    seconds: generation.seconds,
    estimatedCostUsd: Number(generation.estimated_cost_usd),
    actualCostUsd: state.actualCostUsd,
    latencyMs: elapsedMs,
  })

  await track('ad_video_completed', generation.org_id, {
    provider: providerId,
    seconds: generation.seconds,
    estimated_cost_usd: Number(generation.estimated_cost_usd),
    latency_sec: Math.round(elapsedMs / 1000),
  })

  console.log(`[video_poll] ${generation.id} เสร็จ → ${storagePath}`)
}
