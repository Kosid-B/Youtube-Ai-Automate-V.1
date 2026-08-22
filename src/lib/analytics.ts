/**
 * ส่งอีเวนต์เข้า Amplitude
 *
 * ใช้ HTTP API v2 ตรง ๆ ไม่ใช่ Browser SDK เพราะเหตุการณ์ที่มีความหมายของระบบนี้
 * เกิดใน worker (Node) แทบทั้งหมด — เขียนสคริปต์ เรนเดอร์ อัปโหลด งานตาย
 * Browser SDK จับอะไรพวกนี้ไม่ได้เลยเพราะไม่มีเบราว์เซอร์เปิดอยู่ตอนงานเดิน
 *
 * ไม่ลง SDK เพิ่มด้วย — endpoint เดียว payload ธรรมดา fetch พอ
 *
 * ⚠️ ห้ามใส่ import 'server-only' ในไฟล์นี้ — worker รันนอก Next.js จะพังทันที
 * (ทดสอบแล้ว: ERR_MODULE_NOT_FOUND) ไฟล์นี้ต้องใช้ได้ทั้งสองฝั่ง
 * ความปลอดภัยของคีย์อาศัยว่าไม่ได้ตั้งชื่อ env ขึ้นต้น NEXT_PUBLIC_ จึงไม่หลุดไปฝั่ง browser
 */

const ENDPOINT = 'https://api2.amplitude.com/2/httpapi'

/**
 * แยกอีเวนต์ของ yt-factory ออกจากผลิตภัณฑ์อื่นที่ใช้ Amplitude project เดียวกัน
 * ไม่มีตัวนี้ funnel กับ retention จะปนกันจนอ่านไม่ได้
 */
const PRODUCT = 'yt-factory'

export type AnalyticsEvent =
  // ── ฝั่งระบบ: ใช้เครื่องมือนี้แล้วติดตรงไหน ──
  | 'ideas_generated'
  | 'script_generated'
  | 'script_blocked'
  | 'render_started'
  | 'render_completed'
  | 'render_failed'
  | 'job_dead'
  // ── คลิปโฆษณาที่ผู้ให้บริการสร้างให้ (คนละสายกับ render ข้างบน) ──
  | 'ad_video_planned'
  | 'ad_video_requested'
  | 'ad_video_completed'
  | 'ad_video_failed'
  // ── ฝั่งผลงาน: คลิปที่ปล่อยออกไปได้ผลแค่ไหน ──
  | 'video_published'
  | 'video_metrics_synced'

export type EventProps = Record<string, string | number | boolean | null | undefined>

function apiKey(): string | null {
  return process.env.AMPLITUDE_API_KEY?.trim() || null
}

/**
 * ส่งอีเวนต์ — ห้าม throw และห้ามทำให้สายการผลิตช้าลง
 *
 * การวัดผลล้มไม่ใช่เหตุผลที่ควรทำให้คลิปเรนเดอร์ไม่สำเร็จ ทุก error จึงถูกกลืน
 * และแค่ log ไว้ · ไม่มีคีย์ = ไม่ทำอะไรเลย ไม่ error ไม่เตือน
 *
 * ⚠️ ห้ามส่งอีเมลหรือชื่อคนเข้ามา — ใช้ org_id / channel_id ที่เป็น uuid เท่านั้น
 */
export async function track(
  event: AnalyticsEvent,
  orgId: string,
  props: EventProps = {},
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const key = apiKey()
  if (!key) return

  try {
    await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        events: [
          {
            // องค์กรคือหน่วยที่มีความหมาย ไม่ใช่คน — ระบบนี้ทำงานโดยไม่มีคนนั่งดู
            user_id: orgId,
            event_type: event,
            time: Date.now(),
            event_properties: { ...props, product: PRODUCT },
          },
        ],
      }),
    })
  } catch (error) {
    console.warn(`[analytics] ส่ง ${event} ไม่สำเร็จ (ไม่กระทบงานหลัก):`, error)
  }
}

/** ส่งหลายอีเวนต์ในคำขอเดียว — ใช้ตอน sync ผลรายวันของหลายคลิปพร้อมกัน */
export async function trackBatch(
  events: { event: AnalyticsEvent; orgId: string; props?: EventProps }[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const key = apiKey()
  if (!key || events.length === 0) return

  try {
    await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        events: events.map((e) => ({
          user_id: e.orgId,
          event_type: e.event,
          time: Date.now(),
          event_properties: { ...e.props, product: PRODUCT },
        })),
      }),
    })
  } catch (error) {
    console.warn(`[analytics] ส่ง ${events.length} อีเวนต์ไม่สำเร็จ:`, error)
  }
}
