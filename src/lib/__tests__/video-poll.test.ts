import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { videoPoll } from '../../../worker/handlers/video-poll'
import { DeferJobSignal } from '@/lib/jobs'
import type { WorkerClient } from '../../../worker/supabase'

/**
 * ตัวปลอมของ Supabase client — จำสิ่งที่ถูกเขียนไว้ให้ตรวจได้
 * เขียนเองแทนการใช้ไลบรารี mock เพราะสนใจแค่ 3 อย่าง: อ่านอะไร เขียนอะไร อัปไฟล์ไหม
 */
function fakeDb(row: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = []
  const uploads: { path: string; bytes: number }[] = []

  const db = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                single: async () => ({ data: row }),
                maybeSingle: async () => ({ data: row }),
              }
            },
          }
        },
        update(values: Record<string, unknown>) {
          updates.push(values)
          return { eq: async () => ({ error: null }) }
        },
      }
    },
    storage: {
      from() {
        return {
          upload: async (path: string, bytes: Uint8Array) => {
            uploads.push({ path, bytes: bytes.byteLength })
            return { error: null }
          },
        }
      },
    },
  } as unknown as WorkerClient

  return { db, updates, uploads }
}

const RUNNING_ROW = {
  id: 'gen-1',
  org_id: 'org-1',
  project_id: 'proj-1',
  provider: 'veo',
  provider_job_id: 'operations/abc',
  status: 'running',
  seconds: 8,
  estimated_cost_usd: 0.4,
  output_storage_path: null,
  created_at: new Date().toISOString(),
}

/** ตัวปลอมของ fetch ที่ adapter ของ Veo จะเรียก */
function stubFetch(operation: Record<string, unknown>, videoBytes = 1234) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/v.mp4')) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new ArrayBuffer(videoBytes),
        } as Response
      }
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => operation,
      } as Response
    }),
  )
}

beforeEach(() => {
  process.env.GOOGLE_AI_API_KEY = 'test-key'
})

afterEach(() => {
  delete process.env.GOOGLE_AI_API_KEY
  delete process.env.VIDEO_POLL_DEADLINE_MIN
  vi.unstubAllGlobals()
})

describe('videoPoll', () => {
  /**
   * idempotent — งาน retry ได้ถึง 3 ครั้ง ถ้าโหลดไฟล์ซ้ำทุกครั้ง
   * ก็เปลืองแบนด์วิดท์และเขียนทับไฟล์ที่ใช้ได้อยู่แล้วโดยไม่ได้อะไร
   */
  it('มีไฟล์แล้วต้องข้าม ไม่โหลดซ้ำ', async () => {
    const { db, updates, uploads } = fakeDb({
      ...RUNNING_ROW,
      output_storage_path: 'org-1/proj-1/gen-1/output.mp4',
    })

    await videoPoll(db, { generation_id: 'gen-1' })

    expect(uploads).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it('งานที่ปิดไปแล้วต้องไม่ถามต่อ', async () => {
    const { db, updates } = fakeDb({ ...RUNNING_ROW, status: 'failed' })

    await videoPoll(db, { generation_id: 'gen-1' })
    expect(updates).toHaveLength(0)
  })

  /**
   * ยังไม่จบต้องคืนงานเข้าคิว ไม่ใช่นั่งรอใน handler
   * นั่งรอ = ยึด worker ไว้ทั้งตัว งานอื่นในคิวไม่ได้เดินเลยตลอดเวลานั้น
   */
  it('ยังไม่จบต้องเลื่อนงาน ไม่ใช่รอในนี้', async () => {
    const { db, updates } = fakeDb(RUNNING_ROW)
    stubFetch({ done: false })

    await expect(videoPoll(db, { generation_id: 'gen-1' })).rejects.toBeInstanceOf(DeferJobSignal)
    expect(updates).toHaveLength(0)
  })

  it('เสร็จแล้วต้องโหลดไฟล์ เก็บขึ้น Storage แล้วบันทึกพาธ', async () => {
    const { db, updates, uploads } = fakeDb(RUNNING_ROW)
    stubFetch({
      done: true,
      response: { generatedVideos: [{ video: { uri: 'https://x/v.mp4' } }] },
    })

    await videoPoll(db, { generation_id: 'gen-1' })

    // โครงพาธต้องขึ้นต้นด้วย org_id เพราะ policy ของบัคเก็ตอ่าน org จากส่วนแรก
    expect(uploads).toHaveLength(1)
    expect(uploads[0].path).toBe('org-1/proj-1/gen-1/output.mp4')
    expect(uploads[0].bytes).toBe(1234)

    expect(updates.at(-1)).toMatchObject({
      status: 'done',
      output_storage_path: 'org-1/proj-1/gen-1/output.mp4',
      provider_output_url: 'https://x/v.mp4',
    })
  })

  it('ผู้ให้บริการแจ้งล้มเหลว ต้องบันทึกรหัสและเหตุผล', async () => {
    const { db, updates, uploads } = fakeDb(RUNNING_ROW)
    stubFetch({ done: true, error: { message: 'internal failure' } })

    await videoPoll(db, { generation_id: 'gen-1' })

    expect(uploads).toHaveLength(0)
    expect(updates.at(-1)).toMatchObject({
      status: 'failed',
      error_code: 'provider',
      error: 'internal failure',
    })
  })

  it('งานเสร็จแต่ไม่มีลิงก์ ต้องนับเป็นล้มเหลว ไม่ใช่เงียบ', async () => {
    const { db, updates, uploads } = fakeDb(RUNNING_ROW)
    stubFetch({ done: true, response: {} })

    await videoPoll(db, { generation_id: 'gen-1' })

    expect(uploads).toHaveLength(0)
    expect(updates.at(-1)).toMatchObject({ status: 'failed', error_code: 'provider' })
  })

  /**
   * ⚠️ ข้อสำคัญที่สุดของชุดนี้
   *
   * defer_job ลด attempts ลงหนึ่งทุกครั้ง การวนถามจึงไม่กินโควตา retry
   * ซึ่งแปลว่า "วนไม่รู้จบ" ได้ถ้าผู้ให้บริการค้าง — กินคำขอทุก 20 วินาที
   * ไปเรื่อย ๆ โดยไม่มีใครสังเกต ต้องมีเพดานเวลาของเราเอง
   */
  it('เกินเพดานเวลาต้องเลิกรอ ไม่ใช่วนต่อไปเรื่อย ๆ', async () => {
    process.env.VIDEO_POLL_DEADLINE_MIN = '5'

    const { db, updates } = fakeDb({
      ...RUNNING_ROW,
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    })
    stubFetch({ done: false })

    await videoPoll(db, { generation_id: 'gen-1' })

    expect(updates.at(-1)).toMatchObject({ status: 'failed', error_code: 'timeout' })
  })

  /**
   * ผู้ใช้ที่เห็นแค่ "ไม่สำเร็จ" จะเข้าใจว่าไม่ถูกคิดเงิน ซึ่งไม่จริง
   * งานถูกส่งไปแล้ว เงินอาจออกไปแล้ว ต้องบอกให้ชัด
   */
  it('ข้อความตอนหมดเวลาต้องบอกว่าเงินอาจออกไปแล้ว', async () => {
    process.env.VIDEO_POLL_DEADLINE_MIN = '5'

    const { db, updates } = fakeDb({
      ...RUNNING_ROW,
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    })
    stubFetch({ done: false })

    await videoPoll(db, { generation_id: 'gen-1' })

    expect(String(updates.at(-1)?.error)).toMatch(/คิดเงิน/)
  })

  it('ไม่พบงานต้องล้ม ไม่ใช่เงียบ', async () => {
    const { db } = fakeDb(null)
    await expect(videoPoll(db, { generation_id: 'ไม่มีจริง' })).rejects.toThrow(/ไม่พบ/)
  })
})
