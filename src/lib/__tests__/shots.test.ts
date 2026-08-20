import { describe, expect, it } from 'vitest'
import { planShots, shotSceneCounts, shotText } from '@/lib/shots'
import { groupByDuration } from '@/lib/grouping'

const scenes = [
  { text: 'ฉากหนึ่ง' },
  { text: 'ฉากสอง' },
  { text: 'ฉากสาม' },
  { text: 'ฉากสี่' },
]

describe('planShots', () => {
  it('รวมหลายฉากเข้าภาพเดียวตามเป้าความยาวภาพ', () => {
    // ฉากละ 15 วินาที เป้า 45 → 3 ฉากต่อภาพ
    const shots = planShots([15, 15, 15, 15, 15, 15], 45)
    expect(shotSceneCounts(shots)).toEqual([3, 3])
  })

  /**
   * คลิปสั้นต้องไม่เปลี่ยนพฤติกรรม — คนเลื่อนผ่านเร็ว ภาพต้องเปลี่ยนถี่
   * ตั้ง shotSeconds สั้นกว่าหนึ่งฉากแล้วต้องได้ภาพต่อฉากเป๊ะ ๆ
   */
  it('เป้าสั้นกว่าหนึ่งฉาก ต้องได้ภาพต่อฉากเหมือนเดิม', () => {
    const shots = planShots([6.4, 6.1, 5.9], 3)
    expect(shotSceneCounts(shots)).toEqual([1, 1, 1])
  })

  it('ทุกฉากต้องถูกครอบ ไม่มีตกหล่นและไม่ซ้ำ', () => {
    const durations = Array.from({ length: 180 }, (_, i) => 12 + (i % 7))
    const shots = planShots(durations, 60)

    expect(shots[0].start).toBe(0)
    expect(shots[shots.length - 1].end).toBe(durations.length)
    shots.forEach((shot, i) => {
      if (i > 0) expect(shot.start).toBe(shots[i - 1].end)
    })
    expect(shotSceneCounts(shots).reduce((a, b) => a + b, 0)).toBe(durations.length)
  })

  /** เหตุผลหลักที่ทำเรื่องนี้: Pexels ให้ 200 คำค้นต่อชั่วโมง */
  it('คลิป 45 นาทีต้องใช้ภาพไม่เกินโควตา Pexels ต่อชั่วโมง', () => {
    const durations = Array.from({ length: 180 }, () => 15) // 45 นาที
    expect(planShots(durations, 60).length).toBeLessThan(60)
  })
})

describe('shotText', () => {
  /**
   * คำค้นภาพต้องมาจากทุกฉากในช็อต ไม่ใช่ฉากแรกฉากเดียว
   * ภาพใบนี้ต้องอยู่ให้ครบทั้งช็อต ถ้าเลือกจากฉากแรกจะตรงแค่ช่วงต้นแล้วหลุดบริบท
   */
  it('รวมข้อความของทุกฉากในช็อต', () => {
    expect(shotText(scenes, { start: 1, end: 3, seconds: 30 })).toBe('ฉากสอง ฉากสาม')
  })

  it('ช็อตที่ครอบฉากเดียวได้ข้อความฉากนั้น', () => {
    expect(shotText(scenes, { start: 0, end: 1, seconds: 15 })).toBe('ฉากหนึ่ง')
  })
})

describe('groupByDuration', () => {
  it('ปิดกลุ่มก่อนเกินเป้า ไม่ใช่หลังเกิน', () => {
    expect(groupByDuration([100, 100, 100, 100], 300)).toEqual([
      { start: 0, end: 3, seconds: 300 },
      { start: 3, end: 4, seconds: 100 },
    ])
  })

  it('รายการที่ยาวเกินเป้าด้วยตัวเองต้องอยู่ครบในกลุ่มเดียว ไม่ถูกหั่น', () => {
    expect(groupByDuration([500], 300)).toEqual([{ start: 0, end: 1, seconds: 500 }])
  })

  it('ไม่มีรายการเลยต้องได้ลิสต์ว่าง', () => {
    expect(groupByDuration([], 300)).toEqual([])
  })
})
