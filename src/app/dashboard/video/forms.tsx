'use client'

import { useActionState, useId, useState } from 'react'
import { cancelVideo, createProject, generateVideo, type ActionState } from './actions'
import { PLATFORMS } from '@/lib/video/schema'

const INITIAL: ActionState = { error: null, ok: null }

const FIELD =
  'w-full rounded-lg border border-line bg-surface-2 px-3.5 py-3 outline-none focus:border-ink-muted'
const BUTTON = 'w-full rounded-lg px-4 py-3 font-medium transition disabled:opacity-50 sm:w-auto'

const PLATFORM_LABEL: Record<(typeof PLATFORMS)[number], string> = {
  youtube_shorts: 'YouTube Shorts',
  tiktok: 'TikTok',
  instagram_reels: 'Instagram Reels',
  facebook: 'Facebook',
  website: 'เว็บไซต์',
}

/**
 * Doherty Threshold: ปุ่มที่กดแล้วเงียบทำให้คนกดซ้ำ
 * งานสร้างคลิปเสียเงินจริง การกดซ้ำจึงไม่ใช่แค่รำคาญ
 */
function Feedback({ state }: { state: ActionState }) {
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

export function CreateProjectForm() {
  const [state, action, pending] = useActionState(createProject, INITIAL)
  const titleId = useId()

  return (
    <form action={action} className="mt-3 space-y-3">
      <div>
        <label htmlFor={titleId} className="block text-sm font-medium">
          ชื่องาน
        </label>
        <input
          id={titleId}
          name="title"
          required
          maxLength={200}
          placeholder="เช่น โฆษณาคอร์ส ISO 9001 สำหรับโรงงาน"
          className={`${FIELD} mt-1.5`}
        />
      </div>

      <div>
        <label className="block text-sm font-medium">เป้าหมายธุรกิจ</label>
        <p className="mt-0.5 text-xs text-ink-muted">
          เขียนว่าอยากได้อะไรจริง ๆ ไม่ใช่อยากได้คลิปแบบไหน — ทุกอย่างที่ AI คิดต่อเริ่มจากบรรทัดนี้
        </p>
        <textarea
          name="objective"
          rows={2}
          maxLength={2000}
          placeholder="เช่น หาลูกค้าโรงงาน SME ที่กำลังจะทำ ISO"
          className={`${FIELD} mt-1.5`}
        />
      </div>

      <div>
        <label className="block text-sm font-medium">กลุ่มเป้าหมาย</label>
        <textarea
          name="audience"
          rows={2}
          maxLength={2000}
          placeholder="เช่น เจ้าของโรงงาน 30-50 คน ในชลบุรี ระยอง"
          className={`${FIELD} mt-1.5`}
        />
      </div>

      {/* Hick's Law: ตัวเลือกน้อย แสดงพร้อมกัน เร็วกว่า dropdown ที่ต้องกดเปิด */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="platform" className="block text-sm font-medium">
            แพลตฟอร์ม
          </label>
          <select id="platform" name="platform" className={`${FIELD} mt-1.5`}>
            {PLATFORMS.map((key) => (
              <option key={key} value={key}>
                {PLATFORM_LABEL[key]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="aspectRatio" className="block text-sm font-medium">
            สัดส่วนภาพ
          </label>
          <select id="aspectRatio" name="aspectRatio" className={`${FIELD} mt-1.5`}>
            <option value="9:16">9:16 แนวตั้ง (Shorts / Reels / TikTok)</option>
            <option value="16:9">16:9 แนวนอน (เว็บไซต์ / YouTube)</option>
          </select>
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className={BUTTON}
        style={{ color: 'var(--color-base)', background: 'var(--color-ink)' }}
      >
        {pending ? 'กำลังสร้าง…' : 'สร้างงานใหม่'}
      </button>
      <Feedback state={state} />
    </form>
  )
}

const POLICIES = [
  { key: 'cheap', label: 'ประหยัด', hint: 'ถูกที่สุด เหมาะกับการทำหลายชิ้นเพื่อคัด' },
  { key: 'fast', label: 'สมดุล', hint: 'คุณภาพกลาง ราคากลาง' },
  { key: 'quality', label: 'คุณภาพสูง', hint: 'สำหรับชิ้นที่จะเอาไปยิงแอดจริง' },
  { key: 'auto', label: 'อัตโนมัติ', hint: 'เอาดีที่สุดเท่าที่งบต่อชิ้นไหว' },
] as const

export function GenerateForm({
  projectId,
  aspect,
}: {
  projectId: string
  aspect: '9:16' | '16:9'
}) {
  const [state, action, pending] = useActionState(generateVideo, INITIAL)
  const [policy, setPolicy] = useState<string>('auto')
  const [seconds, setSeconds] = useState(8)

  /**
   * กุญแจกันสั่งซ้ำ สร้างครั้งเดียวตอนฟอร์มถูกวาด
   * กดปุ่มรัวหรือเน็ตกระตุกแล้ว browser retry จะได้ไม่กลายเป็นสองงานที่คิดเงินสองรอบ
   */
  const idempotencyKey = useId()

  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="aspect" value={aspect} />
      <input type="hidden" name="policy" value={policy} />
      <input type="hidden" name="idempotencyKey" value={`${projectId}:${idempotencyKey}`} />

      <div>
        <label htmlFor="prompt" className="block text-sm font-medium">
          คำสั่งภาพ
        </label>
        <p className="mt-0.5 text-xs text-ink-muted">
          บรรยายสิ่งที่อยากเห็นในคลิป ไม่ใช่สิ่งที่อยากให้คนรู้สึก
        </p>
        <textarea
          id="prompt"
          name="prompt"
          required
          rows={3}
          minLength={10}
          maxLength={2000}
          placeholder="เช่น มุมกว้างในโรงงานตอนเช้า แสงส่องผ่านหน้าต่างสูง คนงานเดินตรวจสายการผลิต"
          className={`${FIELD} mt-1.5`}
        />
      </div>

      <div>
        <label htmlFor="seconds" className="block text-sm font-medium">
          ความยาว {seconds} วินาที
        </label>
        <input
          id="seconds"
          name="seconds"
          type="range"
          min={4}
          max={8}
          value={seconds}
          onChange={(event) => setSeconds(Number(event.target.value))}
          className="mt-2 w-full"
        />
        {/* Tesler's Law: ข้อจำกัดของผู้ให้บริการซ่อนไม่ได้ ต้องบอกว่าทำไมยาวได้แค่นี้ */}
        <p className="mt-1 text-xs text-ink-muted">
          ผู้ให้บริการสร้างได้ครั้งละ ~8 วินาที คลิปยาวกว่านี้ต้องสร้างหลายท่อนแล้วต่อกัน
        </p>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">คุณภาพ</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {POLICIES.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setPolicy(option.key)}
              aria-pressed={policy === option.key}
              className={`rounded-lg border px-3 py-2.5 text-left transition ${
                policy === option.key
                  ? 'border-ink bg-surface-2'
                  : 'border-line hover:border-ink-muted'
              }`}
            >
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="mt-0.5 block text-xs leading-snug text-ink-muted">
                {option.hint}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className={BUTTON}
        style={{ color: 'var(--color-base)', background: 'var(--color-ink)' }}
      >
        {pending ? 'กำลังสั่ง…' : 'สร้างคลิป'}
      </button>
      <Feedback state={state} />
    </form>
  )
}

export function CancelButton({ generationId }: { generationId: string }) {
  const [state, action, pending] = useActionState(cancelVideo, INITIAL)

  return (
    <form action={action} className="mt-2">
      <input type="hidden" name="generationId" value={generationId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium transition hover:border-ink-muted disabled:opacity-50"
      >
        {pending ? 'กำลังยกเลิก…' : 'ยกเลิกงาน'}
      </button>
      <Feedback state={state} />
    </form>
  )
}
