import { describe, expect, it } from 'vitest'
import { graphemes, truncateGraphemes, visibleLength, wrapByGraphemes } from '@/lib/thai-text'

describe('graphemes', () => {
  it('พยัญชนะ + สระ + วรรณยุกต์ นับเป็นตัวเดียว', () => {
    expect(graphemes('ขึ้น')).toEqual(['ขึ้', 'น'])
  })

  it('ความยาวที่ตาเห็นน้อยกว่า .length เสมอเมื่อมีสระบน/ล่าง', () => {
    expect('ขึ้นทุกเดือน'.length).toBe(12)
    expect(visibleLength('ขึ้นทุกเดือน')).toBe(8)
  })
})

describe('wrapByGraphemes', () => {
  /**
   * บั๊กที่เจอจากการเปิดภาพปกดู — บรรทัดขึ้นต้นด้วยสระลอยเดี่ยว
   * เทสที่ตรวจแค่ความยาวสตริงจับไม่ได้ ต้องตรวจว่าบรรทัดขึ้นต้นถูกต้อง
   */
  it('บรรทัดใหม่ห้ามขึ้นต้นด้วยสระหรือวรรณยุกต์ลอย', () => {
    const lines = wrapByGraphemes('ทำไมธุรกิจคุณขาดทุนทั้งที่ยอดขายดีขึ้นทุกเดือน', 12)
    // สระบน/ล่างและวรรณยุกต์ของไทยอยู่ในช่วงนี้
    const combining = /^[ัิ-ฺ็-๎]/
    for (const line of lines) {
      expect(combining.test(line)).toBe(false)
    }
  })

  it('ทุกบรรทัดยาวไม่เกินที่กำหนด นับตามตัวที่มองเห็น', () => {
    const lines = wrapByGraphemes('ขึ้นทุกเดือนขึ้นทุกเดือนขึ้นทุกเดือน', 8)
    for (const line of lines) expect(visibleLength(line)).toBeLessThanOrEqual(8)
  })

  it('ต่อกลับแล้วต้องได้ข้อความเดิม ไม่มีตัวอักษรหาย', () => {
    const text = 'ทำไมธุรกิจคุณขาดทุนทั้งที่ยอดขายดีขึ้น'
    expect(wrapByGraphemes(text, 10).join('')).toBe(text)
  })

  it('ตัดที่ช่องว่างถ้ามีและไม่สั้นเกินไป', () => {
    const lines = wrapByGraphemes('ต้นทุนพุ่ง กำไรหาย', 12)
    expect(lines[0]).toBe('ต้นทุนพุ่ง')
  })

  it('บรรทัดถัดไปห้ามขึ้นต้นด้วยช่องว่าง', () => {
    for (const line of wrapByGraphemes('ต้นทุนพุ่ง กำไรหาย รู้ตัวก็สาย', 10)) {
      expect(line).toBe(line.trimStart())
    }
  })

  it('ข้อความสั้นอยู่บรรทัดเดียว', () => {
    expect(wrapByGraphemes('ลดต้นทุน', 20)).toEqual(['ลดต้นทุน'])
  })

  it('ข้อความว่างได้ลิสต์ว่าง', () => {
    expect(wrapByGraphemes('   ', 10)).toEqual([])
  })
})

describe('truncateGraphemes', () => {
  it('ตัดโดยไม่ทำให้สระค้างท้าย', () => {
    const out = truncateGraphemes('ขึ้นทุกเดือนนะครับ', 5)
    expect(out.endsWith('…')).toBe(true)
    expect(/[ัิ-ฺ็-๎]…$/.test(out)).toBe(false)
  })

  it('สั้นพออยู่แล้วต้องไม่แตะ', () => {
    expect(truncateGraphemes('สั้น', 10)).toBe('สั้น')
  })
})
