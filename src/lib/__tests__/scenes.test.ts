import { describe, expect, it } from 'vitest'
import { splitIntoScenes, estimateDurationSeconds, THAI_CHARS_PER_SECOND } from '@/lib/scenes'

const THAI_PARAGRAPH =
  'ร้านกาแฟในไทยเปิดใหม่ปีละหลายพันร้าน แต่เกินครึ่งปิดตัวภายในปีแรก ' +
  'เหตุผลที่เจ้าของร้านมักตอบคือทำเลไม่ดี แต่ตัวเลขบอกอีกอย่าง ' +
  'ต้นทุนคงที่ต่อเดือนสูงกว่ารายได้ที่ประมาณไว้ตั้งแต่วันแรก ' +
  'และเจ้าของส่วนใหญ่ไม่ได้แยกเงินร้านออกจากเงินตัวเอง'

describe('splitIntoScenes', () => {
  it('ตัดย่อหน้ายาวไม่ให้เกินเพดาน', () => {
    const scenes = splitIntoScenes(THAI_PARAGRAPH, { targetChars: 60, maxChars: 90 })
    expect(scenes.length).toBeGreaterThan(1)
    for (const scene of scenes) {
      expect(scene.charCount).toBeLessThanOrEqual(90)
    }
  })

  it('ไม่ตัดกลางคำ — ทุกฉากต่อกลับมาแล้วต้องได้ตัวอักษรครบเท่าเดิม', () => {
    const scenes = splitIntoScenes(THAI_PARAGRAPH, { targetChars: 60, maxChars: 90 })
    const rejoined = scenes.map((s) => s.text).join(' ')
    // เทียบแบบตัดช่องว่างออก เพราะจุดตัดคือช่องว่าง
    expect(rejoined.replace(/\s/g, '')).toBe(THAI_PARAGRAPH.replace(/\s/g, ''))
  })

  it('รวมย่อหน้าสั้น ๆ ที่ติดกันเข้าด้วยกัน ไม่ปล่อยให้เป็นฉากละสองวินาที', () => {
    const scenes = splitIntoScenes('สั้นมาก\nสั้นอีก\nสั้นที่สาม', { targetChars: 200, maxChars: 300 })
    expect(scenes).toHaveLength(1)
    expect(scenes[0].text).toBe('สั้นมาก สั้นอีก สั้นที่สาม')
  })

  it('ตัดข้อความไทยที่เขียนติดกันยาวโดยไม่มีช่องว่างได้ ไม่วนไม่รู้จบ', () => {
    const noSpace = 'ก'.repeat(500)
    const scenes = splitIntoScenes(noSpace, { targetChars: 100, maxChars: 120 })
    expect(scenes.length).toBe(Math.ceil(500 / 120))
    expect(scenes.every((s) => s.charCount <= 120)).toBe(true)
  })

  it('ข้อความว่างได้ผลลัพธ์ว่าง ไม่ throw', () => {
    expect(splitIntoScenes('')).toEqual([])
    expect(splitIntoScenes('   \n\n  ')).toEqual([])
  })

  it('ให้ลำดับฉากเรียงจาก 0 ต่อเนื่อง', () => {
    const scenes = splitIntoScenes(THAI_PARAGRAPH, { targetChars: 50, maxChars: 70 })
    expect(scenes.map((s) => s.index)).toEqual(scenes.map((_, i) => i))
  })
})

describe('estimateDurationSeconds', () => {
  it('ประมาณความยาวจากจำนวนตัวอักษร', () => {
    const scenes = splitIntoScenes('ก'.repeat(THAI_CHARS_PER_SECOND * 10), {
      targetChars: 1000,
      maxChars: 1000,
    })
    expect(estimateDurationSeconds(scenes)).toBe(10)
  })
})
