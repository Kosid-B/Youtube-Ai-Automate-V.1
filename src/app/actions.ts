'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type RequeueState = { error: string | null }

/**
 * เอางานที่ worker ตายคาไว้กลับเข้าคิว
 *
 * ใช้ client ที่ผูก session ไม่ใช่ service client — rpc ตรวจสิทธิ์ให้เองในตัว
 * และงานที่ตายถาวร (dead) จะถูกปฏิเสธจากฝั่งฐานข้อมูล ไม่ต้องเช็คซ้ำตรงนี้
 */
export async function requeueJob(_prev: RequeueState, formData: FormData): Promise<RequeueState> {
  const jobId = String(formData.get('jobId') ?? '')
  if (!jobId) return { error: 'ไม่มีรหัสงาน' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('requeue_stuck_job', { p_job_id: jobId })

  if (error) return { error: error.message }

  revalidatePath('/')
  return { error: null }
}
