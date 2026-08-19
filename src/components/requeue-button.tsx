'use client'

import { useActionState } from 'react'
import { requeueJob, type RequeueState } from '@/app/actions'

const INITIAL: RequeueState = { error: null }

/** ปุ่มเดียวสำหรับงานที่ worker ตายกลางทาง — งานที่ตายถาวรไม่มีปุ่มนี้ ต้องดูก่อนว่าเกิดอะไร */
export function RequeueButton({ jobId }: { jobId: string }) {
  const [state, action, pending] = useActionState(requeueJob, INITIAL)

  return (
    <form action={action} className="mt-2">
      <input type="hidden" name="jobId" value={jobId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
      >
        {pending ? 'กำลังปลดล็อก…' : 'เอากลับเข้าคิว'}
      </button>
      {state.error && (
        <p className="mt-1.5 text-xs" style={{ color: 'var(--color-block)' }}>
          {state.error}
        </p>
      )}
    </form>
  )
}
