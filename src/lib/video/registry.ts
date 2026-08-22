/**
 * ทะเบียนผู้ให้บริการ
 *
 * เพิ่มเจ้าใหม่ = เขียน adapter + ใส่หนึ่งบรรทัดตรงนี้ · ไม่ต้องแตะ router,
 * orchestrator, ฐานข้อมูล หรือ UI เลย นั่นคือเหตุผลทั้งหมดที่แยกชั้นนี้ออกมา
 *
 * ⚠️ "ไม่มีคีย์ = ไม่มีอยู่" ไม่ใช่ error — ระบบต้องเดินได้แม้ต่อไว้เจ้าเดียว
 * และต้องเดินได้เมื่อไม่ต่อเลย (ฟีเจอร์ปิด ไม่ใช่แอปพัง)
 */
import type { VideoProvider } from '@/lib/video/provider'
import type { VideoProviderId } from '@/lib/video/types'
import { createVeoProvider } from '@/lib/video/providers/veo/adapter'
import { createRunwayProvider } from '@/lib/video/providers/runway/adapter'

type Entry = {
  id: VideoProviderId
  /** ตั้งคีย์ครบพอจะเรียกได้หรือยัง — ตรวจจาก env ไม่ใช่จากการยิงเน็ต */
  configured: () => boolean
  create: (fetchImpl?: typeof fetch) => VideoProvider
}

const ENTRIES: Entry[] = [
  {
    id: 'veo',
    configured: () => Boolean(process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY),
    create: createVeoProvider,
  },
  {
    id: 'runway',
    configured: () => Boolean(process.env.RUNWAY_API_KEY),
    create: createRunwayProvider,
  },
  /**
   * ที่ว่างสำหรับ OpenAI — ยังไม่มี adapter โดยตั้งใจ
   *
   * OpenAI ประกาศเลิก Videos API + sora-2 + sora-2-pro วันที่ 24 ก.ย. 2569
   * เขียน adapter ตอนนี้คือเขียนโค้ดที่ตายก่อนได้ใช้
   *
   * วันที่เขาออก API วิดีโอรุ่นใหม่ ให้ทำแค่นี้:
   *   1. src/lib/video/providers/openai/{adapter,types}.ts
   *      export function createOpenAiProvider(): VideoProvider
   *   2. เพิ่มหนึ่งรายการในลิสต์นี้
   * ไม่ต้องแตะ router, orchestrator, ฐานข้อมูล, API หรือ UI เลยสักบรรทัด
   */
]

/** เจ้าที่ตั้งคีย์ไว้แล้วเท่านั้น */
export function availableProviders(fetchImpl?: typeof fetch): VideoProvider[] {
  return ENTRIES.filter((entry) => entry.configured()).map((entry) => entry.create(fetchImpl))
}

/** หาเจ้าที่ระบุ — คืน null เมื่อยังไม่ได้ตั้งคีย์ ให้ผู้เรียกตัดสินใจว่าจะพังหรือถอย */
export function getProvider(id: VideoProviderId, fetchImpl?: typeof fetch): VideoProvider | null {
  const entry = ENTRIES.find((item) => item.id === id && item.configured())
  return entry ? entry.create(fetchImpl) : null
}

/** ไอดีของทุกเจ้าที่ระบบรู้จัก (ไม่ว่าจะตั้งคีย์แล้วหรือยัง) — ใช้ตอนตรวจค่าที่ผู้ใช้ส่งมา */
export function knownProviderIds(): VideoProviderId[] {
  return ENTRIES.map((entry) => entry.id)
}
