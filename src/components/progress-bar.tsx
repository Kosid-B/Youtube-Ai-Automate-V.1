import { TOTAL_STEPS, progressPercent, type Tone } from '@/lib/pipeline'

const FILL_CLASS: Record<Tone, string> = {
  signal: 'bg-signal',
  live: 'bg-live',
  block: 'bg-block',
  quiet: 'bg-ink-muted/40',
}

/**
 * แถบความคืบหน้าของคลิปหนึ่งชิ้น
 *
 * Goal-Gradient Effect: คนเร่งเข้าหาเป้าหมายมากขึ้นเมื่อเห็นว่าใกล้ถึงแล้ว
 * การบอกว่า "ขั้นที่ 3 จาก 4" จึงมีค่ากว่าการบอกแค่ชื่อสถานะ
 */
export function ProgressBar({
  step,
  tone,
  fraction,
}: {
  step: number
  tone: Tone
  /** ความคืบหน้าภายในขั้นนี้ (0–1) — มีเฉพาะตอนตัดต่อคลิปที่แบ่งเป็นหลายช่วง */
  fraction?: number
}) {
  const percent = progressPercent(step, fraction)

  return (
    <div
      className="flex items-center gap-2"
      role="progressbar"
      aria-valuenow={step}
      aria-valuemin={0}
      aria-valuemax={TOTAL_STEPS}
      aria-valuetext={
        fraction === undefined
          ? undefined
          : `ขั้นที่ ${step} จาก ${TOTAL_STEPS} · ไปแล้ว ${Math.round(fraction * 100)}%`
      }
      aria-label={`ขั้นที่ ${step} จาก ${TOTAL_STEPS}`}
    >
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${FILL_CLASS[tone]}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="tabular shrink-0 text-xs text-ink-muted">
        {step}/{TOTAL_STEPS}
      </span>
    </div>
  )
}
