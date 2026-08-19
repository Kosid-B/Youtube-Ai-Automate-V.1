import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { track, trackBatch } from '@/lib/analytics'

function okFetch() {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }))
}

function bodyOf(mock: ReturnType<typeof okFetch>) {
  return JSON.parse(String(mock.mock.calls[0][1]?.body))
}

describe('track', () => {
  beforeEach(() => vi.stubEnv('AMPLITUDE_API_KEY', 'test-key'))
  afterEach(() => vi.unstubAllEnvs())

  it('ไม่มีคีย์ = ไม่ยิงอะไรเลย ไม่ใช่ยิงแล้วพัง', async () => {
    vi.stubEnv('AMPLITUDE_API_KEY', '')
    const f = okFetch()
    await track('render_completed', 'org-1', {}, f as unknown as typeof fetch)
    expect(f).not.toHaveBeenCalled()
  })

  it('ติดป้าย product ทุกอีเวนต์ ไม่งั้นปนกับผลิตภัณฑ์อื่นใน project เดียวกัน', async () => {
    const f = okFetch()
    await track('render_completed', 'org-1', { scenes: 8 }, f as unknown as typeof fetch)
    expect(bodyOf(f).events[0].event_properties.product).toBe('yt-factory')
    expect(bodyOf(f).events[0].event_properties.scenes).toBe(8)
  })

  it('ใช้ org id เป็น user id — ระบบนี้ทำงานโดยไม่มีคนนั่งดู', async () => {
    const f = okFetch()
    await track('render_started', 'org-abc', {}, f as unknown as typeof fetch)
    expect(bodyOf(f).events[0].user_id).toBe('org-abc')
  })

  /**
   * ข้อนี้สำคัญที่สุด — การวัดผลล้มต้องไม่ทำให้คลิปเรนเดอร์ไม่สำเร็จ
   * ถ้า track โยน error ขึ้นไป มันจะไปโผล่เป็น job failed แล้วเสียเครดิตฟรี
   */
  it('เน็ตล่มต้องกลืน error ไม่ใช่โยนขึ้นไปทำให้งานหลักพัง', async () => {
    const f = vi.fn(async () => {
      throw new Error('network down')
    })
    await expect(
      track('render_completed', 'org-1', {}, f as unknown as typeof fetch),
    ).resolves.toBeUndefined()
  })
})

describe('trackBatch', () => {
  beforeEach(() => vi.stubEnv('AMPLITUDE_API_KEY', 'test-key'))
  afterEach(() => vi.unstubAllEnvs())

  it('รวมหลายอีเวนต์เป็นคำขอเดียว ไม่ยิงทีละตัว', async () => {
    const f = okFetch()
    await trackBatch(
      [
        { event: 'video_metrics_synced', orgId: 'o', props: { views: 100 } },
        { event: 'video_metrics_synced', orgId: 'o', props: { views: 200 } },
      ],
      f as unknown as typeof fetch,
    )
    expect(f).toHaveBeenCalledTimes(1)
    expect(bodyOf(f).events).toHaveLength(2)
  })

  it('รายการว่างต้องไม่ยิง', async () => {
    const f = okFetch()
    await trackBatch([], f as unknown as typeof fetch)
    expect(f).not.toHaveBeenCalled()
  })
})
