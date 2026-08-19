import { describe, expect, it } from 'vitest'
import {
  MAX_SECTIONS,
  SECTION_SECONDS,
  chapterMarks,
  sectionDurationsFromScenes,
  joinSections,
  outlineProblems,
  plannedSections,
  sectionSeconds,
  type Outline,
} from '@/lib/outline'

function outline(overrides: Partial<Outline> = {}): Outline {
  return {
    title: 'วางระบบต้นทุนตั้งแต่ศูนย์',
    promise: 'ดูจบแล้วคำนวณต้นทุนจริงของสินค้าตัวเองได้',
    sections: [
      { heading: 'ทำไมต้นทุนที่คุณคิดอยู่ผิด', covers: 'ค่าที่คนลืมนับ' },
      { heading: 'แยกต้นทุนคงที่กับผันแปร', covers: 'วิธีแยกและตัวอย่าง' },
    ],
    ...overrides,
  }
}

describe('plannedSections', () => {
  it('คลิป 1 ชั่วโมงต้องแบ่งหลายท่อน ไม่ใช่ท่อนเดียวยาว', () => {
    expect(plannedSections(3600)).toBeGreaterThanOrEqual(6)
  })

  it('ไม่เกินเพดานแม้ขอคลิปยาวมาก', () => {
    expect(plannedSections(36000)).toBe(MAX_SECTIONS)
  })

  it('คลิปสั้นยังต้องมีอย่างน้อย 2 ท่อน ไม่งั้นไม่ใช่โครง', () => {
    expect(plannedSections(60)).toBe(2)
  })
})

describe('sectionSeconds', () => {
  it('ท่อนต้องอยู่ในช่วงที่โมเดลเขียนได้ดี', () => {
    const each = sectionSeconds(3600, 8)
    expect(each).toBeGreaterThanOrEqual(SECTION_SECONDS.min)
    expect(each).toBeLessThanOrEqual(SECTION_SECONDS.max)
  })

  it('แบ่งท่อนเยอะเกินไปก็ยังไม่ให้ท่อนสั้นกว่าเกณฑ์', () => {
    expect(sectionSeconds(600, 12)).toBe(SECTION_SECONDS.min)
  })
})

describe('outlineProblems — ตรวจก่อนจ่ายเงินเขียน', () => {
  it('โครงที่ดีต้องไม่มีปัญหา', () => {
    expect(outlineProblems(outline())).toEqual([])
  })

  it('ท่อนเดียวไม่ใช่คลิปยาว', () => {
    const problems = outlineProblems(outline({ sections: [{ heading: 'a', covers: 'b' }] }))
    expect(problems.join(' ')).toContain('ท่อนเดียว')
  })

  /** หัวข้อซ้ำ = เขียนออกมาแล้วเนื้อหาทับกัน คนดูรู้สึกว่าวนที่เดิม */
  it('หัวข้อย่อยซ้ำต้องถูกจับได้', () => {
    const problems = outlineProblems(
      outline({
        sections: [
          { heading: 'ต้นทุน', covers: 'x' },
          { heading: 'ต้นทุน', covers: 'y' },
        ],
      }),
    )
    expect(problems.join(' ')).toContain('ซ้ำ')
  })

  it('ไม่บอกว่าดูจบแล้วได้อะไร ต้องถูกจับ', () => {
    expect(outlineProblems(outline({ promise: '  ' })).join(' ')).toContain('ได้อะไร')
  })

  it('ท่อนที่ไม่บอกว่าจะเล่าอะไรต้องถูกจับ', () => {
    const problems = outlineProblems(
      outline({
        sections: [
          { heading: 'a', covers: 'มีเนื้อหา' },
          { heading: 'b', covers: '' },
        ],
      }),
    )
    expect(problems.join(' ')).toContain('ไม่ได้บอกว่าจะเล่าอะไร')
  })
})

describe('joinSections', () => {
  /** บทนี้จะถูกอ่านออกเสียง — ผู้ฟังไม่ได้ยินหัวข้อ ได้ยินแค่คนประกาศชื่อบทลอย ๆ */
  it('ต่อเฉพาะเนื้อหา ไม่แทรกชื่อหัวข้อลงในบทพูด', () => {
    const joined = joinSections(['ท่อนหนึ่ง', 'ท่อนสอง'])
    expect(joined).toBe('ท่อนหนึ่ง\n\nท่อนสอง')
  })

  it('ท่อนว่างต้องหายไป ไม่ทิ้งช่องว่างเป็นตับ', () => {
    expect(joinSections(['ก', '   ', 'ข'])).toBe('ก\n\nข')
  })
})

describe('chapterMarks', () => {
  it('หมุดแรกต้องเป็น 0:00 ไม่งั้น YouTube ไม่รับเป็นบท', () => {
    expect(chapterMarks(['เปิดเรื่อง', 'ท่อนสอง'], [300, 300])[0].time).toBe('0:00')
  })

  it('เกินหนึ่งชั่วโมงต้องขึ้นรูปแบบ h:mm:ss', () => {
    const marks = chapterMarks(['a', 'b', 'c'], [1800, 1900, 600])
    expect(marks[2].time).toBe('1:01:40')
  })

  it('ต่ำกว่าชั่วโมงใช้ m:ss', () => {
    expect(chapterMarks(['a', 'b'], [125, 60])[1].time).toBe('2:05')
  })
})

describe('sectionDurationsFromScenes', () => {
  it('ฉากที่ตรงกับท่อนพอดี ต้องได้เวลาของท่อนตรงตามนั้น', () => {
    const seconds = sectionDurationsFromScenes([100, 200], [100, 200], [10, 20])
    expect(seconds).toEqual([10, 20])
  })

  /**
   * กรณีที่เขียนแบบง่าย ๆ แล้วพลาด — ตัวแบ่งฉากรวมย่อหน้าสั้นเข้าด้วยกันได้
   * ฉากเดียวจึงคร่อมรอยต่อของสองท่อน ต้องเฉลี่ยเวลาให้ตามสัดส่วนตัวอักษร
   */
  it('ฉากที่คร่อมสองท่อน ต้องแบ่งเวลาตามสัดส่วนตัวอักษร', () => {
    const seconds = sectionDurationsFromScenes([100, 100], [200], [20])
    expect(seconds).toEqual([10, 10])
  })

  /** เวลารวมต้องไม่หายไปไหน ไม่ว่าจะแบ่งยังไง — หมุดท้ายจะได้ไม่เพี้ยน */
  it('เวลารวมของทุกท่อนต้องเท่ากับเวลารวมของทุกฉาก', () => {
    const durations = [12, 7, 19, 4]
    const seconds = sectionDurationsFromScenes([90, 130, 80], [60, 70, 90, 80], durations)
    const total = seconds.reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(durations.reduce((a, b) => a + b, 0), 5)
  })

  /**
   * ตัวอักษรของฉากรวมกันมักมากกว่าที่ท่อนนับไว้ (joinSections ใส่ตัวคั่นย่อหน้า
   * และตัวแบ่งฉาก trim ช่องว่างทิ้ง) ส่วนเกินต้องไปลงท่อนสุดท้าย ไม่ใช่หายไปเฉย ๆ
   */
  it('ตัวอักษรที่ล้นเกินท่อนสุดท้าย ต้องนับเข้าท่อนสุดท้าย', () => {
    const seconds = sectionDurationsFromScenes([50], [100], [10])
    expect(seconds[0]).toBeCloseTo(10, 5)
  })
})
