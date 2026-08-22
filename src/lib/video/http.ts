/**
 * เครื่องมือเรียก HTTP ที่ adapter ทุกเจ้าใช้ร่วมกัน
 *
 * รวมไว้ที่เดียวเพราะทั้ง timeout, backoff และการแปลง error เป็นรหัสกลาง
 * เป็นเรื่องที่ต้องทำเหมือนกันทุกเจ้า · ปล่อยให้แต่ละ adapter เขียนเองแล้ว
 * เจ้าหนึ่งจะลืม timeout อีกเจ้าจะ retry สิ่งที่ retry ไม่ได้ โดยไม่มีอะไรฟ้อง
 */
import { VideoProviderError, type VideoErrorCode, type VideoProviderId } from '@/lib/video/types'

/**
 * รอผู้ให้บริการนานสุดต่อหนึ่งคำขอ — งานสร้างเป็น async อยู่แล้ว คำขอเดียวไม่ควรนาน
 *
 * ⚠️ อ่าน env ตอนเรียก ไม่ใช่ตอนโหลดโมดูล
 * `const X = Number(process.env...)` ระดับบนสุดจะถูกตรึงตั้งแต่ ESM ประเมิน import
 * ซึ่งเกิดก่อน loadEnv() เสมอ · กับดักนี้กัดมาสามรอบแล้วในโปรเจคนี้
 * (worker/env.ts, video/router.ts และรอบนี้เจอตอนเทสต์ timeout ค้าง 30 วินาที
 * ทั้งที่ตั้ง VIDEO_REQUEST_TIMEOUT_MS=150 ไว้แล้ว)
 */
export function requestTimeoutMs(): number {
  const raw = Number(process.env.VIDEO_REQUEST_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000
}

/** จำนวนครั้งที่ลองใหม่สำหรับข้อผิดพลาดที่ลองแล้วมีโอกาสสำเร็จ */
export const MAX_RETRIES = 3

/**
 * แปลงสถานะ HTTP เป็นรหัสกลาง
 *
 * ตัดสินจากสถานะ ไม่ใช่จากข้อความ — ข้อความของแต่ละเจ้าต่างกันและเปลี่ยนได้ตลอด
 * แมตช์ข้อความคือบั๊กที่รอเกิดในวันที่เขาแก้คำ
 */
export function codeFromStatus(status: number): VideoErrorCode {
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limit'
  if (status === 400 || status === 422) return 'invalid_input'
  if (status >= 500) return 'provider'
  return 'unknown'
}

export type FetchJsonOptions = {
  providerId: VideoProviderId
  method?: string
  headers?: Record<string, string>
  body?: unknown
  fetchImpl?: typeof fetch
  /** ปิด retry สำหรับคำขอที่ทำซ้ำแล้วเสียเงินซ้ำ (เช่นการเริ่มงานใหม่) */
  retry?: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * ยิงคำขอพร้อม timeout และ backoff ทวีคูณ
 *
 * ⚠️ retry ต้องปิดสำหรับคำขอที่ "เริ่มงานใหม่" — คำขอนั้นไม่ idempotent
 * ลองใหม่หลัง timeout อาจได้งานสองงานที่คิดเงินสองรอบ โดยเรารู้จัก id แค่อันเดียว
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions): Promise<T> {
  const doFetch = options.fetchImpl ?? fetch
  const allowRetry = options.retry ?? false

  let lastError: VideoProviderError | null = null

  for (let attempt = 0; attempt <= (allowRetry ? MAX_RETRIES : 0); attempt += 1) {
    if (attempt > 0) {
      // 1s, 2s, 4s — พอให้ rate limit คลายโดยไม่ทำให้ผู้ใช้รอเป็นนาที
      await sleep(2 ** (attempt - 1) * 1000)
    }

    const timeoutMs = requestTimeoutMs()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await doFetch(url, {
        method: options.method ?? 'GET',
        headers: options.headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const code = codeFromStatus(response.status)
        // ตัดข้อความให้สั้น — คำตอบ error บางเจ้ายาวเป็นหน้าและอาจมีข้อมูลคำขอติดมา
        const detail = (await response.text().catch(() => '')).slice(0, 300)
        lastError = new VideoProviderError(
          code,
          `${options.providerId} ตอบ ${response.status}: ${detail}`,
          options.providerId,
          response.status,
        )

        if (!lastError.retryable) throw lastError
        continue
      }

      return (await response.json()) as T
    } catch (error) {
      if (error instanceof VideoProviderError) throw error

      const aborted = error instanceof Error && error.name === 'AbortError'
      lastError = new VideoProviderError(
        aborted ? 'timeout' : 'provider',
        aborted
          ? `${options.providerId} ไม่ตอบใน ${timeoutMs / 1000} วินาที`
          : `ต่อ ${options.providerId} ไม่ได้: ${error instanceof Error ? error.message : String(error)}`,
        options.providerId,
      )
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError ?? new VideoProviderError('unknown', 'ไม่ทราบสาเหตุ', options.providerId)
}

/** โหลดไฟล์ไบนารี — แยกจาก fetchJson เพราะคำตอบไม่ใช่ JSON */
export async function fetchBytes(
  url: string,
  options: { providerId: VideoProviderId; headers?: Record<string, string>; fetchImpl?: typeof fetch },
): Promise<Uint8Array> {
  const doFetch = options.fetchImpl ?? fetch
  const controller = new AbortController()
  // โหลดไฟล์วิดีโอนานกว่าคำขอ JSON มาก จึงให้เวลามากกว่าสี่เท่า
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs() * 4)

  try {
    const response = await doFetch(url, { headers: options.headers, signal: controller.signal })

    if (!response.ok) {
      throw new VideoProviderError(
        codeFromStatus(response.status),
        `โหลดวิดีโอไม่สำเร็จ (${response.status})`,
        options.providerId,
        response.status,
      )
    }

    return new Uint8Array(await response.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}
