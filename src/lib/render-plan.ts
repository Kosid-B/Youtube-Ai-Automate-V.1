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
  /** ไฟล์ภาพของแต่ละฉาก เรียงตามลำดับฉาก */
  imagePaths: string[]
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
export function kenBurnsFor(sceneIndex: number): KenBurns {
  const zoomIn = sceneIndex % 2 === 0
  return {
    zoomFrom: zoomIn ? 1 : 1.12,
    zoomTo: zoomIn ? 1.12 : 1,
    pan: PAN_CYCLE[sceneIndex % PAN_CYCLE.length],
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
  if (imagePaths.length !== scenes.length) {
    throw new Error(`จำนวนฉาก (${scenes.length}) ไม่ตรงกับจำนวนภาพ (${imagePaths.length})`)
  }
  if (audioPaths.length !== scenes.length) {
    throw new Error(`จำนวนฉาก (${scenes.length}) ไม่ตรงกับจำนวนไฟล์เสียง (${audioPaths.length})`)
  }
  if (durationsSec.some((d) => !(d > 0))) {
    throw new Error('ความยาวเสียงต้องมากกว่า 0 ทุกฉาก')
  }

  const canvas = input.canvas ?? DEFAULT_CANVAS
  const crossfadeSeconds = input.crossfadeSeconds ?? CROSSFADE_SECONDS

  const clips: PlanClip[] = []
  const audio: PlanAudio[] = []
  let cursor = 0

  scenes.forEach((scene, i) => {
    const duration = durationsSec[i]

    audio.push({
      sceneIndex: scene.index,
      audioPath: audioPaths[i],
      startSec: round(cursor),
      durationSec: round(duration),
    })

    // ภาพยืดคลุมช่วงเสียงของตัวเอง บวกหางไว้ให้ฉากถัดไปเฟดทับ
    // ฉากสุดท้ายไม่มีหาง เพราะไม่มีอะไรมาทับแล้ว
    const hasNext = i < scenes.length - 1
    clips.push({
      sceneIndex: scene.index,
      imagePath: imagePaths[i],
      startSec: round(cursor),
      endSec: round(cursor + duration + (hasNext ? crossfadeSeconds : 0)),
      kenBurns: kenBurnsFor(i),
    })

    cursor += duration
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
