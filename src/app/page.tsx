import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const JOB_LABEL: Record<string, string> = {
  script_generate: 'เขียนสคริปต์',
  video_render: 'ตัดต่อคลิป',
  youtube_upload: 'อัปขึ้น YouTube',
  metrics_sync: 'ดึงตัวเลขผลงาน',
}

const VIDEO_LABEL: Record<string, string> = {
  queued: 'รอคิว',
  rendering: 'กำลังตัดต่อ',
  ready: 'พร้อมเผยแพร่',
  scheduled: 'ตั้งเวลาไว้',
  published: 'เผยแพร่แล้ว',
  failed: 'ทำไม่สำเร็จ',
  blocked: 'ถูกบล็อก',
}

/** สีสถานะ: signal = กำลังผลิต · live = เผยแพร่แล้ว · block = ถูกบล็อก */
function videoTone(status: string): string {
  if (status === 'published') return 'text-live'
  if (status === 'blocked' || status === 'failed') return 'text-block'
  return 'text-signal'
}

function jobTone(status: string): string {
  if (status === 'done') return 'text-live'
  if (status === 'dead') return 'text-block'
  return 'text-signal'
}

function isConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

export default async function Page() {
  if (!isConfigured()) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold">ยังตั้งค่าไม่ครบ</h1>
        <p className="mt-3 text-ink-muted">
          คัดลอก <code className="tabular">.env.example</code> เป็น{' '}
          <code className="tabular">.env.local</code> แล้วเติมค่า Supabase ก่อน จากนั้นรัน{' '}
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

  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold">เข้าสู่ระบบเพื่อดูสายการผลิต</h1>
        <p className="mt-3 text-ink-muted">
          หน้านี้แสดงคิวงานและคลิปขององค์กรที่คุณเป็นสมาชิก
        </p>
      </main>
    )
  }

  // RLS คัดให้เหลือเฉพาะองค์กรที่ผู้ใช้เป็นสมาชิกอยู่แล้ว
  const [{ data: jobs }, { data: videos }] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, kind, status, attempts, max_attempts, run_after, last_error')
      .in('status', ['queued', 'claimed', 'dead'])
      .order('run_after', { ascending: true })
      .limit(20),
    supabase
      .from('videos')
      .select('id, title, status, published_at, block_reason')
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-2xl font-semibold">สายการผลิต</h1>

      <section className="mt-10">
        <h2 className="text-sm font-medium tracking-wide text-ink-muted">งานในคิว</h2>
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface">
          {(jobs ?? []).length === 0 && (
            <li className="px-4 py-6 text-ink-muted">ไม่มีงานค้างอยู่</li>
          )}
          {jobs?.map((job) => (
            <li key={job.id} className="flex items-baseline gap-4 px-4 py-3">
              <span className={`w-24 shrink-0 text-sm ${jobTone(job.status)}`}>
                {job.status === 'dead' ? 'ล้มเหลว' : job.status === 'claimed' ? 'กำลังทำ' : 'รอคิว'}
              </span>
              <span className="flex-1">{JOB_LABEL[job.kind] ?? job.kind}</span>
              <span className="tabular text-sm text-ink-muted">
                ครั้งที่ {job.attempts}/{job.max_attempts}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium tracking-wide text-ink-muted">คลิปล่าสุด</h2>
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface">
          {(videos ?? []).length === 0 && (
            <li className="px-4 py-6 text-ink-muted">ยังไม่มีคลิป</li>
          )}
          {videos?.map((video) => (
            <li key={video.id} className="px-4 py-3">
              <div className="flex items-baseline gap-4">
                <span className={`w-28 shrink-0 text-sm ${videoTone(video.status)}`}>
                  {VIDEO_LABEL[video.status] ?? video.status}
                </span>
                <span className="flex-1">{video.title}</span>
              </div>
              {video.block_reason && (
                <p className="mt-1 pl-32 text-sm text-block">{video.block_reason}</p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
