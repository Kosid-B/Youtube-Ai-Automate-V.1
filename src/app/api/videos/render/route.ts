import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { InsufficientCreditsError } from '@/lib/credits'
import { enqueueJob } from '@/lib/jobs'
import { checkOriginality, isBlocked, type ChecklistKey } from '@/lib/originality'
import type { Json } from '@/lib/database.types'

/** จำนวนสคริปต์เดิมที่เอามาเทียบความซ้ำ */
const CORPUS_LIMIT = 200

/**
 * ส่งสคริปต์เข้าคิว render
 * ด่าน originality อยู่ตรงนี้ — verdict 'block' ตอบ 409 และไม่มีทางข้าม
 */
export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'ต้องเข้าสู่ระบบก่อน' }, { status: 401 })
  }

  let body: { script_id?: string; checklist?: Partial<Record<ChecklistKey, boolean>> }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'รูปแบบคำขอไม่ถูกต้อง' }, { status: 400 })
  }

  const scriptId = body.script_id
  if (!scriptId) {
    return NextResponse.json({ error: 'ต้องระบุ script_id' }, { status: 400 })
  }

  const { data: script } = await supabase
    .from('scripts')
    .select('id, org_id, channel_id, title, body, status')
    .eq('id', scriptId)
    .maybeSingle()

  if (!script) {
    return NextResponse.json({ error: 'ไม่พบสคริปต์นี้ หรือไม่มีสิทธิ์เข้าถึง' }, { status: 404 })
  }

  if (!script.body) {
    return NextResponse.json(
      { error: 'สคริปต์ยังไม่มีเนื้อหา รอให้เขียนเสร็จก่อน' },
      { status: 409 },
    )
  }

  // เทียบกับสคริปต์อื่นในองค์กรเดียวกัน (รวมช่องอื่นด้วย — เนื้อหาซ้ำข้ามช่องก็โดนตีเหมือนกัน)
  const { data: others } = await supabase
    .from('scripts')
    .select('id, body')
    .eq('org_id', script.org_id)
    .neq('id', script.id)
    .not('body', 'is', null)
    .order('created_at', { ascending: false })
    .limit(CORPUS_LIMIT)

  const report = checkOriginality({
    body: script.body,
    corpus: (others ?? []).map((row) => row.body ?? ''),
    checklist: body.checklist ?? {},
  })

  const service = createServiceClient()

  await service
    .from('scripts')
    .update({
      // เก็บ checklist ที่ผู้ใช้ติ๊กไว้ด้วย เพื่อให้ด่านตอนอัปตรวจซ้ำได้จากข้อมูลเดียวกัน
      originality: { ...report, checklist: body.checklist ?? {} } as unknown as Json,
      status: isBlocked(report) ? 'blocked' : 'ready',
    })
    .eq('id', script.id)

  if (isBlocked(report)) {
    return NextResponse.json(
      {
        error: 'สคริปต์นี้เสี่ยงโดนตีเป็นเนื้อหาซ้ำ จึงยังส่งเข้าคิวไม่ได้',
        originality: report,
      },
      { status: 409 },
    )
  }

  const { data: video, error: insertError } = await service
    .from('videos')
    .insert({
      org_id: script.org_id,
      channel_id: script.channel_id,
      script_id: script.id,
      title: script.title,
      status: 'queued',
    })
    .select('id')
    .single()

  if (insertError || !video) {
    return NextResponse.json(
      { error: `สร้างงานคลิปไม่สำเร็จ: ${insertError?.message ?? 'ไม่ทราบสาเหตุ'}` },
      { status: 500 },
    )
  }

  try {
    const job = await enqueueJob(service, script.org_id, 'video_render', {
      video_id: video.id,
      script_id: script.id,
    })

    return NextResponse.json(
      { video_id: video.id, job_id: job.id, originality: report },
      { status: 202 },
    )
  } catch (error) {
    await service.from('videos').delete().eq('id', video.id)

    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: 'เครดิตไม่พอ เติมเครดิตก่อน' }, { status: 402 })
    }
    throw error
  }
}
