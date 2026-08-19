/**
 * รูปแบบคลิป — ยาว (16:9) กับ สั้น (9:16)
 *
 * รวมค่าที่ต้องเปลี่ยนพร้อมกันไว้ที่เดียว เพราะเปลี่ยนแค่ขนาดเฟรมไม่พอ:
 * ถ้าลืมเปลี่ยนแนวภาพที่ขอจาก Pexels จะได้ภาพแนวนอนมาตัดเป็นแนวตั้ง เหลือ ~30% ของภาพ
 * ถ้าลืมเปลี่ยนขนาดซับ ตัวหนังสือจะเล็กจนอ่านไม่ออกบนจอสูง
 * ถ้าลืมเปลี่ยนความยาวฉาก คลิปสั้นจะยาวเกินจนไม่ถูกนับเป็น Short
 *
 * สเปค YouTube Shorts (ส.ค. 2569): 9:16 · 1080×1920 · ยาวได้ถึง 3 นาที
 * ช่วงที่ทำงานได้ดีที่สุดคือ 35–58 วินาที จึงตั้งเป้าไว้ 50 วินาที
 */
import type { SplitOptions } from '@/lib/scenes'

export type VideoFormat = 'long' | 'short'

export type FormatSpec = {
  label: string
  canvas: { width: number; height: number; fps: number }
  /** แนวภาพที่ต้องขอจาก Pexels — ตัวที่ลืมแล้วเสียหายเงียบที่สุด */
  orientation: 'landscape' | 'portrait'
  scenes: Required<SplitOptions>
  /** ความยาวที่ตั้งใจ ใช้บอกโมเดลว่าจะเขียนสคริปต์ยาวแค่ไหน */
  targetSeconds: number
  /** เกินนี้ = ผิดรูปแบบ (คลิปสั้นเกิน 3 นาทีไม่ถูกนับเป็น Short อีกต่อไป) */
  maxSeconds: number
  subtitleFontSize: number
  /** ระยะซับจากขอบล่าง — คลิปสั้นต้องยกสูงหนีปุ่มไลก์/แชร์กับชื่อคลิปที่ YouTube วางทับ */
  subtitleMarginV: number
  crossfadeSeconds: number
}

export const FORMATS: Record<VideoFormat, FormatSpec> = {
  long: {
    label: 'คลิปยาว (16:9)',
    canvas: { width: 1920, height: 1080, fps: 30 },
    orientation: 'landscape',
    scenes: { targetChars: 210, maxChars: 320 },
    targetSeconds: 480,
    // ยาวเกินนี้คนดูไม่จบ และค่า TTS พุ่งเกินงบ 10 บาท/คลิป
    maxSeconds: 900,
    subtitleFontSize: 22,
    subtitleMarginV: 48,
    crossfadeSeconds: 0.5,
  },
  short: {
    label: 'คลิปสั้น (9:16)',
    canvas: { width: 1080, height: 1920, fps: 30 },
    orientation: 'portrait',
    // ~6 วินาทีต่อฉาก — เปลี่ยนภาพถี่กว่าคลิปยาวเพราะคนดูเลื่อนผ่านเร็ว
    scenes: { targetChars: 90, maxChars: 140 },
    targetSeconds: 50,
    maxSeconds: 180,
    // จอสูงเป็นสองเท่า ตัวอักษรต้องโตตาม ไม่งั้นเล็กจนอ่านไม่ทันตอนเลื่อนผ่าน
    subtitleFontSize: 44,
    // YouTube วางชื่อคลิปกับปุ่มทับพื้นที่ล่างของ Shorts — ซับต้องอยู่เหนือแถบนั้น
    subtitleMarginV: 420,
    // ตัดเร็วกว่าเพื่อให้จังหวะกระชับ เฟดยาวในคลิป 50 วินาทีกินเวลาไปเปล่า ๆ
    crossfadeSeconds: 0.25,
  },
}

export function formatSpec(format: VideoFormat): FormatSpec {
  return FORMATS[format]
}

/**
 * ขนาดภาพขั้นต่ำที่รับได้ — ผูกกับขนาดเฟรมโดยตรง ไม่ใช่ตัวเลขตายตัว
 *
 * เขียนเป็นค่าคงที่ 1920 เมื่อไร คลิปแนวตั้งจะหาภาพไม่ได้เลยสักฉาก
 * เพราะภาพแนวตั้งกว้างราว 1080 เท่านั้น
 */
export function minPhotoSize(format: VideoFormat): { minWidth: number; minHeight: number } {
  const { width, height } = FORMATS[format].canvas
  return { minWidth: width, minHeight: height }
}

/** จำนวนตัวอักษรที่ควรเขียนทั้งสคริปต์ เพื่อให้ได้ความยาวตามรูปแบบ */
export function targetScriptChars(format: VideoFormat, charsPerSecond: number): number {
  return Math.round(FORMATS[format].targetSeconds * charsPerSecond)
}

/**
 * ตรวจว่าคลิปที่ประกอบเสร็จยังอยู่ในรูปแบบที่ตั้งใจไหม
 *
 * คลิปสั้นที่ยาวเกิน 3 นาทีจะไม่ถูก YouTube นับเป็น Short อีกต่อไป — อัปไปก็ไม่ได้
 * การกระจายแบบ Shorts ซึ่งเป็นเหตุผลเดียวที่ทำคลิปสั้น
 */
export function formatWarning(format: VideoFormat, totalSeconds: number): string | null {
  const spec = FORMATS[format]

  if (totalSeconds > spec.maxSeconds) {
    return format === 'short'
      ? `คลิปยาว ${Math.round(totalSeconds)} วินาที เกิน ${spec.maxSeconds} วินาที — YouTube จะไม่นับเป็น Short`
      : `คลิปยาว ${Math.round(totalSeconds / 60)} นาที เกินที่ตั้งไว้ ${spec.maxSeconds / 60} นาที`
  }

  return null
}
