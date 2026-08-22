import { afterEach, describe, expect, it, vi } from 'vitest'
import { guardCost, clampSeconds, VideoCostExceeded } from '@/lib/video-provider'
import { createVeoProvider, VEO_USD_PER_SECOND, VEO_MAX_SECONDS } from '@/lib/video-veo'
import { createRunwayProvider } from '@/lib/video-runway'
import { route, availableProviders, TIER_ORDER } from '@/lib/video-router'

const ENV_KEYS = [
  'GOOGLE_AI_API_KEY', 'GEMINI_API_KEY', 'RUNWAY_API_KEY',
  'RUNWAY_USD_PER_SECOND', 'VIDEO_MAX_COST_USD',
]

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
  vi.unstubAllGlobals()
})

const base = { prompt: 'ร้านกาแฟยามเช้า', aspect: '9:16' as const, seconds: 8 }

describe('ราคา Veo', () => {
  it('คิดตามวินาที × อัตราของระดับนั้น', () => {
    const veo = createVeoProvider()
    expect(veo.costUsd({ ...base, tier: 'lite' })).toBeCloseTo(0.4, 3)
    expect(veo.costUsd({ ...base, tier: 'fast' })).toBeCloseTo(0.8, 3)
    expect(veo.costUsd({ ...base, tier: 'quality' })).toBeCloseTo(3.2, 3)
  })

  /** ราคาที่ประกาศไว้ ส.ค. 2569 — เปลี่ยนเมื่อไรต้องแก้เทสต์นี้พร้อมโค้ด */
  it('อัตราตรงกับที่ประกาศไว้', () => {
    expect(VEO_USD_PER_SECOND).toEqual({ lite: 0.05, fast: 0.1, quality: 0.4 })
  })
})

describe('clampSeconds', () => {
  /**
   * Veo สร้างได้ครั้งละ ~8 วินาที · ขอ 50 วินาทีไปตรง ๆ ไม่ได้
   * ต้องบีบก่อน ไม่ใช่ส่งไปแล้วให้ API ปฏิเสธหลังจากที่คิดเงินไปแล้ว
   */
  it('บีบให้ไม่เกินที่ผู้ให้บริการทำได้ต่อครั้ง', () => {
    const veo = createVeoProvider()
    expect(clampSeconds(veo, 50)).toBe(VEO_MAX_SECONDS)
    expect(clampSeconds(veo, 5)).toBe(5)
    expect(clampSeconds(veo, 0)).toBe(1)
  })
})

describe('ด่านคุมงบ', () => {
  /**
   * ข้อสำคัญที่สุดของไฟล์นี้ — เครดิตของระบบกันได้แค่ "จำนวนงาน"
   * ไม่ได้กันขนาดของงานแต่ละชิ้น · บั๊กที่ส่งความยาวผิดหน่วยไปหนึ่งครั้ง
   * ทำเงินหายเป็นสิบเท่าในคำสั่งเดียว
   */
  it('เกินเพดานต้องล้มก่อนเงินออก', () => {
    process.env.VIDEO_MAX_COST_USD = '1'
    const veo = createVeoProvider()

    expect(() => guardCost(veo, { ...base, tier: 'quality' })).toThrow(VideoCostExceeded)
    expect(guardCost(veo, { ...base, tier: 'lite' })).toBeCloseTo(0.4, 3)
  })

  it('ข้อความ error ต้องบอกทั้งราคาจริงและเพดาน ไม่ใช่แค่ว่าเกิน', () => {
    process.env.VIDEO_MAX_COST_USD = '1'
    const veo = createVeoProvider()

    expect(() => guardCost(veo, { ...base, tier: 'quality' })).toThrow(/3\.20.*1\.00/)
  })
})

describe('ราคา Runway', () => {
  /**
   * ยืนยันราคาต่อวินาทีของ Runway จากแหล่งทางการไม่ได้ (คิดเป็นเครดิต)
   * ไม่รู้ราคา = ด่านคุมงบทำงานไม่ได้ = ต้องปฏิเสธ ไม่ใช่เดาแล้วปล่อยผ่าน
   */
  it('ไม่ได้ตั้งราคาต้องปฏิเสธ ไม่ใช่เดาราคาให้', () => {
    const runway = createRunwayProvider()
    expect(() => runway.costUsd({ ...base, tier: 'lite' })).toThrow(/RUNWAY_USD_PER_SECOND/)
  })

  it('ตั้งราคาแล้วคิดตามนั้น', () => {
    process.env.RUNWAY_USD_PER_SECOND = '0.25'
    const runway = createRunwayProvider()
    expect(runway.costUsd({ ...base, tier: 'lite' })).toBeCloseTo(2, 3)
  })
})

describe('availableProviders', () => {
  /** ไม่มีคีย์ = ไม่มีอยู่ ไม่ใช่ error — ระบบต้องเดินได้แม้ต่อไว้เจ้าเดียว */
  it('คืนเฉพาะเจ้าที่ตั้งคีย์ไว้', () => {
    expect(availableProviders()).toHaveLength(0)

    process.env.GOOGLE_AI_API_KEY = 'k'
    expect(availableProviders().map((p) => p.id)).toEqual(['veo'])

    process.env.RUNWAY_API_KEY = 'k'
    expect(availableProviders().map((p) => p.id)).toEqual(['veo', 'runway'])
  })
})

describe('route', () => {
  it('ไม่ได้ตั้งคีย์เลยต้องบอกว่าต้องตั้งตัวไหน', () => {
    expect(() => route({ ...base })).toThrow(/GOOGLE_AI_API_KEY|RUNWAY_API_KEY/)
  })

  it('ไม่ระบุระดับต้องได้ถูกที่สุด — โฆษณาสั้นทำหลายชิ้นเพื่อคัด', () => {
    process.env.GOOGLE_AI_API_KEY = 'k'
    const result = route({ ...base })

    expect(result.input.tier).toBe('lite')
    expect(result.downgraded).toBe(false)
    expect(result.costUsd).toBeCloseTo(0.4, 3)
  })

  /**
   * ลดระดับก่อนปฏิเสธ — ผู้ใช้ที่ได้ "ไม่ได้ เกินงบ" ไม่รู้ว่าต้องแก้อะไร
   * แต่ต้องติดธง downgraded ไว้ · เปลี่ยนคุณภาพเงียบ ๆ คือหลอกผู้ใช้
   *
   * และต้องลด "ทีละขั้น" ไม่ใช่ร่วงไปถูกสุดทันที — งบ $1 กับคลิป 8 วินาที
   * ยังจ่าย fast ($0.80) ไหว การไปเอา lite ($0.40) ทั้งที่งบพอ คือลดคุณภาพเกินจำเป็น
   */
  it('ขอระดับที่เกินงบ ต้องลดลงทีละขั้นเท่าที่งบยังไหว แล้วบอกว่าลด', () => {
    process.env.GOOGLE_AI_API_KEY = 'k'
    process.env.VIDEO_MAX_COST_USD = '1'

    const result = route({ ...base, tier: 'quality' })

    expect(result.input.tier).toBe('fast')
    expect(result.costUsd).toBeCloseTo(0.8, 3)
    expect(result.downgraded).toBe(true)
  })

  it('ลดจนถึงถูกสุดได้ ถ้างบไม่ไหวจริง ๆ', () => {
    process.env.GOOGLE_AI_API_KEY = 'k'
    process.env.VIDEO_MAX_COST_USD = '0.5'

    const result = route({ ...base, tier: 'quality' })
    expect(result.input.tier).toBe('lite')
    expect(result.downgraded).toBe(true)
  })

  it('ถูกสุดก็ยังเกินงบ ต้องล้มพร้อมบอกตัวเลข', () => {
    process.env.GOOGLE_AI_API_KEY = 'k'
    process.env.VIDEO_MAX_COST_USD = '0.01'

    expect(() => route({ ...base })).toThrow(VideoCostExceeded)
  })

  it('เจ้าที่ยังไม่ได้ตั้งราคา ต้องถูกข้าม ไม่ใช่ทำให้ทั้งงานล้ม', () => {
    process.env.GOOGLE_AI_API_KEY = 'k'
    process.env.RUNWAY_API_KEY = 'k' // ไม่ได้ตั้งราคา

    const result = route({ ...base })
    expect(result.provider.id).toBe('veo')
  })

  it('บังคับเจ้าที่ยังไม่ได้ตั้งคีย์ ต้องบอกให้ชัด', () => {
    process.env.GOOGLE_AI_API_KEY = 'k'
    expect(() => route({ ...base, prefer: 'runway' })).toThrow(/runway/)
  })

  it('ความยาวเกินที่เจ้านั้นทำได้ ต้องถูกบีบก่อนคิดราคา', () => {
    process.env.GOOGLE_AI_API_KEY = 'k'
    const result = route({ ...base, seconds: 60 })

    expect(result.input.seconds).toBe(VEO_MAX_SECONDS)
    expect(result.costUsd).toBeCloseTo(0.4, 3)
  })

  it('ลำดับระดับต้องเรียงจากถูกไปแพง — ตรรกะลดระดับพึ่งลำดับนี้', () => {
    expect(TIER_ORDER).toEqual(['lite', 'fast', 'quality'])
  })
})
