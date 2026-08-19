'use client'

import { useActionState } from 'react'
import { saveCta, saveTarget, topUpCredits, type SettingsState } from './actions'
import { VISIBLE_CHARS } from '@/lib/description'

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

/**
 * ข้อความชวนคลิกของช่อง
 *
 * Postel's Law: ช่องที่ยังไม่ตั้งต้องบอกว่าทำอะไร ไม่ใช่ปล่อยว่างเฉย ๆ
 * Tesler's Law: ความจริงที่ว่า YouTube ตัดคำอธิบายเป็นเรื่องที่ผู้ใช้ไม่ควรต้องรู้เอง
 *               ระบบเตือนให้ตอนบันทึกแทน
 */
export function CtaForm({ channelId, current }: { channelId: string; current: string | null }) {
  const [state, action, pending] = useActionState(saveCta, INITIAL)

  return (
    <form action={action} className="mt-2">
      <input type="hidden" name="channelId" value={channelId} />
      <textarea
        name="cta"
        rows={3}
        defaultValue={current ?? ''}
        placeholder={'อยากได้ระบบที่ทำสิ่งนี้ให้อัตโนมัติ → https://ceoaithailand.org'}
        className={`${FIELD} resize-y leading-relaxed`}
      />
      <p className="mt-1 text-xs text-ink-muted">
        วางลิงก์ไว้ภายใน {VISIBLE_CHARS} ตัวอักษรแรก — YouTube ตัดคำอธิบายที่เหลือไปซ่อนหลังปุ่ม
        “แสดงเพิ่มเติม” ซึ่งคนส่วนใหญ่ไม่กด
      </p>
      <div className="mt-2">
        <button type="submit" disabled={pending} className={`${BUTTON} border border-line bg-surface-2`}>
          {pending ? 'กำลังบันทึก…' : 'บันทึกข้อความชวนคลิก'}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  )
}
