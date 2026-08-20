import type { Scene } from '@/lib/scenes'
import { buildCues, type Cue } from '@/lib/subtitles'

/**
 * แผนการประกอบคลิป — ไม่ผูกกับโปรแกรมตัดต่อตัวไหน
 *
 * ตัวแปลงปลายทาง (ffmpeg, ไฟล์ draft ของ CapCut, หรืออย่างอื่นในอนาคต)
 * รับแผนนี้ไปแปลเป็นคำสั่งของตัวเอง ตรรกะการวางไทม์ไลน์อยู่ที่นี่ที่เดียว
 * ไม่ต้องเขียนซ้ำทุกครั้งที่เพิ่มปลายทางใหม่
 */

export const DEFAULT_CANVAS = { width: 1920, height: 1080, fps: 30 } as const

/** ระยะเวลาที่ภาพสองใบซ้อนกันตอนเปลี่ยนฉาก */
export const CROSSFADE_SECONDS = 0.5

export type KenBurns = {
  /** ขนาดเริ่มต้นและปลายทาง 1 = เต็มเฟรมพอดี */
  zoomFrom: number
  zoomTo: number
  /** ทิศที่ภาพเลื่อนไป — ให้แต่ละฉากไม่ซ้ำกันจนดูน่าเบื่อ */
  pan: 'left' | 'right' | 'up' | 'down'
}

export type PlanClip = {
  /** ฉากแรกที่ช็อตนี้ครอบ — ใช้เลือกทิศ Ken Burns ให้ไม่ซ้ำกัน */
  sceneIndex: number
  imagePath: string
  startSec: number
  endSec: number
  kenBurns: KenBurns
}

export type PlanAudio = {
  sceneIndex: number
  audioPath: string
  startSec: number
  durationSec: number
}

export type RenderPlan = {
  canvas: { width: number; height: number; fps: number }
  totalSeconds: number
  clips: PlanClip[]
  audio: PlanAudio[]
  subtitles: Cue[]
  crossfadeSeconds: number
}

export type BuildPlanInput = {
  scenes: Scene[]
  /** ความยาวเสียงจริงของแต่ละฉาก (วินาที) — ไม่ใช่ค่าประมาณ */
  durationsSec: number[]
  /**
   * ไฟล์ภาพ — หนึ่งใบต่อ "ช็อต" ไม่ใช่ต่อฉาก
   * ไม่ส่ง sceneCounts มาด้วย = ช็อตละฉาก (พฤติกรรมเดิม)
   */
  imagePaths: string[]
  /**
   * จำนวนฉากที่แต่ละช็อตครอบ เรียงตามลำดับช็อต
   *
   * แยกภาพออกจากฉากเพราะจังหวะภาพกับจังหวะเสียงคนละจังหวะกัน —
   * เสียงกับซับเปลี่ยนทุกไม่กี่วินาที ส่วนภาพค้างได้เป็นนาที (ดู lib/shots.ts)
   */
  sceneCounts?: number[]
  /** ไฟล์เสียงของแต่ละฉาก เรียงตามลำดับฉาก */
  audioPaths: string[]
  canvas?: { width: number; height: number; fps: number }
  crossfadeSeconds?: number
}

const PAN_CYCLE: KenBurns['pan'][] = ['right', 'up', 'left', 'down']

/**
 * ภาพนิ่งที่ค้างเฉย ๆ ทำให้คนดูเลิกดูเร็ว จึงให้ทุกฉากขยับเสมอ
 * สลับซูมเข้า/ซูมออกและหมุนทิศ เพื่อไม่ให้คลิปยาว ๆ ดูเหมือนกันไปหมด
 */
export function kenBurnsFor(shotIndex: number): KenBurns {
  const zoomIn = shotIndex % 2 === 0
  return {
    zoomFrom: zoomIn ? 1 : 1.12,
    zoomTo: zoomIn ? 1.12 : 1,
    pan: PAN_CYCLE[shotIndex % PAN_CYCLE.length],
  }
}

export function buildRenderPlan(input: BuildPlanInput): RenderPlan {
  const { scenes, durationsSec, imagePaths, audioPaths } = input

  if (scenes.length === 0) {
    throw new Error('ไม่มีฉากให้ประกอบ')
  }
  if (durationsSec.length !== scenes.length) {
    throw new Error(`จำนวนฉาก (${scenes.length}) ไม่ตรงกับความยาวเสียง (${durationsSec.length})`)
  }
  // ไม่ระบุ = ช็อตละฉาก ซึ่งเป็นพฤติกรรมเดิมก่อนแยกภาพออกจากฉาก
  const sceneCounts = input.sceneCounts ?? scenes.map(() => 1)

  if (imagePaths.length !== sceneCounts.length) {
    throw new Error(
      `จำนวนช็อต (${sceneCounts.length}) ไม่ตรงกับจำนวนภาพ (${imagePaths.length})`,
    )
  }
  if (sceneCounts.some((count) => !Number.isInteger(count) || count < 1)) {
    throw new Error('จำนวนฉากต่อช็อตต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป')
  }

  /**
   * ผลรวมต้องเท่ากับจำนวนฉากพอดี ไม่ใช่แค่ "ไม่เกิน"
   * ขาดไปหนึ่ง = ฉากท้ายไม่มีภาพคลุม คลิปจบด้วยจอดำที่ยังมีเสียงพูด
   * เกินไปหนึ่ง = ภาพสุดท้ายอ้างฉากที่ไม่มีอยู่ แล้วพังตอนอ่าน scenes[sceneAt]
   */
  const covered = sceneCounts.reduce((sum, count) => sum + count, 0)
  if (covered !== scenes.length) {
    throw new Error(`ช็อตครอบ ${covered} ฉาก แต่มีทั้งหมด ${scenes.length} ฉาก`)
  }
  if (audioPaths.length !== scenes.length) {
    throw new Error(`จำนวนฉาก (${scenes.length}) ไม่ตรงกับจำนวนไฟล์เสียง (${audioPaths.length})`)
  }
  if (durationsSec.some((d) => !(d > 0))) {
    throw new Error('ความยาวเสียงต้องมากกว่า 0 ทุกฉาก')
  }

  const canvas = input.canvas ?? DEFAULT_CANVAS
  const crossfadeSeconds = input.crossfadeSeconds ?? CROSSFADE_SECONDS

  const audio: PlanAudio[] = []
  let cursor = 0

  scenes.forEach((scene, i) => {
    audio.push({
      sceneIndex: scene.index,
      audioPath: audioPaths[i],
      startSec: round(cursor),
      durationSec: round(durationsSec[i]),
    })
    cursor += durationsSec[i]
  })

  const clips: PlanClip[] = []
  let shotStart = 0
  let sceneAt = 0

  sceneCounts.forEach((count, shotIndex) => {
    const sceneEnd = sceneAt + count
    const shotSeconds = durationsSec.slice(sceneAt, sceneEnd).reduce((a, b) => a + b, 0)

    // ภาพยืดคลุมช่วงเสียงของทุกฉากในช็อต บวกหางไว้ให้ช็อตถัดไปเฟดทับ
    // ช็อตสุดท้ายไม่มีหาง เพราะไม่มีอะไรมาทับแล้ว
    const hasNext = shotIndex < sceneCounts.length - 1
    clips.push({
      sceneIndex: scenes[sceneAt].index,
      imagePath: imagePaths[shotIndex],
      startSec: round(shotStart),
      endSec: round(shotStart + shotSeconds + (hasNext ? crossfadeSeconds : 0)),
      kenBurns: kenBurnsFor(shotIndex),
    })

    shotStart += shotSeconds
    sceneAt = sceneEnd
  })

  return {
    canvas,
    totalSeconds: round(cursor),
    clips,
    audio,
    subtitles: buildCues(scenes, durationsSec),
    crossfadeSeconds,
  }
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000
}
