import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

type Client = SupabaseClient<Database>

/**
 * ต้นทุนโควตา YouTube Data API v3 (units)
 * เพดาน 10,000 units/วัน/project → videos.insert 1,600 = ~6 คลิป/project/วัน
 */
export const QUOTA_COST = {
  videosInsert: 1600,
  videosUpdate: 50,
  videosList: 1,
  searchList: 100,
  thumbnailsSet: 50,
} as const

/**
 * เพดานต่อวันต่อ project — อ่านตอนเรียก ไม่ใช่ตอนโหลดโมดูล
 *
 * ⚠️ เคยเป็น `const DAILY_QUOTA_LIMIT = Number(process.env...)` ระดับบนสุด
 * ซึ่งถูกตรึงตั้งแต่ ESM ประเมิน import คือ "ก่อน" loadEnv() ของ worker เสมอ
 * ผลคือค่าที่ตั้งใน .env.local ไม่เคยมีผล และไม่มีอะไรฟ้อง (ที่มาของ worker/env.ts)
 */
export function dailyQuotaLimit(): number {
  const raw = Number(process.env.YOUTUBE_QUOTA_DAILY_LIMIT)
  return Number.isFinite(raw) && raw > 0 ? raw : 10000
}

/**
 * จองโควตาก่อนยิง API จริงเสมอ — ห้ามยิงแล้วค่อยนับ
 * คืน false = โควตาไม่พอ ให้เลื่อน job ไปวันถัดไป (ห้าม retry ทันที
 * เพราะจะเผาโควตาของ project อื่นเปล่า ๆ)
 */
export async function reserveQuota(
  db: Client,
  projectKey: string,
  units: number,
): Promise<boolean> {
  const { data, error } = await db.rpc('reserve_quota', {
    p_project_key: projectKey,
    p_units: units,
    p_daily_limit: dailyQuotaLimit(),
  })

  if (error) throw new Error(`จองโควตาไม่สำเร็จ: ${error.message}`)
  return data === true
}

/**
 * จองโควตาให้ช่องหนึ่ง โดยระบบเลือก Google Cloud project ให้เอง
 *
 * คืน key ของ project ที่จองได้ (ต้องใช้ key นี้ตอนคืนโควตาถ้ายิงพลาด)
 * หรือ null ถ้าเต็มทุก project แล้ว
 *
 * ⚠️ โควตา YouTube ผูกกับ project ของ "แอป" ไม่ใช่ของช่องลูกค้า
 * ห้ามกลับไปผูก project ตายตัวกับช่อง ไม่งั้นลูกค้าทุกรายจะแย่งโควตาก้อนเดียวกัน
 */
export async function reserveQuotaForChannel(
  db: Client,
  channelId: string,
  units: number,
): Promise<string | null> {
  const { data, error } = await db.rpc('reserve_quota_for_channel', {
    p_channel_id: channelId,
    p_units: units,
  })

  if (error) throw new Error(`จองโควตาไม่สำเร็จ: ${error.message}`)
  return (data as string | null) ?? null
}

/** คืนโควตาที่จองไว้ เมื่อการเรียก API ล้มเหลวก่อนถึงตัวนับของ Google */
export async function releaseQuota(
  db: Client,
  projectKey: string,
  units: number,
): Promise<void> {
  const { error } = await db.rpc('release_quota', {
    p_project_key: projectKey,
    p_units: units,
  })
  if (error) throw new Error(`คืนโควตาไม่สำเร็จ: ${error.message}`)
}

/** เวลาที่โควตารอบถัดไปรีเซ็ต (เที่ยงคืนเวลาแปซิฟิก) ใช้ตั้ง run_after ตอนเลื่อนงาน */
export async function quotaResetsAt(db: Client): Promise<string> {
  const { data, error } = await db.rpc('quota_resets_at')
  if (error) throw new Error(`อ่านเวลารีเซ็ตโควตาไม่สำเร็จ: ${error.message}`)
  return data as string
}
