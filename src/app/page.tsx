import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Section, type Row } from '@/components/section'
import { AutoRefresh } from '@/components/auto-refresh'
import { formatRelative, jobLabel, jobView, videoStage } from '@/lib/pipeline'
import { KpiStrip, type Kpi } from '@/components/kpi-strip'
import { Sparkline } from '@/components/sparkline'
import { RequeueButton } from '@/components/requeue-button'
import { estimateSpendThb } from '@/lib/costs'

export const dynamic = 'force-dynamic'

function isConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

export default async function Page() {
  // Postel's Law: รับสภาพที่ยังตั้งค่าไม่เสร็จได้ และบอกให้ชัดว่าต้องทำอะไรต่อ
  if (!isConfigured()) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-16 sm:px-6">
        <h1 className="text-2xl font-semibold">ยังตั้งค่าไม่ครบ</h1>
        <p className="mt-3 leading-relaxed text-ink-muted">
          คัดลอก <code className="tabular">.env.example</code> เป็น{' '}
          <code className="tabular">.env.local</code> แล้วเติมค่า Supabase จากนั้นรัน{' '}
          <code className="tabular">supabase db push</code> และ{' '}
          <code className="tabular">pnpm db:types</code>
        </p>
      </main>
    )
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // ยังไม่มีองค์กร = ผู้ใช้ใหม่ พาไปเปิดพื้นที่ทำงานก่อน
  const { data: memberships } = await supabase.from('org_members').select('org_id').limit(1)
  const orgId = memberships?.[0]?.org_id

  if (!orgId) redirect('/onboarding')

  // RLS คัดให้เหลือเฉพาะองค์กรที่ผู้ใช้เป็นสมาชิกอยู่แล้ว
  const [{ data: videos }, { data: jobs }] = await Promise.all([
    supabase
      .from('videos')
      .select('id, title, status, block_reason, published_at, storage_path')
      .order('created_at', { ascending: false })
      .limit(60),
    supabase
      .from('jobs')
      .select('id, kind, status, attempts, run_after')
      .in('status', ['queued', 'claimed', 'dead'])
      .order('run_after', { ascending: true })
      .limit(60),
  ])

  /**
   * ตัวเลขสรุปมาจาก rpc ไม่ใช่ query ตรง ๆ เพราะ youtube_quota ปิด RLS ไว้สนิท
   * (ไม่มี policy เลย = client อ่านไม่ได้โดยตั้งใจ) และรวมเป็นรอบเดียวโหลดเร็วกว่า
   */
  const [{ data: summaryRows }, { data: stuckRows }, { data: quotaRows }, { data: dailyRows }] =
    await Promise.all([
      supabase.rpc('pipeline_summary', { p_org_id: orgId }),
      supabase.rpc('pipeline_stuck_jobs', { p_org_id: orgId }),
      supabase.rpc('quota_remaining_clips', { p_org_id: orgId }),
      supabase.rpc('pipeline_daily', { p_org_id: orgId, p_days: 30 }),
    ])

  const stats = summaryRows?.[0]
  const quota = quotaRows?.[0]
  const stuck = stuckRows ?? []
  const daily = dailyRows ?? []

  const now = new Date()

  const kpis: Kpi[] = stats
    ? [
        {
          label: 'ต้องแตะเอง',
          value: stats.stuck_count === 0 ? 'ไม่มี' : String(stats.stuck_count),
          context: stats.stuck_count === 0 ? 'ระบบเดินเองได้ทั้งหมด' : 'ระบบไปต่อเองไม่ได้',
          alert: stats.stuck_count > 0,
        },
        {
          label: 'ใช้ไปเดือนนี้',
          value: `฿${estimateSpendThb(stats.credits_used_month).toLocaleString('th-TH')}`,
          context: `${stats.credits_used_month} เครดิต · ประมาณจากคลิปมาตรฐาน`,
          estimated: true,
        },
        {
          label: 'ผลิตเดือนนี้',
          value: `${stats.clips_done_month} / ${stats.monthly_target}`,
          context: `เหลืออีก ${Math.max(stats.monthly_target - stats.clips_done_month, 0)} คลิปถึงเป้า`,
          progress: stats.clips_done_month / stats.monthly_target,
        },
        {
          label: 'อัปได้วันนี้',
          value: quota ? `${quota.clips_left} คลิป` : '—',
          context: quota
            ? quota.is_shared
              ? 'ความจุคลังกลาง ใช้ร่วมกับช่องอื่น'
              : 'โควตาของช่องคุณเอง'
            : 'ยังไม่ได้ตั้งค่าคลังโควตา',
        },
      ]
    : []

  const videoRows = (videos ?? []).map((video) => {
    const stage = videoStage(video.status)
    return {
      row: {
        key: video.id,
        title: video.title,
        tone: stage.tone,
        label: stage.label,
        // เหตุผลที่ระบบบล็อกมีค่ากว่าคำว่า "ถูกบล็อก" — เอามาแสดงแทนเมื่อมี
        detail: video.block_reason ?? stage.detail,
        step: stage.step,
        // มีไฟล์แล้วต้องเอาออกไปใช้ได้จากในแอป ไม่ใช่ต้องไปเปิด Supabase Dashboard เอง
        action: video.storage_path
          ? { href: `/api/videos/${video.id}/download`, label: '⬇ ดาวน์โหลด mp4' }
          : undefined,
      } satisfies Row,
      stage,
      status: video.status,
    }
  })

  /**
   * งานในคิวกับคลิปเป็นของสิ่งเดียวกันในสายตาผู้ใช้ ไม่แสดงซ้อนกันสองรายการ
   * โผล่เฉพาะตอนที่งานเป็นสัญญาณเดียวที่มี: สคริปต์ที่ยังไม่กลายเป็นคลิป กับงานที่ตายแล้ว
   */
  const jobRows = (jobs ?? [])
    .filter((job) => job.status === 'dead' || job.kind === 'script_generate')
    .map((job) => {
      const view = jobView(job, now)
      return {
        row: {
          key: job.id,
          title: view.label,
          tone: view.tone,
          label: view.needsAttention ? 'ไม่สำเร็จ' : 'กำลังทำ',
          detail: view.detail,
          step: job.kind === 'script_generate' ? 1 : undefined,
        } satisfies Row,
        view,
      }
    })

  /**
   * Serial Position Effect: คนจำหัวกับท้ายรายการได้ดีที่สุด
   * ของที่ต้องลงมือทำจึงอยู่บนสุด และผลงานที่สำเร็จแล้วอยู่ล่างสุด
   */
  const attention: Row[] = [
    ...videoRows.filter((item) => item.stage.needsAttention).map((item) => item.row),
    ...jobRows.filter((item) => item.view.needsAttention).map((item) => item.row),
  ]

  const active: Row[] = [
    ...videoRows
      .filter((item) => !item.stage.needsAttention && item.status !== 'published')
      .map((item) => item.row),
    ...jobRows.filter((item) => !item.view.needsAttention).map((item) => item.row),
  ]

  const published: Row[] = videoRows
    .filter((item) => item.status === 'published')
    .map((item) => item.row)

  // Zeigarnik Effect: งานที่ยังไม่จบค้างอยู่ในหัวคน — บอกจำนวนไปเลยว่าค้างเท่าไร
  const summary = [
    attention.length > 0 ? `${attention.length} รายการรอคุณจัดการ` : null,
    active.length > 0 ? `${active.length} กำลังผลิต` : null,
    published.length > 0 ? `${published.length} เผยแพร่แล้ว` : null,
  ].filter(Boolean)

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
      {/* หน้าจอขยับเองเฉพาะตอนมีงานเดินอยู่ ไม่มีงานก็ไม่ต้องโพล */}
      <AutoRefresh enabled={active.length > 0} />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">สายการผลิต</h1>
          {/* Selective Attention: บรรทัดเดียวที่ตอบว่า "ตอนนี้เป็นยังไง" ก่อนจะไล่อ่านรายการ */}
          <p className="mt-1.5 text-sm text-ink-muted">
            {summary.length > 0 ? summary.join(' · ') : 'ยังไม่มีอะไรอยู่ในสายการผลิต'}
          </p>
        </div>

        {/* Hick's Law: หน้านี้มีปุ่มหลักปุ่มเดียว — ตั้งค่าเป็นลิงก์ข้อความ ไม่ใช่ปุ่มแข่งกัน */}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Link href="/settings" className="text-sm text-ink-muted transition hover:text-ink">
            ตั้งค่า
          </Link>
        <Link
          href="/scripts/new"
          className="w-full rounded-lg px-4 py-2.5 text-center font-medium transition sm:w-auto"
          style={{ color: 'var(--color-base)', background: 'var(--color-ink)' }}
        >
          สร้างคลิปใหม่
        </Link>
        </div>
      </header>

      {kpis.length > 0 && <KpiStrip items={kpis} />}

      {/* งานที่ระบบไปต่อเองไม่ได้ — อยู่บนสุดเพราะเป็นสิ่งเดียวที่ต้องลงมือทำ */}
      {stuck.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold">ต้องแตะเอง</h2>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {stuck.map((job) => (
              <li key={job.job_id} className="px-4 py-3.5 sm:px-5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-medium" style={{ color: 'var(--color-block)' }}>
                    {job.reason}
                  </span>
                  <span className="text-sm text-ink-muted">
                    {jobLabel(job.kind as Parameters<typeof jobLabel>[0])} ·{' '}
                    {formatRelative(new Date(job.stuck_since), now)}
                  </span>
                </div>
                {job.last_error && (
                  <p className="mt-1 text-sm leading-snug text-ink-muted">{job.last_error}</p>
                )}
                {job.can_requeue && <RequeueButton jobId={job.job_id} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* หมวดนี้โผล่เฉพาะตอนมีของจริง หัวข้อว่างเปล่าไม่ได้ช่วยอะไรนอกจากกินที่ */}
      {attention.length > 0 && (
        <Section
          title="ต้องจัดการก่อน"
          hint="ระบบไปต่อเองไม่ได้"
          rows={attention}
          emptyText=""
        />
      )}

      <Section
        title="กำลังผลิต"
        hint={active.length > 0 ? 'อัปเดตเองทุก 10 วินาที' : undefined}
        rows={active}
        emptyText="ไม่มีงานเดินอยู่ตอนนี้ เริ่มจากสร้างสคริปต์จากไอเดียในช่องของคุณ"
      />

      <Section
        title="เผยแพร่แล้ว"
        rows={published}
        emptyText="ยังไม่มีคลิปที่เผยแพร่ คลิปแรกจะมาโผล่ตรงนี้"
      />

      {/* แนวโน้มอยู่ล่างสุด — เป็นบริบท ไม่ใช่สิ่งที่ต้องเห็นก่อนตัดสินใจอะไร */}
      {daily.length > 0 && stats && (
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <Sparkline
            label="คลิปเสร็จต่อวัน (30 วัน)"
            values={daily.map((d) => d.clips_done)}
            target={stats.monthly_target / 30}
          />
          <Sparkline
            label="เครดิตที่ใช้ต่อวัน (30 วัน)"
            values={daily.map((d) => d.credits_used)}
          />
        </div>
      )}
    </main>
  )
}
