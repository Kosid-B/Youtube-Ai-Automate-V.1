import { describe, expect, it } from 'vitest'
import {
  AUDIENCE_SEGMENTS,
  HIGH_VALUE_PROVINCES,
  HOOK_ANGLES,
  HOOK_RULES,
  ideaContext,
} from '@/lib/idea-angles'

const brief = {
  channelName: 'ช่องทดสอบ',
  niche: 'ธุรกิจ SME',
  recentTitles: ['ลดต้นทุนร้านอาหาร'],
  count: 5,
}

describe('ข้อมูลกลุ่มเป้าหมาย', () => {
  it('สัดส่วนเจนต้องสมเหตุสมผล ไม่เกิน 100% รวมกัน', () => {
    const total = AUDIENCE_SEGMENTS.reduce((sum, s) => sum + s.share, 0)
    expect(total).toBeLessThanOrEqual(100)
    expect(total).toBeGreaterThan(50)
  })

  it('มีจังหวัดกำลังซื้อสูงครบ 10 จังหวัด', () => {
    expect(HIGH_VALUE_PROVINCES).toHaveLength(10)
  })
})

describe('มุมเปิดเรื่อง', () => {
  it('ทุกมุมต้องมีเหตุผลกำกับ ไม่ใช่รายการลอย ๆ', () => {
    for (const hook of HOOK_ANGLES) {
      expect(hook.why.length).toBeGreaterThan(10)
      expect(hook.example.length).toBeGreaterThan(10)
    }
  })

  /**
   * skill ต้นทางเป็นเรื่องจิตวิทยาการโน้มน้าว และกำกับไว้เองว่าต้องใช้อย่างโปร่งใส
   * มุมที่ต้องโกหกถึงจะใช้ได้จึงต้องไม่หลุดเข้ามา
   */
  it('ไม่มีมุมที่ต้องสร้างเรื่องปลอมถึงจะใช้ได้', () => {
    const banned = ['ปลอม', 'หลอก', 'แกล้ง']
    for (const hook of HOOK_ANGLES) {
      const text = `${hook.label} ${hook.why} ${hook.example}`
      for (const word of banned) expect(text).not.toContain(word)
    }
  })

  it('ข้อห้ามต้องครอบคลุมทั้งการสัญญาเกินจริงและตัวเลขที่ไม่ได้ตรวจ', () => {
    const rules = HOOK_RULES.join(' ')
    expect(rules).toContain('สัญญาเกิน')
    expect(rules).toContain('ตรวจแหล่งที่มา')
    expect(rules).toContain('เร่งด่วนปลอม')
  })
})

describe('ideaContext', () => {
  it('ใส่ตัวเลขประชากรจริงเข้าไป ไม่ปล่อยให้โมเดลนึกเอง', () => {
    const text = ideaContext(brief)
    expect(text).toContain('24%')
    expect(text).toContain('ทะเบียนราษฎร์')
  })

  it('บอกหัวข้อที่ทำไปแล้วเพื่อกันคิดซ้ำ', () => {
    expect(ideaContext(brief)).toContain('ลดต้นทุนร้านอาหาร')
  })

  it('ระบุเจนแล้วต้องเหลือเฉพาะเจนนั้น ไม่แถมเจนอื่นมาด้วย', () => {
    const text = ideaContext({ ...brief, segment: 'gen-z' })
    expect(text).toContain('Gen Z')
    expect(text).not.toContain('Gen X')
  })

  it('ข้อห้ามต้องอยู่ใน context เสมอ ไม่ใช่ใส่เฉพาะบางกรณี', () => {
    for (const rule of HOOK_RULES) {
      expect(ideaContext(brief)).toContain(rule)
    }
  })

  it('ช่องที่ยังไม่เคยทำอะไรเลยต้องไม่มีหัวข้อ "ห้ามซ้ำ" ลอยมา', () => {
    const text = ideaContext({ ...brief, recentTitles: [] })
    expect(text).not.toContain('ห้ามซ้ำ')
  })
})

describe('ideaContext กับโทนของช่อง', () => {
  const base = { channelName: 'ช่องทดสอบ', niche: null, recentTitles: [], count: 3 }

  /** โทนเดิมต้องไม่ถูกแตะ — คลิปความรู้ที่กลายเป็นโฆษณาคือการถดถอย ไม่ใช่ฟีเจอร์ */
  it('ไม่ระบุโทนต้องได้ prompt เหมือนเดิมทุกประการ', () => {
    expect(ideaContext(base)).toBe(ideaContext({ ...base, style: 'informative' }))
  })

  /**
   * โทนต้องมาถึงตั้งแต่ตอนคิดหัวข้อ ไม่ใช่ไปเริ่มตอนเขียนบท —
   * หัวข้อที่คิดมาแบบเล่าเปล่า ๆ ดัดให้เป็นโทนชวนลงมือทีหลังไม่ได้
   */
  it('โทนชวนลงมือต้องส่งจังหวะการเล่าไปถึงตอนคิดหัวข้อด้วย', () => {
    const text = ideaContext({ ...base, style: 'direct' })
    expect(text).toContain('ตีกรอบใหม่ก่อน')
    expect(text).toContain('ปิดด้วยการกระทำเดียว')
  })

  it('หลักฐานของช่องต้องไปถึงตอนคิดหัวข้อ พร้อมที่มา', () => {
    const text = ideaContext({
      ...base,
      style: 'direct',
      proof: [{ claim: 'ลูกค้า 12 ราย', source: 'แบบสอบถาม ก.ค. 2569' }],
    })
    expect(text).toContain('แบบสอบถาม ก.ค. 2569')
  })

  it('โทนชวนลงมือแต่ไม่มีหลักฐาน ต้องยังสั่งห้ามพูดตัวเลข', () => {
    expect(ideaContext({ ...base, style: 'direct' })).toContain('ห้ามใส่ตัวเลขใด ๆ')
  })
})
