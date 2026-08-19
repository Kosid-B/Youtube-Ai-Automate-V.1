'use client'

import { useActionState } from 'react'
import { saveTarget, topUpCredits, type SettingsState } from './actions'

const INITIAL: SettingsState = { error: null, ok: null }

/**
 * Doherty Threshold: งานที่กินเวลาไม่ถึงวินาทีก็ยังต้องตอบกลับทันที
 * ปุ่มที่กดแล้วเงียบทำให้คนกดซ้ำ — บอกสถานะทุกครั้งทั้งตอนกำลังทำและตอนเสร็จ
 */
function Feedback({ state }: { state: SettingsState }) {
  if (state.error) {
    return (
      <p className="mt-2 text-sm" style={{ color: 'var(--color-block)' }}>
        {state.error}
      </p>
    )
  }
  if (state.ok) {
    return (
      <p className="mt-2 text-sm" style={{ color: 'var(--color-live)' }}>
        {state.ok}
      </p>
    )
  }
  return null
}

/** Fitts's Law: ปุ่มหลักเต็มความกว้างบนมือถือ กดพลาดยาก */
const FIELD =
  'w-full rounded-lg border border-line bg-surface-2 px-3 py-2 tabular outline-none focus:border-ink-muted'
const BUTTON =
  'w-full rounded-lg px-4 py-2.5 font-medium transition disabled:opacity-50 sm:w-auto'

export function TargetForm({ current }: { current: number }) {
  const [state, action, pending] = useActionState(saveTarget, INITIAL)

  return (
    <form action={action} className="mt-3">
      <label htmlFor="target" className="text-sm text-ink-muted">
        จำนวนคลิปที่ตั้งใจทำต่อเดือน
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="target"
          name="target"
          type="number"
          min={1}
          max={500}
          defaultValue={current}
          className={`${FIELD} sm:w-32`}
        />
        <button
          type="submit"
          disabled={pending}
          className={BUTTON}
          style={{ color: 'var(--color-base)', background: 'var(--color-ink)' }}
        >
          {pending ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  )
}

export function TopUpForm() {
  const [state, action, pending] = useActionState(topUpCredits, INITIAL)

  return (
    <form action={action} className="mt-3">
      <label htmlFor="amount" className="text-sm text-ink-muted">
        เติมเครดิต (1 คลิป = 7 เครดิต)
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="amount"
          name="amount"
          type="number"
          min={1}
          max={1000}
          defaultValue={140}
          className={`${FIELD} sm:w-32`}
        />
        <button type="submit" disabled={pending} className={`${BUTTON} border border-line bg-surface-2`}>
          {pending ? 'กำลังเติม…' : 'เติมเครดิต'}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  )
}
