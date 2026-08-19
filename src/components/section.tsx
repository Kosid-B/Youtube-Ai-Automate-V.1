import { StatusPill } from '@/components/status-pill'
import { ProgressBar } from '@/components/progress-bar'
import type { Tone } from '@/lib/pipeline'

export type Row = {
  key: string
  title: string
  tone: Tone
  label: string
  detail: string
  /** ขั้นในสายการผลิต — ไม่ใส่ = ไม่ต้องแสดงแถบความคืบหน้า */
  step?: number
  /** ปุ่มท้ายแถว เช่นดาวน์โหลดคลิปที่เรนเดอร์เสร็จแล้ว */
  action?: { href: string; label: string }
}

/**
 * Miller's Law: คนถือของในหัวได้ทีละไม่กี่อย่าง
 * รายการยาวเป็นหางว่าวไม่ได้ช่วยใคร ตัดแล้วบอกว่าเหลืออีกเท่าไร
 */
export const MAX_PER_GROUP = 7

/**
 * Law of Common Region + Law of Proximity: ของที่อยู่ในกรอบเดียวกันและชิดกัน
 * ถูกอ่านว่าเป็นพวกเดียวกันโดยไม่ต้องอธิบาย
 */
export function Section({
  title,
  hint,
  rows,
  emptyText,
}: {
  title: string
  hint?: string
  rows: Row[]
  emptyText: string
}) {
  const visible = rows.slice(0, MAX_PER_GROUP)
  const hidden = rows.length - visible.length

  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <span className="text-xs text-ink-muted">{hint}</span>}
      </div>

      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {visible.length === 0 ? (
          <li className="px-4 py-6 text-sm text-ink-muted sm:px-5">{emptyText}</li>
        ) : (
          visible.map((row) => (
            <li key={row.key} className="px-4 py-3.5 sm:px-5">
              <div className="flex items-start gap-3">
                <StatusPill tone={row.tone}>{row.label}</StatusPill>
                {/* บนมือถือชื่อคลิปยาวเกินหนึ่งบรรทัด ตัดหายไปเลยแย่กว่าปล่อยให้ขึ้นสองบรรทัด */}
                <span className="min-w-0 flex-1 leading-snug line-clamp-2">{row.title}</span>
              </div>
              <p className="mt-1.5 text-sm text-ink-muted">{row.detail}</p>
              {row.step !== undefined && (
                <div className="mt-2.5">
                  <ProgressBar step={row.step} tone={row.tone} />
                </div>
              )}
              {row.action && (
                <a
                  href={row.action.href}
                  className="mt-2.5 inline-block rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium transition hover:border-ink-muted"
                >
                  {row.action.label}
                </a>
              )}
            </li>
          ))
        )}

        {hidden > 0 && (
          <li className="px-4 py-2.5 text-xs text-ink-muted sm:px-5">และอีก {hidden} รายการ</li>
        )}
      </ul>
    </section>
  )
}
