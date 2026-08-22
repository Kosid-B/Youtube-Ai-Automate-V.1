import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createVeoProvider } from '@/lib/video/providers/veo/adapter'
import { createRunwayProvider } from '@/lib/video/providers/runway/adapter'
import { codeFromStatus } from '@/lib/video/http'
import { VideoProviderError } from '@/lib/video/types'
import { checkGeneration, cancelGeneration } from '@/lib/video/orchestrator'

const input = { prompt: 'โรงงานตอนเช้า', seconds: 8, aspect: '9:16' as const, tier: 'lite' as const }

beforeEach(() => {
  process.env.GOOGLE_AI_API_KEY = 'test-key'
  process.env.RUNWAY_API_KEY = 'test-key'
  process.env.RUNWAY_USD_PER_SECOND = '0.05'
  // ย่นเวลารอให้เทสต์ไม่ช้า — ตัวจริงคือ 30 วินาที
  process.env.VIDEO_REQUEST_TIMEOUT_MS = '150'
})

afterEach(() => {
  delete process.env.GOOGLE_AI_API_KEY
  delete process.env.RUNWAY_API_KEY
  delete process.env.RUNWAY_USD_PER_SECOND
  delete process.env.VIDEO_REQUEST_TIMEOUT_MS
  vi.restoreAllMocks()
})

/** ตัวปลอมของ fetch — คืนตามลำดับที่กำหนด เพื่อจำลอง retry ได้ */
function mockFetch(responses: (Partial<Response> & { json?: () => Promise<unknown> })[]) {
  let i = 0
  return vi.fn(async () => {
    const spec = responses[Math.min(i, responses.length - 1)]
    i += 1
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(4),
      ...spec,
    } as Response
  }) as unknown as typeof fetch
}

describe('แปลงสถานะ HTTP เป็นรหัสกลาง', () => {
  /**
   * ตัดสินจากสถานะ ไม่ใช่จากข้อความ — ข้อความของแต่ละเจ้าต่างกันและเปลี่ยนได้
   * แมตช์ข้อความคือบั๊กที่รอเกิดในวันที่เขาแก้คำ
   */
  it('จับคู่รหัสได้ถูกทุกช่วง', () => {
    expect(codeFromStatus(401)).toBe('auth')
    expect(codeFromStatus(403)).toBe('auth')
    expect(codeFromStatus(404)).toBe('not_found')
    expect(codeFromStatus(429)).toBe('rate_limit')
    expect(codeFromStatus(400)).toBe('invalid_input')
    expect(codeFromStatus(500)).toBe('provider')
    expect(codeFromStatus(503)).toBe('provider')
  })
})

describe('Veo adapter', () => {
  it('เริ่มงานแล้วคืน id กับชื่อรุ่นกับราคาประมาณ', async () => {
    const fetchMock = mockFetch([{ json: async () => ({ name: 'operations/abc' }) }])
    const started = await createVeoProvider(fetchMock).generate(input)

    expect(started.providerJobId).toBe('operations/abc')
    expect(started.model).toBe('veo-3.1-lite')
    expect(started.estimatedCostUsd).toBeCloseTo(0.4, 3)
  })

  /**
   * ไม่มีชื่อ operation = ถามสถานะไม่ได้ตลอดกาล และเงินออกไปแล้ว
   * ต้องล้มตรงนี้ให้ดัง ไม่ใช่คืนค่าว่างแล้วไปพังตอน getStatus
   */
  it('ตอบสำเร็จแต่ไม่มี operation ต้องล้มทันที', async () => {
    const fetchMock = mockFetch([{ json: async () => ({}) }])

    await expect(createVeoProvider(fetchMock).generate(input)).rejects.toThrow(/operation/)
  })

  it('ยังไม่เสร็จต้องรายงานว่ากำลังทำ', async () => {
    const fetchMock = mockFetch([{ json: async () => ({ done: false }) }])
    expect(await createVeoProvider(fetchMock).getStatus('operations/abc')).toEqual({
      status: 'running',
    })
  })

  it('เสร็จแล้วต้องคืนลิงก์วิดีโอ', async () => {
    const fetchMock = mockFetch([
      {
        json: async () => ({
          done: true,
          response: { generatedVideos: [{ video: { uri: 'https://x/v.mp4' } }] },
        }),
      },
    ])

    const state = await createVeoProvider(fetchMock).getStatus('operations/abc')
    expect(state).toEqual({ status: 'done', outputUrl: 'https://x/v.mp4' })
  })

  /** รุ่นเก่าใช้ชื่อฟิลด์อีกแบบ — รับทั้งสองไว้ ดีกว่าพังเพราะรุ่นใหม่ย้ายฟิลด์ */
  it('รับรูปแบบคำตอบของรุ่นเก่าได้ด้วย', async () => {
    const fetchMock = mockFetch([
      {
        json: async () => ({
          done: true,
          response: {
            generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://y/v.mp4' } }] },
          },
        }),
      },
    ])

    const state = await createVeoProvider(fetchMock).getStatus('operations/abc')
    expect(state.outputUrl).toBe('https://y/v.mp4')
  })

  it('งานเสร็จแต่ไม่มีลิงก์ ต้องนับเป็นล้มเหลว ไม่ใช่สำเร็จ', async () => {
    const fetchMock = mockFetch([{ json: async () => ({ done: true, response: {} }) }])
    const state = await createVeoProvider(fetchMock).getStatus('operations/abc')

    expect(state.status).toBe('failed')
    expect(state.errorCode).toBe('provider')
  })

  it('ไม่ได้ตั้งคีย์ต้องได้รหัส auth ไม่ใช่ unknown', async () => {
    delete process.env.GOOGLE_AI_API_KEY
    delete process.env.GEMINI_API_KEY

    await expect(createVeoProvider(mockFetch([])).generate(input)).rejects.toMatchObject({
      code: 'auth',
    })
  })

  it('Veo ไม่รองรับการยกเลิก ต้องบอกว่าไม่รองรับ ไม่ใช่เงียบ', async () => {
    expect(createVeoProvider().supportsCancel).toBe(false)
    expect(await cancelGeneration('veo', 'operations/abc')).toBe(false)
  })
})

describe('Runway adapter', () => {
  it('เริ่มงานแล้วคืน id', async () => {
    const fetchMock = mockFetch([{ json: async () => ({ id: 'task-1' }) }])
    const started = await createRunwayProvider(fetchMock).generate(input)

    expect(started.providerJobId).toBe('task-1')
    expect(started.model).toBe('gen4_turbo')
  })

  it('สถานะระหว่างทางทั้งหมดต้องนับเป็นกำลังทำ', async () => {
    for (const status of ['PENDING', 'RUNNING', 'THROTTLED']) {
      const fetchMock = mockFetch([{ json: async () => ({ status }) }])
      expect((await createRunwayProvider(fetchMock).getStatus('t')).status).toBe('running')
    }
  })

  /** เนื้อหาถูกปฏิเสธ ลองใหม่ไม่ช่วย ต้องแยกจากปัญหาระบบที่ลองใหม่ช่วยได้ */
  it('ถูกปฏิเสธเพราะนโยบายเนื้อหา ต้องได้รหัส content_policy', async () => {
    const fetchMock = mockFetch([
      { json: async () => ({ status: 'FAILED', failureCode: 'SAFETY_VIOLATION' }) },
    ])

    const state = await createRunwayProvider(fetchMock).getStatus('t')
    expect(state.errorCode).toBe('content_policy')
  })

  it('ล้มเพราะระบบ ต้องได้รหัส provider ซึ่งลองใหม่ได้', async () => {
    const fetchMock = mockFetch([
      { json: async () => ({ status: 'FAILED', failure: 'internal error' }) },
    ])

    const state = await createRunwayProvider(fetchMock).getStatus('t')
    expect(state.errorCode).toBe('provider')
    expect(new VideoProviderError(state.errorCode!, '').retryable).toBe(true)
  })

  it('ถูกยกเลิกต้องแยกจากล้มเหลว', async () => {
    const fetchMock = mockFetch([{ json: async () => ({ status: 'CANCELLED' }) }])
    expect((await createRunwayProvider(fetchMock).getStatus('t')).status).toBe('cancelled')
  })

  it('Runway ยกเลิกได้', async () => {
    const fetchMock = mockFetch([{ json: async () => ({}) }])
    expect(await createRunwayProvider(fetchMock).supportsCancel).toBe(true)
    await expect(createRunwayProvider(fetchMock).cancel!('t')).resolves.toBeUndefined()
  })
})

describe('ลองใหม่และหมดเวลา', () => {
  /**
   * การถามสถานะ idempotent จึงลองใหม่ได้ปลอดภัย
   * 429 คือกรณีที่ลองใหม่แล้วมีโอกาสสำเร็จจริง
   */
  it('ถามสถานะเจอ 429 แล้วสำเร็จรอบสอง ต้องผ่าน', async () => {
    const fetchMock = mockFetch([
      { ok: false, status: 429, text: async () => 'slow down' },
      { json: async () => ({ done: false }) },
    ])

    const state = await createVeoProvider(fetchMock).getStatus('operations/abc')
    expect(state.status).toBe('running')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  }, 20_000)

  /**
   * ⚠️ ข้อสำคัญที่สุดของชุดนี้ — การ "เริ่มงาน" ไม่ idempotent
   * ลองใหม่หลัง timeout อาจได้สองงานที่คิดเงินสองรอบ โดยเรารู้จัก id แค่อันเดียว
   */
  it('เริ่มงานเจอ 429 ต้องล้มทันที ห้ามลองใหม่', async () => {
    const fetchMock = mockFetch([
      { ok: false, status: 429, text: async () => 'slow down' },
      { json: async () => ({ name: 'operations/should-not-happen' }) },
    ])

    await expect(createVeoProvider(fetchMock).generate(input)).rejects.toMatchObject({
      code: 'rate_limit',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('401 ต้องล้มทันทีแม้เปิด retry — ลองใหม่ไม่ช่วย', async () => {
    const fetchMock = mockFetch([{ ok: false, status: 401, text: async () => 'bad key' }])

    await expect(createVeoProvider(fetchMock).getStatus('operations/abc')).rejects.toMatchObject({
      code: 'auth',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ผู้ให้บริการไม่ตอบ ต้องได้รหัส timeout', async () => {
    const hang = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
    }) as unknown as typeof fetch

    await expect(createVeoProvider(hang).generate(input)).rejects.toMatchObject({
      code: 'timeout',
    })
  }, 20_000)
})

describe('ถามสถานะผ่านชั้นกลาง', () => {
  /** เจ้าที่ถอดคีย์ออกไปแล้ว ต้องรายงานเป็นความล้มเหลวที่อธิบายได้ ไม่ใช่ throw ดิบ */
  it('เจ้าที่ยังไม่ได้ตั้งคีย์ ต้องคืนสถานะล้มเหลวที่บอกสาเหตุ', async () => {
    delete process.env.RUNWAY_API_KEY

    const state = await checkGeneration('runway', 'task-1')
    expect(state.status).toBe('failed')
    expect(state.errorMessage).toMatch(/runway/)
  })
})
