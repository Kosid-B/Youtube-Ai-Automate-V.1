import { afterEach, describe, expect, it, vi } from 'vitest'
import { route, clampSeconds, maxCostUsd, VideoCostExceeded, TIER_ORDER } from '@/lib/video/router'
import { availableProviders, knownProviderIds } from '@/lib/video/registry'
import { createVeoProvider, VEO_USD_PER_SECOND, VEO_MAX_SECONDS } from '@/lib/video/providers/veo/adapter'
import { createRunwayProvider } from '@/lib/video/providers/runway/adapter'
import { planGeneration } from '@/lib/video/orchestrator'
import { VideoProviderError } from '@/lib/video/types'

const ENV = [
  'GOOGLE_AI_API_KEY', 'GEMINI_API_KEY', 'RUNWAY_API_KEY',
  'RUNWAY_USD_PER_SECOND', 'MAX_VIDEO_COST_USD', 'MAX_VIDEO_DURATION_SECONDS',
]

afterEach(() => {
  for (const key of ENV) delete process.env[key]
  vi.unstubAllGlobals()
})

const base = { prompt: 'โรงงานตอนเช้า', aspect: '9:16' as const, seconds: 8, policy: 'auto' as const }

describe('ทะเบียนผู้ให้บริการ', () => {
  /** ไม่มีคีย์ = ไม่มีอยู่ ไม่ใช่ error — แอปต้องเดินได้แม้ไม่ต่อสักเจ้า */
  it('คืนเฉพาะเจ้าที่ตั้งคีย์ไว้', () => {
    expect(availableProviders()).toHaveLength(0)

    process.env.GOOGLE_AI_API_KEY = 'k'
    expect(availableProviders().map((p) => p.id)).toEqual(['veo'])

    process.env.RUNWAY_API_KEY = 'k'
    expect(availableProviders().map((p) => p.id)).toEqual(['veo', 'runway'])
  })

  /**
   * OpenAI ต้องอยู่ในชนิดข้อมูลตั้งแต่ต้น แต่ยังไม่มี adapter
   * เพราะ Videos API ของเขาถูกประกาศเลิกใช้ 24 ก.ย. 2569
   * เขียน adapter ตอนนี้คือเขียนโค้ดที่ตายก่อนได้ใช้
   */
  it('ยังไม่ลงทะเบียน OpenAI แต่ชนิดข้อมูลรองรับไว้แล้ว', () => {
    expect(knownProviderIds()).not.toContain('openai')
  })
})

describe('ราคา', () => {
  it('Veo คิดตามวินาที × อัตราของระดับนั้น', () => {
    const veo = createVeoProvider()
    expect(veo.estimateCostUsd({ ...base, tier: 'lite' })).toBeCloseTo(0.4, 3)
    expect(veo.estimateCostUsd({ ...base, tier: 'fast' })).toBeCloseTo(0.8, 3)
    expect(veo.estimateCostUsd({ ...base, tier: 'quality' })).toBeCloseTo(3.2, 3)
  })

  /** ราคาที่ประกาศไว้ ส.ค. 2569 — เปลี่ยนเมื่อไรต้องแก้เทสต์นี้พร้อมโค้ด */
  it('อัตราของ Veo ตรงกับที่ประกาศไว้', () => {
    expect(VEO_USD_PER_SECOND).toEqual({ lite: 0.05, fast: 0.1, quality: 0.4 })
  })

  /**
   * ยืนยันราคาต่อวินาทีของ Runway จากแหล่งทางการไม่ได้ (คิดเป็นเครดิต)
   * ไม่รู้ราคา = ด่านคุมงบทำงานไม่ได้ = ต้องปฏิเสธ ไม่ใช่เดาแล้วปล่อยผ่าน
   */
  it('Runway ที่ยังไม่ตั้งราคา ต้องปฏิเสธ ไม่ใช่เดาให้', () => {
    expect(() => createRunwayProvider().estimateCostUsd({ ...base, tier: 'lite' })).toThrow(
      /RUNWAY_USD_PER_SECOND/,
    )
  })
})

describe('เพดานความยาว', () => {
  it('บีบตามที่เจ้านั้นทำได้ต่อครั้ง', () => {
    const veo = createVeoProvider()
    expect(clampSeconds(veo, 50)).toBe(VEO_MAX_SECONDS)
    expect(clampSeconds(veo, 5)).toBe(5)
    expect(clampSeconds(veo, 0)).toBe(1)
  })

  it('เพดานของระบบชนะเพดานของเจ้านั้นเมื่อเข้มกว่า', () => {
    process.env.MAX_VIDEO_DURATION_SECONDS = '4'
    expect(clampSeconds(createVeoProvider(), 8)).toBe(4)
  })

  /** ขอเกินเพดานระบบต้องถูกปฏิเสธที่ชั้นตรรกะ ไม่ใช่บีบเงียบ ๆ แล้วคิดเงิน */
  it('ขอยาวเกินเพดานระบบ ต้องล้มพร้อมบอกตัวเลข', () => {
    process.env.GOOGLE_AI_API_KEY = 'k'
    process.env.MAX_VIDEO_DURATION_SECONDS = '10'

    expect(() => planGeneration({ ...base, seconds: 30 })).toThrow(/30 วินาที เกินเพดาน 10/)
  })
})

describe('ด่านคุมงบ', () => {
  it('ค่าเริ่มต้นคือ $5 ต่อคลิป', () => {
    expect(maxCostUsd()).toBe(5)
  })

  /**
   * ข้อสำคัญที่สุด — เครดิตของระบบกันได้แค่ "จำนวนงาน" ไม่ได้กันขนาดของงาน
   * บั๊กที่ส่งความยาวผิดหน่วยไปหนึ่งครั้ง ทำเงินหายสิบเท่าในคำสั่งเดียว
   */
  it('ถูกสุดก็ยังเกินงบ ต้องล้มพร้อมบอกทั้งราคาจริงและเพดาน', () => {
    process.env.GOOGLE_AI_API_KEY = 'k'
    process.env.MAX_VIDEO_COST_USD = '0.01'

    expect(() => route({ ...base })).toThrow(VideoCostExceeded)
    expect(() => route({ ...base })).toThrow(/0\.40.*0\.01/)
  })
})

describe('การเลือกเส้นทาง', () => {
  it('ไม่ได้ตั้งคีย์เลย ต้องบอกว่าต้องตั้งตัวไหน', () => {
    expect(() => route({ ...base })).toThrow(/GOOGLE_AI_API_KEY|RUNWAY_API_KEY/)
  })

  it('นโยบาย cheap ล็อกที่ระดับถูกสุด', () => {
    process.env.GOOGLE_AI_API_KEY = 'k'
    const result = route({ ...base, policy: 'cheap' })

    expect(result.input.tier).toBe('lite')
    expect(result.downgraded).toBe(false)
    expect(result.model).toBe('veo-3.1-lite')
  })

  it('นโยบาย quality เอาระดับสูงสุดเมื่องบไหว', () => {
    process.env.GOOGLE_AI_API_KEY = 'k'
    expect(route({ ...base, policy: 'quality' }).input.tier).toBe('quality')
  })

  /** auto = เอาดีที่สุดเท่าที่งบไหว จึงเริ่มจาก quality แล้วลดลง */
  it('auto เริ่มจากคุณภาพสูงสุดเมื่องบไหว', () => {
    process.env.GOOGLE_AI_API_KEY = 'k'
    expect(route({ ...base, policy: 'auto' }).input.tier).toBe('quality')
  })

  /**
   * ลดระดับ "ทีละขั้น" ไม่ใช่ร่วงไปถูกสุดทันที — งบ $1 กับคลิป 8 วินาที
   * ยังจ่าย fast ($0.80) ไหว การไปเอา lite ($0.40) คือลดคุณภาพเกินจำเป็น
   * และต้องติดธง downgraded เสมอ เปลี่ยนคุณภาพเงียบ ๆ คือหลอกผู้ใช้
   */
  it('งบไม่พอ ต้องลดทีละขั้นแล้วบอกว่าลด', () => {
    process.env.GOOGLE_AI_API_KEY = 'k'
    process.env.MAX_VIDEO_COST_USD = '1'

    const result = route({ ...base, policy: 'quality' })
    expect(result.input.tier).toBe('fast')
    expect(result.estimatedCostUsd).toBeCloseTo(0.8, 3)
    expect(result.downgraded).toBe(true)
  })

  it('ลดจนถึงถูกสุดได้ถ้างบไม่ไหวจริง', () => {
    process.env.GOOGLE_AI_API_KEY = 'k'
    process.env.MAX_VIDEO_COST_USD = '0.5'

    expect(route({ ...base, policy: 'quality' }).input.tier).toBe('lite')
  })

  it('เจ้าที่ยังตั้งราคาไม่ครบ ต้องถูกข้าม ไม่ใช่ทำให้ทั้งงานล้ม', () => {
    process.env.GOOGLE_AI_API_KEY = 'k'
    process.env.RUNWAY_API_KEY = 'k'

    expect(route({ ...base }).provider.id).toBe('veo')
  })

  it('ตั้งราคา Runway ถูกกว่าแล้ว ต้องเลือก Runway', () => {
    process.env.GOOGLE_AI_API_KEY = 'k'
    process.env.RUNWAY_API_KEY = 'k'
    process.env.RUNWAY_USD_PER_SECOND = '0.001'

    expect(route({ ...base, policy: 'cheap' }).provider.id).toBe('runway')
  })

  it('บังคับเจ้าที่ยังไม่ได้ตั้งคีย์ ต้องบอกให้ชัด', () => {
    process.env.GOOGLE_AI_API_KEY = 'k'
    expect(() => route({ ...base, prefer: 'runway' })).toThrow(/runway/)
  })

  /** deterministic — อินพุตเดียวกันต้องได้ผลเดียวกันเสมอ ไม่งั้นราคาที่โชว์กับที่จ่ายไม่ตรง */
  it('เรียกซ้ำด้วยอินพุตเดิม ต้องได้ผลเดิมทุกครั้ง', () => {
    process.env.GOOGLE_AI_API_KEY = 'k'
    process.env.RUNWAY_API_KEY = 'k'
    process.env.RUNWAY_USD_PER_SECOND = '0.05'

    const first = route({ ...base })
    for (let i = 0; i < 5; i += 1) {
      const again = route({ ...base })
      expect(again.provider.id).toBe(first.provider.id)
      expect(again.input.tier).toBe(first.input.tier)
      expect(again.estimatedCostUsd).toBe(first.estimatedCostUsd)
    }
  })

  it('ลำดับระดับต้องเรียงจากถูกไปแพง — ตรรกะลดระดับพึ่งลำดับนี้', () => {
    expect(TIER_ORDER).toEqual(['lite', 'fast', 'quality'])
  })
})

describe('ตรรกะธุรกิจไม่รู้จักชื่อเจ้า', () => {
  /**
   * ข้อนี้คือเหตุผลทั้งหมดที่แยกชั้น provider ออกมา
   * orchestrator ที่มีคำว่า Veo หรือ Runway อยู่ = วันที่เปลี่ยนเจ้าต้องรื้อตรรกะธุรกิจ
   */
  it('orchestrator ต้องไม่มีชื่อผู้ให้บริการเจ้าใดเจ้าหนึ่งในโค้ด', async () => {
    const { readFile } = await import('node:fs/promises')
    const source = await readFile('src/lib/video/orchestrator.ts', 'utf8')

    /**
     * ตัดคอมเมนต์ออกก่อนตรวจ — คอมเมนต์พูดถึงชื่อเจ้าได้ (และควรพูด
     * เพราะเป็นการอธิบายว่าทำไมโค้ดถึงไม่พูดถึง) ที่ห้ามคือ "โค้ด" ต้องไม่ผูกกับเจ้าใด
     * รอบแรกเทสต์นี้แดงเพราะคอมเมนต์ที่เขียนว่า "ทั้งไฟล์ไม่มีคำว่า Veo หรือ Runway"
     */
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .toLowerCase()

    expect(code).not.toContain('veo')
    expect(code).not.toContain('runway')
    expect(code).not.toContain('generativelanguage')
  })
})

describe('error ที่ผู้ใช้เห็น', () => {
  it('VideoProviderError บอกได้ว่าลองใหม่แล้วมีโอกาสสำเร็จไหม', () => {
    expect(new VideoProviderError('rate_limit', 'x').retryable).toBe(true)
    expect(new VideoProviderError('provider', 'x').retryable).toBe(true)
    expect(new VideoProviderError('timeout', 'x').retryable).toBe(true)

    // ลองใหม่ไม่ช่วย — ลองซ้ำก็เสียเวลาและเงินเปล่า
    expect(new VideoProviderError('auth', 'x').retryable).toBe(false)
    expect(new VideoProviderError('content_policy', 'x').retryable).toBe(false)
    expect(new VideoProviderError('invalid_input', 'x').retryable).toBe(false)
  })
})
