/**
 * สัญญาที่ผู้ให้บริการวิดีโอทุกเจ้าต้องทำตาม
 *
 * ⚠️ ข้อที่ต่างจาก provider layer อื่นในโปรเจคนี้ (llm/tts/image):
 * งานสร้างวิดีโอเป็น "งานยาว" ไม่ใช่ request-response — เรียกแล้วได้ id กลับมา
 * ต้องถามสถานะเป็นระยะจนเสร็จ (นาที ไม่ใช่วินาที) จึงแยก generate กับ getStatus
 * เขียนเป็นฟังก์ชันเดียวที่รอจนเสร็จจะค้าง worker ทั้งตัว และ retry ทีไรก็เสียเงิน
 * สร้างใหม่ทุกครั้งเพราะไม่มี id ให้กลับไปถาม
 */
import type {
  GenerateVideoInput,
  StartedJob,
  VideoJobState,
  VideoProviderId,
} from '@/lib/video/types'

export interface VideoProvider {
  readonly id: VideoProviderId

  /** ความยาวสูงสุดต่อการเรียกหนึ่งครั้ง — เกินนี้ต้องสร้างหลายท่อนแล้วต่อกัน */
  readonly maxSeconds: number

  /** ยกเลิกกลางคันได้ไหม — ไม่ใช่ทุกเจ้าที่รองรับ */
  readonly supportsCancel: boolean

  /** ชื่อรุ่นที่จะใช้กับระดับคุณภาพนี้ — เก็บลงฐานข้อมูลไว้ตามรอยทีหลัง */
  modelFor(tier: GenerateVideoInput['tier']): string

  /**
   * ราคาโดยประมาณ "ก่อน" เรียก — ต้องคำนวณได้โดยไม่ต้องยิงเน็ต
   * เพราะด่านคุมงบต้องตัดสินก่อนที่เงินจะออก ไม่ใช่หลังจากนั้น
   * โยน VideoProviderError('invalid_input') เมื่อไม่รู้ราคา — ไม่รู้ราคา = ไม่ให้ใช้
   */
  estimateCostUsd(input: GenerateVideoInput): number

  /** เริ่มงาน คืน id ของฝั่งผู้ให้บริการไว้ถามสถานะทีหลัง */
  generate(input: GenerateVideoInput): Promise<StartedJob>

  /** ถามสถานะ — ปลอดภัยที่จะเรียกซ้ำ ไม่มีค่าใช้จ่ายเพิ่ม */
  getStatus(providerJobId: string): Promise<VideoJobState>

  /** ยกเลิก — เรียกได้เฉพาะเจ้าที่ supportsCancel = true */
  cancel?(providerJobId: string): Promise<void>

  /** โหลดไฟล์วิดีโอจากลิงก์ที่ getStatus คืนมา */
  getResult(outputUrl: string): Promise<Uint8Array>
}
