import { describe, expect, it } from 'vitest'
import { isValidSlug, randomToken, slugify } from '@/lib/slug'

describe('slugify', () => {
  it('ชื่อภาษาไทยล้วนยังได้ slug ที่ใช้ได้ ไม่ใช่สตริงว่าง', () => {
    const slug = slugify('ช่องของสมชาย', 'abc123')
    expect(slug).toBe('org-abc123')
    expect(isValidSlug(slug)).toBe(true)
  })

  it('ชื่อภาษาอังกฤษเก็บคำเดิมไว้ให้อ่านออก', () => {
    expect(slugify('Somchai Studio', 'abc123')).toBe('somchai-studio-abc123')
  })

  it('ชื่อผสมไทย-อังกฤษ ใช้ส่วนที่เป็นอังกฤษได้', () => {
    expect(slugify('ช่อง Coffee Talk', 'zz9999')).toBe('coffee-talk-zz9999')
  })

  it('ตัดขีดหัวท้ายทิ้ง ไม่ให้ slug ลงท้ายด้วยขีด', () => {
    expect(slugify('--- Hello ---', 'abc123')).toBe('hello-abc123')
  })

  it('ชื่อยาวมากยังอยู่ในเพดาน 40 ตัว', () => {
    const slug = slugify('a'.repeat(200), 'abc123')
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(isValidSlug(slug)).toBe(true)
  })

  it('ชื่อว่างหรือมีแต่สัญลักษณ์ก็ยังได้ slug ที่ถูกกฎ', () => {
    for (const name of ['', '   ', '!!!', '๑๒๓']) {
      expect(isValidSlug(slugify(name, 'abc123'))).toBe(true)
    }
  })
})

describe('randomToken', () => {
  it('ยาวตามที่ขอ และใช้เฉพาะอักขระที่ slug ยอมรับ', () => {
    const token = randomToken(6)
    expect(token).toHaveLength(6)
    expect(token).toMatch(/^[a-z0-9]{6}$/)
  })

  it('สุ่มจริง ไม่ซ้ำกันทุกครั้ง', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => randomToken(8)))
    expect(tokens.size).toBeGreaterThan(45)
  })
})
