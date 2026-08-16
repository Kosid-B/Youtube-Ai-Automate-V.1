import type { WorkerClient } from '../supabase'
import { type JobPayloads, DeferJobSignal } from '@/lib/jobs'
import { QUOTA_COST, reserveQuotaForChannel, releaseQuota, quotaResetsAt } from '@/lib/quota'
import { checkOriginality, isBlocked, type ChecklistKey } from '@/lib/originality'

const CORPUS_LIMIT = 200

/**
 * ดึง access token ของช่องจาก Supabase Vault
 * ⚠️ ยังไม่ได้ทำ (งานค้างข้อ 1) — schema เว้นช่อง channels.oauth_secret_id ไว้แล้ว
 * ห้ามเก็บ token เป็น plaintext
 */
async function getChannelAccessToken(_secretId: string | null): Promise<string> {
  throw new Error(
    'ยังไม่ได้ทำ OAuth flow ของ YouTube — ดูงานค้างข้อ 1 ใน CLAUDE.md ' +
      '(refresh token ต้องเก็บใน Supabase Vault ไม่ใช่ plaintext)',
  )
}

/**
 * อัปคลิปขึ้น YouTube
 *
 * ลำดับสำคัญ:
 * 1. ตรวจ originality ซ้ำ — เส้นทางที่นำสคริปต์ไปอัปต้องผ่านด่านนี้ทุกครั้ง
 * 2. เอา access token ให้ได้ก่อน — ถ้าไม่มี token แล้วไปจองโควตาก่อน จะเผาโควตาทิ้งเปล่า ๆ
 * 3. จองโควตาแล้วค่อยยิง API — ห้ามยิงแล้วค่อยนับ
 */
export async function youtubeUpload(
  db: WorkerClient,
  payload: JobPayloads['youtube_upload'],
): Promise<void> {
  const { data: video } = await db
    .from('videos')
    .select('id, org_id, status, storage_path, youtube_video_id, script_id, title, description')
    .eq('id', payload.video_id)
    .single()

  if (!video) {
    throw new Error(`ไม่พบคลิป ${payload.video_id}`)
  }

  // idempotent: อัปไปแล้วก็จบ ไม่อัปซ้ำ (retry ได้ถึง 3 ครั้ง)
  if (video.youtube_video_id) {
    console.log(`[youtube_upload] ${video.id} อัปแล้ว (${video.youtube_video_id}) ข้าม`)
    return
  }

  if (!video.storage_path) {
    throw new Error(`คลิป ${video.id} ยังไม่มีไฟล์ ต้อง render ให้เสร็จก่อน`)
  }

  // ── 1. ด่าน originality ──────────────────────────────────────────────
  const { data: script } = await db
    .from('scripts')
    .select('id, body, originality')
    .eq('id', video.script_id)
    .single()

  if (!script?.body) {
    throw new Error(`ไม่พบเนื้อหาสคริปต์ของคลิป ${video.id}`)
  }

  const stored = (script.originality ?? {}) as {
    checklist?: Partial<Record<ChecklistKey, boolean>>
  }

  const { data: others } = await db
    .from('scripts')
    .select('body')
    .eq('org_id', video.org_id)
    .neq('id', script.id)
    .not('body', 'is', null)
    .order('created_at', { ascending: false })
    .limit(CORPUS_LIMIT)

  const report = checkOriginality({
    body: script.body,
    corpus: (others ?? []).map((row) => row.body ?? ''),
    checklist: stored.checklist ?? {},
  })

  if (isBlocked(report)) {
    await db
      .from('videos')
      .update({ status: 'blocked', block_reason: report.reasons.join(' · ') })
      .eq('id', video.id)

    // ไม่ใช่ error ชั่วคราว — retry ไปก็ block เหมือนเดิม ปล่อยให้ตายไปเลย
    throw new Error(`ไม่ผ่านด่านความเป็นต้นฉบับ: ${report.reasons.join(' · ')}`)
  }

  const { data: channel } = await db
    .from('channels')
    .select('id, oauth_secret_id, quota_project_key')
    .eq('id', payload.channel_id)
    .single()

  if (!channel) {
    throw new Error(`ไม่พบช่อง ${payload.channel_id}`)
  }

  // ── 2. เอา token ให้ได้ก่อนแตะโควตา ─────────────────────────────────
  const accessToken = await getChannelAccessToken(channel.oauth_secret_id)

  // ── 3. จองโควตา แล้วค่อยยิง ────────────────────────────────────────
  const units = QUOTA_COST.videosInsert
  // ระบบเลือก project ให้เอง — ลูกค้าทุกรายไม่ได้แย่งโควตาก้อนเดียวกัน
  const projectKey = await reserveQuotaForChannel(db, channel.id, units)

  if (!projectKey) {
    // เต็มทุก project = เลื่อนไปวันถัดไป ห้าม retry ทันที
    const runAfter = await quotaResetsAt(db)
    throw new DeferJobSignal(runAfter, 'โควตา YouTube เต็มทุก project แล้ว เลื่อนไปรอบถัดไป')
  }

  try {
    await db.from('videos').update({ status: 'ready' }).eq('id', video.id)

    const youtubeVideoId = await insertVideo({
      accessToken,
      storagePath: video.storage_path,
      title: video.title,
      description: video.description ?? '',
    })

    await db
      .from('videos')
      .update({
        status: 'published',
        youtube_video_id: youtubeVideoId,
        published_at: new Date().toISOString(),
      })
      .eq('id', video.id)

    console.log(`[youtube_upload] ${video.id} → ${youtubeVideoId}`)
  } catch (error) {
    // ยิงไม่ถึง Google = โควตายังไม่ถูกใช้จริง คืนให้ project ตัวที่จองไป
    await releaseQuota(db, projectKey, units)
    throw error
  }
}

/**
 * เรียก videos.insert จริง
 * ⚠️ ยังไม่ได้ทำ — ต่อได้เมื่อ OAuth (งานค้างข้อ 1) และ render (ข้อ 2) เสร็จ
 */
async function insertVideo(_input: {
  accessToken: string
  storagePath: string
  title: string
  description: string
}): Promise<string> {
  throw new Error('ยังไม่ได้ทำ videos.insert — รอ OAuth flow และ video_render')
}
