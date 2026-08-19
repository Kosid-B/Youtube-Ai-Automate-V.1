import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { InsufficientCreditsError } from '@/lib/credits'
import { enqueueJob } from '@/lib/jobs'
import { FORMATS } from '@/lib/formats'
import type { VideoFormat } from '@/lib/database.types'

/**
 * สร้างสคริปต์ใหม่เข้าคิว
 *
 * นี่คือรูปแบบมาตรฐานของ route handler ในโปรเจคนี้:
 * 1. createClient() ตรวจ session + สิทธิ์ในองค์กร (RLS เป็นคนบังคับ)
 * 2. createServiceClient() ทำงานจริงหลังผ่านการตรวจแล้วเท่านั้น
 */
export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'ต้องเข้าสู่ระบบก่อน' }, { status: 401 })
  }

  let body: {
    channel_id?: string
    idea_id?: string
    title?: string
    brief?: string
    format?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'รูปแบบคำขอไม่ถูกต้อง' }, { status: 400 })
  }

  const { channel_id: channelId, idea_id: ideaId, brief } = body

  // ค่าที่ผู้ใช้ส่งมาต้องอยู่ในชุดที่รู้จัก ไม่ใช่ยัดอะไรก็ได้ลงคอลัมน์ enum
  // ตรวจกับ FORMATS โดยตรง เพิ่มรูปแบบใหม่ทีหลังจะได้ไม่ต้องมาแก้ตรงนี้ซ้ำ
  // (เขียนเป็น body.format === 'short' ? ... : 'long' ไว้ รูปแบบที่สามจะถูกกลืนเป็น 'long' เงียบ ๆ)
  const format: VideoFormat =
    typeof body.format === 'string' && body.format in FORMATS
      ? (body.format as VideoFormat)
      : 'long'

  if (!channelId) {
    return NextResponse.json({ error: 'ต้องระบุ channel_id' }, { status: 400 })
  }

  // อ่านผ่าน client ที่ผูก session — ถ้าผู้ใช้ไม่ได้อยู่ในองค์กรนี้ RLS จะไม่คืนแถว
  const { data: channel } = await supabase
    .from('channels')
    .select('id, org_id, name')
    .eq('id', channelId)
    .maybeSingle()

  if (!channel) {
    return NextResponse.json({ error: 'ไม่พบช่องนี้ หรือไม่มีสิทธิ์เข้าถึง' }, { status: 404 })
  }

  // หัวข้อ: มาจากไอเดียที่เลือก หรือจากที่ผู้ใช้พิมพ์เอง
  let title = body.title?.trim()
  if (ideaId) {
    const { data: idea } = await supabase
      .from('ideas')
      .select('id, title, channel_id')
      .eq('id', ideaId)
      .maybeSingle()

    if (!idea || idea.channel_id !== channelId) {
      return NextResponse.json({ error: 'ไม่พบไอเดียนี้ในช่องที่เลือก' }, { status: 404 })
    }
    title = idea.title
  }

  if (!title) {
    return NextResponse.json({ error: 'ต้องระบุ title หรือ idea_id' }, { status: 400 })
  }

  // ผ่านการตรวจสิทธิ์แล้ว จากตรงนี้ใช้ service client ได้
  const service = createServiceClient()

  const { data: script, error: insertError } = await service
    .from('scripts')
    .insert({
      org_id: channel.org_id,
      channel_id: channelId,
      idea_id: ideaId ?? null,
      title,
      status: 'draft',
      format,
    })
    .select('id')
    .single()

  if (insertError || !script) {
    return NextResponse.json(
      { error: `สร้างสคริปต์ไม่สำเร็จ: ${insertError?.message ?? 'ไม่ทราบสาเหตุ'}` },
      { status: 500 },
    )
  }

  try {
    // ตัดเครดิตตอนเข้าคิว (อยู่ใน enqueue_job ทรานแซกชันเดียวกัน) เพื่อกันการยิงซ้ำ
    const job = await enqueueJob(service, channel.org_id, 'script_generate', {
      script_id: script.id,
      channel_id: channelId,
      brief,
    })

    return NextResponse.json({ script_id: script.id, job_id: job.id }, { status: 202 })
  } catch (error) {
    // เข้าคิวไม่สำเร็จ = ไม่มีงานให้ทำ ลบสคริปต์เปล่าทิ้งไม่ให้ค้างในรายการ
    await service.from('scripts').delete().eq('id', script.id)

    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: 'เครดิตไม่พอ เติมเครดิตก่อน' }, { status: 402 })
    }
    throw error
  }
}
