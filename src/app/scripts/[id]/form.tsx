'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CHECKLIST, CHECKLIST_MIN_PASS, type ChecklistKey } from '@/lib/originality'
import type { OriginalityReport } from '@/lib/originality'

/**
 * ด่านตรวจก่อนสั่งตัดต่อ
 *
 * ติ๊กเองเพราะระบบตรวจแทนคนไม่ได้ในข้อพวกนี้ — มีมุมของตัวเองไหม ตัวเลขตรวจแหล่งได้ไหม
 * API ตรวจซ้ำฝั่ง server อยู่แล้ว ติ๊กครบในหน้านี้ไม่ได้แปลว่าจะผ่านอัตโนมัติ
 */
export function ReviewForm({ scriptId }: { scriptId: string }) {
  const router = useRouter()
  const [checked, setChecked] = useState<Partial<Record<ChecklistKey, boolean>>>({})
  const [pending, setPending] = useState(false)
  const [blocked, setBlocked] = useState<OriginalityReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const passed = CHECKLIST.filter((item) => checked[item.key]).length
  const enough = passed >= CHECKLIST_MIN_PASS

  async function submit() {
    setError(null)
    setBlocked(null)
    setPending(true)

    const response = await fetch('/api/videos/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ script_id: scriptId, checklist: checked }),
    })

    const body = (await response.json().catch(() => ({}))) as {
      error?: string
      originality?: OriginalityReport
    }

    if (response.status === 409 && body.originality) {
      setBlocked(body.originality)
      setPending(false)
      return
    }

    if (!response.ok) {
      setError(body.error ?? 'สั่งตัดต่อไม่สำเร็จ ลองใหม่อีกครั้ง')
      setPending(false)
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold">ตรวจก่อนสั่งตัดต่อ</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        ต้องผ่านอย่างน้อย {CHECKLIST_MIN_PASS} ข้อจาก {CHECKLIST.length} ข้อ
        เกณฑ์นี้มีไว้กันช่องโดนตัดรายได้จากเนื้อหาที่ถูกมองว่าซ้ำ
      </p>

      <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {CHECKLIST.map((item) => (
          <li key={item.key}>
            <label className="flex cursor-pointer items-start gap-3 px-4 py-3.5 sm:px-5">
              <input
                type="checkbox"
                checked={checked[item.key] ?? false}
                onChange={(e) => setChecked((prev) => ({ ...prev, [item.key]: e.target.checked }))}
                className="mt-1 size-4 shrink-0 accent-current"
              />
              <span className="leading-snug">{item.question}</span>
            </label>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-sm text-ink-muted">
        ผ่านแล้ว{' '}
        <span className={`tabular ${enough ? 'text-live' : 'text-ink'}`}>{passed}</span>/
        <span className="tabular">{CHECKLIST.length}</span> ข้อ
      </p>

      {blocked && (
        <div className="mt-4 rounded-xl border border-block/50 bg-block/10 px-4 py-3.5 sm:px-5">
          <p className="font-medium text-block">ยังส่งเข้าคิวไม่ได้</p>
          <ul className="mt-2 space-y-1 text-sm leading-relaxed text-ink-muted">
            {blocked.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-block">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending || !enough}
        className="mt-5 w-full rounded-lg px-4 py-3 font-medium transition disabled:opacity-50"
        style={{ color: 'var(--color-base)', background: 'var(--color-ink)' }}
      >
        {pending ? 'กำลังส่ง…' : enough ? 'ส่งเข้าคิวตัดต่อ' : `ติ๊กให้ครบ ${CHECKLIST_MIN_PASS} ข้อก่อน`}
      </button>
    </section>
  )
}
