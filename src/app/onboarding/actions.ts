'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { slugify } from '@/lib/slug'

export type OnboardingState = { error: string | null }

/**
 * เปิดองค์กร + ช่องแรกในคลิกเดียว
 *
 * ผู้ใช้กรอกแค่สองช่อง ที่เหลือระบบจัดการ:
 * slug สร้างให้ · โควตา YouTube เลือก project ให้ตอนอัป · เครดิตเริ่มต้นเปิดจากฝั่ง server
 */
export async function createWorkspace(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const orgName = String(formData.get('org_name') ?? '').trim()
  const channelName = String(formData.get('channel_name') ?? '').trim()
  const niche = String(formData.get('niche') ?? '').trim()

  if (!orgName) return { error: 'ต้องตั้งชื่อธุรกิจหรือทีมของคุณ' }
  if (!channelName) return { error: 'ต้องตั้งชื่อช่องแรก' }

  const { data: org, error: orgError } = await supabase.rpc('create_org', {
    p_name: orgName,
    p_slug: slugify(orgName),
  })

  if (orgError || !org) {
    return { error: `เปิดพื้นที่ทำงานไม่สำเร็จ: ${orgError?.message ?? 'ไม่ทราบสาเหตุ'}` }
  }

  // ผู้ใช้เป็น owner แล้ว จึงเขียนช่องผ่าน client ที่ผูก session ได้เลย
  const { error: channelError } = await supabase.from('channels').insert({
    org_id: org.id,
    name: channelName,
    niche: niche || null,
  })

  if (channelError) {
    return { error: `สร้างช่องไม่สำเร็จ: ${channelError.message}` }
  }

  redirect('/')
}
