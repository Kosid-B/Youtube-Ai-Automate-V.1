import type { WorkerClient } from '../supabase'
import type { JobPayloads } from '@/lib/jobs'

/**
 * แปลงสคริปต์เป็นไฟล์วิดีโอ
 *
 * ⚠️ ยังไม่ได้ทำ (งานค้างข้อ 2) — ต้องตัดสินใจก่อนว่าจะ ffmpeg บน worker
 * หรือเรียก render service ภายนอก
 *
 * เมื่อทำจริง handler นี้ต้อง idempotent: เช็ค videos.storage_path ก่อน
 * ถ้ามีไฟล์แล้วให้ข้าม ไม่ render ซ้ำ
 */
export async function videoRender(
  db: WorkerClient,
  payload: JobPayloads['video_render'],
): Promise<void> {
  const { data: video } = await db
    .from('videos')
    .select('id, status, storage_path')
    .eq('id', payload.video_id)
    .single()

  if (!video) {
    throw new Error(`ไม่พบคลิป ${payload.video_id}`)
  }

  if (video.storage_path) {
    console.log(`[video_render] ${video.id} มีไฟล์แล้ว ข้าม`)
    return
  }

  await db.from('videos').update({ status: 'failed' }).eq('id', video.id)

  throw new Error(
    'ยังไม่ได้ทำ video_render handler — ดูงานค้างข้อ 2 ใน CLAUDE.md ' +
      '(ต้องเลือกระหว่าง ffmpeg บน worker กับ render service ภายนอก)',
  )
}
