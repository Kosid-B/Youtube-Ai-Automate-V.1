import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PexelsRateLimitError,
  creditBlock,
  creditLine,
  downloadUrl,
  pickPhoto,
  searchPhotos,
  type PexelsPhoto,
} from '@/lib/pexels'

function photo(overrides: Partial<PexelsPhoto> = {}): PexelsPhoto {
  return {
    id: 1,
    width: 4000,
    height: 2667,
    url: 'https://www.pexels.com/photo/example-1/',
    photographer: 'สมชาย ใจดี',
    photographer_url: 'https://www.pexels.com/@somchai',
    alt: 'coffee shop',
    src: {
      original: 'https://images.pexels.com/photos/1/original.jpg',
      large2x: 'https://images.pexels.com/photos/1/large2x.jpg',
      large: 'https://images.pexels.com/photos/1/large.jpg',
      medium: 'https://images.pexels.com/photos/1/medium.jpg',
    },
    ...overrides,
  }
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers })
}

describe('searchPhotos', () => {
  beforeEach(() => {
    vi.stubEnv('PEXELS_API_KEY', 'test-key')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('ขอภาพแนวนอนขนาดใหญ่เป็นค่าเริ่มต้น เพราะคลิปเป็น 16:9 และต้องซูมได้', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ photos: [photo()] }),
    )
    await searchPhotos('coffee shop', {}, fetchMock as unknown as typeof fetch)

    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.searchParams.get('orientation')).toBe('landscape')
    expect(url.searchParams.get('size')).toBe('large')
    expect(url.searchParams.get('query')).toBe('coffee shop')
  })

  it('ส่ง API key ทาง header Authorization', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ photos: [] }),
    )
    await searchPhotos('x', {}, fetchMock as unknown as typeof fetch)

    const init = fetchMock.mock.calls[0][1]
    expect((init?.headers as Record<string, string>).Authorization).toBe('test-key')
  })

  it('อ่านโควตาที่เหลือจาก header', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ photos: [] }, { 'X-Ratelimit-Remaining': '178' }),
    )
    const result = await searchPhotos('x', {}, fetchMock as unknown as typeof fetch)
    expect(result.remaining).toBe(178)
  })

  it('โควตาเต็ม (429) โยน error ที่บอกเวลารีเซ็ต ไม่ใช่ error ทั่วไป', async () => {
    const reset = Math.floor(Date.now() / 1000) + 600
    const fetchMock = vi.fn(
      async () => new Response('', { status: 429, headers: { 'X-Ratelimit-Reset': String(reset) } }),
    )

    await expect(searchPhotos('x', {}, fetchMock as unknown as typeof fetch)).rejects.toThrow(
      PexelsRateLimitError,
    )
  })

  it('คำค้นว่างต้อง throw ก่อนยิง API ไม่เผาโควตาทิ้ง', async () => {
    const fetchMock = vi.fn()
    await expect(searchPhotos('   ', {}, fetchMock as unknown as typeof fetch)).rejects.toThrow(
      /คำค้นว่าง/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ไม่มี PEXELS_API_KEY ต้องบอกให้ชัด', async () => {
    vi.stubEnv('PEXELS_API_KEY', '')
    await expect(searchPhotos('x', {}, vi.fn() as unknown as typeof fetch)).rejects.toThrow(
      /PEXELS_API_KEY/,
    )
  })
})

describe('pickPhoto', () => {
  it('ข้ามภาพที่เล็กกว่าเฟรม เพราะซูมแล้วเบลอ', () => {
    const chosen = pickPhoto([photo({ id: 1, width: 1200 }), photo({ id: 2, width: 3000 })])
    expect(chosen?.id).toBe(2)
  })

  it('ไม่หยิบภาพที่ใช้ไปแล้วในคลิปเดียวกัน', () => {
    const chosen = pickPhoto([photo({ id: 1 }), photo({ id: 2 })], { usedIds: new Set([1]) })
    expect(chosen?.id).toBe(2)
  })

  it('คงลำดับความเกี่ยวข้องของ Pexels ไว้ ไม่เรียงใหม่เอง', () => {
    const chosen = pickPhoto([photo({ id: 7 }), photo({ id: 8 })])
    expect(chosen?.id).toBe(7)
  })

  it('ไม่มีภาพไหนผ่านเกณฑ์ต้องคืน null ไม่ใช่ยัดภาพเบลอมาให้', () => {
    expect(pickPhoto([photo({ width: 800 })])).toBeNull()
    expect(pickPhoto([])).toBeNull()
  })
})

describe('เครดิตช่างภาพ', () => {
  it('รูปแบบตรงกับที่แจ้ง Pexels ไว้ตอนขอ key', () => {
    expect(creditLine({ photographer: 'Jane Doe', sourceUrl: 'https://p/1' })).toBe(
      'Photo by Jane Doe on Pexels: https://p/1',
    )
  })

  it('ตัดภาพซ้ำออก แต่คงลิงก์แยกทุกภาพที่ต่างกัน', () => {
    const block = creditBlock([
      { photographer: 'A', sourceUrl: 'https://p/1' },
      { photographer: 'A', sourceUrl: 'https://p/1' },
      { photographer: 'A', sourceUrl: 'https://p/2' },
    ])
    expect(block.split('\n')).toHaveLength(3)
    expect(block).toContain('https://p/1')
    expect(block).toContain('https://p/2')
  })

  it('ไม่มีภาพเลยได้สตริงว่าง ไม่ใช่หัวข้อลอย ๆ ในคำอธิบายคลิป', () => {
    expect(creditBlock([])).toBe('')
  })
})

describe('downloadUrl', () => {
  it('ใช้ large2x เพราะกว้างพอสำหรับเฟรม 1080p โดยไม่ต้องโหลดไฟล์ต้นฉบับเต็ม', () => {
    expect(downloadUrl(photo())).toContain('large2x')
  })

  it('ไม่มี large2x ให้ใช้ไฟล์ต้นฉบับแทน', () => {
    const p = photo()
    p.src.large2x = ''
    expect(downloadUrl(p)).toContain('original')
  })
})

describe('pickPhoto — เกณฑ์ขนาดสำหรับคลิปแนวตั้ง', () => {
  function portrait(id: number, width: number, height: number): PexelsPhoto {
    return photo({ id, width, height })
  }

  it('เกณฑ์ความสูงต้องคัดภาพเตี้ยเกินออก แม้จะกว้างพอ', () => {
    const chosen = pickPhoto([portrait(1, 1200, 800), portrait(2, 1200, 2000)], {
      minWidth: 1080,
      minHeight: 1920,
    })
    expect(chosen?.id).toBe(2)
  })

  it('ภาพแนวตั้ง 1080x1920 ต้องผ่านเกณฑ์ของคลิปสั้น (เดิมโดนคัดทิ้งเพราะกว้างไม่ถึง 1920)', () => {
    const chosen = pickPhoto([portrait(9, 1080, 1920)], { minWidth: 1080, minHeight: 1920 })
    expect(chosen?.id).toBe(9)
  })
})
