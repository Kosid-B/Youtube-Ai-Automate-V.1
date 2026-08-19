import { describe, expect, it } from 'vitest'
import {
  EXPLORE_EVERY,
  MIN_SAMPLE_FOR_GUIDANCE,
  buildGuidance,
  guidanceText,
  type FeaturePerformance,
} from '@/lib/content-feedback'

function rows(...spec: [string, number, number | null][]): FeaturePerformance[] {
  return spec.map(([feature_value, sample_size, median_views]) => ({
    feature_value,
    sample_size,
    median_views,
  }))
}

describe('buildGuidance — กติกากันข้อมูลน้อย', () => {
  it('ยังไม่มีข้อมูลเลยต้องไม่ป้อนอะไร', () => {
    expect(buildGuidance([], 0).mode).toBe('none')
  })

  it('ข้อมูลน้อยกว่าเกณฑ์ต้องเงียบ ไม่ใช่เดาจากตัวอย่างไม่กี่ตัว', () => {
    const g = buildGuidance(rows(['number', 4, 900], ['story', 3, 500]), 1)
    expect(g.mode).toBe('none')
  })

  it('ค่าที่มีตัวอย่างน้อยเกินไปไม่ถูกนับ แม้ยอดวิวจะสูง', () => {
    // 'fluke' มีคลิปเดียวแต่ยอดพุ่ง — ห้ามถูกเลือกเป็นตัวชนะ
    const g = buildGuidance(
      rows(['fluke', 1, 99999], ['number', 6, 900], ['story', 5, 400]),
      1,
    )
    expect(g.mode).toBe('exploit')
    if (g.mode === 'exploit') expect(g.best).toBe('number')
  })

  it('ตัวอย่างที่นับได้ต้องถึงเกณฑ์รวม ไม่ใช่นับรวมตัวที่ตกเกณฑ์ต่อค่า', () => {
    // รวมดิบ 11 แต่ตัดตัวที่ n<3 ออกแล้วเหลือ 8 → ยังไม่ถึง 10
    const g = buildGuidance(rows(['a', 8, 500], ['b', 2, 400], ['c', 1, 300]), 1)
    expect(g.mode).toBe('none')
    if (g.mode === 'none') expect(g.reason).toContain(String(MIN_SAMPLE_FOR_GUIDANCE))
  })
})

describe('buildGuidance — กติกาบังคับให้ลองของใหม่', () => {
  const enough = rows(['number', 7, 900], ['story', 5, 400], ['warning', 4, 300])

  it(`ทุก ๆ ${EXPLORE_EVERY} คลิปต้องเป็นรอบทดลอง`, () => {
    expect(buildGuidance(enough, EXPLORE_EVERY).mode).toBe('explore')
    expect(buildGuidance(enough, EXPLORE_EVERY * 3).mode).toBe('explore')
  })

  it('รอบอื่นใช้สิ่งที่ได้ผล', () => {
    expect(buildGuidance(enough, EXPLORE_EVERY + 1).mode).toBe('exploit')
    expect(buildGuidance(enough, EXPLORE_EVERY - 1).mode).toBe('exploit')
  })

  it('คลิปแรกสุดไม่ใช่รอบทดลอง (0 % n = 0 ต้องไม่หลุดเป็น explore)', () => {
    expect(buildGuidance(enough, 0).mode).toBe('exploit')
  })

  it('รอบทดลองต้องบอกว่าให้เลี่ยงอะไร ไม่ใช่แค่เงียบ', () => {
    const g = buildGuidance(enough, EXPLORE_EVERY)
    if (g.mode !== 'explore') throw new Error('ควรเป็นรอบทดลอง')
    expect(g.avoid).toContain('number')
  })
})

describe('guidanceText', () => {
  const enough = rows(['number', 7, 900], ['story', 5, 400])

  it('ข้อมูลไม่พอต้องคืน null — prompt จะได้ไม่มีอะไรงอกมา', () => {
    expect(guidanceText(buildGuidance([], 0))).toBeNull()
  })

  it('บอกขนาดตัวอย่างเสมอ ไม่สั่งลอย ๆ ว่าให้ใช้แบบนี้', () => {
    const text = guidanceText(buildGuidance(enough, 1))
    expect(text).toContain('7 คลิป')
    expect(text).toContain('ไม่ใช่กฎ')
  })

  it('เปิดช่องให้เลือกแบบอื่นได้ถ้าเหมาะกับเนื้อหามากกว่า', () => {
    expect(guidanceText(buildGuidance(enough, 1))).toContain('เหมาะกับเนื้อหา')
  })

  it('รอบทดลองต้องบอกชัดว่าไม่ต้องกลัวผลตก', () => {
    expect(guidanceText(buildGuidance(enough, EXPLORE_EVERY))).toContain('หาของใหม่')
  })
})
