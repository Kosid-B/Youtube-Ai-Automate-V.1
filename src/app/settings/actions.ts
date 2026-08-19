'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ctaWarning } from '@/lib/description'

export type SettingsState = { error: string | null; ok: string | null }

/**
 * เพดานการเติมต่อครั้ง
 *
 * เครดิตมีไว้กันค่า API บานปลาย ถ้าเติมทีละล้านได้ก็ไม่เหลือความหมาย
 * เลขนี้พอสำหรับ ~140 คลิป มากกว่าที่ผลิตได้ในเดือนหนึ่งอยู่แล้ว
 */
const MAX_TOP_UP = 1000

async function ownerOrgId(): Promise<{ orgId: string } | { error: string }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: 'ต้องเข้าสู่ระบบก่อน' }

  // RLS คัดให้เห็นเฉพาะองค์กรที่ตัวเองเป็นสมาชิก · ตรวจ role ซ้ำอีกชั้นตรงนี้
  const { data: membership } = await supabase
    .from('org_members')
    .select('org_id, role')
    .in('role', ['owner', 'admin'])
    .limit(1)
    .maybeSingle()

  if (!membership) return { error: 'ต้องเป็นเจ้าของหรือแอดมินขององค์กร' }
  return { orgId: membership.org_id }
}

/** ตั้งเป้าจำนวนคลิปต่อเดือน — ตัวหารของแถบความคืบหน้าบนหน้าแรก */
export async function saveTarget(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const found = await ownerOrgId()
  if ('error' in found) return { error: found.error, ok: null }

  const target = Number(formData.get('target'))

  if (!Number.isInteger(target) || target < 1 || target > 500) {
    return { error: 'ใส่จำนวนเต็ม 1–500', ok: null }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('organizations')
    .update({ monthly_target: target })
    .eq('id', found.orgId)

  if (error) return { error: error.message, ok: null }

  revalidatePath('/')
  revalidatePath('/settings')
  return { error: null, ok: `ตั้งเป้าเป็น ${target} คลิปต่อเดือนแล้ว` }
}

/**
 * เติมเครดิตให้องค์กรตัวเอง
 *
 * ต้องใช้ service client เพราะ grant_credits เปิดให้ service_role เท่านั้น
 * (ตารางมี trigger กันการแก้ credits ตรง ๆ อยู่แล้ว) — ตรวจสิทธิ์ด้วย client ที่ผูก
 * session ก่อนเสมอ แล้วค่อยให้ service client ลงมือ
 */
export async function topUpCredits(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const found = await ownerOrgId()
  if ('error' in found) return { error: found.error, ok: null }

  const amount = Number(formData.get('amount'))

  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_TOP_UP) {
    return { error: `ใส่จำนวนเต็ม 1–${MAX_TOP_UP}`, ok: null }
  }

  const admin = createServiceClient()
  const { error } = await admin.rpc('grant_credits', {
    p_org_id: found.orgId,
    p_amount: amount,
    p_reason: 'เติมเองจากหน้าตั้งค่า',
  })

  if (error) return { error: error.message, ok: null }

  revalidatePath('/')
  revalidatePath('/settings')
  return { error: null, ok: `เติม ${amount} เครดิตแล้ว` }
}

/**
 * ตั้งข้อความชวนคลิก + ลิงก์ของช่อง
 *
 * ไม่ตรวจเนื้อความให้ นอกจากเตือนเรื่องตำแหน่งลิงก์ — ข้อความเป็นการตัดสินใจ
 * ทางการตลาดของเจ้าของ ระบบมีหน้าที่ทำให้มันไปโผล่ถูกที่เท่านั้น
 */
export async function saveCta(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const channelId = String(formData.get('channelId') ?? '')
  const cta = String(formData.get('cta') ?? '')

  if (!channelId) return { error: 'ไม่มีรหัสช่อง', ok: null }

  const supabase = await createClient()
  const { error } = await supabase.rpc('set_channel_cta', {
    p_channel_id: channelId,
    p_cta: cta,
  })

  if (error) return { error: error.message, ok: null }

  revalidatePath('/settings')

  const warning = ctaWarning(cta)
  return warning
    ? { error: null, ok: `บันทึกแล้ว · ⚠️ ${warning}` }
    : { error: null, ok: 'บันทึกแล้ว — ลิงก์จะอยู่บนสุดของคำอธิบายทุกคลิป' }
}
