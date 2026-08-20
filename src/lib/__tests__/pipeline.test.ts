import { describe, expect, it } from 'vitest'
import {
  TOTAL_STEPS,
  progressPercent,
  renderDetail,
  renderEta,
  renderFraction,
  videoStage,
} from '@/lib/pipeline'

const START = '2026-08-20T10:00:00.000Z'
/** ผ่านไป 10 นาทีนับจาก START */
const TEN_MIN_LATER = new Date('2026-08-20T10:10:00.000Z')

describe('renderDetail', () => {
  it('บอกช่วงที่กำลังทำ ไม่ใช่ช่วงที่ทำเสร็จแล้ว', () => {
    const text = renderDetail({ done: 2, total: 8, startedAt: null })
    expect(text).toContain('ช่วงที่ 3 จาก 8')
  })

  /**
   * คลิปสั้นไม่ได้แบ่งช่วง — ขึ้น "ช่วงที่ 1 จาก 1" คือเพิ่มศัพท์ระบบให้ผู้ใช้เปล่า ๆ
   * โดยไม่ได้บอกอะไรที่เขาไม่รู้อยู่แล้ว
   */
  it('ไม่ได้แบ่งช่วงต้องไม่รายงานอะไร', () => {
    expect(renderDetail({ done: 0, total: 1, startedAt: START })).toBeNull()
    expect(renderDetail({ done: 0, total: null, startedAt: START })).toBeNull()
  })

  it('ช่วงสุดท้ายที่ยังทำอยู่ต้องขึ้นเลขให้ถูก', () => {
    expect(renderDetail({ done: 7, total: 8, startedAt: null })).toContain('ช่วงที่ 8 จาก 8')
  })

  /**
   * ครบทุกช่วงแล้วยังไม่จบงาน — เหลือรวมไฟล์กับอัปขึ้นที่เก็บอีกหลายนาที
   * ค้าง "ช่วงที่ 8 จาก 8" ไว้ ผู้ใช้จะอ่านว่าแขวนตรงช่วงสุดท้าย
   */
  it('ครบทุกช่วงแล้วต้องบอกว่ากำลังรวมไฟล์ ไม่ใช่ค้างเลขช่วงสุดท้าย', () => {
    expect(renderDetail({ done: 8, total: 8, startedAt: null })).toBe(
      'ประกอบครบทุกช่วงแล้ว กำลังรวมไฟล์',
    )
  })

  it('มีข้อมูลพอประมาณเวลาแล้วต้องบอกด้วยว่าเหลืออีกนานเท่าไร', () => {
    const text = renderDetail({ done: 2, total: 8, startedAt: START }, TEN_MIN_LATER)
    // 10 นาทีต่อ 2 ช่วง → เหลือ 6 ช่วง = 30 นาที
    expect(text).toContain('เหลืออีกราว 30 นาที')
  })
})

describe('renderEta', () => {
  it('ประมาณจากเวลาที่ใช้จริง ไม่ใช่ค่าคงที่ต่อช่วง', () => {
    expect(renderEta({ done: 2, total: 8, startedAt: START }, TEN_MIN_LATER)).toBe('30 นาที')
    // เครื่องช้ากว่าสองเท่า ตัวเลขต้องขยับตาม ไม่ใช่ตอบเท่าเดิม
    expect(
      renderEta({ done: 1, total: 8, startedAt: START }, TEN_MIN_LATER),
    ).toBe('1.2 ชั่วโมง')
  })

  /**
   * ยังไม่เสร็จสักช่วง = ยังไม่มีข้อมูลพอ · เดาไปแล้วผิดมากจนผู้ใช้เลิกเชื่อ
   * แย่กว่าไม่บอกเลย เพราะครั้งต่อไปเขาจะไม่เชื่อตัวเลขที่ถูกด้วย
   */
  it('ยังไม่เสร็จสักช่วงต้องไม่เดา', () => {
    expect(renderEta({ done: 0, total: 8, startedAt: START }, TEN_MIN_LATER)).toBeNull()
  })

  it('ไม่มีเวลาเริ่มต้องไม่เดา', () => {
    expect(renderEta({ done: 4, total: 8, startedAt: null }, TEN_MIN_LATER)).toBeNull()
  })

  it('ทำครบทุกช่วงแล้วไม่ต้องบอกว่าเหลือเท่าไร', () => {
    expect(renderEta({ done: 8, total: 8, startedAt: START }, TEN_MIN_LATER)).toBeNull()
  })

  /** นาฬิกาเครื่องเพี้ยนจนเวลาเริ่มอยู่ในอนาคต — ต้องไม่โชว์เวลาติดลบ */
  it('เวลาเริ่มอยู่ในอนาคตต้องไม่เดา', () => {
    expect(
      renderEta({ done: 2, total: 8, startedAt: '2026-08-20T11:00:00.000Z' }, TEN_MIN_LATER),
    ).toBeNull()
  })
})

describe('videoStage กับความคืบหน้า', () => {
  it('ตอนตัดต่อต้องแทนที่ข้อความกลาง ๆ ด้วยความคืบหน้าจริง', () => {
    const plain = videoStage('rendering')
    const withProgress = videoStage('rendering', { done: 2, total: 8, startedAt: null })

    expect(plain.detail).not.toContain('ช่วงที่')
    expect(withProgress.detail).toContain('ช่วงที่ 3 จาก 8')
    // ขั้นในสายการผลิตต้องไม่เปลี่ยน — ความคืบหน้าย่อยไม่ใช่ขั้นใหม่
    expect(withProgress.step).toBe(plain.step)
  })

  it('สถานะอื่นต้องไม่ถูกความคืบหน้าไปแตะ', () => {
    const ready = videoStage('ready', { done: 8, total: 8, startedAt: START })
    expect(ready.detail).toBe(videoStage('ready').detail)
  })
})

describe('progressPercent', () => {
  it('ไม่ส่ง fraction ต้องได้ค่าเดิมทุกประการ', () => {
    expect(progressPercent(3)).toBe(75)
    expect(progressPercent(TOTAL_STEPS)).toBe(100)
  })

  /**
   * ประเด็นทั้งหมดของ fraction: แถบต้องเดินคืบระหว่างขั้น ไม่ใช่กระโดดไปสุดขั้น
   * ตั้งแต่วินาทีแรกแล้วค้างอยู่ตรงนั้นครึ่งชั่วโมงจนดูเหมือนแขวน
   */
  it('ส่ง fraction แล้วแถบต้องเดินจากปลายขั้นก่อนหน้าไปหาปลายขั้นนี้', () => {
    expect(progressPercent(3, 0)).toBe(50)
    expect(progressPercent(3, 0.5)).toBe(63)
    expect(progressPercent(3, 1)).toBe(75)
  })

  it('ค่าที่หลุดช่วงต้องถูกบีบกลับ ไม่ใช่ทำให้แถบล้นกรอบ', () => {
    expect(progressPercent(3, 5)).toBe(75)
    expect(progressPercent(3, -1)).toBe(50)
    expect(progressPercent(99)).toBe(100)
  })
})

describe('renderFraction', () => {
  it('คิดจากช่วงที่เสร็จแล้วหารด้วยช่วงทั้งหมด', () => {
    expect(renderFraction({ done: 2, total: 8, startedAt: null })).toBe(0.25)
  })

  it('ไม่ได้แบ่งช่วงต้องไม่มีค่า — แถบจะได้กลับไปทำงานแบบเดิม', () => {
    expect(renderFraction({ done: 0, total: 1, startedAt: null })).toBeUndefined()
    expect(renderFraction({ done: 0, total: null, startedAt: null })).toBeUndefined()
  })
})
