import { describe, expect, it } from 'vitest'
import {
  MAX_DESCRIPTION_CHARS,
  VISIBLE_CHARS,
  buildDescription,
  chapterBlock,
  ctaWarning,
} from '@/lib/description'

describe('buildDescription', () => {
  /**
   * ข้อสำคัญที่สุดของไฟล์นี้ — YouTube ตัดคำอธิบายเหลือ 2–3 บรรทัด
   * ลิงก์ที่อยู่ท้ายเท่ากับไม่มีลิงก์
   */
  it('CTA ต้องอยู่บนสุด เหนือเนื้อหาและเครดิต', () => {
    const text = buildDescription({
      cta: 'ดูเครื่องมือ → https://ceoaithailand.org',
      chapters: null,
      body: 'สรุปเนื้อหาคลิป',
      credits: 'Photo by A on Pexels',
    })
    expect(text.indexOf('ceoaithailand')).toBeLessThan(text.indexOf('สรุปเนื้อหา'))
    expect(text.indexOf('สรุปเนื้อหา')).toBeLessThan(text.indexOf('Pexels'))
  })

  it('หมุดเวลาต้องอยู่ใต้ CTA แต่เหนือเนื้อหา', () => {
    const text = buildDescription({
      cta: 'https://ceoaithailand.org',
      chapters: '0:00 เปิดเรื่อง\n7:00 ท่อนสอง\n14:00 ท่อนสาม',
      body: 'สรุปเนื้อหาคลิป',
      credits: 'Photo by A on Pexels',
    })
    expect(text.indexOf('ceoaithailand')).toBeLessThan(text.indexOf('0:00'))
    expect(text.indexOf('0:00')).toBeLessThan(text.indexOf('สรุปเนื้อหา'))
  })

  it('ส่วนที่ว่างต้องหายไป ไม่ทิ้งบรรทัดว่างคั่นเป็นตับ', () => {
    expect(
      buildDescription({ cta: 'ลิงก์', chapters: null, body: null, credits: 'เครดิต' }),
    ).toBe('ลิงก์\n\nเครดิต')
    expect(
      buildDescription({ cta: null, chapters: null, body: null, credits: null }),
    ).toBe('')
  })

  it('ยาวเกินเพดานต้องตัดจากท้าย เพื่อรักษาลิงก์ที่อยู่หัวไว้', () => {
    const text = buildDescription({
      cta: 'https://ceoaithailand.org',
      chapters: null,
      body: 'ก'.repeat(MAX_DESCRIPTION_CHARS),
      credits: 'Photo by A on Pexels',
    })
    expect(text.length).toBe(MAX_DESCRIPTION_CHARS)
    expect(text.startsWith('https://ceoaithailand.org')).toBe(true)
  })
})

describe('chapterBlock', () => {
  it('หมุดครบเงื่อนไขต้องได้บรรทัดละหมุด', () => {
    const text = chapterBlock([
      { time: '0:00', heading: 'เปิดเรื่อง' },
      { time: '7:00', heading: 'ท่อนสอง' },
      { time: '14:00', heading: 'ท่อนสาม' },
    ])
    expect(text).toBe('0:00 เปิดเรื่อง\n7:00 ท่อนสอง\n14:00 ท่อนสาม')
  })

  /**
   * ไม่ครบเงื่อนไข YouTube ไม่แปลงเป็นบทให้ และไม่บอกอะไรเลย
   * ปล่อยผ่านไปจะได้ข้อความรกคำอธิบายโดยไม่ได้ประโยชน์
   */
  it('น้อยกว่า 3 หมุดต้องไม่ใส่เลย', () => {
    expect(chapterBlock([
      { time: '0:00', heading: 'ก' },
      { time: '7:00', heading: 'ข' },
    ])).toBeNull()
  })

  it('หมุดแรกไม่ใช่ 0:00 ต้องไม่ใส่เลย', () => {
    expect(chapterBlock([
      { time: '0:05', heading: 'ก' },
      { time: '7:00', heading: 'ข' },
      { time: '14:00', heading: 'ค' },
    ])).toBeNull()
  })
})

describe('ctaWarning', () => {
  it('ไม่ได้ตั้ง CTA ต้องเตือน — คลิปจะไม่พาใครไปไหน', () => {
    expect(ctaWarning(null)).toContain('ไม่มีลิงก์พาคนไปไหน')
    expect(ctaWarning('   ')).not.toBeNull()
  })

  it('มีข้อความแต่ไม่มีลิงก์ต้องเตือน', () => {
    expect(ctaWarning('ติดตามช่องด้วยนะครับ')).toContain('ยังไม่มีลิงก์')
  })

  /** จับกรณีที่ดูเหมือนทำถูกทุกอย่างแต่ยอดคลิกเป็นศูนย์ */
  it('ลิงก์อยู่ไกลเกินรอยตัดต้องเตือนพร้อมบอกตำแหน่ง', () => {
    const warning = ctaWarning('ก'.repeat(VISIBLE_CHARS + 20) + ' https://ceoaithailand.org')
    expect(warning).toContain('ถูกซ่อน')
  })

  it('ลิงก์อยู่ต้น ๆ ต้องไม่เตือน', () => {
    expect(ctaWarning('อยากได้ระบบนี้ → https://ceoaithailand.org')).toBeNull()
  })
})
