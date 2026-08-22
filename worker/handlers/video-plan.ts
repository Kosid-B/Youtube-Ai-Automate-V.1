import type { WorkerClient } from '../supabase'
import type { JobPayloads } from '@/lib/jobs'
import {
  platformSeconds,
  planProblems,
  runDirector,
  scriptWithContext,
  totalShotSeconds,
  type MarketingBrief,
  type Platform,
} from '@/lib/video/director'
import { track } from '@/lib/analytics'
import type { Json } from '@/lib/database.types'

/**
 * AI Marketing Director — เป้าหมายธุรกิจ → แผนโฆษณาที่สั่งสร้างได้
 *
 * idempotent: โปรเจคที่มีแผนแล้วจะถูกข้าม · งานหนึ่งชิ้น retry ได้ถึง 3 ครั้ง
 * และการเรียกโมเดลซ้ำเสียทั้งเงินและเวลา แถมได้แผนคนละอันกับที่ผู้ใช้เห็นไปแล้ว
 * ซึ่งสับสนกว่าไม่ทำอะไรเลย
 *
 * ⚠️ แผนที่มีปัญหาไม่ถูกทิ้ง — บันทึกไว้แล้วให้คนตัดสิน
 * ทิ้งทั้งแผนเพราะช็อตเดียวยาวเกินคือเผาเงินที่จ่ายให้โมเดลไปแล้วทิ้ง
 * และหน้าเว็บคำนวณคำเตือนใหม่จากแผนที่บันทึกไว้ทุกครั้งที่เปิด (planProblems บริสุทธิ์)
 * จึงไม่ต้องมีคอลัมน์เก็บคำเตือน และคำเตือนจะไม่มีวันค้างเป็นของเก่าเมื่อกติกาเปลี่ยน
 */
export async function videoPlan(
  db: WorkerClient,
  payload: JobPayloads['video_plan'],
): Promise<void> {
  const { data: project } = await db
    .from('video_projects')
    .select('id, org_id, title, objective, audience, platform, aspect_ratio, status')
    .eq('id', payload.project_id)
    .single()

  if (!project) throw new Error(`ไม่พบโปรเจค ${payload.project_id}`)

  const { data: existing } = await db
    .from('video_scripts')
    .select('id')
    .eq('project_id', project.id)
    .limit(1)
    .maybeSingle()

  if (existing) {
    console.log(`[video_plan] ${project.id} มีแผนแล้ว ข้าม`)
    return
  }

  const brief: MarketingBrief = {
    title: project.title,
    objective: project.objective,
    audience: project.audience,
    platform: project.platform as Platform,
    aspect: project.aspect_ratio,
    notes: payload.notes ?? null,
    totalSeconds: platformSeconds(project.platform as Platform),
  }

  const startedAt = Date.now()
  const plan = await runDirector(brief)
  const problems = planProblems(plan, brief)

  const { error } = await db.from('video_scripts').insert({
    project_id: project.id,
    org_id: project.org_id,
    hook: plan.hook,
    // เก็บ ICP กับความเจ็บไว้หัวบทด้วย (ดู scriptWithContext ใน director.ts)
    script: scriptWithContext(plan, brief.notes),
    cta: plan.cta,
    storyboard: plan.storyboard as unknown as Json,
  })

  if (error) throw new Error(`บันทึกแผนไม่สำเร็จ: ${error.message}`)

  // 'scripted' = มีแผนแล้ว ยังไม่ได้แปลว่าแผนใช้ได้ทันที — คำเตือนโชว์อยู่ที่หน้าเว็บ
  await db.from('video_projects').update({ status: 'scripted' }).eq('id', project.id)

  if (problems.length > 0) {
    console.warn(`[video_plan] ${project.id} มีข้อควรตรวจ ${problems.length} ข้อ:`, problems)
  }

  await track('ad_video_planned', project.org_id, {
    platform: project.platform,
    shots: plan.storyboard.length,
    total_seconds: totalShotSeconds(plan),
    problems: problems.length,
    latency_sec: Math.round((Date.now() - startedAt) / 1000),
  })

  console.log(
    `[video_plan] ${project.id} วางแผนเสร็จ ${plan.storyboard.length} ช็อต ` +
      `(ข้อควรตรวจ ${problems.length} ข้อ)`,
  )
}
