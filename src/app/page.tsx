import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Section, type Row } from '@/components/section'
import { AutoRefresh } from '@/components/auto-refresh'
import { jobView, videoStage } from '@/lib/pipeline'

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
  const { count: orgCount } = await supabase
    .from('org_members')
    .select('org_id', { count: 'exact', head: true })

  if (!orgCount) redirect('/onboarding')

  // RLS คัดให้เหลือเฉพาะองค์กรที่ผู้ใช้เป็นสมาชิกอยู่แล้ว
  const [{ data: videos }, { data: jobs }] = await Promise.all([
    supabase
      .from('videos')
      .select('id, title, status, block_reason, published_at')
      .order('created_at', { ascending: false })
      .limit(60),
    supabase
      .from('jobs')
      .select('id, kind, status, attempts, run_after')
      .in('status', ['queued', 'claimed', 'dead'])
      .order('run_after', { ascending: true })
      .limit(60),
  ])

  const now = new Date()

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

        {/* Hick's Law: หน้านี้มีปุ่มหลักปุ่มเดียว · Fitts's Law: เต็มความกว้างบนมือถือ */}
        <Link
          href="/scripts/new"
          className="w-full rounded-lg px-4 py-2.5 text-center font-medium transition sm:w-auto"
          style={{ color: 'var(--color-base)', background: 'var(--color-ink)' }}
        >
          สร้างคลิปใหม่
        </Link>
      </header>

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
    </main>
  )
}
