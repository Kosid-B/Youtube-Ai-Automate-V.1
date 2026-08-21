import { describe, expect, it } from 'vitest'
import {
  MAX_CLAIM_CHARS,
  MAX_PROOF_POINTS,
  hasNumber,
  parseProofPoints,
  proofContext,
  proofProblems,
} from '@/lib/proof'
import { salesStyleContext } from '@/lib/sales-style'

const good = [{ claim: 'ลูกค้า 12 รายลดเวลาทำรายงานลงครึ่งหนึ่ง', source: 'แบบสอบถาม ก.ค. 2569' }]

describe('parseProofPoints', () => {
  it('อ่านของที่รูปร่างถูกได้', () => {
    expect(parseProofPoints(good)).toEqual(good)
  })

  /** ค่าจากฐานข้อมูลเป็น jsonb ซึ่งเป็นอะไรก็ได้ ห้ามเชื่อรูปร่างล่วงหน้า */
  it('ของที่รูปร่างผิดต้องถูกทิ้ง ไม่ใช่ทำให้พังทั้งงาน', () => {
    expect(parseProofPoints(null)).toEqual([])
    expect(parseProofPoints('ไม่ใช่ array')).toEqual([])
    expect(parseProofPoints([{ claim: 'มีแต่คำอ้าง' }])).toEqual([])
    expect(parseProofPoints([{ claim: 'x', source: '   ' }])).toEqual([])
  })
})

describe('proofProblems', () => {
  it('ของที่ถูกต้องต้องไม่มีปัญหา', () => {
    expect(proofProblems(good)).toEqual([])
  })

  /**
   * ข้อสำคัญที่สุดของไฟล์นี้ — ที่มาว่างคือช่องโหว่ที่ทำให้ตัวเลขไม่มีที่มาหลุดเข้าคลิป
   * ยอมให้เว้นว่างเมื่อไร ทั้งระบบนี้ก็ไม่มีความหมาย
   */
  it('ที่มาว่างต้องผ่านไม่ได้', () => {
    const problems = proofProblems([{ claim: '41 ล้านวิวใน 28 วัน', source: '' }])
    expect(problems.join(' ')).toContain('ต้องบอกที่มา')
  })

  it('เกินจำนวนหรือยาวเกินต้องฟ้อง', () => {
    const many = Array.from({ length: MAX_PROOF_POINTS + 1 }, () => good[0])
    expect(proofProblems(many).join(' ')).toContain(`ไม่เกิน ${MAX_PROOF_POINTS}`)

    const long = [{ claim: 'ก'.repeat(MAX_CLAIM_CHARS + 1), source: 'ที่มา' }]
    expect(proofProblems(long).join(' ')).toContain('ยาวเกิน')
  })
})

describe('proofContext', () => {
  /**
   * ช่องที่ยังไม่มีผลงานต้องไม่พูดเหมือนมี — คำสั่งต้องเป็นข้อห้ามที่ชัด
   * ไม่ใช่การละไว้ให้โมเดลเดาเอง เพราะการแต่งตัวเลขทำให้บทฟังดูดีขึ้นทันที
   */
  it('ไม่มีหลักฐานต้องสั่งห้ามพูดตัวเลขอย่างชัดเจน', () => {
    const text = proofContext([])
    expect(text).toContain('ห้ามใส่ตัวเลขใด ๆ')
  })

  it('มีหลักฐานต้องแนบที่มาไปด้วย และห้ามใช้ตัวเลขนอกรายการ', () => {
    const text = proofContext(good)
    expect(text).toContain('แบบสอบถาม ก.ค. 2569')
    expect(text).toContain('ห้ามพูดเด็ดขาด')
    expect(text).toContain('ห้ามปัดเศษ')
  })
})

describe('salesStyleContext', () => {
  /** โทนเดิมต้องไม่ถูกแตะ — คลิปความรู้ที่กลายเป็นโฆษณาคือการถดถอย ไม่ใช่ฟีเจอร์ */
  it('โทนเล่าให้เข้าใจต้องไม่เพิ่มอะไรเข้า prompt เลย', () => {
    expect(salesStyleContext('informative', good)).toBe('')
    expect(salesStyleContext('informative', [])).toBe('')
  })

  it('โทนชวนให้ลงมือต้องมีทั้งจังหวะการเล่า ข้อห้าม และรายการหลักฐาน', () => {
    const text = salesStyleContext('direct', good)
    expect(text).toContain('ตีกรอบใหม่ก่อน')
    expect(text).toContain('ปิดด้วยการกระทำเดียว')
    expect(text).toContain('ห้ามสร้างความเร่งด่วนที่ไม่มีอยู่จริง')
    expect(text).toContain('แบบสอบถาม ก.ค. 2569')
  })

  /**
   * ใช้โทนนี้โดยไม่มีหลักฐาน = สร้างเครื่องแต่งตัวเลขอัตโนมัติ
   * คำสั่งห้ามจึงต้องยังอยู่ครบแม้เลือกโทนที่เดินด้วยตัวเลข
   */
  it('เลือกโทนชวนลงมือแต่ไม่มีหลักฐาน ต้องยังสั่งห้ามพูดตัวเลข', () => {
    expect(salesStyleContext('direct', [])).toContain('ห้ามใส่ตัวเลขใด ๆ')
  })
})

describe('hasNumber', () => {
  it('จับได้ทั้งเลขอารบิกและเลขไทย', () => {
    expect(hasNumber('ลูกค้า 12 ราย')).toBe(true)
    expect(hasNumber('ลูกค้า ๑๒ ราย')).toBe(true)
    expect(hasNumber('ลูกค้าหลายราย')).toBe(false)
  })
})
