import { describe, expect, it } from 'vitest'
import {
  HOOK_WARN_CHARS,
  MAX_SHOTS,
  SHOT_SECONDS,
  briefText,
  parsePlan,
  planFromRow,
  planProblems,
  plannedShots,
  platformSeconds,
  runDirector,
  scriptWithContext,
  unverifiedClaims,
  type DirectorPlan,
  type MarketingBrief,
} from '@/lib/video/director'

const BRIEF: MarketingBrief = {
  title: 'โฆษณาคอร์ส ISO 9001',
  objective: 'หาลูกค้าโรงงาน SME ที่กำลังจะทำ ISO · เคสล่าสุดลดของเสียได้ 25%',
  audience: 'เจ้าของโรงงาน 30-50 คน ชลบุรี ระยอง',
  platform: 'youtube_shorts',
  aspect: '9:16',
  notes: null,
  totalSeconds: 20,
}

function plan(overrides: Partial<DirectorPlan> = {}): DirectorPlan {
  return {
    icp: 'เจ้าของโรงงานฉีดพลาสติก 40 คน ที่ลูกค้ารายใหญ่เพิ่งขอใบเซอร์',
    pain: 'กลัวเสียลูกค้ารายใหญ่เพราะยังไม่มีใบเซอร์',
    promise: 'รู้ว่าเริ่มยังไงโดยไม่ต้องหยุดสายการผลิต',
    hook: 'ลูกค้ารายใหญ่ขอใบเซอร์ แล้วคุณมีเวลากี่เดือน',
    script: 'โรงงานส่วนใหญ่เริ่มไม่ถูก เพราะคิดว่าต้องหยุดไลน์ก่อน ซึ่งไม่จริง',
    cta: 'ทักมาคุยก่อนได้ ไม่มีค่าใช้จ่าย',
    storyboard: [
      { shot: 1, seconds: 6, prompt: 'Wide shot of a factory floor at dawn', voiceover: 'สั้น ๆ' },
      { shot: 2, seconds: 7, prompt: 'Close up on hands checking a part', voiceover: 'ต่ออีกนิด' },
      { shot: 3, seconds: 7, prompt: 'Owner smiling at the production line', voiceover: 'ปิดท้าย' },
    ],
    ...overrides,
  }
}

describe('การแบ่งช็อต', () => {
  it('ความยาวมากขึ้นต้องได้ช็อตมากขึ้น แต่ไม่เกินเพดาน', () => {
    expect(plannedShots(12)).toBe(2)
    expect(plannedShots(30)).toBe(5)
    expect(plannedShots(600)).toBe(MAX_SHOTS)
  })

  /** ช็อตเดียวไม่ใช่โฆษณา เป็นคลิปเดียว — บังคับอย่างน้อยสอง */
  it('สั้นแค่ไหนก็ต้องมีอย่างน้อยสองช็อต', () => {
    expect(plannedShots(1)).toBe(2)
  })

  it('แต่ละแพลตฟอร์มมีความยาวของตัวเอง', () => {
    expect(platformSeconds('youtube_shorts')).toBeLessThan(platformSeconds('website'))
  })
})

describe('parsePlan', () => {
  it('ไม่ใช่ JSON ต้องบอกให้ชัด ไม่ใช่ throw ดิบ ๆ', () => {
    expect(() => parsePlan('ขอโทษครับ ผมทำไม่ได้')).toThrow(/JSON/)
  })

  /**
   * โมเดลนับเลขช็อตข้ามเป็นเรื่องปกติ (1, 2, 4) และเลขที่ข้ามจะทำให้ปุ่ม
   * "ใส่ช็อตนี้ลงฟอร์ม" ชี้ผิดช็อต — เรียงใหม่จากลำดับจริงเสมอ
   */
  it('เลขช็อตต้องถูกเรียงใหม่จากลำดับจริง ไม่เชื่อเลขที่โมเดลให้มา', () => {
    const parsed = parsePlan(
      JSON.stringify({
        icp: 'ก',
        pain: 'ข',
        promise: 'ค',
        hook: 'ง',
        script: 'จ',
        cta: 'ฉ',
        storyboard: [
          { shot: 1, seconds: 5, prompt: 'a', voiceover: 'ก' },
          { shot: 4, seconds: 5, prompt: 'b', voiceover: 'ข' },
        ],
      }),
    )

    expect(parsed.storyboard.map((s) => s.shot)).toEqual([1, 2])
  })

  it('ความยาวช็อตต้องถูกบีบให้อยู่ในช่วงที่ผู้ให้บริการทำได้', () => {
    const parsed = parsePlan(
      JSON.stringify({
        storyboard: [
          { shot: 1, seconds: 60, prompt: 'a', voiceover: 'ก' },
          { shot: 2, seconds: 0, prompt: 'b', voiceover: 'ข' },
          { shot: 3, seconds: 'ห้า', prompt: 'c', voiceover: 'ค' },
        ],
      }),
    )

    expect(parsed.storyboard.map((s) => s.seconds)).toEqual([
      SHOT_SECONDS.max,
      SHOT_SECONDS.min,
      SHOT_SECONDS.target,
    ])
  })
})

/**
 * ตารางเก็บบทเป็นข้อความก้อนเดียว — ICP/ความเจ็บ/โน้ต ถูกฝังไว้หัวบท
 * สองฟังก์ชันนี้ต้องเดินสวนกันได้เป๊ะ ไม่งั้นข้อมูลหายเงียบ ๆ ตอนอ่านกลับ
 */
describe('เก็บลงตารางแล้วอ่านกลับ', () => {
  it('ICP ความเจ็บ และบท ต้องกลับมาครบ', () => {
    const original = plan()
    const back = planFromRow({
      hook: original.hook,
      script: scriptWithContext(original),
      cta: original.cta,
      storyboard: original.storyboard,
    })

    expect(back.icp).toBe(original.icp)
    expect(back.pain).toBe(original.pain)
    expect(back.script).toBe(original.script)
    expect(back.storyboard).toEqual(original.storyboard)
  })

  /** โน้ตเป็นส่วนหนึ่งของบรีฟ หายไปแล้วตัวเลขที่ผู้ใช้พิมพ์เองจะถูกเตือนว่าไม่มีที่มา */
  it('โน้ตของผู้ใช้ต้องกลับมาด้วย', () => {
    const back = planFromRow({
      hook: 'ก',
      script: scriptWithContext(plan(), 'เน้นว่าเริ่มได้เลย ไม่ต้องรอ'),
      cta: 'ข',
      storyboard: [],
    })

    expect(back.notes).toBe('เน้นว่าเริ่มได้เลย ไม่ต้องรอ')
  })

  it('บทที่ไม่มีหัวบท (แถวเก่า) ต้องอ่านได้ ไม่ใช่พัง', () => {
    const back = planFromRow({ hook: null, script: 'บทเปล่า ๆ', cta: null, storyboard: null })

    expect(back.script).toBe('บทเปล่า ๆ')
    expect(back.icp).toBe('')
    expect(back.storyboard).toEqual([])
  })
})

/**
 * ⚠️ ข้อที่สำคัญที่สุดของไฟล์นี้
 *
 * โมเดลเติมตัวเลขที่ "ฟังดูสมเหตุสมผล" ให้เองเป็นเรื่องปกติ แม้จะสั่งห้ามไว้ใน prompt
 * และตัวเลขที่ฟังดูสมเหตุสมผลคือตัวเลขที่คนอ่านผ่านโดยไม่เอะใจ
 * — อันตรายกว่าตัวเลขที่ผิดจนสังเกตได้ เพราะมันไปโผล่ในโฆษณาจริงที่ผิดกฎหมายได้
 */
describe('ตัวเลขที่ไม่มีที่มา', () => {
  const brief = briefText(BRIEF)

  it('เปอร์เซ็นต์ที่ไม่ได้อยู่ในบรีฟต้องถูกจับ', () => {
    const found = unverifiedClaims(plan({ hook: 'ประหยัดต้นทุนได้ถึง 40%' }), brief)
    expect(found).toContain('40%')
  })

  it('เปอร์เซ็นต์ที่อยู่ในบรีฟต้องผ่าน', () => {
    const found = unverifiedClaims(plan({ script: 'เคสล่าสุดลดของเสียได้ 25%' }), brief)
    expect(found).toEqual([])
  })

  it('เงินและจำนวนเท่าต้องถูกจับด้วย', () => {
    const found = unverifiedClaims(
      plan({ script: 'ประหยัดปีละ 500,000 บาท', cta: 'ยอดโตขึ้น 3 เท่า' }),
      brief,
    )

    expect(found.join(' ')).toMatch(/บาท/)
    expect(found.join(' ')).toMatch(/เท่า/)
  })

  it('จำนวนหลักร้อยขึ้นไปต้องถูกจับ แม้ไม่มีหน่วยกำกับ', () => {
    const found = unverifiedClaims(plan({ script: 'ลูกค้ากว่า 500 โรงงานเลือกเรา' }), brief)
    expect(found).toContain('500')
  })

  /**
   * จับเลขเล็กด้วยจะได้คำเตือนเยอะจนไม่มีใครอ่าน ซึ่งแย่กว่าไม่เตือนเลย
   * — คำเตือนที่ถูกมองข้ามทุกครั้งคือคำเตือนที่ไม่มีอยู่
   */
  it('เลขเล็กที่เป็นโครงประโยคต้องไม่ถูกจับ', () => {
    const found = unverifiedClaims(plan({ script: 'มี 3 ข้อที่ต้องรู้ ใช้เวลา 2 นาที' }), brief)
    expect(found).toEqual([])
  })

  it('ปี พ.ศ. ต้องไม่ถูกจับ', () => {
    const found = unverifiedClaims(plan({ script: 'กฎใหม่เริ่มใช้ปี 2569' }), brief)
    expect(found).toEqual([])
  })

  /** ตัวเลขในโน้ตของผู้ใช้ = ผู้ใช้เป็นคนอ้างเอง ไม่ใช่โมเดลแต่ง */
  it('ตัวเลขที่มาจากโน้ตของผู้ใช้ต้องผ่าน', () => {
    const withNotes = briefText({ ...BRIEF, notes: 'บอกด้วยว่าเริ่มได้ใน 7 วัน' })
    const found = unverifiedClaims(plan({ cta: 'เริ่มได้ใน 7 วัน' }), withNotes)
    expect(found).toEqual([])
  })
})

describe('planProblems', () => {
  it('แผนที่ดีต้องไม่มีปัญหา', () => {
    expect(planProblems(plan(), BRIEF)).toEqual([])
  })

  it('ไม่มีสตอรีบอร์ดต้องบอกว่าสั่งสร้างต่อไม่ได้', () => {
    expect(planProblems(plan({ storyboard: [] }), BRIEF).join(' ')).toMatch(/สตอรีบอร์ด/)
  })

  /** hook ที่พูดไม่จบใน 3 วินาทีคือ hook ที่คนเลื่อนผ่านไปแล้ว */
  it('hook ยาวเกินเพดานเตือนต้องถูกเตือน', () => {
    const long = 'ก'.repeat(HOOK_WARN_CHARS + 10)
    expect(planProblems(plan({ hook: long }), BRIEF).join(' ')).toMatch(/hook/)
  })

  it('บทพูดยาวเกินเวลาช็อตต้องถูกเตือน', () => {
    const problems = planProblems(
      plan({
        storyboard: [
          { shot: 1, seconds: 3, prompt: 'a', voiceover: 'ก'.repeat(200) },
          { shot: 2, seconds: 6, prompt: 'b', voiceover: 'ข' },
        ],
      }),
      BRIEF,
    )

    expect(problems.join(' ')).toMatch(/ช็อต 1/)
  })

  it('ไม่มี CTA ต้องถูกเตือน', () => {
    expect(planProblems(plan({ cta: '' }), BRIEF).join(' ')).toMatch(/CTA/)
  })

  it('ตัวเลขที่ไม่มีที่มาต้องโผล่ในรายการปัญหาด้วย', () => {
    expect(planProblems(plan({ hook: 'ได้ผล 99%' }), BRIEF).join(' ')).toMatch(/99%/)
  })
})

describe('runDirector', () => {
  /**
   * ไม่มีเป้าหมายธุรกิจแล้วปล่อยให้โมเดลเดาเอง = ได้แผนที่ดูดีแต่ไม่ใช่ธุรกิจของผู้ใช้
   * ซึ่งแย่กว่าไม่ได้แผนเลย เพราะอ่านแล้วเชื่อ
   */
  it('ไม่มีเป้าหมายธุรกิจต้องไม่เรียกโมเดลเลย', async () => {
    let called = false
    const spy = async () => {
      called = true
      return '{}'
    }

    await expect(runDirector({ ...BRIEF, objective: null }, spy)).rejects.toThrow(/เป้าหมาย/)
    expect(called).toBe(false)
  })

  it('ต้องส่งเป้าหมายและกลุ่มเป้าหมายเข้า prompt', async () => {
    let sent = ''
    await runDirector(BRIEF, async (input) => {
      sent = input.user
      return JSON.stringify(plan())
    })

    expect(sent).toContain('หาลูกค้าโรงงาน SME')
    expect(sent).toContain('ชลบุรี')
  })

  it('ต้องคืนแผนที่อ่านแล้ว ไม่ใช่ข้อความดิบ', async () => {
    const result = await runDirector(BRIEF, async () => JSON.stringify(plan()))
    expect(result.storyboard).toHaveLength(3)
    expect(result.hook).toMatch(/ใบเซอร์/)
  })
})
