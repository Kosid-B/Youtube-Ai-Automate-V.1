import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AutoRefresh } from '@/components/auto-refresh'
import { StatusPill } from '@/components/status-pill'
import { CancelButton, CreateProjectForm, GenerateForm, PlanForm, StoryboardPanel } from './forms'
import { availableProviders } from '@/lib/video/registry'
import { maxCostUsd, maxDurationSeconds } from '@/lib/video/router'
import {
  planFromRow,
  planProblems,
  platformSeconds,
  type MarketingBrief,
  type Platform,
} from '@/lib/video/director'
import type { Tone } from '@/lib/pipeline'

export const dynamic = 'force-dynamic'

const STATUS: Record<string, { label: string; tone: Tone; detail: string }> = {
  queued: { label: 'รอคิว', tone: 'quiet', detail: 'กำลังเลือกผู้ให้บริการ' },
  running: { label: 'กำลังสร้าง', tone: 'signal', detail: 'ผู้ให้บริการกำลังทำงาน' },
  done: { label: 'เสร็จแล้ว', tone: 'live', detail: 'พร้อมดาวน์โหลด' },
  failed: { label: 'ไม่สำเร็จ', tone: 'block', detail: 'ดูสาเหตุด้านล่าง' },
}

function Card({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-6 rounded-xl border border-line bg-surface px-4 py-4 sm:px-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <span className="text-xs text-ink-muted">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

export default async function VideoDashboard() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: memberships } = await supabase.from('org_members').select('org_id').limit(1)
  if (!memberships?.[0]) redirect('/onboarding')

  // RLS คัดให้เหลือเฉพาะองค์กรที่ผู้ใช้เป็นสมาชิก ไม่ต้องกรอง org เองในคิวรี
  const [{ data: projects }, { data: generations }, { data: scripts }, { data: planJobs }] =
    await Promise.all([
    supabase
      .from('video_projects')
      .select('id, title, objective, audience, platform, aspect_ratio, status, created_at')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('video_generations')
      .select(
        'id, project_id, prompt, aspect, seconds, provider, model, tier, routing_policy, status, estimated_cost_usd, output_storage_path, error, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('video_scripts')
      .select('id, project_id, hook, script, cta, storyboard, created_at')
      .order('created_at', { ascending: false })
      .limit(20),
    /**
     * งานวางแผนที่ยังไม่จบ — ใช้บอกผู้ใช้ว่ากำลังทำอยู่ ไม่ใช่ปุ่มไม่ทำงาน
     *
     * ไม่มีตรงนี้แล้วหน้าจะเหมือนเดิมทุกอย่างหลังกดปุ่ม ซึ่งอ่านได้อย่างเดียวว่าพัง
     * แล้วผู้ใช้จะกดซ้ำ — ซึ่งตัดเครดิตอีกรอบ
     */
    supabase
      .from('jobs')
      .select('id, kind, status, payload')
      .eq('kind', 'video_plan')
      .in('status', ['queued', 'claimed'])
      .limit(20),
  ])

  const providers = availableProviders()
  const active = (generations ?? []).filter((g) => g.status === 'queued' || g.status === 'running')

  const planning = new Set(
    (planJobs ?? [])
      .map((job) => (job.payload as { project_id?: string } | null)?.project_id)
      .filter((id): id is string => typeof id === 'string'),
  )

  return (
    <main className="mx-auto max-w-2xl px-5 py-10 sm:px-6">
      {/* Doherty Threshold: งานกินเวลาเป็นนาที ให้หน้าจอขยับเองแทนที่จะให้คนกดรีเฟรช */}
      <AutoRefresh enabled={active.length > 0 || planning.size > 0} />

      <header>
        {/* Jakob's Law: ลิงก์กลับมุมบนซ้ายเหมือนทุกเว็บ ไม่ต้องเรียนรู้ใหม่ */}
        <Link href="/" className="text-sm text-ink-muted transition hover:text-ink">
          ← สายการผลิต
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">คลิปโฆษณา</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          คลิปสั้นที่ AI สร้างให้ทั้งคลิป — คนละอย่างกับคลิปเล่าเรื่องในหน้าสายการผลิต
          ซึ่งประกอบจากภาพนิ่งกับเสียงพากย์
        </p>
      </header>

      {providers.length === 0 ? (
        /* Postel's Law: สถานะที่ยังไม่พร้อมต้องบอกว่าทำอะไรต่อ ไม่ใช่บอกแค่ว่าไม่มี */
        <div className="mt-6 rounded-xl border border-line bg-surface px-4 py-5 sm:px-5">
          <p className="font-medium">ยังใช้ไม่ได้ — ยังไม่ได้ตั้งคีย์ผู้ให้บริการ</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            ตั้ง <code className="text-ink">GOOGLE_AI_API_KEY</code> (Veo) หรือ{' '}
            <code className="text-ink">RUNWAY_API_KEY</code> ในเซิร์ฟเวอร์ที่รันเว็บ
            แล้วรัน <code className="text-ink">pnpm preflight</code> เพื่อตรวจว่าเรียกได้จริง
          </p>
        </div>
      ) : (
        <p className="mt-4 text-xs text-ink-muted">
          ผู้ให้บริการที่พร้อม: {providers.map((p) => p.id).join(', ')} · เพดาน $
          {maxCostUsd().toFixed(2)}/คลิป · ยาวได้ถึง {maxDurationSeconds()} วินาที
        </p>
      )}

      <Card title="เริ่มงานใหม่" hint="เป้าหมายธุรกิจ → กลุ่มเป้าหมาย → แพลตฟอร์ม">
        <CreateProjectForm />
      </Card>

      {(projects ?? []).map((project) => {
        const mine = (generations ?? []).filter((g) => g.project_id === project.id)
        const row = (scripts ?? []).find((s) => s.project_id === project.id)
        const plan = row ? planFromRow(row) : null

        /**
         * คำนวณคำเตือนใหม่ทุกครั้งที่เปิดหน้า ไม่เก็บลงตาราง
         *
         * planProblems บริสุทธิ์ จึงคิดใหม่ได้ฟรี · เก็บลงตารางแล้ววันที่กติกาเปลี่ยน
         * แผนเก่าจะยังโชว์คำเตือนชุดเดิมค้างไว้ ทั้งที่ไม่ใช่ปัญหาแล้ว
         * (หรือแย่กว่า: ไม่โชว์ปัญหาใหม่ที่เพิ่งกลายเป็นปัญหา)
         */
        const brief: MarketingBrief = {
          title: project.title,
          objective: project.objective,
          audience: project.audience,
          platform: project.platform as Platform,
          aspect: project.aspect_ratio,
          notes: plan?.notes ?? null,
          totalSeconds: platformSeconds(project.platform as Platform),
        }
        const problems = plan ? planProblems(plan, brief) : []

        return (
          <Card
            key={project.id}
            title={project.title}
            hint={`${project.aspect_ratio} · ${mine.length} คลิป`}
          >
            {project.objective && (
              <p className="mt-2 text-sm text-ink-muted">เป้าหมาย: {project.objective}</p>
            )}
            {project.audience && (
              <p className="mt-1 text-sm text-ink-muted">กลุ่มเป้าหมาย: {project.audience}</p>
            )}

            {plan ? (
              <div className="mt-4 rounded-lg border border-line bg-surface-2 px-3.5 py-3">
                {/* hook มาก่อนทุกอย่าง เพราะเป็นสิ่งเดียวที่คนดูจะได้ยินแน่ ๆ */}
                <p className="text-xs text-ink-muted">3 วินาทีแรก</p>
                <p className="mt-0.5 font-medium leading-relaxed">{plan.hook}</p>

                {plan.icp && (
                  <p className="mt-2.5 text-xs text-ink-muted">พูดกับ: {plan.icp}</p>
                )}
                {plan.pain && (
                  <p className="mt-0.5 text-xs text-ink-muted">ความเจ็บ: {plan.pain}</p>
                )}

                {plan.script && (
                  <p className="mt-2.5 whitespace-pre-line text-sm leading-relaxed">
                    {plan.script}
                  </p>
                )}

                {plan.cta && <p className="mt-2.5 text-sm font-medium">{plan.cta}</p>}
              </div>
            ) : planning.has(project.id) ? (
              <p className="mt-4 text-sm text-ink-muted">
                AI กำลังวางแผนอยู่ — หน้านี้จะอัปเดตเองเมื่อเสร็จ
              </p>
            ) : (
              project.objective && <PlanForm projectId={project.id} />
            )}

            {/*
              Postel's Law: คำเตือนต้องบอกว่าให้ทำอะไรต่อ ไม่ใช่บอกว่าผิด
              และต้องอยู่เหนือปุ่มสั่งสร้าง ไม่ใช่ใต้ — ใต้ปุ่มคือหลังจากจ่ายเงินไปแล้ว
            */}
            {problems.length > 0 && (
              <div className="mt-3 rounded-lg border px-3.5 py-3" style={{ borderColor: 'var(--color-block)' }}>
                <p className="text-sm font-medium">ตรวจก่อนสั่งสร้าง {problems.length} ข้อ</p>
                <ul className="mt-1.5 space-y-1">
                  {problems.map((problem) => (
                    <li key={problem} className="text-xs leading-relaxed text-ink-muted">
                      · {problem}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {providers.length > 0 &&
              (plan && plan.storyboard.length > 0 ? (
                <StoryboardPanel
                  projectId={project.id}
                  aspect={project.aspect_ratio as '9:16' | '16:9'}
                  shots={plan.storyboard}
                />
              ) : (
                <GenerateForm
                  projectId={project.id}
                  aspect={project.aspect_ratio as '9:16' | '16:9'}
                />
              ))}

            {mine.length > 0 && (
              <ul className="mt-4 divide-y divide-line border-t border-line">
                {mine.map((generation) => {
                  const view = STATUS[generation.status] ?? STATUS.queued

                  return (
                    <li key={generation.id} className="py-3">
                      <div className="flex items-start gap-3">
                        <StatusPill tone={view.tone}>{view.label}</StatusPill>
                        <span className="min-w-0 flex-1 text-sm leading-snug line-clamp-2">
                          {generation.prompt}
                        </span>
                      </div>

                      <p className="mt-1.5 text-xs text-ink-muted">
                        {generation.provider === 'pending' ? 'ยังไม่ได้เลือกผู้ให้บริการ' : generation.provider}
                        {generation.model !== 'pending' && ` · ${generation.model}`} ·{' '}
                        {generation.seconds} วินาที · ประมาณ $
                        {Number(generation.estimated_cost_usd).toFixed(2)}
                      </p>

                      {generation.error && (
                        <p className="mt-1 text-xs" style={{ color: 'var(--color-block)' }}>
                          {generation.error}
                        </p>
                      )}

                      {generation.status === 'running' && (
                        <CancelButton generationId={generation.id} />
                      )}

                      {generation.output_storage_path && (
                        <a
                          href={`/api/video/${generation.id}/download`}
                          className="mt-2 inline-block rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium transition hover:border-ink-muted"
                        >
                          ⬇ ดาวน์โหลด mp4
                        </a>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        )
      })}

      {(projects ?? []).length === 0 && (
        <p className="mt-6 text-sm text-ink-muted">ยังไม่มีงาน — สร้างงานแรกจากฟอร์มด้านบน</p>
      )}
    </main>
  )
}
