import type { WorkerClient } from '../supabase'
import type { JobPayloads } from '@/lib/jobs'
import { generateIdeas } from '@/lib/anthropic'
import { parseProofPoints } from '@/lib/proof'
import { AUDIENCE_SEGMENTS } from '@/lib/idea-angles'
import { track } from '@/lib/analytics'

/** หัวข้อเดิมที่เอามาบอกโมเดลว่าอย่าคิดซ้ำ */
const RECENT_LIMIT = 40

/**
 * คิดหัวข้อคลิปแล้วเก็บลงตาราง ideas
 *
 * ไม่สร้างสคริปต์ต่อทันที — ให้คนเลือกก่อนว่าหัวข้อไหนน่าทำ
 * หัวข้อที่ AI คิดมาไม่ได้ดีทุกอัน และสคริปต์แพงกว่าหัวข้อหลายเท่า
 * เลือกก่อนจ่ายจึงคุ้มกว่าผลิตทุกอันแล้วค่อยทิ้ง
 */
export async function ideaGenerate(
  db: WorkerClient,
  payload: JobPayloads['idea_generate'],
): Promise<void> {
  const { data: channel } = await db
    .from('channels')
    .select('id, org_id, name, niche, script_style, proof_points')
    .eq('id', payload.channel_id)
    .single()

  if (!channel) throw new Error(`ไม่พบช่อง ${payload.channel_id}`)

  // ดูทั้งหัวข้อที่ทำเป็นสคริปต์แล้วและหัวข้อที่เคยเสนอไว้ — ซ้ำกับที่เสนอไปแล้ว
  // ก็ไร้ประโยชน์พอกัน แม้จะยังไม่ได้ลงมือทำ
  const [{ data: scripts }, { data: ideas }] = await Promise.all([
    db
      .from('scripts')
      .select('title')
      .eq('channel_id', channel.id)
      .order('created_at', { ascending: false })
      .limit(RECENT_LIMIT),
    db
      .from('ideas')
      .select('title')
      .eq('channel_id', channel.id)
      .order('created_at', { ascending: false })
      .limit(RECENT_LIMIT),
  ])

  const recentTitles = [
    ...(scripts ?? []).map((row) => row.title),
    ...(ideas ?? []).map((row) => row.title),
  ]

  const segment = AUDIENCE_SEGMENTS.find((s) => s.key === payload.segment)?.key

  const generated = await generateIdeas({
    channelName: channel.name,
    niche: channel.niche,
    recentTitles,
    segment,
    // โทนของช่องต้องมาถึงตั้งแต่ตอนคิดหัวข้อ — หัวข้อที่คิดมาแบบเล่าเปล่า ๆ
    // ดัดให้เป็นโทนชวนลงมือตอนเขียนบททีหลังไม่ได้
    style: channel.script_style,
    proof: parseProofPoints(channel.proof_points),
    count: payload.count,
  })

  if (generated.length === 0) {
    throw new Error('โมเดลไม่ได้เสนอหัวข้อกลับมาเลย')
  }

  const { error } = await db.from('ideas').insert(
    generated.map((idea) => ({
      org_id: channel.org_id,
      channel_id: channel.id,
      title: idea.title,
      angle: idea.angle,
      // เก็บเหตุผลกับกลุ่มเป้าหมายไว้ด้วย ตอนเลือกจะได้ตัดสินจากอะไรสักอย่าง
      // ไม่ใช่เดาจากชื่อหัวข้ออย่างเดียว
      source_note: `${idea.segment} · ${idea.hook}\n${idea.reason}`,
      score: Math.min(Math.max(idea.demand, 0), 1),
    })),
  )

  if (error) throw new Error(`บันทึกหัวข้อไม่สำเร็จ: ${error.message}`)

  await track('ideas_generated', channel.org_id, {
    count: generated.length,
    segment: segment ?? 'all',
  })

  console.log(`[idea_generate] ${channel.name} ได้ ${generated.length} หัวข้อ`)
}
