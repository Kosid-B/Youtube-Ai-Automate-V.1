import type { WorkerClient } from '../supabase'
import type { JobPayloads } from '@/lib/jobs'

/**
 * ดึง CTR / AVD / RPM จาก YouTube Analytics API ลง video_metrics
 *
 * ⚠️ ยังไม่ได้ทำ (งานค้างข้อ 4) — รอ OAuth flow (ข้อ 1) เพราะ Analytics API
 * ต้องใช้ token ของเจ้าของช่อง
 *
 * เมื่อทำจริง: upsert ด้วย unique (video_id, day) เพื่อให้ retry ไม่สร้างแถวซ้ำ
 * และใช้ YouTube Analytics API ซึ่งมีโควตาแยกจาก Data API v3
 *
 * จุดต่อ Amplitude อยู่ตรงนี้ด้วย — หลัง upsert สำเร็จให้เรียก trackBatch()
 * ส่ง 'video_metrics_synced' หนึ่งอีเวนต์ต่อคลิป พร้อม views/ctr/avd_seconds
 * ใช้ trackBatch ไม่ใช่ track ทีละตัว เพราะ sync รอบเดียวได้ผลของหลายคลิปพร้อมกัน
 * (ดู src/lib/analytics.ts — helper พร้อมและมีเทสแล้ว รอแค่ข้อมูลจริง)
 */
export async function metricsSync(
  _db: WorkerClient,
  payload: JobPayloads['metrics_sync'],
): Promise<void> {
  throw new Error(
    `ยังไม่ได้ทำ metrics_sync (ช่อง ${payload.channel_id}) — ดูงานค้างข้อ 4 ใน CLAUDE.md`,
  )
}
