import type { RenderPlan } from '@/lib/render-plan'

/**
 * แปลง RenderPlan เป็นคำสั่ง ffmpeg
 *
 * เป็นฟังก์ชันบริสุทธิ์ คืนอาร์กิวเมนต์ออกมาเป็นอาร์เรย์ ไม่ได้รันเอง
 * เพื่อให้เทสได้โดยไม่ต้องมี ffmpeg และให้ worker เอาไป log ก่อนรันได้เวลาสืบสาเหตุ
 */

/** ฟอนต์ที่ใช้เรนเดอร์ซับ — ต้องเป็นฟอนต์ที่มีอักษรไทย ไม่งั้นได้สี่เหลี่ยม */
export const DEFAULT_SUBTITLE_FONT = 'Loma'

export type FfmpegOptions = {
  /** ไฟล์ .srt ที่สร้างจาก plan.subtitles */
  subtitlePath: string
  outputPath: string
  fontName?: string
  fontSize?: number
  /** ไดเรกทอรีของฟอนต์ ถ้าไม่ได้ติดตั้งในระบบ */
  fontsDir?: string
  crf?: number
  preset?: string
}

/**
 * เอฟเฟกต์ Ken Burns ด้วย zoompan
 *
 * zoompan ทำงานเป็น "เฟรม" ไม่ใช่วินาที จึงต้องแปลงความยาวเป็นจำนวนเฟรมก่อน
 * และต้องขยายภาพต้นทางขึ้นก่อน zoompan เสมอ ไม่งั้นภาพจะกระตุกเป็นขั้น ๆ
 * เพราะ zoompan ปัดตำแหน่งเป็นพิกเซลเต็มของภาพต้นทาง
 */
const UPSCALE = 4

function kenBurnsFilter(
  clip: RenderPlan['clips'][number],
  canvas: RenderPlan['canvas'],
): string {
  const frames = Math.max(Math.round((clip.endSec - clip.startSec) * canvas.fps), 1)
  const { zoomFrom, zoomTo, pan } = clip.kenBurns

  // ไล่ซูมเชิงเส้นจาก zoomFrom ไป zoomTo ตลอดความยาวฉาก
  const step = (zoomTo - zoomFrom) / frames
  const zoomExpr = `${zoomFrom}+${step.toFixed(8)}*on`

  // ตำแหน่งกล้องเดินจากขอบหนึ่งไปอีกขอบตามทิศที่กำหนด
  const progress = `on/${frames}`
  const maxX = `(iw-iw/zoom)`
  const maxY = `(ih-ih/zoom)`

  let x: string
  let y: string
  switch (pan) {
    case 'right':
      x = `${maxX}*${progress}`
      y = `${maxY}/2`
      break
    case 'left':
      x = `${maxX}*(1-${progress})`
      y = `${maxY}/2`
      break
    case 'down':
      x = `${maxX}/2`
      y = `${maxY}*${progress}`
      break
    case 'up':
      x = `${maxX}/2`
      y = `${maxY}*(1-${progress})`
      break
  }

  const w = canvas.width
  const h = canvas.height

  return [
    // ครอบภาพให้เต็มเฟรมก่อน ไม่ว่าภาพต้นทางจะสัดส่วนไหน
    `scale=${w}:${h}:force_original_aspect_ratio=increase`,
    `crop=${w}:${h}`,
    `scale=${w * UPSCALE}:${h * UPSCALE}`,
    `zoompan=z='${zoomExpr}':x='${x}':y='${y}':d=${frames}:s=${w}x${h}:fps=${canvas.fps}`,
    'setsar=1',
  ].join(',')
}

export type FfmpegCommand = {
  args: string[]
  /** filtergraph แยกออกมาให้อ่านง่ายตอน debug */
  filterGraph: string
}

export function buildFfmpegCommand(plan: RenderPlan, options: FfmpegOptions): FfmpegCommand {
  const { canvas, clips, audio, crossfadeSeconds } = plan

  if (clips.length === 0) throw new Error('ไม่มีภาพให้ประกอบ')
  if (audio.length !== clips.length) {
    throw new Error(`จำนวนภาพ (${clips.length}) ไม่ตรงกับไฟล์เสียง (${audio.length})`)
  }

  const args: string[] = ['-y']

  // ภาพนิ่งต้องบอก -loop 1 และ -t ไม่งั้น ffmpeg อ่านเฟรมเดียวแล้วจบ
  clips.forEach((clip) => {
    args.push('-loop', '1', '-t', String(clip.endSec - clip.startSec), '-i', clip.imagePath)
  })
  audio.forEach((track) => {
    args.push('-i', track.audioPath)
  })

  const filters: string[] = []

  clips.forEach((clip, i) => {
    filters.push(`[${i}:v]${kenBurnsFilter(clip, canvas)}[v${i}]`)
  })

  // ต่อภาพด้วย xfade ทีละคู่ · offset นับจากต้นสายที่ต่อมาแล้ว ไม่ใช่จากต้นคลิปถัดไป
  let videoLabel = '[v0]'
  let elapsed = clips[0].endSec - clips[0].startSec

  for (let i = 1; i < clips.length; i++) {
    const duration = clips[i].endSec - clips[i].startSec
    const offset = elapsed - crossfadeSeconds
    const out = i === clips.length - 1 ? '[vmix]' : `[vx${i}]`

    filters.push(
      `${videoLabel}[v${i}]xfade=transition=fade:duration=${crossfadeSeconds}:offset=${round(offset)}${out}`,
    )

    videoLabel = out
    elapsed = elapsed + duration - crossfadeSeconds
  }

  if (clips.length === 1) {
    filters.push(`[v0]null[vmix]`)
  }

  // ซับใส่ทีหลังสุด ไม่งั้นตัวหนังสือจะถูกซูมไปกับภาพ
  const fontsOption = options.fontsDir ? `:fontsdir=${escapeFilterValue(options.fontsDir)}` : ''
  const style = [
    `FontName=${options.fontName ?? DEFAULT_SUBTITLE_FONT}`,
    `FontSize=${options.fontSize ?? 22}`,
    'PrimaryColour=&H00FFFFFF',
    'OutlineColour=&H00000000',
    'BorderStyle=1',
    'Outline=2',
    'Shadow=0',
    'Alignment=2',
    'MarginV=48',
  ].join(',')

  filters.push(
    `[vmix]subtitles=${escapeFilterValue(options.subtitlePath)}${fontsOption}:force_style='${style}'[vout]`,
  )

  // เสียงต่อกันตามลำดับฉาก ไม่ต้องเฟด เพราะแต่ละไฟล์จบประโยคพอดีอยู่แล้ว
  const audioInputs = audio.map((_, i) => `[${clips.length + i}:a]`).join('')
  filters.push(`${audioInputs}concat=n=${audio.length}:v=0:a=1[aout]`)

  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    options.preset ?? 'medium',
    '-crf',
    String(options.crf ?? 20),
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(canvas.fps),
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    // ตัดที่ความยาวเสียงรวม เพราะภาพฉากท้ายมีหางเฟดเผื่อไว้
    '-t',
    String(plan.totalSeconds),
    options.outputPath,
  )

  return { args, filterGraph: filters.join(';') }
}

/**
 * escape ค่าที่ส่งเป็นออปชันของ filter — ต้องทำ "สองชั้น" ไม่ใช่ชั้นเดียว
 *
 * ffmpeg แกะสตริงสองรอบ: รอบแรกระดับ filtergraph รอบสองระดับออปชันของ filter
 * ใส่ `\` ชั้นเดียวจึงถูกกินหมดตั้งแต่รอบแรก แล้วรอบสองเห็นอักขระดิบ
 *
 * พังชัดที่สุดกับพาธ Windows: `C:\Users\...\sub.srt` escape ชั้นเดียวได้
 * `C\:\\Users\\...` → ffmpeg อ่านชื่อไฟล์เป็นแค่ "C" แล้วโยนที่เหลือไปเป็นออปชัน
 * ตัวถัดไป (original_size) จนล้มด้วย "Unable to parse ... as image size"
 * ทดสอบจริงแล้วทั้งบน Linux (โฟลเดอร์จำลองที่มี : และ \ ในชื่อ) และ Windows
 */
function escapeFilterValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\\\\\')
    .replace(/:/g, '\\\\:')
    .replace(/'/g, "\\\\'")
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000
}
