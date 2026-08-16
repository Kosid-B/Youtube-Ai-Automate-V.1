import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type { WorkerClient } from '../supabase'
import type { JobPayloads } from '@/lib/jobs'
import { sceneImageQueries } from '@/lib/anthropic'
import { buildFfmpegCommand } from '@/lib/ffmpeg'
import { creditBlock, downloadPhoto, pickPhoto, searchPhotos, type PexelsPhoto } from '@/lib/pexels'
import { buildRenderPlan } from '@/lib/render-plan'
import { splitIntoScenes, type Scene } from '@/lib/scenes'
import { toSrt } from '@/lib/subtitles'
import { synthesize } from '@/lib/tts'

const run = promisify(execFile)

/** ffmpeg กินเวลานานกับคลิปยาว ตั้งเพดานไว้กันงานค้างทั้งคิว */
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
): Promise<void> {
  const { data: video } = await db
    .from('videos')
    .select('id, org_id, channel_id, title, storage_path, description')
    .eq('id', payload.video_id)
    .single()

  if (!video) throw new Error(`ไม่พบคลิป ${payload.video_id}`)

  if (video.storage_path) {
    console.log(`[video_render] ${video.id} มีไฟล์แล้ว ข้าม`)
    return
  }

  const { data: script } = await db
    .from('scripts')
    .select('id, body, title')
    .eq('id', payload.script_id)
    .single()

  if (!script?.body) throw new Error(`สคริปต์ ${payload.script_id} ยังไม่มีเนื้อหา`)

  const { data: channel } = await db
    .from('channels')
    .select('niche')
    .eq('id', video.channel_id)
    .single()

  const scenes = splitIntoScenes(script.body)
  if (scenes.length === 0) throw new Error('แบ่งฉากจากสคริปต์ไม่ได้')

  await db.from('videos').update({ status: 'rendering' }).eq('id', video.id)

  const workDir = await mkdtemp(join(tmpdir(), `ytf-${video.id}-`))

  try {
    const images = await collectImages(db, video, scenes, channel?.niche ?? null, workDir)
    const audio = await collectAudio(scenes, workDir)

    const plan = buildRenderPlan({
      scenes,
      durationsSec: audio.durations,
      imagePaths: images.paths,
      audioPaths: audio.paths,
    })

    const subtitlePath = join(workDir, 'subtitles.srt')
    await writeFile(subtitlePath, toSrt(plan.subtitles), 'utf8')

    const outputPath = join(workDir, 'out.mp4')
    const { args } = buildFfmpegCommand(plan, {
      subtitlePath,
      outputPath,
      ...subtitleStyle(),
    })

    console.log(`[video_render] ${video.id} เริ่มประกอบ ${scenes.length} ฉาก ${plan.totalSeconds}s`)
    await run('ffmpeg', args, { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 })

    const storagePath = `${video.org_id}/${video.id}.mp4`
    const { error: uploadError } = await db.storage
      .from('videos')
      .upload(storagePath, await readFile(outputPath), {
        contentType: 'video/mp4',
        upsert: true,
      })

    if (uploadError) throw new Error(`อัปไฟล์ขึ้น Storage ไม่สำเร็จ: ${uploadError.message}`)

    // เครดิตช่างภาพต่อท้ายคำอธิบาย — เราแจ้ง Pexels ไว้ว่าจะทำ
    const credits = creditBlock(images.credits)
    const description = [video.description?.trim(), credits].filter(Boolean).join('\n\n')

    await db
      .from('videos')
      .update({ status: 'ready', storage_path: storagePath, description })
      .eq('id', video.id)

    console.log(`[video_render] ${video.id} เสร็จ → ${storagePath}`)
  } catch (error) {
    await db.from('videos').update({ status: 'failed' }).eq('id', video.id)
    throw error
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

type CollectedImages = {
  paths: string[]
  credits: { photographer: string; sourceUrl: string }[]
}

async function collectImages(
  db: WorkerClient,
  video: { id: string; org_id: string; title: string },
  scenes: Scene[],
  niche: string | null,
  workDir: string,
): Promise<CollectedImages> {
  // ภาพที่เคยหาไว้แล้วจากรอบก่อน — retry ไม่ต้องเผาโควตา Pexels ซ้ำ
  const { data: existing } = await db
    .from('video_assets')
    .select('scene_index, provider_id, photographer, photographer_url, source_url, query')
    .eq('video_id', video.id)

  const known = new Map((existing ?? []).map((row) => [row.scene_index, row]))

  const missing = scenes.filter((scene) => !known.has(scene.index))
  const queries = new Map<number, string>()

  if (missing.length > 0) {
    const generated = await sceneImageQueries(missing, { title: video.title, niche })
    for (const item of generated) queries.set(item.sceneIndex, item.query)
  }

  const paths: string[] = []
  const credits: CollectedImages['credits'] = []
  const usedIds = new Set<number>((existing ?? []).map((row) => Number(row.provider_id)))

  for (const scene of scenes) {
    const cached = known.get(scene.index)
    const query = cached?.query ?? queries.get(scene.index) ?? 'abstract background'

    let photo: PexelsPhoto | null = null

    if (!cached) {
      const { photos } = await searchPhotos(query)
      photo = pickPhoto(photos, { usedIds })

      if (!photo) {
        // คำค้นเฉพาะเกินไปจนไม่มีภาพผ่านเกณฑ์ — ถอยไปคำกว้างแทนที่จะล้มทั้งงาน
        const fallback = await searchPhotos(niche?.trim() ? 'business workplace' : 'abstract background')
        photo = pickPhoto(fallback.photos, { usedIds })
      }

      if (!photo) throw new Error(`หาภาพให้ฉาก ${scene.index} ไม่ได้ (คำค้น "${query}")`)
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
    const imagePath = join(workDir, `scene-${scene.index}.jpg`)
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
