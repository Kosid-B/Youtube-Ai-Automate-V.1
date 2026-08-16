import { describe, expect, it } from 'vitest'
import {
  CHECKLIST,
  CHECKLIST_MIN_PASS,
  SIMILARITY_BLOCK,
  checkOriginality,
  isBlocked,
  similarity,
  type ChecklistKey,
} from '@/lib/originality'

/** ติ๊กผ่านครบทุกข้อ ใช้เป็นฐานแล้วค่อยเอาออกทีละข้อ */
const ALL_PASS = Object.fromEntries(CHECKLIST.map((item) => [item.key, true])) as Record<
  ChecklistKey,
  boolean
>

const ORIGINAL =
  'ร้านกาแฟที่ผมเคยลงทุนด้วยเจ๊งภายในแปดเดือน สิ่งที่ผมเรียนรู้คือค่าเช่าไม่ใช่ต้นทุนที่ฆ่าเรา แต่เป็นของเสียในครัวที่ไม่มีใครนับ'

describe('similarity', () => {
  it('ข้อความเดียวกันได้ 1', () => {
    expect(similarity(ORIGINAL, ORIGINAL)).toBe(1)
  })

  it('ข้อความคนละเรื่องได้ค่าต่ำ', () => {
    expect(similarity(ORIGINAL, 'วิธีติดตั้งแอร์ในคอนโดด้วยตัวเองแบบไม่ต้องจ้างช่าง')).toBeLessThan(0.1)
  })

  it('ข้อความว่างได้ 0 ไม่ใช่ NaN', () => {
    expect(similarity('', ORIGINAL)).toBe(0)
    expect(similarity('', '')).toBe(0)
  })

  it('จับการเรียบเรียงใหม่แบบเปลี่ยนคำนิดเดียวได้', () => {
    const reworded = ORIGINAL.replace('แปดเดือน', 'เก้าเดือน')
    expect(similarity(ORIGINAL, reworded)).toBeGreaterThan(SIMILARITY_BLOCK)
  })

  it('ไม่สนใจเครื่องหมายวรรคตอนและช่องว่างที่ต่างกัน', () => {
    expect(similarity('สวัสดีครับ ทุกคน!', 'สวัสดีครับ, ทุกคน')).toBeGreaterThan(0.9)
  })
})

describe('checkOriginality', () => {
  it('เนื้อหาใหม่ + ติ๊กครบ = ผ่าน', () => {
    const report = checkOriginality({ body: ORIGINAL, corpus: [], checklist: ALL_PASS })
    expect(report.verdict).toBe('pass')
    expect(isBlocked(report)).toBe(false)
  })

  it('ซ้ำเกินเพดาน = block พร้อมบอกเหตุผล', () => {
    const report = checkOriginality({
      body: ORIGINAL,
      corpus: ['เรื่องอื่นที่ไม่เกี่ยว', ORIGINAL],
      checklist: ALL_PASS,
    })
    expect(report.verdict).toBe('block')
    expect(report.closestIndex).toBe(1)
    expect(report.reasons.join(' ')).toMatch(/ซ้ำ/)
  })

  it('checklist ผ่านน้อยกว่าเกณฑ์ = block แม้เนื้อหาจะไม่ซ้ำเลย', () => {
    const failing = { ...ALL_PASS }
    // เอาออกให้เหลือผ่านน้อยกว่าเกณฑ์
    CHECKLIST.slice(0, CHECKLIST.length - CHECKLIST_MIN_PASS + 1).forEach((item) => {
      failing[item.key] = false
    })

    const report = checkOriginality({ body: ORIGINAL, corpus: [], checklist: failing })
    expect(report.checklistPassed).toBeLessThan(CHECKLIST_MIN_PASS)
    expect(report.verdict).toBe('block')
  })

  it('ไม่ส่ง checklist มาเลย ต้องถือว่าไม่ผ่าน ไม่ใช่ผ่านโดยปริยาย', () => {
    const report = checkOriginality({ body: ORIGINAL, corpus: [], checklist: {} })
    expect(report.verdict).toBe('block')
    expect(report.failedChecks).toHaveLength(CHECKLIST.length)
  })

  it('ใกล้เคียงแต่ยังไม่ถึงเพดาน = review ไม่ใช่ block', () => {
    const halfShared = `${ORIGINAL.slice(0, 60)} ส่วนที่เหลือเป็นเรื่องการเลือกเครื่องชงและการคุมสต็อกนมซึ่งไม่เหมือนต้นฉบับเลยแม้แต่น้อย`
    const report = checkOriginality({ body: halfShared, corpus: [ORIGINAL], checklist: ALL_PASS })
    expect(report.similarity).toBeGreaterThan(0)
    expect(report.similarity).toBeLessThan(SIMILARITY_BLOCK)
    expect(report.verdict).toBe('review')
  })

  it('corpus ว่าง closestIndex ต้องเป็น -1 ไม่ใช่ 0', () => {
    const report = checkOriginality({ body: ORIGINAL, corpus: [], checklist: ALL_PASS })
    expect(report.closestIndex).toBe(-1)
    expect(report.similarity).toBe(0)
  })
})
