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

export function videoStage(status: VideoStatus): StageView {
  return VIDEO_STAGES[status]
}

/** เปอร์เซ็นต์ความคืบหน้าของแถบ — คลิปที่ยังไม่เริ่มก็ควรเห็นว่ามีอะไรเดินไปแล้วบ้าง */
export function progressPercent(step: number): number {
  const clamped = Math.min(Math.max(step, 0), TOTAL_STEPS)
  return Math.round((clamped / TOTAL_STEPS) * 100)
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
