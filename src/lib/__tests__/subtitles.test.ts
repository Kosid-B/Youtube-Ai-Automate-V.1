import { visibleLength } from '@/lib/thai-text'
import { describe, expect, it } from 'vitest'
import { buildCues, cuesFromScene, toSrt } from '@/lib/subtitles'

describe('cuesFromScene', () => {
  it('คำบรรยายท่อนสุดท้ายจบตรงปลายเสียงพอดี ไม่มี error สะสม', () => {
    const cues = cuesFromScene('ก'.repeat(200), 10, 12, 40)
    expect(cues.at(-1)!.end).toBe(22)
  })

  it('เวลาต่อเนื่องกัน ไม่ทับกันและไม่มีช่องว่าง', () => {
    const cues = cuesFromScene('ทดสอบ '.repeat(40), 0, 30, 40)
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].start).toBe(cues[i - 1].end)
    }
  })

  it('ท่อนที่ยาวกว่าได้เวลามากกว่า', () => {
    const cues = cuesFromScene(`${'ก'.repeat(38)} ${'ข'.repeat(10)}`, 0, 10, 40)
    expect(cues).toHaveLength(2)
    const first = cues[0].end - cues[0].start
    const second = cues[1].end - cues[1].start
    expect(first).toBeGreaterThan(second)
  })

  it('ไม่เกินความยาวต่อคำบรรยายที่กำหนด', () => {
    const cues = cuesFromScene('คำ '.repeat(100), 0, 60, 42)
    // วัดด้วยตัวที่มองเห็น ไม่ใช่ .length — ภาษาไทยมีสระที่ไม่กินความกว้าง
    // เกณฑ์ที่ตั้งไว้คือ "อ่านทันไหม" ซึ่งขึ้นกับสิ่งที่ตาเห็น ไม่ใช่จำนวน code unit
    expect(cues.every((cue) => visibleLength(cue.text) <= 42)).toBe(true)
  })

  it('ข้อความว่างได้ผลลัพธ์ว่าง', () => {
    expect(cuesFromScene('   ', 0, 5)).toEqual([])
  })
})

describe('buildCues', () => {
  it('ต่อเวลาข้ามฉากให้ถูกต้อง', () => {
    const cues = buildCues([{ text: 'ฉากหนึ่ง' }, { text: 'ฉากสอง' }], [4, 6])
    expect(cues[0].start).toBe(0)
    expect(cues[0].end).toBe(4)
    expect(cues[1].start).toBe(4)
    expect(cues.at(-1)!.end).toBe(10)
  })

  it('จำนวนฉากไม่ตรงกับจำนวนไฟล์เสียงต้อง throw ไม่ใช่เงียบแล้วซับเพี้ยน', () => {
    expect(() => buildCues([{ text: 'a' }, { text: 'b' }], [3])).toThrow(/ไม่ตรงกับจำนวนไฟล์เสียง/)
  })
})

describe('toSrt', () => {
  it('จัดรูปแบบเวลาตามมาตรฐาน SRT และนับลำดับจาก 1', () => {
    const srt = toSrt([
      { start: 0, end: 3.5, text: 'สวัสดีครับ' },
      { start: 3.5, end: 3725.25, text: 'ทดสอบเวลายาว' },
    ])

    expect(srt).toBe(
      '1\n00:00:00,000 --> 00:00:03,500\nสวัสดีครับ\n\n' +
        '2\n00:00:03,500 --> 01:02:05,250\nทดสอบเวลายาว\n',
    )
  })
})
