'use client'

import { useActionState } from 'react'
import { createWorkspace, type OnboardingState } from './actions'

const INITIAL: OnboardingState = { error: null }

/**
 * เปิดพื้นที่ทำงานครั้งแรก
 *
 * Hick's Law: สามช่อง หนึ่งปุ่ม และช่องที่สามเป็นตัวเลือก
 * ไม่ถาม slug, ไม่ถาม Google Cloud project, ไม่ถามแพ็กเกจ — ถามทีหลังได้ทั้งหมด
 */
export default function OnboardingPage() {
  const [state, action, pending] = useActionState(createWorkspace, INITIAL)

  return (
    <main className="mx-auto max-w-md px-5 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">เปิดพื้นที่ทำงาน</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        กรอกสองช่องแรกก็เริ่มผลิตคลิปแรกได้
      </p>

      <form action={action} className="mt-8 space-y-5">
        <Field
          name="org_name"
          label="ชื่อธุรกิจหรือทีมของคุณ"
          placeholder="เช่น สตูดิโอสมชาย"
          required
        />
        <Field
          name="channel_name"
          label="ชื่อช่อง YouTube แรก"
          placeholder="เช่น เล่าเรื่องธุรกิจไทย"
          required
        />
        <Field
          name="niche"
          label="แนวเนื้อหา"
          hint="ไม่ใส่ก็ได้ ใส่แล้ว AI เขียนสคริปต์ได้ตรงแนวขึ้น"
          placeholder="เช่น ธุรกิจ SME การเงินส่วนบุคคล"
        />

        {state.error && <p className="text-sm text-block">{state.error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg px-4 py-3 font-medium transition disabled:opacity-50"
          style={{ color: 'var(--color-base)', background: 'var(--color-ink)' }}
        >
          {pending ? 'กำลังเปิด…' : 'เปิดพื้นที่ทำงาน'}
        </button>
      </form>
    </main>
  )
}

function Field({
  name,
  label,
  placeholder,
  hint,
  required,
}: {
  name: string
  label: string
  placeholder?: string
  hint?: string
  required?: boolean
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
        {!required && <span className="ml-2 text-xs text-ink-muted">ไม่บังคับ</span>}
      </label>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
      <input
        id={name}
        name={name}
        required={required}
        placeholder={placeholder}
        className="mt-2 w-full rounded-lg border border-line bg-surface px-3.5 py-3 outline-none placeholder:text-ink-muted/60 focus:border-ink-muted"
      />
    </div>
  )
}
