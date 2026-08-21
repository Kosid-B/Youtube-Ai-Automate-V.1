'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ctaWarning } from '@/lib/description'
import { hasNumber, proofProblems, type ProofPoint } from '@/lib/proof'

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

/**
 * ตั้งโทนการเล่า + หลักฐานที่ช่องอ้างได้
 *
 * สองอย่างนี้อยู่ฟอร์มเดียวกันโดยตั้งใจ — โทน "ชวนให้ลงมือ" เดินด้วยตัวเลข
 * ถ้าเลือกโทนนั้นแล้วไม่มีหลักฐาน ระบบจะสั่งโมเดลว่า "ห้ามพูดตัวเลขเลย"
 * ซึ่งได้คลิปที่จืดกว่าโทนธรรมดา · แยกฟอร์มกันแล้วผู้ใช้จะไม่เห็นความเชื่อมโยงนี้
 *
 * อัปเดตตรงผ่าน client ที่ผูก session ได้เลย — policy channels_write บังคับ
 * role owner/admin/editor อยู่แล้ว และ check constraint ฝั่งฐานข้อมูล
 * ตรวจรูปร่าง proof_points ซ้ำอีกชั้น (worker เขียนด้วย service role ซึ่งข้าม RLS)
 */
export async function saveStyle(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const channelId = String(formData.get('channelId') ?? '')
  if (!channelId) return { error: 'ไม่มีรหัสช่อง', ok: null }

  const style = formData.get('style') === 'direct' ? 'direct' : 'informative'

  // ฟอร์มส่งมาเป็นคู่ claim/source ตามลำดับ — ข้อที่เว้นว่างทั้งคู่คือช่องที่ไม่ได้กรอก
  const claims = formData.getAll('claim').map(String)
  const sources = formData.getAll('source').map(String)

  const points: ProofPoint[] = claims
    .map((claim, i) => ({ claim: claim.trim(), source: (sources[i] ?? '').trim() }))
    .filter((point) => point.claim || point.source)

  const problems = proofProblems(points)
  if (problems.length > 0) return { error: problems.join(' · '), ok: null }

  const supabase = await createClient()
  const { error } = await supabase
    .from('channels')
    .update({ script_style: style, proof_points: points })
    .eq('id', channelId)

  if (error) return { error: error.message, ok: null }

  revalidatePath('/settings')

  /**
   * เตือนเมื่อเลือกโทนที่ต้องใช้ตัวเลข แต่ไม่มีตัวเลขให้ใช้
   * ไม่ใช่ error เพราะเป็นการตั้งค่าที่ถูกต้อง แค่จะได้ผลไม่เต็มที่
   */
  if (style === 'direct' && !points.some((point) => hasNumber(point.claim))) {
    return {
      error: null,
      ok:
        'บันทึกแล้ว · ⚠️ ยังไม่มีหลักฐานที่เป็นตัวเลข — ระบบจะสั่งห้ามพูดตัวเลขในคลิป ' +
        'ซึ่งทำให้โทนนี้ได้ผลน้อยลง ใส่ผลงานจริงที่ตอบได้ว่ามาจากไหนจะช่วยได้มาก',
    }
  }

  return {
    error: null,
    ok: `บันทึกแล้ว — ใช้กับคลิปที่สั่งทำหลังจากนี้ (หลักฐาน ${points.length} ข้อ)`,
  }
}
