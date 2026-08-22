import { beforeEach, describe, expect, it, vi } from 'vitest'
import { videoPlan } from '../../../worker/handlers/video-plan'
import type { WorkerClient } from '../../../worker/supabase'

/**
 * ปลอมเฉพาะชั้นเรียกโมเดล ไม่ปลอม director
 *
 * ปลอม runDirector ทั้งตัวจะทำให้เทสต์นี้ผ่านแม้ parsePlan หรือ planProblems พัง
 * ซึ่งเป็นสองอย่างที่ handler พึ่งอยู่จริง — ปลอมให้ตื้นที่สุดเท่าที่ทำได้
 */
const completeMock = vi.fn()
vi.mock('@/lib/llm', () => ({
  complete: (...args: unknown[]) => completeMock(...args),
}))

const PROJECT = {
  id: 'proj-1',
  org_id: 'org-1',
  title: 'โฆษณาคอร์ส ISO 9001',
  objective: 'หาลูกค้าโรงงาน SME ที่กำลังจะทำ ISO',
  audience: 'เจ้าของโรงงานในชลบุรี',
  platform: 'youtube_shorts',
  aspect_ratio: '9:16' as const,
  status: 'draft',
}

const PLAN = {
  icp: 'เจ้าของโรงงานฉีดพลาสติกที่ลูกค้ารายใหญ่เพิ่งขอใบเซอร์',
  pain: 'กลัวเสียลูกค้ารายใหญ่',
  promise: 'รู้ว่าเริ่มยังไง',
  hook: 'ลูกค้าขอใบเซอร์ เหลือเวลากี่เดือน',
  script: 'โรงงานส่วนใหญ่เริ่มไม่ถูก เพราะคิดว่าต้องหยุดไลน์ก่อน',
  cta: 'ทักมาคุยก่อนได้',
  storyboard: [
    { shot: 1, seconds: 6, prompt: 'Wide shot of a factory floor', voiceover: 'สั้น ๆ' },
    { shot: 2, seconds: 7, prompt: 'Close up on hands', voiceover: 'ต่ออีกนิด' },
    { shot: 3, seconds: 7, prompt: 'Owner smiling', voiceover: 'ปิดท้าย' },
  ],
}

function fakeDb(options: { project?: Record<string, unknown> | null; hasPlan?: boolean } = {}) {
  const inserts: Record<string, unknown>[] = []
  const updates: Record<string, unknown>[] = []

  const db = {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                single: async () => ({
                  // ?? ใช้ไม่ได้ตรงนี้ — เทสต์ "ไม่พบโปรเจค" ส่ง null มาโดยตั้งใจ
                  data:
                    table === 'video_projects'
                      ? 'project' in options
                        ? options.project
                        : PROJECT
                      : null,
                }),
                limit: () => ({
                  maybeSingle: async () => ({ data: options.hasPlan ? { id: 'script-1' } : null }),
                }),
              }
            },
          }
        },
        insert: async (values: Record<string, unknown>) => {
          inserts.push({ table, ...values })
          return { error: null }
        },
        update(values: Record<string, unknown>) {
          updates.push({ table, ...values })
          return { eq: async () => ({ error: null }) }
        },
      }
    },
  } as unknown as WorkerClient

  return { db, inserts, updates }
}

beforeEach(() => {
  completeMock.mockReset()
  completeMock.mockResolvedValue(JSON.stringify(PLAN))
})

describe('videoPlan', () => {
  it('ไม่พบโปรเจคต้องล้ม ไม่ใช่เงียบ', async () => {
    const { db } = fakeDb({ project: null })
    await expect(videoPlan(db, { project_id: 'ไม่มีจริง' })).rejects.toThrow(/ไม่พบ/)
  })

  /**
   * งานหนึ่งชิ้น retry ได้ถึง 3 ครั้ง · เรียกโมเดลซ้ำนอกจากเสียเงินแล้ว
   * ยังได้แผนคนละอันกับที่ผู้ใช้เห็นไปแล้ว ซึ่งสับสนกว่าไม่ทำอะไรเลย
   */
  it('มีแผนแล้วต้องข้าม ไม่เรียกโมเดลซ้ำ', async () => {
    const { db, inserts } = fakeDb({ hasPlan: true })

    await videoPlan(db, { project_id: 'proj-1' })

    expect(completeMock).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
  })

  it('วางแผนเสร็จต้องบันทึกบทและสตอรีบอร์ด แล้วเลื่อนสถานะโปรเจค', async () => {
    const { db, inserts, updates } = fakeDb()

    await videoPlan(db, { project_id: 'proj-1' })

    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({
      table: 'video_scripts',
      project_id: 'proj-1',
      org_id: 'org-1',
      hook: PLAN.hook,
      cta: PLAN.cta,
    })
    expect((inserts[0].storyboard as unknown[]).length).toBe(3)
    expect(updates.at(-1)).toMatchObject({ table: 'video_projects', status: 'scripted' })
  })

  /** ทิ้งไปแล้วรอบหน้าที่มีคนแก้บท เขาจะแก้โดยไม่รู้ว่ากำลังพูดกับใคร */
  it('บทที่บันทึกต้องมี ICP กับความเจ็บติดไปด้วย', async () => {
    const { db, inserts } = fakeDb()

    await videoPlan(db, { project_id: 'proj-1' })

    expect(String(inserts[0].script)).toContain(PLAN.icp)
    expect(String(inserts[0].script)).toContain(PLAN.pain)
    expect(String(inserts[0].script)).toContain(PLAN.script)
  })

  it('โน้ตของผู้ใช้ต้องถูกเก็บไว้กับบท', async () => {
    const { db, inserts } = fakeDb()

    await videoPlan(db, { project_id: 'proj-1', notes: 'ไม่ต้องพูดถึงราคา' })

    expect(String(inserts[0].script)).toContain('ไม่ต้องพูดถึงราคา')
  })

  /**
   * แผนที่มีปัญหาไม่ถูกทิ้ง — เงินจ่ายให้โมเดลไปแล้ว และแผนยังมีค่าให้คนแก้ต่อ
   * หน้าเว็บเป็นคนแสดงคำเตือน (คำนวณใหม่จากแถวที่บันทึกไว้)
   */
  it('แผนที่มีตัวเลขไม่มีที่มา ต้องยังถูกบันทึก ไม่ใช่โยนทิ้ง', async () => {
    completeMock.mockResolvedValue(JSON.stringify({ ...PLAN, hook: 'ลดต้นทุนได้ 87% แน่นอน' }))
    const { db, inserts, updates } = fakeDb()

    await videoPlan(db, { project_id: 'proj-1' })

    expect(inserts).toHaveLength(1)
    expect(updates.at(-1)).toMatchObject({ status: 'scripted' })
  })

  it('ไม่มีเป้าหมายธุรกิจต้องล้มก่อนเรียกโมเดล', async () => {
    const { db } = fakeDb({ project: { ...PROJECT, objective: null } })

    await expect(videoPlan(db, { project_id: 'proj-1' })).rejects.toThrow(/เป้าหมาย/)
    expect(completeMock).not.toHaveBeenCalled()
  })
})
