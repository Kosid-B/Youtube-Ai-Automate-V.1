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

export const DAILY_QUOTA_LIMIT = Number(process.env.YOUTUBE_QUOTA_DAILY_LIMIT ?? 10000)

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
    p_daily_limit: DAILY_QUOTA_LIMIT,
  })

  if (error) throw new Error(`จองโควตาไม่สำเร็จ: ${error.message}`)
  return data === true
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
