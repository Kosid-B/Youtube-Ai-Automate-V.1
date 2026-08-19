import type { WorkerClient } from '../supabase'
import type { JobPayloads } from '@/lib/jobs'
import { generateScript } from '@/lib/anthropic'
import { buildGuidance, guidanceText } from '@/lib/content-feedback'
import { track } from '@/lib/analytics'
import { checkOriginality, SIMILARITY_BLOCK } from '@/lib/originality'
import type { Json } from '@/lib/database.types'

/** จำนวนสคริปต์เดิมที่เอามาเทียบความซ้ำ */
const CORPUS_LIMIT = 200

/**
 * เขียนสคริปต์ด้วย AI แล้วตรวจความซ้ำทันที
 *
 * idempotent: ถ้าสคริปต์มีเนื้อหาแล้ว ถือว่างานนี้ทำไปแล้ว ไม่เรียกโมเดลซ้ำ
 * (retry ได้ถึง 3 ครั้ง และการเรียกโมเดลซ้ำเสียทั้งเงินและโควตา)
 */
export async function scriptGenerate(
  db: WorkerClient,
  payload: JobPayloads['script_generate'],
): Promise<void> {
  const { data: script, error } = await db
    .from('scripts')
    .select('id, org_id, channel_id, title, body, status, format')
    .eq('id', payload.script_id)
    .single()

  if (error || !script) {
    throw new Error(`ไม่พบสคริปต์ ${payload.script_id}`)
  }

  if (script.body) {
    console.log(`[script_generate] ${script.id} มีเนื้อหาแล้ว ข้าม`)
    return
  }

  const { data: channel } = await db
    .from('channels')
    .select('id, name, niche')
    .eq('id', script.channel_id)
    .single()

  if (!channel) {
    throw new Error(`ไม่พบช่อง ${script.channel_id}`)
  }

  await db.from('scripts').update({ status: 'checking' }).eq('id', script.id)

  const { data: recent } = await db
    .from('scripts')
    .select('title')
    .eq('channel_id', script.channel_id)
    .neq('id', script.id)
    .order('created_at', { ascending: false })
    .limit(20)

  /**
   * ป้อนผลงานที่ผ่านมากลับเข้า prompt
   *
   * ล้มตรงนี้ไม่ควรทำให้เขียนสคริปต์ไม่ได้ — มันเป็นแค่แนวทางเสริม
   * ถ้าดึงไม่ได้ก็เขียนแบบไม่มีข้อมูลไปก่อน ดีกว่าไม่ได้สคริปต์เลย
   */
  let performanceNote: string | null = null

  try {
    const [{ data: summary }, { count: clipsMade }] = await Promise.all([
      db.rpc('content_feature_summary', { p_org_id: script.org_id, p_feature: 'hook_type' }),
      db
        .from('videos')
        .select('id', { count: 'exact', head: true })
        .eq('channel_id', script.channel_id),
    ])

    performanceNote = guidanceText(buildGuidance(summary ?? [], clipsMade ?? 0))
  } catch (error) {
    console.warn('[script_generate] ดึงผลงานที่ผ่านมาไม่ได้ เขียนต่อโดยไม่ใช้:', error)
  }

  const generated = await generateScript({
    channelName: channel.name,
    niche: channel.niche,
    title: script.title,
    angle: null,
    recentTitles: (recent ?? []).map((row) => row.title),
    brief: payload.brief,
    performanceNote,
    format: script.format,
  })

  // ตรวจความซ้ำตั้งแต่ตอนนี้ เพื่อให้ผู้ใช้เห็นปัญหาก่อนจะไปกดสั่ง render
  const { data: others } = await db
    .from('scripts')
    .select('body')
    .eq('org_id', script.org_id)
    .neq('id', script.id)
    .not('body', 'is', null)
    .order('created_at', { ascending: false })
    .limit(CORPUS_LIMIT)

  const report = checkOriginality({
    body: generated.body,
    corpus: (others ?? []).map((row) => row.body ?? ''),
    // ตอนนี้ยังไม่มีคนมายืนยัน checklist — ให้ผลตรวจสะท้อนเฉพาะความซ้ำไปก่อน
    // ผู้ใช้จะติ๊ก checklist ตอนกดส่ง render (ดู api/videos/render)
    checklist: {},
  })

  await db
    .from('scripts')
    .update({
      title: generated.title,
      body: generated.body,
      originality: { ...report, sources: generated.sources, angle: generated.angle } as Json,
      // 'draft' = เขียนเสร็จแล้วรอคนตรวจ · จะเป็น 'ready' เมื่อผ่านด่าน originality ตอนสั่ง render
      status: report.similarity >= SIMILARITY_BLOCK ? 'blocked' : 'draft',
    })
    .eq('id', script.id)

  const blocked = report.similarity >= SIMILARITY_BLOCK

  await track(blocked ? 'script_blocked' : 'script_generated', script.org_id, {
    chars: generated.body.length,
    similarity: Math.round(report.similarity * 100) / 100,
    // บันทึกว่ารอบนี้ป้อนผลงานเก่าเข้าไปหรือเปล่า จะได้เทียบทีหลังว่าช่วยจริงไหม
    used_feedback: performanceNote !== null,
  })

  console.log(
    `[script_generate] ${script.id} เสร็จ — ซ้ำ ${Math.round(report.similarity * 100)}%`,
  )
}
