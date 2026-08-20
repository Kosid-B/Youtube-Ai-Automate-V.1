import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildConcatCommand, buildFfmpegCommand } from '@/lib/ffmpeg'
import { buildRenderPlan } from '@/lib/render-plan'
import { concatListFile, planChunks } from '@/lib/render-chunks'
import { splitIntoScenes } from '@/lib/scenes'
import { toSrt } from '@/lib/subtitles'

const scenes = splitIntoScenes('ฉากแรกเล่าปัญหา\nฉากสองเล่าสาเหตุ\nฉากสามสรุปทางออก', {
  targetChars: 12,
  maxChars: 24,
})

const durations = [2, 2.5, 2]

function makePlan() {
  return buildRenderPlan({
    scenes,
    durationsSec: durations,
    imagePaths: ['/tmp/a.png', '/tmp/b.png', '/tmp/c.png'],
    audioPaths: ['/tmp/a.wav', '/tmp/b.wav', '/tmp/c.wav'],
  })
}

describe('buildFfmpegCommand', () => {
  it('ภาพนิ่งทุกใบต้องมี -loop 1 และ -t ไม่งั้น ffmpeg อ่านเฟรมเดียวแล้วจบ', () => {
    const { args } = buildFfmpegCommand(makePlan(), {
      subtitlePath: '/tmp/s.srt',
      outputPath: '/tmp/out.mp4',
    })
    expect(args.filter((a) => a === '-loop')).toHaveLength(3)
  })

  it('offset ของ xfade นับสะสมจากต้นสาย ไม่ใช่จากต้นฉากถัดไป', () => {
    const { filterGraph } = buildFfmpegCommand(makePlan(), {
      subtitlePath: '/tmp/s.srt',
      outputPath: '/tmp/out.mp4',
    })
    // ฉากแรกยาว 2 + หางเฟด 0.5 = 2.5 · เฟดเริ่มที่ 2.5-0.5 = 2
    expect(filterGraph).toContain('offset=2')
    // ฉากสองจบที่ 2+2.5=4.5 · เฟดถัดไปเริ่มที่ 4
    expect(filterGraph).toContain('offset=4')
  })

  it('ซับซ้อนหลัง xfade เสมอ ไม่งั้นตัวหนังสือถูกซูมไปกับภาพ', () => {
    const { filterGraph } = buildFfmpegCommand(makePlan(), {
      subtitlePath: '/tmp/s.srt',
      outputPath: '/tmp/out.mp4',
    })
    expect(filterGraph.indexOf('subtitles=')).toBeGreaterThan(filterGraph.indexOf('xfade'))
  })

  /**
   * ffmpeg แกะสตริงสองรอบ (filtergraph แล้วค่อยออปชันของ filter)
   * escape ชั้นเดียวจึงถูกกินหมดตั้งแต่รอบแรก — ต้องใส่ให้เหลือถึงรอบสอง
   *
   * เทสต์นี้เคยเขียนผิดเป็นชั้นเดียวแล้วผ่านเขียว จนบั๊กหลุดไปโผล่บนเครื่อง Windows
   * ตัวที่จับได้จริงคือเทสต์เรนเดอร์ข้างล่างที่ยิง ffmpeg จริงกับพาธแบบนั้น
   */
  it('escape : และ \\ แบบสองชั้น ไม่งั้น ffmpeg อ่านชื่อไฟล์ขาดกลางคัน', () => {
    const { filterGraph } = buildFfmpegCommand(makePlan(), {
      subtitlePath: 'C:\\งาน\\sub.srt',
      outputPath: '/tmp/out.mp4',
    })
    expect(filterGraph).toContain('C\\\\:\\\\\\\\งาน\\\\\\\\sub.srt')
  })

  it('ตัดความยาวที่ผลรวมเสียง ไม่ใช่ความยาวภาพที่มีหางเฟด', () => {
    const plan = makePlan()
    const { args } = buildFfmpegCommand(plan, {
      subtitlePath: '/tmp/s.srt',
      outputPath: '/tmp/out.mp4',
    })
    expect(args[args.indexOf('-t') + 1]).not.toBe(undefined)
    expect(args.at(-2)).toBe(String(plan.totalSeconds))
  })
})

/**
 * เทสต์ที่เรนเดอร์จริง — ยืนยันว่าคำสั่งที่สร้างมา ffmpeg รับได้และได้ไฟล์ที่ถูกต้อง
 * ข้ามอัตโนมัติถ้าเครื่องไม่มี ffmpeg (เช่นบน CI ที่ยังไม่ได้ติดตั้ง)
 *
 * ต้องตะโกนบอกตอนข้าม ไม่งั้นผลรวมขึ้นเขียวทั้งที่ ffmpeg ไม่เคยถูกเรียกเลยสักครั้ง
 * แล้วคนอ่านจะสรุปว่า "เครื่องนี้เรนเดอร์คลิปได้" ทั้งที่ยังไม่ได้พิสูจน์อะไรเลย
 */
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    console.warn(
      '\n⚠️  ข้ามเทสต์เรนเดอร์จริง เพราะเรียก ffmpeg บนเครื่องนี้ไม่ได้\n' +
        '   เทสต์ที่เหลือเป็นตรรกะล้วน ไม่ได้ยืนยันว่าเครื่องนี้ประกอบคลิปได้\n' +
        '   ติดตั้งแล้วรันใหม่ (Windows: winget install Gyan.FFmpeg แล้วเปิด terminal ใหม่)\n',
    )
    return false
  }
})()

const workDir = hasFfmpeg ? mkdtempSync(join(tmpdir(), 'ytf-')) : ''

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true })
})

describe.skipIf(!hasFfmpeg)('เรนเดอร์จริงด้วย ffmpeg', () => {
  it('ได้ไฟล์ mp4 ที่ยาวตรงกับแผน ขนาดถูก และมีทั้งภาพและเสียง', () => {
    const colors = ['red', 'green', 'blue']
    const images = colors.map((color, i) => {
      const path = join(workDir, `img${i}.png`)
      execFileSync('ffmpeg', [
        '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=1280x720`, '-frames:v', '1', path,
      ], { stdio: 'ignore' })
      return path
    })

    const audios = durations.map((seconds, i) => {
      const path = join(workDir, `snd${i}.wav`)
      execFileSync('ffmpeg', [
        '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
        '-ar', '24000', '-ac', '1', path,
      ], { stdio: 'ignore' })
      return path
    })

    const plan = buildRenderPlan({
      scenes,
      durationsSec: durations,
      imagePaths: images,
      audioPaths: audios,
      canvas: { width: 640, height: 360, fps: 24 },
    })

    const srtPath = join(workDir, 'sub.srt')
    writeFileSync(srtPath, toSrt(plan.subtitles), 'utf8')

    const outputPath = join(workDir, 'out.mp4')
    const { args } = buildFfmpegCommand(plan, {
      subtitlePath: srtPath,
      outputPath,
      fontSize: 16,
    })

    execFileSync('ffmpeg', args, { stdio: 'pipe' })

    const probe = JSON.parse(
      execFileSync('ffprobe', [
        '-v', 'quiet', '-print_format', 'json',
        '-show_format', '-show_streams', outputPath,
      ]).toString(),
    ) as {
      format: { duration: string }
      streams: { codec_type: string; width?: number; height?: number }[]
    }

    // ยาวตรงกับผลรวมเสียง (เผื่อคลาดได้ครึ่งวินาทีจากการปัด keyframe)
    expect(Number(probe.format.duration)).toBeCloseTo(plan.totalSeconds, 0)

    const video = probe.streams.find((s) => s.codec_type === 'video')
    const audio = probe.streams.find((s) => s.codec_type === 'audio')
    expect(video?.width).toBe(640)
    expect(video?.height).toBe(360)
    expect(audio).toBeDefined()
  }, 120_000)

  /**
   * ตรวจว่าซับถูกเบิร์นลงภาพจริง
   *
   * โหมดพังที่เงียบที่สุดคือ subtitles filter ทำงานผ่านแต่ไม่วาดอะไรเลย
   * (พาธผิด ฟอนต์ไม่มีอักษรไทย หรือเวลาไม่ตรงกับ cue ไหนเลย) — ไฟล์ออกมาปกติทุกอย่าง
   * ยกเว้นไม่มีตัวหนังสือ วิธีจับคือดูว่าแถบล่างของเฟรมมีพิกเซลสว่างไหม
   * พื้นหลังเป็นสีเข้ม ตัวหนังสือสีขาว ถ้าไม่มีอะไรวาดเลยค่าความสว่างสูงสุดจะต่ำ
   */
  it('ซับถูกเบิร์นลงภาพจริง ไม่ใช่ filter ผ่านแต่ไม่วาดอะไร', () => {
    const image = join(workDir, 'dark.png')
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'color=c=0x101820:s=640x360', '-frames:v', '1', image,
    ], { stdio: 'ignore' })

    const sound = join(workDir, 'dark.wav')
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-ar', '24000', '-ac', '1', sound,
    ], { stdio: 'ignore' })

    const oneScene = splitIntoScenes('ทดสอบซับไตเติลภาษาไทยว่าขึ้นจริงหรือไม่')
    const plan = buildRenderPlan({
      scenes: oneScene,
      durationsSec: [3],
      imagePaths: [image],
      audioPaths: [sound],
      canvas: { width: 640, height: 360, fps: 24 },
    })

    const srtPath = join(workDir, 'burn.srt')
    writeFileSync(srtPath, toSrt(plan.subtitles), 'utf8')

    const outputPath = join(workDir, 'burn.mp4')
    execFileSync(
      'ffmpeg',
      buildFfmpegCommand(plan, { subtitlePath: srtPath, outputPath, fontSize: 20 }).args,
      { stdio: 'pipe' },
    )

    // ดึงแถบล่าง 100px ของเฟรมกลางคลิปออกมาเป็นค่าความสว่างดิบ
    const strip = execFileSync('ffmpeg', [
      '-v', 'quiet', '-ss', '1.5', '-i', outputPath, '-frames:v', '1',
      '-vf', 'crop=640:100:0:260', '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
    ], { maxBuffer: 10 * 1024 * 1024 })

    expect(strip.length).toBe(640 * 100)
    expect(Math.max(...strip)).toBeGreaterThan(200)
  }, 120_000)

  /**
   * พาธซับที่มี : และ \ ต้องเรนเดอร์ผ่าน — เป็นเรื่องปกติบน Windows เพราะทุกพาธ
   * ขึ้นต้นด้วย C:\ อยู่แล้ว บั๊ก escape จึงพังทันทีที่นั่นแต่เงียบสนิทบน Linux
   *
   * Windows ห้ามใช้ : กับ \ ในชื่อโฟลเดอร์ จึงสร้างพาธแบบนี้ที่นั่นไม่ได้ (และไม่ต้องสร้าง
   * เพราะเทสต์ตัวอื่นได้ C:\ ติดมาเองอยู่แล้ว) เทสต์นี้จึงมีไว้ให้ฝั่ง POSIX จับบั๊ก
   * แทน แทนที่จะรอไปโผล่บนเครื่องผู้ใช้
   */
  it.skipIf(process.platform === 'win32')(
    'เรนเดอร์ผ่านแม้พาธซับมี : และ \\ (จำลองพาธแบบ Windows)',
    () => {
      const trickyDir = join(workDir, 'C:\\Users\\ทดสอบ')
      mkdirSync(trickyDir, { recursive: true })

      const image = join(workDir, 'tricky.png')
      execFileSync('ffmpeg', [
        '-y', '-f', 'lavfi', '-i', 'color=c=0x101820:s=640x360', '-frames:v', '1', image,
      ], { stdio: 'ignore' })

      const sound = join(workDir, 'tricky.wav')
      execFileSync('ffmpeg', [
        '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
        '-ar', '24000', '-ac', '1', sound,
      ], { stdio: 'ignore' })

      const plan = buildRenderPlan({
        scenes: splitIntoScenes('พาธมีอักขระที่ต้อง escape'),
        durationsSec: [2],
        imagePaths: [image],
        audioPaths: [sound],
        canvas: { width: 640, height: 360, fps: 24 },
      })

      const srtPath = join(trickyDir, 'sub.srt')
      writeFileSync(srtPath, toSrt(plan.subtitles), 'utf8')

      const outputPath = join(workDir, 'tricky.mp4')
      execFileSync(
        'ffmpeg',
        buildFfmpegCommand(plan, { subtitlePath: srtPath, outputPath, fontSize: 20 }).args,
        { stdio: 'pipe' },
      )

      // ซับต้องถูกวาดจริง ไม่ใช่แค่ ffmpeg ไม่ error
      const strip = execFileSync('ffmpeg', [
        '-v', 'quiet', '-ss', '1', '-i', outputPath, '-frames:v', '1',
        '-vf', 'crop=640:100:0:260', '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
      ], { maxBuffer: 10 * 1024 * 1024 })

      expect(Math.max(...strip)).toBeGreaterThan(200)
    },
    120_000,
  )

  /**
   * เรนเดอร์แยกช่วงแล้วต่อกัน — เส้นทางของคลิปยาวพิเศษ
   *
   * จับสองอย่างที่พังเงียบได้ทั้งคู่:
   *
   * 1. ความยาวหาย/เกินตรงรอยต่อ — concat -c copy ถ้าค่าเข้ารหัสของแต่ละช่วงไม่ตรงกัน
   *    จะได้ไฟล์ที่เปิดได้แต่ยาวไม่ถูก โดย ffmpeg ไม่คืน error
   *
   * 2. ซับหายในช่วงที่สองเป็นต้นไป — ซับของแต่ละช่วงต้องนับเวลาจาก 0 ใหม่
   *    ถ้าเผลอส่งเวลาแบบทั้งคลิปไป cue ของช่วงหลังจะอยู่นอกช่วงเวลาของไฟล์นั้น
   *    ผลคือช่วงแรกมีซับ ช่วงหลังไม่มี และไม่มีอะไรฟ้องเลยสักอย่าง
   */
  it(
    'เรนเดอร์แยกช่วงแล้วต่อกัน ต้องได้ความยาวครบ และมีซับทุกช่วง',
    () => {
      const dir = join(workDir, 'chunked')
      mkdirSync(dir, { recursive: true })

      const many = splitIntoScenes(
        Array.from({ length: 6 }, (_, i) => `ฉากที่ ${i + 1} ทดสอบซับไตเติลภาษาไทย`).join('\n'),
        { targetChars: 30, maxChars: 40 },
      )
      const secs = many.map(() => 2)

      const images = many.map((_, i) => {
        const path = join(dir, `img${i}.png`)
        execFileSync('ffmpeg', [
          '-y', '-f', 'lavfi', '-i', 'color=c=0x101820:s=640x360', '-frames:v', '1', path,
        ], { stdio: 'ignore' })
        return path
      })
      const sounds = many.map((_, i) => {
        const path = join(dir, `snd${i}.wav`)
        execFileSync('ffmpeg', [
          '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
          '-ar', '24000', '-ac', '1', path,
        ], { stdio: 'ignore' })
        return path
      })

      // เป้า 5 วินาที กับฉากละ 2 วินาที → ได้หลายช่วง ช่วงละ 2 ฉาก
      const chunks = planChunks(secs, 5)
      expect(chunks.length).toBeGreaterThan(1)

      const chunkPaths = chunks.map((chunk, i) => {
        const plan = buildRenderPlan({
          scenes: many.slice(chunk.start, chunk.end),
          durationsSec: secs.slice(chunk.start, chunk.end),
          imagePaths: images.slice(chunk.start, chunk.end),
          audioPaths: sounds.slice(chunk.start, chunk.end),
          canvas: { width: 640, height: 360, fps: 24 },
        })

        const srtPath = join(dir, `sub${i}.srt`)
        writeFileSync(srtPath, toSrt(plan.subtitles), 'utf8')

        const path = join(dir, `chunk${i}.mp4`)
        execFileSync(
          'ffmpeg',
          buildFfmpegCommand(plan, { subtitlePath: srtPath, outputPath: path, fontSize: 20 }).args,
          { stdio: 'pipe' },
        )
        return path
      })

      const listPath = join(dir, 'list.txt')
      writeFileSync(listPath, concatListFile(chunkPaths), 'utf8')

      const outputPath = join(dir, 'joined.mp4')
      execFileSync('ffmpeg', buildConcatCommand(listPath, outputPath), { stdio: 'pipe' })

      const probe = JSON.parse(
        execFileSync('ffprobe', [
          '-v', 'quiet', '-print_format', 'json',
          '-show_format', '-show_streams', outputPath,
        ]).toString(),
      ) as {
        format: { duration: string }
        streams: { codec_type: string; width?: number }[]
      }

      const expected = secs.reduce((a, b) => a + b, 0)
      expect(Number(probe.format.duration)).toBeCloseTo(expected, 0)
      expect(probe.streams.find((s) => s.codec_type === 'video')?.width).toBe(640)
      expect(probe.streams.find((s) => s.codec_type === 'audio')).toBeDefined()

      const stripAt = (seconds: number) => {
        const raw = execFileSync('ffmpeg', [
          '-v', 'quiet', '-ss', String(seconds), '-i', outputPath, '-frames:v', '1',
          '-vf', 'crop=640:100:0:260', '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
        ], { maxBuffer: 10 * 1024 * 1024 })
        expect(raw.length).toBe(640 * 100)
        return raw
      }

      const first = stripAt(1)
      const last = stripAt(expected - 3)

      // มีตัวหนังสือวาดอยู่จริงทั้งต้นและท้าย (พื้นเข้ม ตัวอักษรขาว)
      expect(Math.max(...first)).toBeGreaterThan(200)
      expect(Math.max(...last)).toBeGreaterThan(200)

      /**
       * และต้องเป็น "คนละข้อความ" ด้วย
       *
       * เช็คแค่ว่ามีตัวหนังสือไม่พอ — ทดลองแล้วว่าถ้าส่งซับแบบทั้งคลิป (ไม่ rebase)
       * ให้ทุกช่วง ช่วงหลังก็ยังมีตัวหนังสือขึ้น เพราะไฟล์ของมันเริ่มนับเวลาที่ 0 เหมือนกัน
       * แต่เป็นข้อความของฉากแรกซ้ำอีกรอบ ซึ่งเช็คความสว่างจับไม่ได้เลย
       * เทียบพิกเซลจึงเป็นตัวเดียวที่แยก "ซับถูกฉาก" ออกจาก "ซับขึ้นเฉย ๆ" ได้
       */
      expect(Buffer.compare(first, last)).not.toBe(0)
    },
    180_000,
  )
})
