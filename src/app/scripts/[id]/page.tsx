import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { splitIntoScenes, estimateDurationSeconds } from '@/lib/scenes'
import { ReviewForm } from './form'

export const dynamic = 'force-dynamic'

export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: script } = await supabase
    .from('scripts')
    .select('id, title, body, status, originality')
    .eq('id', id)
    .maybeSingle()

  if (!script) notFound()

  const scenes = script.body ? splitIntoScenes(script.body) : []
  const seconds = estimateDurationSeconds(scenes)
  const minutes = Math.floor(seconds / 60)

  return (
    <main className="mx-auto max-w-2xl px-5 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{script.title}</h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        {script.body
          ? `${scenes.length} ฉาก · ยาวประมาณ ${minutes} นาที ${seconds % 60} วินาที`
          : 'AI กำลังเขียนอยู่ กลับมาดูอีกครั้งในอีกสักครู่'}
      </p>

      {script.body && (
        <>
          <section className="mt-8">
            <h2 className="text-sm font-semibold">สคริปต์</h2>
            <div className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {scenes.map((scene) => (
                <div key={scene.index} className="flex gap-4 px-4 py-3.5 sm:px-5">
                  <span className="tabular w-8 shrink-0 pt-0.5 text-xs text-ink-muted">
                    {scene.index + 1}
                  </span>
                  <p className="flex-1 leading-relaxed">{scene.text}</p>
                  <span className="tabular w-12 shrink-0 pt-0.5 text-right text-xs text-ink-muted">
                    {scene.estimatedSeconds}s
                  </span>
                </div>
              ))}
            </div>
          </section>

          <ReviewForm scriptId={script.id} />
        </>
      )}
    </main>
  )
}
