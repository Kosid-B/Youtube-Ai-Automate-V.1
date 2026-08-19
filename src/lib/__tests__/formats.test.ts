import { describe, expect, it } from 'vitest'
import {
  FORMATS,
  formatWarning,
  minPhotoSize,
  targetScriptChars,
  type VideoFormat,
} from '@/lib/formats'
import { THAI_CHARS_PER_SECOND, splitIntoScenes } from '@/lib/scenes'

const FORMAT_KEYS: VideoFormat[] = ['long', 'short']

describe('สเปคของแต่ละรูปแบบ', () => {
  it('คลิปสั้นต้องเป็น 9:16 ตามที่ YouTube กำหนด ไม่งั้นไม่ถูกนับเป็น Short', () => {
    const { width, height } = FORMATS.short.canvas
    expect(width / height).toBeCloseTo(9 / 16, 3)
    expect(width).toBe(1080)
    expect(height).toBe(1920)
  })

  it('คลิปยาวเป็น 16:9', () => {
    const { width, height } = FORMATS.long.canvas
    expect(width / height).toBeCloseTo(16 / 9, 3)
  })

  /**
   * ข้อนี้คือตัวที่ลืมแล้วเสียหายเงียบที่สุด — ขอภาพแนวนอนมาใส่เฟรมแนวตั้ง
   * ต้อง crop ทิ้งราว 70% ของภาพ คนดูจะเห็นแค่เสี้ยวกลางที่มักไม่ใช่ประเด็น
   */
  it('คลิปสั้นต้องขอภาพแนวตั้งจาก Pexels ไม่ใช่แนวนอน', () => {
    expect(FORMATS.short.orientation).toBe('portrait')
    expect(FORMATS.long.orientation).toBe('landscape')
  })

  it('ซับของคลิปสั้นต้องใหญ่กว่าตามสัดส่วนจอที่สูงเป็นสองเท่า', () => {
    expect(FORMATS.short.subtitleFontSize).toBeGreaterThan(FORMATS.long.subtitleFontSize * 1.5)
  })

  it('ซับของคลิปสั้นต้องยกสูงหนีปุ่มและชื่อคลิปที่ YouTube วางทับด้านล่าง', () => {
    expect(FORMATS.short.subtitleMarginV).toBeGreaterThan(FORMATS.long.subtitleMarginV * 5)
  })

  it('ทุกรูปแบบต้องมีค่าครบ ไม่มีตัวไหนหลุด', () => {
    for (const key of FORMAT_KEYS) {
      const spec = FORMATS[key]
      expect(spec.targetSeconds).toBeGreaterThan(0)
      expect(spec.maxSeconds).toBeGreaterThan(spec.targetSeconds)
      expect(spec.scenes.maxChars).toBeGreaterThan(spec.scenes.targetChars)
      expect(spec.crossfadeSeconds).toBeGreaterThan(0)
    }
  })
})

describe('targetScriptChars', () => {
  it('คลิปสั้น 50 วินาทีได้สคริปต์ราว 700 ตัวอักษร', () => {
    expect(targetScriptChars('short', THAI_CHARS_PER_SECOND)).toBe(700)
  })

  it('คลิปยาวต้องได้สคริปต์ยาวกว่าคลิปสั้นหลายเท่า', () => {
    expect(targetScriptChars('long', THAI_CHARS_PER_SECOND)).toBeGreaterThan(
      targetScriptChars('short', THAI_CHARS_PER_SECOND) * 5,
    )
  })
})

describe('การแบ่งฉากตามรูปแบบ', () => {
  it('สคริปต์คลิปสั้นแบ่งได้หลายฉาก ไม่ใช่ก้อนเดียวยาว', () => {
    const body = 'ก'.repeat(targetScriptChars('short', THAI_CHARS_PER_SECOND))
    const scenes = splitIntoScenes(body, FORMATS.short.scenes)
    expect(scenes.length).toBeGreaterThanOrEqual(5)
    for (const scene of scenes) {
      expect(scene.text.length).toBeLessThanOrEqual(FORMATS.short.scenes.maxChars)
    }
  })

  it('ฉากของคลิปสั้นต้องสั้นกว่าฉากของคลิปยาว', () => {
    const body = 'ก'.repeat(2000)
    const short = splitIntoScenes(body, FORMATS.short.scenes)
    const long = splitIntoScenes(body, FORMATS.long.scenes)
    expect(short.length).toBeGreaterThan(long.length)
  })
})

describe('formatWarning', () => {
  it('คลิปสั้นเกิน 3 นาทีต้องเตือน เพราะจะไม่ถูกนับเป็น Short', () => {
    const warning = formatWarning('short', 200)
    expect(warning).toContain('Short')
  })

  it('อยู่ในเกณฑ์ต้องไม่เตือน', () => {
    expect(formatWarning('short', 50)).toBeNull()
    expect(formatWarning('long', 480)).toBeNull()
  })

  it('คลิปยาวเกินเพดานก็เตือนเหมือนกัน', () => {
    expect(formatWarning('long', 1200)).not.toBeNull()
  })
})

describe('minPhotoSize — เกณฑ์ขนาดภาพต้องผูกกับขนาดเฟรม', () => {
  /**
   * บั๊กที่เกือบหลุด: pickPhoto เดิมคัดภาพกว้าง <1920 ทิ้ง
   * ภาพแนวตั้งกว้างราว 1080 จึงถูกคัดทิ้งทุกใบ → คลิปสั้นหาภาพไม่ได้เลยสักฉาก
   */
  it('คลิปสั้นต้องรับภาพที่กว้าง 1080 ได้ ไม่ใช่บังคับ 1920', () => {
    expect(minPhotoSize('short').minWidth).toBe(1080)
    expect(minPhotoSize('short').minHeight).toBe(1920)
  })

  it('คลิปยาวยังคงเกณฑ์เดิม', () => {
    expect(minPhotoSize('long')).toEqual({ minWidth: 1920, minHeight: 1080 })
  })
})
