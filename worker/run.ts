import { createWorkerClient, type WorkerClient } from './supabase'
import {
  claimJob,
  completeJob,
  deferJob,
  DeferJobSignal,
  type JobPayloads,
} from '@/lib/jobs'
import { JOB_COST, grantCredits } from '@/lib/credits'
import type { JobKind, JobRow } from '@/lib/database.types'
import { scriptGenerate } from './handlers/script-generate'
import { videoRender } from './handlers/video-render'
import { youtubeUpload } from './handlers/youtube-upload'
import { metricsSync } from './handlers/metrics-sync'

const WORKER_ID = process.env.WORKER_ID ?? `worker-${process.pid}`
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 2000)

type Handler<K extends JobKind> = (db: WorkerClient, payload: JobPayloads[K]) => Promise<void>

const HANDLERS: { [K in JobKind]: Handler<K> } = {
  script_generate: scriptGenerate,
  video_render: videoRender,
  youtube_upload: youtubeUpload,
  metrics_sync: metricsSync,
}

let running = true

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * งานตายถาวร → คืนเครดิตที่ตัดไปตอนเข้าคิว
 * grant_credits กันการคืนซ้ำด้วย ref_id ฝั่งฐานข้อมูล จึงเรียกซ้ำได้ปลอดภัย
 */
async function refundDeadJob(db: WorkerClient, job: JobRow): Promise<void> {
  const cost = JOB_COST[job.kind]
  if (cost <= 0) return

  try {
    await grantCredits(db, job.org_id, cost, 'refund:job_dead', job.id)
    console.log(`[worker] คืนเครดิต ${cost} ให้ org ${job.org_id} (งาน ${job.id} ตายถาวร)`)
  } catch (error) {
    // คืนไม่สำเร็จไม่ควรทำให้ worker ตาย — log ไว้ให้ตามเก็บ
    console.error(`[worker] คืนเครดิตงาน ${job.id} ไม่สำเร็จ:`, error)
  }
}

async function runJob(db: WorkerClient, job: JobRow): Promise<void> {
  const handler = HANDLERS[job.kind] as Handler<JobKind> | undefined

  if (!handler) {
    await completeJob(db, job.id, false, `ไม่รู้จักงานชนิด ${job.kind}`)
    return
  }

  try {
    await handler(db, job.payload as JobPayloads[JobKind])
    await completeJob(db, job.id, true)
  } catch (error) {
    // โควตาเต็ม ฯลฯ — ไม่ใช่ความล้มเหลวของงาน เลื่อนไปรอบถัดไปแทน
    if (error instanceof DeferJobSignal) {
      await deferJob(db, job.id, error.runAfter, error.detail)
      console.log(`[worker] เลื่อนงาน ${job.id} ไป ${error.runAfter} — ${error.detail}`)
      return
    }

    const message = error instanceof Error ? error.message : String(error)
    console.error(`[worker] งาน ${job.id} (${job.kind}) ล้มเหลว:`, message)

    const closed = await completeJob(db, job.id, false, message)
    if (closed.status === 'dead') {
      await refundDeadJob(db, closed)
    }
  }
}

async function main(): Promise<void> {
  const db = createWorkerClient()
  console.log(`[worker] ${WORKER_ID} เริ่มทำงาน (poll ทุก ${POLL_INTERVAL_MS}ms)`)

  while (running) {
    let job: JobRow | null = null

    try {
      job = await claimJob(db, WORKER_ID)
    } catch (error) {
      console.error('[worker] ดึงงานไม่สำเร็จ:', error)
      await sleep(POLL_INTERVAL_MS)
      continue
    }

    if (!job) {
      await sleep(POLL_INTERVAL_MS)
      continue
    }

    console.log(`[worker] รับงาน ${job.id} (${job.kind}) ครั้งที่ ${job.attempts}`)

    // งานที่ถูก claim แล้วต้องถูกปิดเสมอ — runJob จับ error ครบทุกทางแล้ว
    await runJob(db, job)
  }

  console.log('[worker] หยุดแล้ว')
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (!running) process.exit(1)
    console.log(`[worker] ได้รับ ${signal} — จะหยุดหลังงานปัจจุบันจบ (กดซ้ำเพื่อบังคับออก)`)
    running = false
  })
}

main().catch((error) => {
  console.error('[worker] ตายเพราะ:', error)
  process.exit(1)
})
