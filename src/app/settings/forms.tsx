'use client'

import { useActionState, useState } from 'react'
import { saveCta, saveStyle, saveTarget, topUpCredits, type SettingsState } from './actions'
import { VISIBLE_CHARS } from '@/lib/description'
import { MAX_CLAIM_CHARS, MAX_PROOF_POINTS, MAX_SOURCE_CHARS, type ProofPoint } from '@/lib/proof'
import { SCRIPT_STYLE_HINT, SCRIPT_STYLE_LABEL, type ScriptStyle } from '@/lib/sales-style'

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

/**
 * โทนการเล่า + หลักฐานที่ช่องอ้างได้
 *
 * Von Restorff Effect: ช่องกรอก "ที่มา" ต้องเด่นเท่ากับช่องคำกล่าวอ้าง
 * ถ้าทำให้มันดูเป็นของเสริม คนจะข้ามมัน แล้วทั้งระบบนี้ก็ไม่มีความหมาย
 *
 * Tesler's Law: ความยุ่งยากที่ตัดไม่ได้คือ "ตัวเลขต้องมีที่มา" — ระบบดูดซับ
 * ให้ไม่ได้ ต้องเป็นคนใส่ · สิ่งที่ทำได้คืออธิบายว่าทำไม ไม่ใช่ซ่อนมันไว้
 */
export function StyleForm({
  channelId,
  current,
  proof,
}: {
  channelId: string
  current: ScriptStyle
  proof: ProofPoint[]
}) {
  const [state, action, pending] = useActionState(saveStyle, INITIAL)
  const [style, setStyle] = useState<ScriptStyle>(current)

  // แสดงช่องว่างเพิ่มหนึ่งแถวเสมอ เพื่อให้เพิ่มข้อใหม่ได้โดยไม่ต้องกดปุ่มอะไรก่อน
  const rows = [...proof, { claim: '', source: '' }].slice(0, MAX_PROOF_POINTS)

  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="channelId" value={channelId} />
      <input type="hidden" name="style" value={style} />

      <div className="grid grid-cols-2 gap-2">
        {(['informative', 'direct'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setStyle(key)}
            aria-pressed={style === key}
            className={`rounded-lg border px-3 py-2.5 text-left transition ${
              style === key ? 'border-ink bg-surface-2' : 'border-line hover:border-ink-muted'
            }`}
          >
            <span className="block text-sm font-medium">{SCRIPT_STYLE_LABEL[key]}</span>
            <span className="mt-0.5 block text-xs leading-snug text-ink-muted">
              {SCRIPT_STYLE_HINT[key]}
            </span>
          </button>
        ))}
      </div>

      {style === 'direct' && (
        <div className="mt-4">
          <p className="text-sm font-medium">หลักฐานที่อ้างได้</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            AI จะพูดตัวเลขได้เฉพาะที่อยู่ในรายการนี้เท่านั้น ไม่มีในรายการคือห้ามพูด
            ใส่ที่มาให้ตอบได้จริงเมื่อมีคนถาม — ไม่ใช่ &ldquo;จากประสบการณ์&rdquo;
          </p>

          <ul className="mt-3 space-y-3">
            {rows.map((row, i) => (
              <li key={i}>
                <input
                  name="claim"
                  defaultValue={row.claim}
                  maxLength={MAX_CLAIM_CHARS}
                  placeholder="เช่น ลูกค้า 12 รายลดเวลาทำรายงานจาก 3 ชั่วโมงเหลือ 20 นาที"
                  className={FIELD}
                />
                <input
                  name="source"
                  defaultValue={row.source}
                  maxLength={MAX_SOURCE_CHARS}
                  placeholder="ที่มา — เช่น แบบสอบถามหลังใช้งาน ก.ค. 2569 (12 ราย)"
                  className={`${FIELD} mt-1.5 text-sm`}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className={`${BUTTON} mt-4`}
        style={{ color: 'var(--color-base)', background: 'var(--color-ink)' }}
      >
        {pending ? 'กำลังบันทึก…' : 'บันทึกโทนการเล่า'}
      </button>
      <Feedback state={state} />
    </form>
  )
}
