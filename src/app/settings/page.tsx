import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CREDITS_PER_CLIP, estimateSpendThb } from '@/lib/costs'
import { TargetForm, TopUpForm } from './forms'

export const dynamic = 'force-dynamic'

/**
 * Law of Common Region: แยกเป็นการ์ดตามเรื่อง ไม่ใช่ฟอร์มยาวติดกันหมด
 * คนหาเรื่องที่ต้องการเจอโดยไม่ต้องอ่านทั้งหน้า
 */
function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
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

export default async function SettingsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, credits, monthly_target')
    .limit(1)
    .maybeSingle()

  if (!org) redirect('/onboarding')

  const { data: channels } = await supabase.rpc('channel_oauth_status', { p_org_id: org.id })

  const clipsLeft = Math.floor(org.credits / CREDITS_PER_CLIP)

  return (
    <main className="mx-auto max-w-2xl px-5 py-10 sm:px-6">
      <header>
        {/* Jakob's Law: ลิงก์กลับอยู่มุมบนซ้ายเหมือนทุกเว็บ ไม่ต้องเรียนรู้ใหม่ */}
        <Link href="/" className="text-sm text-ink-muted transition hover:text-ink">
          ← สายการผลิต
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">ตั้งค่า</h1>
        <p className="mt-1.5 text-sm text-ink-muted">{org.name}</p>
      </header>

      <Card title="เครดิต" hint={`เหลือทำได้อีก ~${clipsLeft} คลิป`}>
        <p className="mt-2 text-3xl font-semibold tabular tracking-tight">
          {org.credits.toLocaleString('th-TH')}
        </p>
        {/* ตัวเลขลอย ๆ ไม่บอกอะไร — เทียบเป็นของที่ผู้ใช้เข้าใจจริงคือจำนวนคลิปกับเงิน */}
        <p className="mt-1 text-xs text-ink-muted">
          ประมาณ ฿{estimateSpendThb(org.credits).toLocaleString('th-TH')} ตามต้นทุนคลิปมาตรฐาน
        </p>
        <TopUpForm />
      </Card>

      <Card title="เป้าการผลิต">
        <TargetForm current={org.monthly_target} />
      </Card>

      <Card title="ช่อง YouTube" hint={`${channels?.length ?? 0} ช่อง`}>
        {/* Postel's Law: สถานะที่ยังไม่พร้อมต้องบอกว่าทำอะไรต่อ ไม่ใช่บอกแค่ว่ายังไม่มี */}
        <ul className="mt-3 divide-y divide-line">
          {(channels ?? []).map((channel) => (
            <li key={channel.channel_id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0 flex-1 truncate">{channel.channel_name}</span>
              <span
                className="shrink-0 text-xs"
                style={{
                  color: channel.connected ? 'var(--color-live)' : 'var(--color-ink-muted)',
                }}
              >
                {channel.connected ? 'เชื่อมแล้ว' : 'ยังไม่เชื่อม'}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          การเชื่อมช่องเพื่ออัปคลิปอัตโนมัติยังทำไม่ได้ — ต้องตั้ง OAuth ใน Google Cloud
          Console ก่อน ระหว่างนี้ดาวน์โหลด mp4 จากหน้าสายการผลิตแล้วอัปเองได้
        </p>
      </Card>
    </main>
  )
}
