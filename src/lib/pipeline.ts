import type { JobKind, JobStatus, VideoStatus } from '@/lib/database.types'

/**
 * แปลงสถานะในฐานข้อมูลเป็นสิ่งที่ผู้ใช้เห็น
 *
 * แยกออกมาเป็นฟังก์ชันบริสุทธิ์เพราะสองเหตุผล:
 * - Tesler's Law ความซับซ้อนของระบบต้องถูกดูดซับไว้ที่นี่ ไม่ใช่โยนให้ผู้ใช้แปลเอง
 *   ผู้ใช้ไม่ควรต้องรู้ว่า 'dead' ต่างจาก 'failed' ยังไง
 * - เทสได้โดยไม่ต้องมี React
 */

/** signal = กำลังผลิต · live = เผยแพร่แล้ว · block = ถูกบล็อก · quiet = ยังไม่ถึงคิว */
export type Tone = 'signal' | 'live' | 'block' | 'quiet'

/** สายการผลิตมี 4 ขั้น ใช้บอกความคืบหน้า (Goal-Gradient Effect) */
export const TOTAL_STEPS = 4

export type StageView = {
  /** ขั้นที่เท่าไรใน 4 ขั้น */
  step: number
  /** ป้ายสั้น ๆ สำหรับ pill */
  label: string
  tone: Tone
  /** ประโยคบอกว่าตอนนี้เกิดอะไรขึ้น เขียนจากมุมผู้ใช้ */
  detail: string
  /** true = ผู้ใช้ต้องลงมือทำอะไรบางอย่าง */
  needsAttention: boolean
}

const VIDEO_STAGES: Record<VideoStatus, StageView> = {
  queued: {
    step: 2,
    label: 'รอคิว',
    tone: 'quiet',
    detail: 'สคริปต์พร้อมแล้ว รอคิวตัดต่อ',
    needsAttention: false,
  },
  rendering: {
    step: 3,
    label: 'กำลังตัดต่อ',
    tone: 'signal',
    detail: 'กำลังประกอบเสียงและภาพ',
    needsAttention: false,
  },
  ready: {
    step: 3,
    label: 'ตัดต่อเสร็จ',
    tone: 'signal',
    detail: 'ไฟล์พร้อมแล้ว รอส่งขึ้น YouTube',
    needsAttention: false,
  },
  scheduled: {
    step: 4,
    label: 'ตั้งเวลาไว้',
    tone: 'signal',
    detail: 'ตั้งเวลาเผยแพร่ไว้แล้ว',
    needsAttention: false,
  },
  published: {
    step: 4,
    label: 'เผยแพร่แล้ว',
    tone: 'live',
    detail: 'อยู่บนช่องเรียบร้อย',
    needsAttention: false,
  },
  failed: {
    step: 3,
    label: 'ไม่สำเร็จ',
    tone: 'block',
    detail: 'ทำไม่สำเร็จ ต้องสั่งทำใหม่',
    needsAttention: true,
  },
  blocked: {
    step: 2,
    label: 'ถูกบล็อก',
    tone: 'block',
    detail: 'เนื้อหาเสี่ยงซ้ำ ต้องแก้สคริปต์ก่อน',
    needsAttention: true,
  },
}

export type RenderProgress = {
  /** ช่วงที่เรนเดอร์เสร็จแล้ว */
  done: number
  /** ช่วงทั้งหมด — null = ยังไม่รู้ (worker ยังไม่ได้เริ่ม) */
  total: number | null
  startedAt: string | null
}

export function videoStage(status: VideoStatus, progress?: RenderProgress): StageView {
  const stage = VIDEO_STAGES[status]

  // ความคืบหน้าย่อยมีความหมายเฉพาะตอนกำลังตัดต่อ สถานะอื่นไม่ต้องรก
  if (status !== 'rendering' || !progress) return stage

  const detail = renderDetail(progress)
  return detail ? { ...stage, detail } : stage
}

/**
 * บอกว่าตัดต่อไปถึงไหนแล้ว และอีกนานไหม
 *
 * ทำไมต้องมี: คลิปยาวพิเศษใช้เวลาราวครึ่งชั่วโมง ตลอดเวลานั้นข้อความเดิม
 * ("กำลังประกอบเสียงและภาพ") เหมือนกันหมดตั้งแต่นาทีแรกจนนาทีสุดท้าย
 * ผู้ใช้จึงแยกไม่ออกว่า "กำลังทำอยู่" กับ "ค้าง" ต่างกันตรงไหน แล้วไปกดสั่งทำใหม่
 * ทั้งที่ของเดิมยังเดินอยู่ — เสียเงินสองเท่าเพราะหน้าจอไม่ยอมบอก
 *
 * Goal-Gradient Effect: เห็นว่าใกล้ถึงแล้วทำให้รอต่อได้ · การบอกว่าเหลืออีกเท่าไร
 * จึงมีค่ากว่าการบอกว่าทำไปแล้วเท่าไร
 */
export function renderDetail(progress: RenderProgress, now: Date = new Date()): string | null {
  const { done, total } = progress

  // ไม่ได้แบ่งช่วง (คลิปสั้น) = ไม่มีอะไรให้รายงานระหว่างทาง อย่าโชว์ "1 จาก 1"
  if (total === null || total <= 1) return null

  /**
   * ครบทุกช่วงแล้วยังไม่จบงาน — เหลือรวมไฟล์กับอัปขึ้นที่เก็บ ซึ่งกินเวลาอีกหลายนาที
   * ถ้ายังขึ้น "ช่วงที่ 8 จาก 8" ค้างอยู่ ผู้ใช้จะอ่านว่าแขวนตรงช่วงสุดท้าย
   */
  if (done >= total) return 'ประกอบครบทุกช่วงแล้ว กำลังรวมไฟล์'

  const base = `กำลังประกอบ ช่วงที่ ${done + 1} จาก ${total}`

  const eta = renderEta(progress, now)
  return eta ? `${base} · เหลืออีกราว ${eta}` : base
}

/**
 * ประมาณเวลาที่เหลือจากเวลาที่ใช้ไปจริงกับช่วงที่ทำเสร็จแล้ว
 *
 * ไม่ใช้ค่าคงที่ต่อช่วง เพราะความเร็วเรนเดอร์ต่างกันหลายเท่าตามเครื่องที่รัน worker
 * (วัดจริงที่ 1080p ได้ตั้งแต่ 0.7 ถึง 3.3 เท่าของความยาวคลิป แล้วแต่การตั้งค่า)
 * ตัวเลขที่เดาจากค่าคงที่จะผิดจนผู้ใช้เลิกเชื่อ ซึ่งแย่กว่าไม่บอกเลย
 *
 * ยังไม่เสร็จสักช่วง = ยังไม่มีข้อมูลพอจะประมาณ คืน null ไปแล้วบอกแค่ว่าอยู่ช่วงไหน
 */
export function renderEta(progress: RenderProgress, now: Date = new Date()): string | null {
  const { done, total, startedAt } = progress

  if (!startedAt || total === null || done < 1 || done >= total) return null

  const elapsedMs = now.getTime() - new Date(startedAt).getTime()
  if (!(elapsedMs > 0)) return null

  const remainingMs = (elapsedMs / done) * (total - done)
  const minutes = Math.round(remainingMs / 60000)

  if (minutes < 1) return 'ไม่ถึงนาที'
  if (minutes < 60) return `${minutes} นาที`
  return `${Math.round(minutes / 6) / 10} ชั่วโมง`
}

/**
 * เปอร์เซ็นต์ความคืบหน้าของแถบ — คลิปที่ยังไม่เริ่มก็ควรเห็นว่ามีอะไรเดินไปแล้วบ้าง
 *
 * ส่ง fraction มาด้วย = รู้ความคืบหน้า "ภายใน" ขั้นนั้น (เช่นตัดต่อไปแล้ว 3 จาก 8 ช่วง)
 * แถบจะเดินจากปลายขั้นก่อนหน้าไปหาปลายขั้นนี้ตามสัดส่วน แทนที่จะกระโดดไปสุดขั้น
 * ตั้งแต่วินาทีแรก แล้วค้างอยู่ตรงนั้นครึ่งชั่วโมงจนดูเหมือนแขวน
 */
export function progressPercent(step: number, fraction?: number): number {
  const clamped = Math.min(Math.max(step, 0), TOTAL_STEPS)

  if (fraction === undefined) return Math.round((clamped / TOTAL_STEPS) * 100)

  const within = Math.min(Math.max(fraction, 0), 1)
  return Math.round(((clamped - 1 + within) / TOTAL_STEPS) * 100)
}

/** สัดส่วนที่ตัดต่อไปแล้ว — null = ไม่ได้แบ่งช่วง จึงไม่มีอะไรให้รายงานระหว่างทาง */
export function renderFraction(progress: RenderProgress): number | undefined {
  if (progress.total === null || progress.total <= 1) return undefined
  return Math.min(Math.max(progress.done / progress.total, 0), 1)
}

const JOB_LABEL: Record<JobKind, string> = {
  idea_generate: 'คิดหัวข้อ',
  script_generate: 'เขียนสคริปต์',
  video_render: 'ตัดต่อคลิป',
  youtube_upload: 'ส่งขึ้น YouTube',
  metrics_sync: 'ดึงตัวเลขผลงาน',
}

export function jobLabel(kind: JobKind): string {
  return JOB_LABEL[kind] ?? kind
}

export type JobView = {
  label: string
  tone: Tone
  detail: string
  needsAttention: boolean
}

/**
 * งานในคิวเล่าให้ผู้ใช้ฟังว่ากำลังรออะไร
 * ตัวเลข attempts กับคำว่า dead ไม่โผล่ออกไปหาผู้ใช้
 */
export function jobView(
  job: { kind: JobKind; status: JobStatus; attempts: number; run_after: string },
  now: Date = new Date(),
): JobView {
  const label = jobLabel(job.kind)

  if (job.status === 'dead') {
    return {
      label,
      tone: 'block',
      detail: 'ลองแล้วหลายครั้งแต่ไม่สำเร็จ เครดิตคืนให้แล้ว',
      needsAttention: true,
    }
  }

  if (job.status === 'claimed') {
    return { label, tone: 'signal', detail: 'กำลังทำอยู่', needsAttention: false }
  }

  const runAfter = new Date(job.run_after)
  const waiting = runAfter.getTime() > now.getTime()

  if (waiting) {
    return {
      label,
      tone: 'quiet',
      // ครั้งแรกที่รอ = คิวยาว · รอบหลัง = เคยพลาดแล้วกำลังจะลองใหม่
      detail:
        job.attempts > 0
          ? `จะลองใหม่${formatRelative(runAfter, now)}`
          : `เริ่ม${formatRelative(runAfter, now)}`,
      needsAttention: false,
    }
  }

  return { label, tone: 'quiet', detail: 'รออยู่ในคิว', needsAttention: false }
}

/**
 * เวลาแบบสัมพัทธ์ภาษาไทย เช่น "อีก 5 นาที" / "เมื่อ 2 ชั่วโมงที่แล้ว"
 * รับ now เข้ามาเพื่อให้เทสได้และให้ผลตรงกันทั้งฝั่ง server และ client
 */
export function formatRelative(target: Date, now: Date = new Date()): string {
  const diffMs = target.getTime() - now.getTime()
  const future = diffMs >= 0
  const minutes = Math.round(Math.abs(diffMs) / 60000)

  if (minutes < 1) return future ? 'ในอีกไม่กี่วินาที' : 'เมื่อสักครู่'

  let amount: string
  if (minutes < 60) {
    amount = `${minutes} นาที`
  } else if (minutes < 60 * 24) {
    amount = `${Math.round(minutes / 60)} ชั่วโมง`
  } else {
    amount = `${Math.round(minutes / (60 * 24))} วัน`
  }

  return future ? `อีก ${amount}` : `เมื่อ ${amount}ที่แล้ว`
}
