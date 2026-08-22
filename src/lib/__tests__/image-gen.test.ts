import { describe, expect, it, vi } from 'vitest'
import { generateImage, imageCostUsd, imageSize, ImageGenError } from '@/lib/image-gen'

const PNG_B64 = Buffer.from('fake-png-bytes').toString('base64')

function fakeFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({ data: [{ b64_json: PNG_B64 }] }),
    ...response,
  }) as unknown as typeof fetch
}

describe('imageSize', () => {
  /**
   * ข้อบังคับของ API: ด้านละเป็นจำนวนเท่าของ 16 · ด้านยาวสุดไม่เกิน 3840 ·
   * พิกเซลรวม 655,360–8,294,400 · ผิดข้อใดข้อหนึ่ง API ปฏิเสธทั้งคำขอ
   */
  it('ขนาดที่ขอต้องผ่านข้อบังคับของ API ทุกข้อ', () => {
    for (const orientation of ['landscape', 'portrait'] as const) {
      const [w, h] = imageSize(orientation).split('x').map(Number)
      expect(w % 16).toBe(0)
      expect(h % 16).toBe(0)
      expect(Math.max(w, h)).toBeLessThanOrEqual(3840)
      expect(w * h).toBeGreaterThanOrEqual(655_360)
      expect(w * h).toBeLessThanOrEqual(8_294_400)
    }
  })

  /**
   * ต้องใหญ่กว่าเฟรมปลายทาง ไม่งั้น Ken Burns ซูมเข้าแล้วเบลอ
   * และ pickPhoto ฝั่ง Pexels ก็ใช้เกณฑ์เดียวกันนี้อยู่แล้ว
   */
  it('ต้องใหญ่กว่าเฟรม 1920x1080 / 1080x1920 และได้สัดส่วนตรงเป๊ะ', () => {
    const [lw, lh] = imageSize('landscape').split('x').map(Number)
    expect(lw).toBeGreaterThanOrEqual(1920)
    expect(lh).toBeGreaterThanOrEqual(1080)
    expect(lw / lh).toBeCloseTo(16 / 9, 5)

    const [pw, ph] = imageSize('portrait').split('x').map(Number)
    expect(pw).toBeGreaterThanOrEqual(1080)
    expect(ph).toBeGreaterThanOrEqual(1920)
    expect(pw / ph).toBeCloseTo(9 / 16, 5)
  })
})

describe('imageCostUsd', () => {
  it('คิดตามจำนวนภาพและคุณภาพ', () => {
    expect(imageCostUsd(45, 'low')).toBeCloseTo(0.9, 3)
    expect(imageCostUsd(45, 'medium')).toBeCloseTo(3.15, 3)
    expect(imageCostUsd(45, 'high')).toBeCloseTo(8.55, 3)
  })

  it('ไม่มีภาพก็ไม่มีค่าใช้จ่าย', () => {
    expect(imageCostUsd(0)).toBe(0)
  })
})

describe('generateImage', () => {
  it('ส่งโมเดล ขนาด และคุณภาพไปให้ถูก แล้วคืนไบต์ของภาพ', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    const fetchMock = fakeFetch({})

    const bytes = await generateImage('a quiet empty coffee shop, no text', {
      orientation: 'landscape',
    }, fetchMock)

    expect(bytes.toString()).toBe('fake-png-bytes')

    const body = JSON.parse((fetchMock as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0][1].body as string)
    expect(body.size).toBe('2048x1152')
    expect(body.response_format).toBe('b64_json')
    expect(body.n).toBe(1)
  })

  /**
   * ตอบ 200 แต่ไม่มีภาพมาด้วยได้ (บางรุ่นคืน url แทนเมื่อไม่รองรับ response_format)
   * ปล่อยผ่านจะได้ไฟล์ 0 ไบต์แล้วไปพังตอน ffmpeg ซึ่งไล่ย้อนกลับมาหาสาเหตุยากกว่ามาก
   */
  it('ตอบสำเร็จแต่ไม่มีภาพ ต้องล้มทันทีตรงนี้ ไม่ใช่ไปพังตอนเรนเดอร์', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    const fetchMock = fakeFetch({ json: async () => ({ data: [{ url: 'https://…' }] }) })

    await expect(
      generateImage('x', { orientation: 'landscape' }, fetchMock),
    ).rejects.toThrow(/b64_json/)
  })

  it('API ปฏิเสธต้องได้ error ที่บอกสถานะและเหตุผล', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    const fetchMock = fakeFetch({ ok: false, status: 400, text: async () => 'invalid size' })

    await expect(
      generateImage('x', { orientation: 'portrait' }, fetchMock),
    ).rejects.toThrow(ImageGenError)
  })

  it('prompt ว่างต้องไม่ยิงเน็ตเลย — เสียเงินฟรีและได้ภาพมั่ว', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    const fetchMock = fakeFetch({})

    await expect(generateImage('   ', { orientation: 'landscape' }, fetchMock)).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
