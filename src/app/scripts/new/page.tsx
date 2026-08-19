import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { NewScriptForm } from './form'

export const dynamic = 'force-dynamic'

export default async function NewScriptPage({
  searchParams,
}: {
  // มาจากปุ่ม "เขียนสคริปต์จากหัวข้อนี้" ในหน้าหัวข้อคลิป
  searchParams: Promise<{ title?: string; idea?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: channels } = await supabase
    .from('channels')
    .select('id, name, org_id')
    .order('created_at', { ascending: true })

  if (!channels || channels.length === 0) redirect('/onboarding')

  const orgId = channels[0].org_id
  const { data: org } = await supabase
    .from('organizations')
    .select('credits')
    .eq('id', orgId)
    .maybeSingle()

  return (
    <main className="mx-auto max-w-xl px-5 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">สร้างคลิปใหม่</h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        AI จะเขียนสคริปต์ให้ก่อน แล้วคุณค่อยตรวจก่อนสั่งตัดต่อ
      </p>

      <NewScriptForm
        channels={channels}
        credits={org?.credits ?? 0}
        presetTitle={params.title}
        ideaId={params.idea}
      />
    </main>
  )
}
