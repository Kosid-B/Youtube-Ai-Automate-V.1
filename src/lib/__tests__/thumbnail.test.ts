import { describe, expect, it } from 'vitest'
import {
  MAX_CHARS_PER_LINE,
  MAX_LINES,
  buildThumbnailAss,
  buildThumbnailCommand,
  thumbnailLines,
} from '@/lib/thumbnail'
import { visibleLength } from '@/lib/thai-text'

describe('thumbnailLines', () => {
  /**
   * ข้อสำคัญของไฟล์นี้ — ภาษาไทยไม่เว้นวรรคระหว่างคำ libass จึงตัดบรรทัดเองไม่ได้
   * ต้องตัดมาให้ ไม่งั้นหัวข้อยาวจะเป็นบรรทัดเดียวทะลุออกนอกภาพ
   */
  it('หัวข้อไทยยาวที่ไม่มีช่องว่างเลย ต้องถูกตัดเป็นหลายบรรทัด', () => {
    const lines = thumbnailLines('ทำไมธุรกิจของคุณถึงขาดทุนทั้งที่ยอดขายดีขึ้นทุกเดือน')
    expect(lines.length).toBeGreaterThan(1)
    // วัดด้วยตัวที่มองเห็น ไม่ใช่ .length — สระบน/ล่างไม่กินความกว้าง
    for (const line of lines) expect(visibleLength(line)).toBeLessThanOrEqual(MAX_CHARS_PER_LINE)
  })

  it('ตัดที่ช่องว่างถ้ามี เพราะอ่านง่ายกว่าตัดกลางคำ', () => {
    const lines = thumbnailLines('ต้นทุนพุ่ง กำไรหาย รู้ตัวอีกทีก็สาย')
    expect(lines[0].endsWith(' ')).toBe(false)
    expect(lines.join(' ')).not.toContain('  ')
  })

  it('หัวข้อสั้นอยู่บรรทัดเดียว ไม่ต้องตัด', () => {
    expect(thumbnailLines('ลดต้นทุน 30%')).toEqual(['ลดต้นทุน 30%'])
  })

  it('ยาวเกินจำนวนบรรทัดสูงสุดต้องมี … ให้รู้ว่ายังมีต่อ ไม่ใช่หายเงียบ', () => {
    const lines = thumbnailLines('ก'.repeat(MAX_CHARS_PER_LINE * (MAX_LINES + 3)))
    expect(lines).toHaveLength(MAX_LINES)
    expect(lines[MAX_LINES - 1]).toContain('…')
  })

  it('หัวข้อว่างต้องได้ลิสต์ว่าง ไม่ใช่บรรทัดว่างหนึ่งบรรทัด', () => {
    expect(thumbnailLines('   ')).toEqual([])
  })
})

describe('buildThumbnailAss', () => {
  const size = { width: 1280, height: 720 }

  it('ต่อบรรทัดด้วย \\N ของ ASS ไม่ใช่ newline จริง', () => {
    const ass = buildThumbnailAss(['บรรทัดหนึ่ง', 'บรรทัดสอง'], size)
    expect(ass).toContain('บรรทัดหนึ่ง\\Nบรรทัดสอง')
  })

  it('ปิดการตัดบรรทัดอัตโนมัติ เพราะเราตัดมาเองแล้ว', () => {
    expect(buildThumbnailAss(['x'], size)).toContain('WrapStyle: 2')
  })

  it('ขนาดพื้นที่ต้องตรงกับขนาดปก ไม่งั้นตัวหนังสือหลุดตำแหน่ง', () => {
    const ass = buildThumbnailAss(['x'], { width: 1080, height: 1920 })
    expect(ass).toContain('PlayResX: 1080')
    expect(ass).toContain('PlayResY: 1920')
  })

  it('escape ปีกกา ไม่งั้นหัวข้อที่มี { } ทำให้ ASS เพี้ยนทั้งบรรทัด', () => {
    expect(buildThumbnailAss(['ราคา {ลด} 50%'], size)).toContain('ราคา \\{ลด\\} 50%')
  })
})

describe('buildThumbnailCommand', () => {
  const base = {
    imagePath: '/tmp/scene.jpg',
    assPath: '/tmp/cover.ass',
    outputPath: '/tmp/cover.jpg',
    size: { width: 1280, height: 720 },
  }

  it('ครอบภาพให้เต็มกรอบ ไม่ใช่ย่อจนเหลือขอบดำ', () => {
    const filter = buildThumbnailCommand(base).join(' ')
    expect(filter).toContain('force_original_aspect_ratio=increase')
    expect(filter).toContain('crop=1280:720')
  })

  /** แผ่นดำต้องมาก่อนตัวหนังสือ ไม่งั้นมันคลุมตัวหนังสือจนจางไปด้วย */
  it('คลุมแผ่นดำก่อนวาดตัวหนังสือ', () => {
    const filter = buildThumbnailCommand(base).join(' ')
    expect(filter.indexOf('drawbox')).toBeLessThan(filter.indexOf('subtitles'))
  })

  it('วาดตัวหนังสือด้วย subtitles ไม่ใช่ drawtext — drawtext วาดภาษาไทยไม่ได้เลย', () => {
    const args = buildThumbnailCommand(base).join(' ')
    expect(args).toContain('subtitles=')
    expect(args).not.toContain('drawtext')
  })

  it('ออกเป็นภาพนิ่งเฟรมเดียว', () => {
    expect(buildThumbnailCommand(base)).toContain('-frames:v')
  })
})
