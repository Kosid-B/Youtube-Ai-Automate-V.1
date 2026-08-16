import type { Tone } from '@/lib/pipeline'

/**
 * ป้ายสถานะ
 *
 * Von Restorff Effect: ของที่ต้องสังเกตต้องต่างจากพวก ถ้าทุกอย่างมีสี ก็ไม่มีอะไรเด่น
 * สถานะที่ยังไม่มีอะไรให้ทำจึงเป็นสีเทา (quiet) เพื่อสงวนสีไว้ให้สถานะที่มีความหมายจริง
 */
const TONE_CLASS: Record<Tone, string> = {
  signal: 'border-signal/40 bg-signal/10 text-signal',
  live: 'border-live/40 bg-live/10 text-live',
  block: 'border-block/50 bg-block/15 text-block',
  quiet: 'border-line bg-surface-2 text-ink-muted',
}

/**
 * ความกว้างคงที่เพื่อให้ชื่อเรื่องเรียงเป็นคอลัมน์เดียวกันทุกแถว
 * Law of Similarity: ขอบซ้ายที่ตรงกันทำให้กวาดตาอ่านรายการยาว ๆ ได้เร็วกว่าขอบที่หยักไปมา
 */
export function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex w-[5.5rem] shrink-0 items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  )
}
