/**
 * ค้นและดาวน์โหลดภาพประกอบจาก Pexels
 *
 * ⚠️ เราแจ้ง Pexels ไว้ตอนขอ API key ว่าจะให้เครดิตช่างภาพในคำอธิบายใต้คลิปทุกคลิป
 * ทุกภาพที่ดาวน์โหลดจึงต้องเก็บชื่อช่างภาพและลิงก์หน้าภาพไว้เสมอ (ตาราง video_assets)
 * ห้ามใช้ภาพโดยไม่บันทึกเครดิต
 */

const SEARCH_ENDPOINT = 'https://api.pexels.com/v1/search'

/** โควตาเริ่มต้นของ Pexels — ใช้เตือนตัวเองใน log ไม่ได้บังคับอะไร */
export const RATE_LIMIT_PER_HOUR = 200

export type PexelsPhoto = {
  id: number
  width: number
  height: number
  /** หน้าภาพบนเว็บ Pexels — ใช้ในเครดิต */
  url: string
  photographer: string
  photographer_url: string
  alt: string | null
  src: {
    original: string
    large2x: string
    large: string
    medium: string
  }
}

export type SearchOptions = {
  perPage?: number
  /** ภาพแนวนอนเท่านั้น เพราะคลิปเป็น 16:9 */
  orientation?: 'landscape' | 'portrait' | 'square'
  /** ภาพเล็กกว่าเฟรมจะเบลอตอนซูม จึงขอ large ไว้ก่อน */
  size?: 'large' | 'medium' | 'small'
  locale?: string
}

export type SearchResult = {
  photos: PexelsPhoto[]
  /** จำนวนคำขอที่เหลือในชั่วโมงนี้ (null ถ้า Pexels ไม่ส่ง header มา) */
  remaining: number | null
}

function apiKey(): string {
  const key = process.env.PEXELS_API_KEY
  if (!key) throw new Error('ไม่ได้ตั้ง PEXELS_API_KEY')
  return key
}

export class PexelsRateLimitError extends Error {
  constructor(readonly resetAt: Date | null) {
    super('Pexels ปฏิเสธเพราะเกินโควตาต่อชั่วโมง')
    this.name = 'PexelsRateLimitError'
  }
}

export async function searchPhotos(
  query: string,
  options: SearchOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<SearchResult> {
  const trimmed = query.trim()
  if (!trimmed) throw new Error('คำค้นว่าง')

  const params = new URLSearchParams({
    query: trimmed,
    per_page: String(options.perPage ?? 10),
    orientation: options.orientation ?? 'landscape',
    size: options.size ?? 'large',
  })
  if (options.locale) params.set('locale', options.locale)

  const response = await fetchImpl(`${SEARCH_ENDPOINT}?${params}`, {
    headers: { Authorization: apiKey() },
  })

  if (response.status === 429) {
    const reset = response.headers.get('X-Ratelimit-Reset')
    // header เป็น unix timestamp หน่วยวินาที
    throw new PexelsRateLimitError(reset ? new Date(Number(reset) * 1000) : null)
  }

  if (!response.ok) {
    throw new Error(`ค้นภาพไม่สำเร็จ (${response.status}): ${await response.text()}`)
  }

  const body = (await response.json()) as { photos?: PexelsPhoto[] }
  const remainingHeader = response.headers.get('X-Ratelimit-Remaining')

  return {
    photos: body.photos ?? [],
    remaining: remainingHeader === null ? null : Number(remainingHeader),
  }
}

export type PickOptions = {
  /** ความกว้างขั้นต่ำที่ยอมรับ — เล็กกว่าเฟรมแล้วซูมจะเบลอ */
  minWidth?: number
  /** id ของภาพที่ใช้ไปแล้วในคลิปนี้ ห้ามหยิบซ้ำ */
  usedIds?: ReadonlySet<number>
}

/**
 * เลือกภาพที่ดีที่สุดจากผลค้นหา
 *
 * ไม่หยิบตัวแรกดื้อ ๆ เพราะ:
 * - ภาพเล็กกว่าเฟรมจะเบลอเมื่อโดน Ken Burns ซูมเข้า
 * - ภาพซ้ำในคลิปเดียวกันทำให้คนดูรู้สึกว่าเป็นคลิปทำมาส่ง ๆ
 * คืน null ถ้าไม่มีภาพไหนผ่านเกณฑ์ ให้ผู้เรียกตัดสินใจว่าจะค้นคำอื่นหรือยอมใช้ภาพสำรอง
 */
export function pickPhoto(
  photos: readonly PexelsPhoto[],
  options: PickOptions = {},
): PexelsPhoto | null {
  const minWidth = options.minWidth ?? 1920
  const used = options.usedIds ?? new Set<number>()

  const candidates = photos.filter((p) => !used.has(p.id) && p.width >= minWidth)
  if (candidates.length === 0) return null

  // Pexels เรียงตามความเกี่ยวข้องอยู่แล้ว จึงคงลำดับไว้ แค่คัดตัวที่ใช้ไม่ได้ออก
  return candidates[0]
}

/** URL ของไฟล์ที่จะโหลดมาใช้จริง — large2x กว้างราว 1880px พอสำหรับเฟรม 1080p */
export function downloadUrl(photo: PexelsPhoto): string {
  return photo.src.large2x || photo.src.original
}

export type PhotoCredit = {
  photographer: string
  sourceUrl: string
}

/** บรรทัดเครดิตหนึ่งภาพ ตามรูปแบบที่ Pexels แนะนำ */
export function creditLine(credit: PhotoCredit): string {
  return `Photo by ${credit.photographer} on Pexels: ${credit.sourceUrl}`
}

/**
 * บล็อกเครดิตสำหรับใส่ท้ายคำอธิบายคลิป
 *
 * ตัดช่างภาพซ้ำออก เพราะคลิปหนึ่งอาจใช้ภาพของคนเดียวกันหลายใบ
 * แต่ยังคงลิงก์แยกทุกภาพไว้ เพราะเครดิตต้องชี้กลับไปที่ "ภาพ" ไม่ใช่แค่ชื่อคน
 */
export function creditBlock(credits: readonly PhotoCredit[]): string {
  if (credits.length === 0) return ''

  const seen = new Set<string>()
  const lines: string[] = []

  for (const credit of credits) {
    if (seen.has(credit.sourceUrl)) continue
    seen.add(credit.sourceUrl)
    lines.push(creditLine(credit))
  }

  return ['ภาพประกอบจาก Pexels (pexels.com)', ...lines].join('\n')
}

export async function downloadPhoto(
  photo: PexelsPhoto,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const response = await fetchImpl(downloadUrl(photo))

  if (!response.ok) {
    throw new Error(`ดาวน์โหลดภาพ ${photo.id} ไม่สำเร็จ (${response.status})`)
  }

  return new Uint8Array(await response.arrayBuffer())
}
