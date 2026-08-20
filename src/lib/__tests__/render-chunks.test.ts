import { describe, expect, it } from 'vitest'
import { CHUNK_TARGET_SECONDS, concatListFile, planChunks } from '@/lib/render-chunks'

// planChunks รับความยาวของ "ช็อต" ไม่ใช่ของฉาก — รอยต่อของช่วงจะได้ตรงกับจุดเปลี่ยนภาพ
describe('planChunks', () => {
  it('คลิปสั้นกว่าเป้าต้องได้ช่วงเดียว — ไม่ต้องต่อไฟล์โดยไม่จำเป็น', () => {
    const chunks = planChunks([10, 10, 10], 360)
    expect(chunks).toEqual([{ start: 0, end: 3, seconds: 30 }])
  })

  it('ต้องปิดช่วงก่อนเกินเป้า ไม่ใช่หลังเกิน', () => {
    // 100+100+100 = 300 พอดี · ช็อตที่สี่จะทำให้เป็น 400 จึงต้องขึ้นช่วงใหม่
    const chunks = planChunks([100, 100, 100, 100], 300)
    expect(chunks).toEqual([
      { start: 0, end: 3, seconds: 300 },
      { start: 3, end: 4, seconds: 100 },
    ])
  })

  /**
   * ตัดกลางช็อตไม่ได้ — ภาพใบเดียวจะถูกแบ่งเป็นสองไฟล์ แล้ว Ken Burns เริ่มใหม่
   * ตรงรอยต่อ เห็นเป็นภาพกระตุกรีเซ็ต · ช็อตยาวเกินเป้าจึงต้องได้อยู่ช่วงของตัวเอง
   */
  it('ช็อตที่ยาวเกินเป้าต้องอยู่ครบในช่วงเดียว ไม่ถูกหั่น', () => {
    const chunks = planChunks([500], 300)
    expect(chunks).toEqual([{ start: 0, end: 1, seconds: 500 }])
  })

  it('ทุกช็อตต้องถูกนับ ไม่มีตกหล่นและไม่ซ้ำ', () => {
    const durations = Array.from({ length: 187 }, (_, i) => 8 + (i % 13))
    const chunks = planChunks(durations, CHUNK_TARGET_SECONDS)

    expect(chunks[0].start).toBe(0)
    expect(chunks[chunks.length - 1].end).toBe(durations.length)
    chunks.forEach((chunk, i) => {
      if (i > 0) expect(chunk.start).toBe(chunks[i - 1].end)
      expect(chunk.end).toBeGreaterThan(chunk.start)
    })

    const total = chunks.reduce((sum, c) => sum + c.seconds, 0)
    expect(total).toBeCloseTo(durations.reduce((a, b) => a + b, 0), 3)
  })

  /** คลิป 45 นาทีต้องถูกแบ่งจริง ไม่ใช่หลุดออกมาเป็นก้อนเดียวแล้วไป timeout ทีหลัง */
  it('คลิป 45 นาทีต้องแบ่งได้หลายช่วง และไม่มีช่วงไหนเกินเพดาน worker', () => {
    // 45 ช็อต ช็อตละ 60 วินาที = 45 นาที
    const durations = Array.from({ length: 45 }, () => 60)
    const chunks = planChunks(durations)

    expect(chunks.length).toBeGreaterThan(6)
    chunks.forEach((chunk) => expect(chunk.seconds).toBeLessThanOrEqual(CHUNK_TARGET_SECONDS))
  })

  it('ไม่มีช็อตเลยต้องได้ช่วงว่าง ไม่ใช่ช่วงที่ไม่มีอะไร', () => {
    expect(planChunks([])).toEqual([])
  })
})

describe('concatListFile', () => {
  it('ต้องได้บรรทัดละไฟล์ในรูปแบบที่ concat demuxer อ่านได้', () => {
    expect(concatListFile(['/tmp/a.mp4', '/tmp/b.mp4'])).toBe(
      "file '/tmp/a.mp4'\nfile '/tmp/b.mp4'\n",
    )
  })

  /**
   * demuxer ตัวนี้ไม่ได้ใช้ backslash escape แบบเชลล์ — ต้องปิดวงแล้วใส่ '\'' แล้วเปิดใหม่
   * เขียนเป็น \' เฉย ๆ จะได้ชื่อไฟล์ผิดโดยไม่มี error ให้เห็น
   */
  it("ชื่อไฟล์ที่มี ' ต้องปิดวงแล้วเปิดใหม่ ไม่ใช่ backslash escape", () => {
    expect(concatListFile(["/tmp/it's.mp4"])).toBe("file '/tmp/it'\\''s.mp4'\n")
  })
})
