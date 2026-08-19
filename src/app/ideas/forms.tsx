'use client'

import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AUDIENCE_SEGMENTS } from '@/lib/idea-angles'
import { JOB_COST } from '@/lib/credits'
import { dropIdea, type IdeaState } from './actions'

type Channel = { id: string; name: string }

/**
 * สั่งให้ AI คิดหัวข้อ
 *
 * Hick's Law: ตัวเลือกน้อยที่สุดที่ยังพอ — ช่อง จำนวน และกลุ่มเป้าหมาย
 * ไม่เปิดให้ตั้งค่ามุมเปิดเรื่องเอง เพราะเลือกผิดแล้วได้หัวข้อแย่ลง
 * และเป็นเรื่องที่ระบบตัดสินได้ดีกว่าจากแนวช่อง
 */
export function GenerateForm({ channels, credits }: { channels: Channel[]; credits: number }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [segment, setSegment] = useState<string>('')

  const cost = JOB_COST.idea_generate
  const enough = credits >= cost

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)

    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/ideas/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channel_id: form.get('channel_id'),
        count: Number(form.get('count')),
        segment: segment || undefined,
      }),
    })

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      setError(body.error ?? 'สั่งคิดหัวข้อไม่สำเร็จ')
      setPending(false)
      return
    }

    setPending(false)
    router.refresh()
  }

  const field =
    'w-full rounded-lg border border-line bg-surface-2 px-3 py-2 outline-none focus:border-ink-muted'

  return (
    <form onSubmit={submit} className="mt-4 rounded-xl border border-line bg-surface px-4 py-4 sm:px-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {channels.length > 1 ? (
          <select name="channel_id" className={field} defaultValue={channels[0]?.id}>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <input type="hidden" name="channel_id" value={channels[0]?.id ?? ''} />
        )}

        <select
          value={segment}
          onChange={(e) => setSegment(e.target.value)}
          className={field}
          aria-label="กลุ่มเป้าหมาย"
        >
          <option value="">ทุกกลุ่ม (ให้ระบบเลือก)</option>
          {AUDIENCE_SEGMENTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label} — {s.role}
            </option>
          ))}
        </select>

        <select name="count" className={field} defaultValue="5" aria-label="จำนวนหัวข้อ">
          {[3, 5, 8, 10].map((n) => (
            <option key={n} value={n}>
              {n} หัวข้อ
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !enough}
          className="w-full rounded-lg px-4 py-2.5 font-medium transition disabled:opacity-50 sm:w-auto"
          style={{ color: 'var(--color-base)', background: 'var(--color-ink)' }}
        >
          {pending ? 'กำลังคิด…' : 'ให้ AI คิดหัวข้อ'}
        </button>
        <span className="text-xs text-ink-muted">
          {enough ? `ใช้ ${cost} เครดิต` : 'เครดิตไม่พอ'}
        </span>
      </div>

      {error && (
        <p className="mt-2 text-sm" style={{ color: 'var(--color-block)' }}>
          {error}
        </p>
      )}
    </form>
  )
}

const INITIAL: IdeaState = { error: null }

export function DropButton({ ideaId }: { ideaId: string }) {
  const [state, action, pending] = useActionState(dropIdea, INITIAL)

  return (
    <form action={action}>
      <input type="hidden" name="ideaId" value={ideaId} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-ink-muted transition hover:text-ink disabled:opacity-50"
      >
        {pending ? 'กำลังลบ…' : 'ทิ้ง'}
      </button>
      {state.error && (
        <span className="ml-2 text-xs" style={{ color: 'var(--color-block)' }}>
          {state.error}
        </span>
      )}
    </form>
  )
}
