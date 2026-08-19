import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { InsufficientCreditsError } from '@/lib/credits'
import { enqueueJob } from '@/lib/jobs'
import { AUDIENCE_SEGMENTS } from '@/lib/idea-angles'

/** ขอทีละกี่หัวข้อ — มากกว่านี้โมเดลเริ่มเสนอเรื่องเดียวกันในมุมต่างกันนิดเดียว */
const MAX_COUNT = 10

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'ต้องเข้าสู่ระบบก่อน' }, { status: 401 })

  let body: { channel_id?: string; count?: number; segment?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'รูปแบบคำขอไม่ถูกต้อง' }, { status: 400 })
  }

  if (!body.channel_id) {
    return NextResponse.json({ error: 'ต้องระบุ channel_id' }, { status: 400 })
  }

  const count = Math.min(Math.max(Math.trunc(body.count ?? 5), 1), MAX_COUNT)

  // ค่าที่ไม่รู้จักให้เป็น undefined ไม่ใช่ส่งต่อไปให้ handler เดา
  const segment = AUDIENCE_SEGMENTS.some((s) => s.key === body.segment) ? body.segment : undefined

  // RLS คัดให้แล้วว่าเห็นเฉพาะช่องขององค์กรตัวเอง
  const { data: channel } = await supabase
    .from('channels')
    .select('id, org_id')
    .eq('id', body.channel_id)
    .single()

  if (!channel) return NextResponse.json({ error: 'ไม่พบช่องนี้' }, { status: 404 })

  const admin = createServiceClient()

  try {
    await enqueueJob(admin, channel.org_id, 'idea_generate', {
      channel_id: channel.id,
      count,
      segment,
    })
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: 'เครดิตไม่พอ' }, { status: 402 })
    }
    throw error
  }

  return NextResponse.json({ ok: true, count })
}
