/**
 * ปกคลิป — วาดหัวข้อทับภาพฉากแรก
 *
 * ⚠️ ต้องวาดผ่าน libass (subtitles filter) ไม่ใช่ drawtext
 *
 * drawtext เป็นวิธีที่เอกสารและตัวอย่างส่วนใหญ่ใช้ แต่**ใช้กับภาษาไทยไม่ได้เลย**
 * ทดสอบแล้วบน ffmpeg 6.1 ด้วยฟอนต์ Loma: ข้อความไทยออกมาเป็นสี่เหลี่ยมเปล่าทั้งบรรทัด
 * ไม่ใช่แค่สระวางผิดที่ — ไม่มีตัวอักษรเลย
 *
 * เพราะ drawtext เรียก libfreetype ตรง ๆ โดยไม่ผ่านตัวจัดวางอักขระ ส่วน libass
 * ใช้ harfbuzz + fribidi ซึ่งเป็นตัวที่ประกอบสระบน/ล่างกับวรรณยุกต์ให้ถูกตำแหน่ง
 * (สองตัวเดียวกับที่เราตรวจว่าต้องมีใน ffmpeg ตั้งแต่ตอนทำซับ)
 */

import { truncateGraphemes, wrapByGraphemes } from '@/lib/thai-text'

/**
 * จำนวน "ตัวที่มองเห็น" ต่อบรรทัด ไม่ใช่ความยาวสตริง
 * เกินนี้ตัวเล็กจนอ่านไม่ออกตอนย่อเป็นภาพเล็กในหน้าค้นหา
 */
export const MAX_CHARS_PER_LINE = 14

/** เกิน 3 บรรทัดจะบังภาพจนไม่เหลือบริบท */
export const MAX_LINES = 3

export type ThumbnailStyle = {
  fontName: string
  fontSize: number
  /** ความทึบของแผ่นดำที่คลุมภาพ 0–1 — ไม่มีตัวนี้ตัวหนังสือขาวจะจมไปกับภาพสว่าง */
  scrimOpacity: number
}

export const DEFAULT_STYLE: ThumbnailStyle = {
  fontName: 'Loma',
  fontSize: 84,
  scrimOpacity: 0.45,
}

/**
 * ตัดหัวข้อเป็นบรรทัด
 *
 * ภาษาไทยไม่เว้นวรรคระหว่างคำ libass จึงตัดบรรทัดเองไม่ได้ (มันตัดที่ช่องว่าง)
 * ต้องใส่ตัวขึ้นบรรทัดให้เองตามจำนวนตัวอักษร ไม่งั้นหัวข้อยาวจะเป็นบรรทัดเดียว
 * ยาวทะลุออกนอกภาพ
 *
 * ตัดที่ช่องว่างก่อนถ้ามี เพราะอ่านง่ายกว่าตัดกลางคำ
 */
export function thumbnailLines(
  title: string,
  maxChars = MAX_CHARS_PER_LINE,
  maxLines = MAX_LINES,
): string[] {
  const lines = wrapByGraphemes(title, maxChars)

  if (lines.length <= maxLines) return lines

  // เกินจำนวนบรรทัด — ตัดท้ายแล้วใส่ … ให้รู้ว่ายังมีต่อ ไม่ใช่หายเงียบ
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = truncateGraphemes(`${kept[maxLines - 1]}…`, maxChars)
  return kept
}

/** อักขระที่มีความหมายในไฟล์ ASS ต้อง escape ไม่งั้นบรรทัดเพี้ยนหรือหลุดรูปแบบ */
function escapeAss(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}')
}

/**
 * สร้างไฟล์ ASS สำหรับวาดหัวข้อ
 *
 * ใช้ ASS ไม่ใช่ SRT เพราะต้องคุมตำแหน่ง ขนาด ขอบ และเงาได้ละเอียด
 * ซึ่ง SRT ทำไม่ได้
 */
export function buildThumbnailAss(
  lines: string[],
  size: { width: number; height: number },
  style: ThumbnailStyle = DEFAULT_STYLE,
): string {
  const text = lines.map(escapeAss).join('\\N')

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${size.width}`,
    `PlayResY: ${size.height}`,
    // ปิดการตัดบรรทัดอัตโนมัติ — เราตัดเองมาแล้วตามจำนวนตัวอักษร
    // ปล่อยให้ libass ตัดจะไม่เกิดอะไรเลยกับภาษาไทยที่ไม่มีช่องว่าง
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Alignment 5 = กลางจอทั้งแนวตั้งและแนวนอน · Outline หนาเพื่อให้อ่านออกบนภาพทุกแบบ
    `Style: Cover,${style.fontName},${style.fontSize},&H00FFFFFF,&H00000000,&H00000000,-1,1,4,2,5,60,60,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 0,0:00:00.00,0:00:10.00,Cover,,0,0,0,,${text}`,
  ].join('\n')
}

export type ThumbnailInput = {
  imagePath: string
  assPath: string
  outputPath: string
  size: { width: number; height: number }
  scrimOpacity?: number
}

/**
 * คำสั่ง ffmpeg สร้างปก — คืน args อย่างเดียว ไม่รันเอง (เทสได้โดยไม่ต้องมี ffmpeg)
 *
 * ลำดับ filter: ย่อ/ครอบภาพ → คลุมด้วยแผ่นดำ → วาดตัวหนังสือ
 * แผ่นดำต้องมาก่อนตัวหนังสือ ไม่งั้นมันจะคลุมตัวหนังสือไปด้วยจนจาง
 */
export function buildThumbnailCommand(input: ThumbnailInput): string[] {
  const { width, height } = input.size
  const opacity = input.scrimOpacity ?? DEFAULT_STYLE.scrimOpacity

  const filter = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    `drawbox=x=0:y=0:w=${width}:h=${height}:color=black@${opacity}:t=fill`,
    `subtitles=${escapeFilterValue(input.assPath)}`,
  ].join(',')

  return [
    '-y',
    '-i', input.imagePath,
    '-vf', filter,
    '-frames:v', '1',
    // คุณภาพ 3 = คมพอสำหรับปก และไฟล์เล็กกว่าเพดาน 2MB ของ YouTube มาก
    '-q:v', '3',
    input.outputPath,
  ]
}

/** escape สองชั้นเหมือน src/lib/ffmpeg.ts — ffmpeg แกะสตริงสองรอบ */
function escapeFilterValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\\\\\')
    .replace(/:/g, '\\\\:')
    .replace(/'/g, "\\\\'")
}
