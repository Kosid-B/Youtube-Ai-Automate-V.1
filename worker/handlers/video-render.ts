import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type { WorkerClient } from '../supabase'
import { heartbeatJob, type JobPayloads } from '@/lib/jobs'
import type { JobContext } from '../run'
import { sceneImageQueries } from '@/lib/anthropic'
import { buildConcatCommand, buildFfmpegCommand } from '@/lib/ffmpeg'
import { creditBlock, downloadPhoto, pickPhoto, searchPhotos, type PexelsPhoto } from '@/lib/pexels'
import { buildRenderPlan } from '@/lib/render-plan'
import { concatListFile, planChunks } from '@/lib/render-chunks'
import { planShots, shotSceneCounts, shotText, type Shot } from '@/lib/shots'
import { splitIntoScenes, type Scene } from '@/lib/scenes'
import { formatSpec, formatWarning, minPhotoSize } from '@/lib/formats'
import { buildDescription, chapterBlock, ctaWarning } from '@/lib/description'
import { chapterMarks, sectionDurationsFromScenes } from '@/lib/outline'
import { buildThumbnailAss, buildThumbnailCommand, thumbnailLines } from '@/lib/thumbnail'
import { toSrt } from '@/lib/subtitles'
import { synthesize } from '@/lib/tts'
import { track } from '@/lib/analytics'

const run = promisify(execFile)

/**
 * เพดานเวลาของ ffmpeg "ต่อหนึ่งช่วง" ไม่ใช่ต่อทั้งคลิป
 *
 * คลิปยาวถูกแบ่งเป็นช่วงละ ~6 นาทีก่อนเรนเดอร์ (ดู lib/render-chunks.ts)
 * เพดานนี้จึงคุมช่วงเดียว ส่วนงานทั้งงานใช้เวลารวมได้นานกว่านี้มาก
 * ซึ่งตั้งใจ — งานเรนเดอร์ไม่มีเพดานรวม มีแต่สัญญาณชีพบอกคิวว่ายังไม่ตาย
 */
const FFMPEG_TIMEOUT_MS = 20 * 60 * 1000

function voice() {
  const name = process.env.GOOGLE_TTS_VOICE
  if (!name) throw new Error('ไม่ได้ตั้ง GOOGLE_TTS_VOICE (ดูรายชื่อด้วย listThaiVoices)')
  return { languageCode: 'th-TH', name }
}

/**
 * ฟอนต์ซับต่างกันตามเครื่องที่รัน worker
 *
 * ค่าเริ่มต้น Loma มีเฉพาะบน Linux — เครื่องอื่นตั้งผ่าน env (Windows: "Leelawadee UI")
 *
 * ตั้งชื่อฟอนต์ผิดไม่ทำให้ ffmpeg ล้ม (ทดสอบแล้ว exit 0) และ libass ยัง fallback
 * หาอักษรไทยจากฟอนต์อื่นในเครื่องมาวาดให้ ผลคือคลิปยังอ่านออกแต่หน้าตาซับไม่ใช่ที่เลือกไว้
 * และไม่มีอะไรฟ้อง จึงต้องตั้งให้ตรงเครื่องเอง ไม่มีทางตรวจจับอัตโนมัติ
 */
function subtitleStyle() {
  return {
    fontName: process.env.SUBTITLE_FONT?.trim() || undefined,
    fontsDir: process.env.SUBTITLE_FONTS_DIR?.trim() || undefined,
  }
}

/**
 * ประกอบคลิปจากสคริปต์: แบ่งฉาก → หาภาพ → พากย์ → ประกอบด้วย ffmpeg → เก็บขึ้น Storage
 *
 * idempotent สองชั้น เพราะ retry ได้ถึง 3 ครั้ง และทุกขั้นเสียเงิน:
 * - มีไฟล์คลิปแล้ว = ข้ามทั้งงาน
 * - ภาพที่โหลดไว้แล้วอยู่ใน video_assets = ไม่ค้น ไม่โหลดซ้ำ (ไม่เผาโควตา Pexels)
 */
export async function videoRender(
  db: WorkerClient,
  payload: JobPayloads['video_render'],
  ctx?: JobContext,
): Promise<void> {
  const { data: video } = await db
    .from('videos')
    .select('id, org_id, channel_id, title, storage_path, description, format, thumbnail_path')
    .eq('id', payload.video_id)
    .single()

  if (!video) throw new Error(`ไม่พบคลิป ${payload.video_id}`)

  if (video.storage_path) {
    console.log(`[video_render] ${video.id} มีไฟล์แล้ว ข้าม`)
    return
  }

  const { data: script } = await db
    .from('scripts')
    .select('id, body, title, originality')
    .eq('id', payload.script_id)
    .single()

  if (!script?.body) throw new Error(`สคริปต์ ${payload.script_id} ยังไม่มีเนื้อหา`)

  const { data: channel } = await db
    .from('channels')
    .select('niche, cta_template')
    .eq('id', video.channel_id)
    .single()

  // รูปแบบกำหนดทุกอย่างพร้อมกัน: ความยาวฉาก แนวภาพ ขนาดเฟรม ขนาดซับ
  const spec = formatSpec(video.format)
  const scenes = splitIntoScenes(script.body, spec.scenes)
  if (scenes.length === 0) throw new Error('แบ่งฉากจากสคริปต์ไม่ได้')

  await db.from('videos').update({ status: 'rendering' }).eq('id', video.id)
  await track('render_started', video.org_id, { scenes: scenes.length })

  const workDir = await mkdtemp(join(tmpdir(), `ytf-${video.id}-`))

  try {
    /**
     * เสียงมาก่อนภาพ เพราะการแบ่งช็อตต้องใช้ "ความยาวเสียงจริง"
     * ประมาณจากจำนวนตัวอักษรไม่ได้ — ช็อตจะยาวไม่เท่าที่ตั้งใจแล้วโควตาภาพเพี้ยนตาม
     */
    const audio = await collectAudio(scenes, workDir)

    /**
     * แยกจังหวะภาพออกจากจังหวะเสียง — ภาพหนึ่งใบครอบหลายฉาก (ดู lib/shots.ts)
     * คลิปสั้นตั้ง shotSeconds ไว้สั้นกว่าหนึ่งฉาก จึงได้ภาพต่อฉากเหมือนเดิมทุกประการ
     */
    const shots = planShots(audio.durations, spec.shotSeconds)

    const images = await collectImages(
      db, video, scenes, shots, channel?.niche ?? null, workDir,
      spec.orientation, minPhotoSize(video.format),
    )

    /**
     * เรนเดอร์ทีละช่วงแล้วต่อกัน — คำสั่งเดียวรวดเดียวใช้ไม่ได้กับคลิปยาว
     * (ทั้งชนเพดานเวลาและเปิดไฟล์เข้าพร้อมกันเยอะเกิน · ดู lib/render-chunks.ts)
     *
     * แบ่งที่ระดับ "ช็อต" ไม่ใช่ฉาก เพื่อให้รอยต่อของช่วงตรงกับจุดเปลี่ยนภาพพอดี
     * ไม่งั้นภาพใบเดียวถูกตัดเป็นสองไฟล์แล้ว Ken Burns เริ่มใหม่ตรงรอยต่อ
     */
    const chunks = planChunks(shots.map((shot) => shot.seconds))
    const totalSeconds = round(chunks.reduce((sum, chunk) => sum + chunk.seconds, 0))

    // คลิปสั้นที่ยาวเกิน 3 นาทีจะไม่ถูกนับเป็น Short — เสียเหตุผลเดียวที่ทำคลิปสั้น
    // ไม่หยุดงาน เพราะไฟล์ยังใช้ได้ แต่ต้องเห็นว่าเกิดขึ้นแล้ว
    const warning = formatWarning(video.format, totalSeconds)
    if (warning) console.warn(`[video_render] ${video.id} ⚠️ ${warning}`)

    console.log(
      `[video_render] ${video.id} เริ่มประกอบ ${scenes.length} ฉาก ` +
        `${images.paths.length} ภาพ ${totalSeconds}s` +
        (chunks.length > 1 ? ` แบ่ง ${chunks.length} ช่วง` : ''),
    )

    const chunkPaths: string[] = []

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]

      // chunk อ้างดัชนี "ช็อต" ต้องแปลงกลับเป็นช่วงฉากก่อนจึงจะหั่นเสียง/ซับได้
      const chunkShots = shots.slice(chunk.start, chunk.end)
      const sceneFrom = chunkShots[0].start
      const sceneTo = chunkShots[chunkShots.length - 1].end
      const scenesOf = <T,>(items: T[]) => items.slice(sceneFrom, sceneTo)

      const plan = buildRenderPlan({
        scenes: scenesOf(scenes),
        durationsSec: scenesOf(audio.durations),
        audioPaths: scenesOf(audio.paths),
        imagePaths: images.paths.slice(chunk.start, chunk.end),
        sceneCounts: shotSceneCounts(chunkShots),
        canvas: spec.canvas,
        crossfadeSeconds: spec.crossfadeSeconds,
      })

      // ซับของแต่ละช่วงนับเวลาจาก 0 ใหม่ เพราะเผาลงไฟล์ของช่วงนั้นแยกกัน
      const subtitlePath = join(workDir, `sub-${pad(i)}.srt`)
      await writeFile(subtitlePath, toSrt(plan.subtitles), 'utf8')

      const chunkPath = join(workDir, `chunk-${pad(i)}.mp4`)
      const { args } = buildFfmpegCommand(plan, {
        subtitlePath,
        outputPath: chunkPath,
        fontSize: spec.subtitleFontSize,
        marginV: spec.subtitleMarginV,
        ...subtitleStyle(),
      })

      await run('ffmpeg', args, { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 })
      chunkPaths.push(chunkPath)

      if (chunks.length > 1) {
        console.log(`[video_render] ${video.id} ช่วง ${i + 1}/${chunks.length} เสร็จ (${chunk.seconds}s)`)
        // บอกคิวว่ายังไม่ตาย ไม่งั้นงานที่ใช้เวลาเกิน 30 นาทีจะถูกติดป้ายว่า worker ตาย
        if (ctx) await heartbeatJob(db, ctx.jobId)
      }
    }

    const outputPath = await concatChunks(chunkPaths, workDir)

    // ปกสร้างจากภาพฉากแรก — ภาพที่คนเห็นก่อนกดควรตรงกับสิ่งที่คลิปเปิดเรื่อง
    const thumbnailPath = await makeThumbnail(db, video, images.paths[0], spec, workDir)

    const storagePath = `${video.org_id}/${video.id}.mp4`
    const { error: uploadError } = await db.storage
      .from('videos')
      .upload(storagePath, await readFile(outputPath), {
        contentType: 'video/mp4',
        upsert: true,
      })

    if (uploadError) throw new Error(`อัปไฟล์ขึ้น Storage ไม่สำเร็จ: ${uploadError.message}`)

    // ลิงก์บนสุด เนื้อหากลาง เครดิตช่างภาพท้ายสุด — YouTube ตัดคำอธิบายเหลือ
    // 2–3 บรรทัดแรก ลิงก์ที่อยู่ท้ายเท่ากับไม่มีลิงก์
    const description = buildDescription({
      cta: channel?.cta_template ?? null,
      chapters: chapterText(script.originality, scenes, audio.durations),
      body: video.description ?? null,
      credits: creditBlock(images.credits),
    })

    const ctaProblem = ctaWarning(channel?.cta_template ?? null)
    if (ctaProblem) console.warn(`[video_render] ${video.id} ⚠️ ${ctaProblem}`)

    await db
      .from('videos')
      .update({
        status: 'ready',
        storage_path: storagePath,
        thumbnail_path: thumbnailPath,
        description,
      })
      .eq('id', video.id)

    await track('render_completed', video.org_id, {
      format: video.format,
      scenes: scenes.length,
      // เก็บจำนวนช่วงไว้ดูว่าการแบ่งเกิดขึ้นจริงบ่อยแค่ไหน และคุ้มกับรอยต่อที่เสียไปไหม
      chunks: chunks.length,
      shots: shots.length,
      seconds: totalSeconds,
      images: images.paths.length,
    })

    console.log(`[video_render] ${video.id} เสร็จ → ${storagePath}`)
  } catch (error) {
    await db.from('videos').update({ status: 'failed' }).eq('id', video.id)
    await track('render_failed', video.org_id, {
      scenes: scenes.length,
      // ข้อความ error เป็นของเราเอง ไม่ใช่ข้อมูลผู้ใช้ — ตัดสั้นกันโควตา property
      reason: String((error as Error).message).slice(0, 120),
    })
    throw error
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

type CollectedImages = {
  paths: string[]
  credits: { photographer: string; sourceUrl: string }[]
}

/**
 * หาภาพ "ใบละช็อต" ไม่ใช่ใบละฉาก
 *
 * `video_assets.scene_index` เก็บ "ฉากแรกของช็อต" ต่อไป ไม่ใช่ดัชนีช็อต —
 * ตั้งใจ เพราะเป็นเลขที่ยังชี้กลับไปหาฉากจริงได้ และของเดิมที่บันทึกไว้แล้ว
 * (ตอนที่ช็อตละฉาก) ยังใช้ต่อได้โดยไม่ต้องย้ายข้อมูล
 */
async function collectImages(
  db: WorkerClient,
  video: { id: string; org_id: string; title: string },
  scenes: Scene[],
  shots: Shot[],
  niche: string | null,
  workDir: string,
  /** คลิปแนวตั้งต้องขอภาพแนวตั้ง ไม่งั้น crop ทิ้งเกือบทั้งภาพ */
  orientation: 'landscape' | 'portrait',
  minSize: { minWidth: number; minHeight: number },
): Promise<CollectedImages> {
  // ภาพที่เคยหาไว้แล้วจากรอบก่อน — retry ไม่ต้องเผาโควตา Pexels ซ้ำ
  const { data: existing } = await db
    .from('video_assets')
    .select('scene_index, provider_id, photographer, photographer_url, source_url, query')
    .eq('video_id', video.id)

  const known = new Map((existing ?? []).map((row) => [row.scene_index, row]))

  /**
   * หนึ่งช็อตต่อหนึ่งภาพ — คำค้นต้องมาจากข้อความของทุกฉากในช็อต ไม่ใช่ฉากแรกฉากเดียว
   * เพราะภาพใบนี้ต้องอยู่ให้ครบทั้งช็อต (นานถึงหนึ่งนาทีในคลิปยาวพิเศษ)
   */
  const shotScenes = shots.map((shot) => ({
    index: scenes[shot.start].index,
    text: shotText(scenes, shot),
  }))

  const missing = shotScenes.filter((shot) => !known.has(shot.index))
  const queries = new Map<number, string>()

  if (missing.length > 0) {
    const generated = await sceneImageQueries(missing, { title: video.title, niche })
    for (const item of generated) queries.set(item.sceneIndex, item.query)
  }

  const paths: string[] = []
  const credits: CollectedImages['credits'] = []
  const usedIds = new Set<number>((existing ?? []).map((row) => Number(row.provider_id)))

  for (const scene of shotScenes) {
    const cached = known.get(scene.index)
    const query = cached?.query ?? queries.get(scene.index) ?? 'abstract background'

    let photo: PexelsPhoto | null = null

    if (!cached) {
      const { photos } = await searchPhotos(query, { orientation })
      photo = pickPhoto(photos, { usedIds, ...minSize })

      if (!photo) {
        // คำค้นเฉพาะเกินไปจนไม่มีภาพผ่านเกณฑ์ — ถอยไปคำกว้างแทนที่จะล้มทั้งงาน
        const fallback = await searchPhotos(
          niche?.trim() ? 'business workplace' : 'abstract background',
          { orientation },
        )
        photo = pickPhoto(fallback.photos, { usedIds, ...minSize })
      }

      if (!photo) throw new Error(`หาภาพให้ช็อตที่เริ่มฉาก ${scene.index} ไม่ได้ (คำค้น "${query}")`)
      usedIds.add(photo.id)

      const { error } = await db.from('video_assets').insert({
        org_id: video.org_id,
        video_id: video.id,
        scene_index: scene.index,
        provider: 'pexels',
        provider_id: String(photo.id),
        photographer: photo.photographer,
        photographer_url: photo.photographer_url,
        source_url: photo.url,
        query,
      })

      if (error) throw new Error(`บันทึกเครดิตภาพไม่สำเร็จ: ${error.message}`)
    }

    const sourceUrl = cached?.source_url ?? photo!.url
    const photographer = cached?.photographer ?? photo!.photographer
    credits.push({ photographer, sourceUrl })

    // ไฟล์อยู่ในไดเรกทอรีชั่วคราวที่ถูกลบทุกรอบ จึงต้องโหลดใหม่เสมอแม้จะเคยบันทึกไว้แล้ว
    const imagePath = join(workDir, `shot-${pad(scene.index)}.jpg`)
    const bytes = photo
      ? await downloadPhoto(photo)
      : await downloadFromSourceId(cached!.provider_id)
    await writeFile(imagePath, bytes)
    paths.push(imagePath)
  }

  return { paths, credits }
}

/** โหลดภาพซ้ำจาก id ที่บันทึกไว้ ใช้ตอน retry ที่ไฟล์ชั่วคราวหายไปแล้ว */
async function downloadFromSourceId(providerId: string): Promise<Uint8Array> {
  const response = await fetch(`https://api.pexels.com/v1/photos/${providerId}`, {
    headers: { Authorization: process.env.PEXELS_API_KEY ?? '' },
  })

  if (!response.ok) {
    throw new Error(`โหลดภาพ ${providerId} ซ้ำไม่สำเร็จ (${response.status})`)
  }

  const photo = (await response.json()) as PexelsPhoto
  return downloadPhoto(photo)
}

async function collectAudio(
  scenes: Scene[],
  workDir: string,
): Promise<{ paths: string[]; durations: number[] }> {
  const paths: string[] = []
  const durations: number[] = []

  for (const scene of scenes) {
    const { bytes, durationSec } = await synthesize(scene.text, { voice: voice() })
    const path = join(workDir, `scene-${scene.index}.wav`)
    await writeFile(path, bytes)

    paths.push(path)
    durations.push(durationSec)
  }

  return { paths, durations }
}

/**
 * สร้างปกแล้วอัปขึ้น Storage
 *
 * ล้มแล้วไม่ล้มทั้งงาน — คลิปที่ไม่มีปกยังใช้ได้ (YouTube สุ่มเฟรมให้)
 * แต่คลิปที่เรนเดอร์เสร็จแล้วต้องล้มเพราะทำปกไม่ได้ คือการทิ้งงานที่จ่ายเงินไปแล้ว
 */
async function makeThumbnail(
  db: WorkerClient,
  video: { id: string; org_id: string; title: string },
  firstImage: string | undefined,
  spec: { thumbnail: { width: number; height: number } },
  workDir: string,
): Promise<string | null> {
  if (!firstImage) return null

  try {
    const lines = thumbnailLines(video.title)
    if (lines.length === 0) return null

    const assPath = join(workDir, 'cover.ass')
    await writeFile(assPath, buildThumbnailAss(lines, spec.thumbnail), 'utf8')

    const coverPath = join(workDir, 'cover.jpg')
    await run(
      'ffmpeg',
      buildThumbnailCommand({
        imagePath: firstImage,
        assPath,
        outputPath: coverPath,
        size: spec.thumbnail,
      }),
      { timeout: 60_000 },
    )

    const path = `${video.org_id}/${video.id}.jpg`
    const { error } = await db.storage.from('videos').upload(path, await readFile(coverPath), {
      contentType: 'image/jpeg',
      upsert: true,
    })

    if (error) throw new Error(error.message)

    return path
  } catch (error) {
    console.warn(`[video_render] ${video.id} ทำปกไม่สำเร็จ (คลิปยังใช้ได้):`, error)
    return null
  }
}

/**
 * หมุดเวลาแยกบท จากหัวข้อย่อยที่ตอนเขียนสคริปต์วางไว้
 *
 * มีเฉพาะคลิปที่เขียนแบบวางโครงก่อน (format 'feature') — คลิปที่เขียนรวดเดียวไม่มีท่อน
 * ให้อ้างอิง จึงไม่มีหมุด ซึ่งถูกแล้ว: หมุดที่เดาเอาแย่กว่าไม่มีหมุด
 *
 * ล้มตรงนี้ต้องไม่ทำให้คลิปที่เรนเดอร์เสร็จแล้วพัง — คำอธิบายที่ขาดหมุดยังใช้ได้
 * แต่คลิปที่หายไปเพราะ JSON รูปแบบไม่ตรงคือเสียทั้งค่าเรนเดอร์
 */
function chapterText(
  originality: unknown,
  scenes: Scene[],
  durations: number[],
): string | null {
  const raw = (originality as { chapters?: unknown } | null)?.chapters
  if (!Array.isArray(raw) || raw.length === 0) return null

  const chapters = raw.filter(
    (item): item is { heading: string; chars: number } =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { heading?: unknown }).heading === 'string' &&
      typeof (item as { chars?: unknown }).chars === 'number',
  )

  if (chapters.length !== raw.length) {
    console.warn('[video_render] ข้อมูลหัวข้อย่อยไม่ครบ ข้ามการทำหมุดเวลา')
    return null
  }

  const seconds = sectionDurationsFromScenes(
    chapters.map((c) => c.chars),
    scenes.map((scene) => scene.charCount),
    durations,
  )

  return chapterBlock(chapterMarks(chapters.map((c) => c.heading), seconds))
}

/**
 * ต่อไฟล์ของทุกช่วงเป็นคลิปเดียว
 *
 * ช่วงเดียวไม่ต้องต่อ — คืนไฟล์นั้นไปเลย ประหยัดการอ่าน/เขียนทั้งไฟล์โดยไม่ได้อะไร
 * และทำให้คลิปสั้นเดินเส้นทางเดิมเป๊ะ ๆ
 */
async function concatChunks(chunkPaths: string[], workDir: string): Promise<string> {
  if (chunkPaths.length === 1) return chunkPaths[0]

  const listPath = join(workDir, 'chunks.txt')
  await writeFile(listPath, concatListFile(chunkPaths), 'utf8')

  const outputPath = join(workDir, 'out.mp4')
  // ต่อโดยไม่เข้ารหัสใหม่ — 45 นาทีเสร็จในไม่กี่วินาที จึงไม่ต้องใช้เพดานเวลาของการเรนเดอร์
  await run('ffmpeg', buildConcatCommand(listPath, outputPath), {
    timeout: FFMPEG_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  })

  return outputPath
}

/** เลขลำดับไฟล์ให้เรียงถูกตามชื่อ — chunk-10 ต้องไม่มาก่อน chunk-2 ตอนไล่ดูตอน debug */
function pad(index: number): string {
  return String(index).padStart(3, '0')
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000
}
