import { describe, expect, it } from 'vitest'
import { buildRenderPlan, kenBurnsFor, CROSSFADE_SECONDS } from '@/lib/render-plan'
import { splitIntoScenes } from '@/lib/scenes'

const scenes = splitIntoScenes('ฉากหนึ่งเล่าปัญหา\nฉากสองเล่าสาเหตุ\nฉากสามสรุปทางออก', {
  targetChars: 10,
  maxChars: 20,
})

const durations = [4, 6, 5]
const images = ['a.jpg', 'b.jpg', 'c.jpg']
const audios = ['a.mp3', 'b.mp3', 'c.mp3']

function plan(overrides: Partial<Parameters<typeof buildRenderPlan>[0]> = {}) {
  return buildRenderPlan({
    scenes,
    durationsSec: durations,
    imagePaths: images,
    audioPaths: audios,
    ...overrides,
  })
}

describe('buildRenderPlan', () => {
  it('ความยาวรวมเท่ากับผลรวมของเสียง ไม่ใช่ค่าประมาณจากตัวอักษร', () => {
    expect(scenes).toHaveLength(3)
    expect(plan().totalSeconds).toBe(15)
  })

  it('เสียงต่อกันไม่มีช่องว่างและไม่ทับกัน', () => {
    const { audio } = plan()
    expect(audio.map((a) => a.startSec)).toEqual([0, 4, 10])
    expect(audio.at(-1)!.startSec + audio.at(-1)!.durationSec).toBe(15)
  })

  it('ภาพทุกใบยาวคลุมเสียงของตัวเอง + หางไว้ให้ฉากถัดไปเฟดทับ', () => {
    const { clips } = plan()
    expect(clips[0].endSec).toBe(4 + CROSSFADE_SECONDS)
    expect(clips[1].endSec).toBe(10 + CROSSFADE_SECONDS)
  })

  it('ฉากสุดท้ายไม่มีหางเฟด เพราะไม่มีอะไรมาทับ', () => {
    const { clips, totalSeconds } = plan()
    expect(clips.at(-1)!.endSec).toBe(totalSeconds)
  })

  it('ภาพคลุมไทม์ไลน์ต่อเนื่อง ไม่มีช่วงที่จอว่าง', () => {
    const { clips, totalSeconds } = plan()
    for (let i = 1; i < clips.length; i++) {
      expect(clips[i].startSec).toBeLessThanOrEqual(clips[i - 1].endSec)
    }
    expect(clips[0].startSec).toBe(0)
    expect(Math.max(...clips.map((c) => c.endSec))).toBe(totalSeconds)
  })

  it('ซับไตเติลอยู่ในช่วงคลิปทั้งหมด', () => {
    const { subtitles, totalSeconds } = plan()
    expect(subtitles.length).toBeGreaterThan(0)
    expect(subtitles[0].start).toBe(0)
    expect(subtitles.at(-1)!.end).toBe(totalSeconds)
  })

  it('จำนวนภาพหรือเสียงไม่ตรงกับฉาก ต้อง throw ไม่ใช่เงียบแล้วได้คลิปเพี้ยน', () => {
    expect(() => plan({ imagePaths: ['a.jpg'] })).toThrow(/จำนวนภาพ/)
    expect(() => plan({ audioPaths: ['a.mp3'] })).toThrow(/จำนวนไฟล์เสียง/)
    expect(() => plan({ durationsSec: [4] })).toThrow(/ความยาวเสียง/)
  })

  it('ความยาวเสียงเป็น 0 หรือติดลบต้อง throw', () => {
    expect(() => plan({ durationsSec: [4, 0, 5] })).toThrow(/มากกว่า 0/)
    expect(() => plan({ durationsSec: [4, -1, 5] })).toThrow(/มากกว่า 0/)
  })

  it('ไม่มีฉากเลยต้อง throw', () => {
    expect(() =>
      buildRenderPlan({ scenes: [], durationsSec: [], imagePaths: [], audioPaths: [] }),
    ).toThrow(/ไม่มีฉาก/)
  })
})

describe('buildRenderPlan — ภาพหนึ่งใบครอบหลายฉาก', () => {
  /**
   * หัวใจของการแยกจังหวะภาพออกจากจังหวะเสียง:
   * เสียงยังเป็นท่อนละฉากเหมือนเดิม แต่ภาพยืดคลุมทุกฉากในช็อต
   */
  it('ภาพต้องยืดคลุมทุกฉากในช็อต ส่วนเสียงยังเป็นท่อนละฉาก', () => {
    const result = plan({ imagePaths: ['a.jpg'], sceneCounts: [3] })

    expect(result.clips).toHaveLength(1)
    expect(result.audio).toHaveLength(3)
    // ฉาก 4+6+5 = 15 วินาที · ช็อตเดียวไม่มีหางเฟดเพราะไม่มีช็อตถัดไป
    expect(result.clips[0].startSec).toBe(0)
    expect(result.clips[0].endSec).toBe(15)
    expect(result.totalSeconds).toBe(15)
  })

  it('ช็อตถัดไปต้องเริ่มตรงที่ช็อตก่อนหน้าจบ และช็อตแรกมีหางไว้ให้เฟดทับ', () => {
    const result = plan({ imagePaths: ['a.jpg', 'b.jpg'], sceneCounts: [2, 1] })

    expect(result.clips[0].startSec).toBe(0)
    expect(result.clips[0].endSec).toBe(10 + CROSSFADE_SECONDS) // 4+6 บวกหาง
    expect(result.clips[1].startSec).toBe(10)
    expect(result.clips[1].endSec).toBe(15) // ช็อตสุดท้ายไม่มีหาง
    expect(result.totalSeconds).toBe(15)
  })

  it('ซับยังนับตามฉาก ไม่ใช่ตามภาพ — คนอ่านซับตามที่พูด ไม่ใช่ตามที่ภาพเปลี่ยน', () => {
    const result = plan({ imagePaths: ['a.jpg'], sceneCounts: [3] })
    expect(result.subtitles.length).toBeGreaterThanOrEqual(3)
  })

  /**
   * ผลรวมต้องเท่ากับจำนวนฉากพอดี ไม่ใช่แค่ "ไม่เกิน"
   * ขาดไปหนึ่ง = ฉากท้ายไม่มีภาพคลุม คลิปจบด้วยจอดำที่ยังมีเสียงพูดอยู่
   */
  it('ช็อตครอบฉากไม่ครบต้องล้ม ไม่ใช่ปล่อยให้ฉากท้ายไม่มีภาพ', () => {
    expect(() => plan({ imagePaths: ['a.jpg'], sceneCounts: [2] })).toThrow(/ครอบ 2 ฉาก/)
    expect(() => plan({ imagePaths: ['a.jpg'], sceneCounts: [4] })).toThrow(/ครอบ 4 ฉาก/)
  })

  it('จำนวนภาพไม่ตรงกับจำนวนช็อตต้องล้ม', () => {
    expect(() => plan({ imagePaths: ['a.jpg'], sceneCounts: [1, 2] })).toThrow(/ไม่ตรงกับจำนวนภาพ/)
  })

  it('ไม่ระบุ sceneCounts ต้องได้ภาพต่อฉากเหมือนเดิม', () => {
    const result = plan()
    expect(result.clips).toHaveLength(scenes.length)
    expect(result.clips.map((c) => c.imagePath)).toEqual(images)
  })
})

describe('kenBurnsFor', () => {
  it('สลับซูมเข้าซูมออก ไม่ให้ทุกฉากขยับเหมือนกัน', () => {
    expect(kenBurnsFor(0).zoomFrom).toBeLessThan(kenBurnsFor(0).zoomTo)
    expect(kenBurnsFor(1).zoomFrom).toBeGreaterThan(kenBurnsFor(1).zoomTo)
  })

  it('ทิศเลื่อนวนสี่ทิศ', () => {
    const pans = [0, 1, 2, 3, 4].map((i) => kenBurnsFor(i).pan)
    expect(new Set(pans.slice(0, 4)).size).toBe(4)
    expect(pans[4]).toBe(pans[0])
  })

  it('ให้ผลเดิมทุกครั้งสำหรับฉากเดียวกัน — render ซ้ำต้องได้คลิปเหมือนเดิม', () => {
    expect(kenBurnsFor(7)).toEqual(kenBurnsFor(7))
  })
})
