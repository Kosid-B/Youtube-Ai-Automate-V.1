import type { WorkerClient } from '../supabase'
import type { JobPayloads } from '@/lib/jobs'
import { generateOutline, generateScript, generateSection } from '@/lib/anthropic'
import { buildGuidance, guidanceText } from '@/lib/content-feedback'
import { formatSpec } from '@/lib/formats'
import { THAI_CHARS_PER_SECOND } from '@/lib/scenes'
import {
  joinSections,
  outlineProblems,
  plannedSections,
  sectionSeconds,
} from '@/lib/outline'
import { parseProofPoints } from '@/lib/proof'
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
    .select('id, name, niche, script_style, proof_points')
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

  /**
   * โทนการเล่า + หลักฐานที่ช่องอ้างได้ ต้องส่งเข้าไปทุกครั้งที่เรียกโมเดล
   * โทน direct ใช้ตัวเลขได้เฉพาะในรายการนี้ · รายการว่าง = ห้ามพูดตัวเลขเลย
   */
  const style = channel.script_style
  const proof = parseProofPoints(channel.proof_points)

  const spec = formatSpec(script.format)

  /**
   * คลิปยาวพิเศษเขียนทีละท่อน ไม่ใช่รวดเดียว
   *
   * ขอ 40,000+ ตัวอักษรในครั้งเดียว โมเดลจะเริ่มวนซ้ำและหลุดประเด็นกลางทาง
   * วางโครงก่อนแล้วให้โฟกัสทีละท่อนได้เนื้อหาที่ไม่ทับกันและตรงประเด็นกว่า
   */
  if (spec.useOutline) {
    const generated = await writeByOutline({
      channelName: channel.name,
      niche: channel.niche,
      title: script.title,
      angle: null,
      recentTitles: (recent ?? []).map((row) => row.title),
      brief: payload.brief,
      performanceNote,
      format: script.format,
      style,
      proof,
      targetSeconds: spec.targetSeconds,
    })

    await finish(db, script, generated, performanceNote)
    return
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
    style,
    proof,
  })

  await finish(db, script, generated, performanceNote)
}

/**
 * วางโครง → เขียนทีละท่อน → ต่อกัน
 *
 * เขียนทีละท่อนโดยส่งท้ายท่อนก่อนหน้าไปด้วย เพื่อให้ต่อประโยคได้ลื่นเหมือนคนเดียวพูดต่อ
 * ท่อนไหนล้มกลางทางจะทำให้ทั้งงานล้ม ซึ่งถูกแล้ว — สคริปต์ที่ขาดท่อนกลางใช้ไม่ได้อยู่ดี
 * และงานนี้ retry ได้ (เสียเงินซ้ำ แต่ดีกว่าได้ของพัง)
 */
async function writeByOutline(
  brief: Parameters<typeof generateScript>[0] & { targetSeconds: number },
): Promise<Generated> {
  const count = plannedSections(brief.targetSeconds)
  const outline = await generateOutline({ ...brief, sectionCount: count })

  // ตรวจโครงก่อนลงมือ — เขียนครบทุกท่อนแล้วค่อยพบว่าโครงพังคือเสียเงินทั้งเรื่อง
  const problems = outlineProblems(outline)
  if (problems.length > 0) {
    throw new Error(`โครงคลิปใช้ไม่ได้: ${problems.join(' · ')}`)
  }

  const perSection = sectionSeconds(brief.targetSeconds, outline.sections.length)
  const charsPerSection = Math.round(perSection * THAI_CHARS_PER_SECOND)

  const sections: string[] = []

  for (let i = 0; i < outline.sections.length; i += 1) {
    const previous = sections[sections.length - 1]

    const text = await generateSection({
      outline,
      index: i,
      channelName: brief.channelName,
      niche: brief.niche,
      targetChars: charsPerSection,
      // ท้ายท่อนก่อนหน้าพอให้ต่อประโยคได้ ไม่ต้องส่งทั้งท่อน — เปลืองโทเคนโดยไม่ช่วยอะไร
      previousTail: previous ? previous.slice(-300) : null,
      style: brief.style,
      proof: brief.proof,
    })

    sections.push(text)
    console.log(`[script_generate] ท่อน ${i + 1}/${outline.sections.length} เสร็จ (${text.length} ตัวอักษร)`)
  }

  return {
    title: outline.title,
    body: joinSections(sections),
    angle: outline.promise,
    sources: [],
    // หัวข้อย่อย + ความยาวจริงที่เขียนได้ เก็บไว้ทำหมุดเวลาตอนประกอบคลิป
    // ต้องเป็นความยาว "หลัง trim" ให้ตรงกับที่ joinSections เอาไปต่อ ไม่งั้นหมุดเลื่อน
    chapters: outline.sections.map((section, i) => ({
      heading: section.heading,
      chars: sections[i].trim().length,
    })),
  }
}

type Generated = {
  title: string
  body: string
  angle: string
  sources: string[]
  /** หัวข้อย่อย + จำนวนตัวอักษรของแต่ละท่อน — มีเฉพาะคลิปที่เขียนตามโครง */
  chapters?: { heading: string; chars: number }[]
}

async function finish(
  db: WorkerClient,
  script: { id: string; org_id: string },
  generated: Generated,
  performanceNote: string | null,
): Promise<void> {
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
      originality: {
        ...report,
        sources: generated.sources,
        angle: generated.angle,
        ...(generated.chapters ? { chapters: generated.chapters } : {}),
      } as Json,
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
