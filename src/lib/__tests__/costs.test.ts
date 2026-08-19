import { describe, expect, it } from 'vitest'
import { CREDITS_PER_CLIP, estimateClipCost, estimateSpendThb } from '@/lib/costs'

describe('estimateClipCost', () => {
  it('คลิป 8 นาทีอยู่ใต้เพดาน 10 บาทที่ตั้งไว้', () => {
    const cost = estimateClipCost({
      scriptChars: 6700,
      model: 'claude-opus-5',
      tts: 'google-chirp3-hd',
    })
    expect(cost.totalThb).toBeLessThan(10)
  })

  it('เกินโควตาฟรีของ TTS แล้วต้องแพงขึ้น ไม่ใช่คิดเท่าเดิม', () => {
    const free = estimateClipCost({
      scriptChars: 6700, model: 'claude-opus-5', tts: 'google-chirp3-hd',
    })
    const paid = estimateClipCost({
      scriptChars: 6700, model: 'claude-opus-5', tts: 'google-chirp3-hd',
      ttsCharsUsedThisMonth: 1_000_000,
    })
    expect(paid.totalThb).toBeGreaterThan(free.totalThb)
    expect(free.ttsWithinFreeTier).toBe(true)
    expect(paid.ttsWithinFreeTier).toBe(false)
  })
})

describe('estimateSpendThb', () => {
  it('เครดิตเท่ากับหนึ่งคลิป = ต้นทุนหนึ่งคลิป', () => {
    const perClip = estimateClipCost({
      scriptChars: 6700, model: 'claude-opus-5', tts: 'google-chirp3-hd',
    })
    expect(estimateSpendThb(CREDITS_PER_CLIP)).toBe(Math.round(perClip.totalThb))
  })

  it('ยังไม่ได้ใช้เครดิตเลยต้องเป็นศูนย์ ไม่ใช่ค่าต่ำสุดอะไรสักอย่าง', () => {
    expect(estimateSpendThb(0)).toBe(0)
  })

  /**
   * ปัดเศษครั้งเดียวตอนท้าย ไม่ใช่ปัดต่อคลิปแล้วคูณ — ต้นทุนจริง 6.4 บาท/คลิป
   * ปัดก่อนคูณจะได้ 60 ซึ่งเพี้ยนไป 4 บาท และยิ่งเพี้ยนมากขึ้นเมื่อคลิปเยอะ
   */
  it('ปัดเศษตอนท้าย ไม่ใช่ปัดต่อคลิปแล้วคูณ', () => {
    const ten = estimateSpendThb(CREDITS_PER_CLIP * 10)
    const oneTimesTen = estimateSpendThb(CREDITS_PER_CLIP) * 10
    expect(ten).toBeGreaterThan(oneTimesTen)
    expect(ten / 10).toBeCloseTo(estimateSpendThb(CREDITS_PER_CLIP * 100) / 100, 1)
  })

  it('ใช้เครดิตมากขึ้นได้ตัวเลขมากขึ้นเสมอ', () => {
    expect(estimateSpendThb(70)).toBeGreaterThan(estimateSpendThb(7))
    expect(estimateSpendThb(700)).toBeGreaterThan(estimateSpendThb(70))
  })
})
