import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DropButton, GenerateForm } from './forms'

export const dynamic = 'force-dynamic'

/** เกินนี้หน้าจะยาวจนหาของดีไม่เจอ — ทิ้งที่ไม่เอาออกก่อน */
const MAX_SHOWN = 30

export default async function IdeasPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [{ data: org }, { data: channels }, { data: ideas }] = await Promise.all([
    supabase.from('organizations').select('id, credits').limit(1).maybeSingle(),
    supabase.from('channels').select('id, name').order('created_at'),
    supabase
      .from('ideas')
      .select('id, title, angle, source_note, score, channel_id')
      // คะแนนสูงอยู่บน — สิ่งที่ควรหยิบทำก่อนต้องอยู่ตรงที่ตาตกก่อน
      .order('score', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(MAX_SHOWN),
  ])

  if (!org) redirect('/onboarding')

  const list = ideas ?? []

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
      <header>
        <Link href="/" className="text-sm text-ink-muted transition hover:text-ink">
          ← สายการผลิต
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">หัวข้อคลิป</h1>
        {/* Selective Attention: บรรทัดเดียวที่บอกว่าตอนนี้เป็นยังไง */}
        <p className="mt-1.5 text-sm text-ink-muted">
          {list.length > 0
            ? `${list.length} หัวข้อรอเลือก · เรียงตามที่ระบบคิดว่ามีคนอยากรู้มากที่สุด`
            : 'ยังไม่มีหัวข้อ — ให้ AI คิดให้จากข้อมูลกลุ่มเป้าหมายจริงในไทย'}
        </p>
      </header>

      {(channels ?? []).length > 0 && (
        <GenerateForm channels={channels ?? []} credits={org.credits} />
      )}

      {/* Postel's Law: ยังไม่มีของ ต้องบอกว่าทำอะไรต่อ ไม่ใช่บอกแค่ว่าว่าง */}
      {list.length === 0 ? (
        <p className="mt-8 rounded-xl border border-line bg-surface px-4 py-6 text-sm leading-relaxed text-ink-muted sm:px-5">
          กดปุ่มด้านบนเพื่อให้ AI เสนอหัวข้อ โดยใช้ข้อมูลประชากรไทยจริง สัดส่วนแต่ละเจน
          และจังหวัดกำลังซื้อสูงเป็นตัวตั้ง แล้วเลือกเฉพาะหัวข้อที่คุณคิดว่าทำได้ดีจริง
          ไปสั่งเขียนสคริปต์ต่อ
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {list.map((idea) => (
            <li key={idea.id} className="rounded-xl border border-line bg-surface px-4 py-4 sm:px-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="min-w-0 flex-1 font-medium leading-snug">{idea.title}</h2>
                {/* คะแนนความต้องการ — ตัวเลขดิบไม่สื่อ แปลงเป็นคำที่ตัดสินใจได้ */}
                {idea.score !== null && (
                  <span
                    className="shrink-0 rounded-full border px-2 py-0.5 text-xs"
                    style={
                      idea.score >= 0.7
                        ? { borderColor: 'var(--color-live)', color: 'var(--color-live)' }
                        : { borderColor: 'var(--color-line)', color: 'var(--color-ink-muted)' }
                    }
                  >
                    {idea.score >= 0.7 ? 'น่าทำ' : 'พอได้'}
                  </span>
                )}
              </div>

              {idea.angle && <p className="mt-1.5 text-sm text-ink-muted">{idea.angle}</p>}

              {idea.source_note && (
                <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-ink-muted">
                  {idea.source_note}
                </p>
              )}

              <div className="mt-3 flex items-center gap-4">
                {/* Fitts's Law: ปุ่มหลักใหญ่กว่าและอยู่ซ้าย · ปุ่มทำลายเป็นข้อความเล็ก */}
                <Link
                  href={`/scripts/new?title=${encodeURIComponent(idea.title)}&idea=${idea.id}`}
                  className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm font-medium transition hover:border-ink-muted"
                >
                  เขียนสคริปต์จากหัวข้อนี้
                </Link>
                <DropButton ideaId={idea.id} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
