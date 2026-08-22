import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** ลิงก์มีอายุสั้นพอให้กดโหลด แต่ไม่นานพอที่จะหลุดไปแล้วยังใช้ได้ */
const LINK_TTL_SECONDS = 300

/**
 * ดาวน์โหลดคลิปโฆษณาที่สร้างเสร็จแล้ว
 *
 * ใช้ client ที่ผูก session ไม่ใช่ service client — policy ของ bucket ตรวจให้อยู่แล้วว่า
 * ผู้ใช้เป็นสมาชิกองค์กรเจ้าของไฟล์ไหม ถ้าใช้ service client จะข้ามการตรวจนั้นไปเลย
 * แล้วต้องมาเขียนตรวจเองซึ่งพลาดง่ายกว่า
 *
 * (เส้นทางนี้แยกจาก /api/videos/[id]/download ซึ่งเป็นของคลิปเล่าเรื่อง
 * คนละตาราง คนละบัคเก็ต คนละสินค้า)
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'ต้องเข้าสู่ระบบก่อน' }, { status: 401 })
  }

  // RLS ของ video_generations คัดให้แล้วว่าเห็นเฉพาะขององค์กรตัวเอง
  const { data: generation } = await supabase
    .from('video_generations')
    .select('id, prompt, status, output_storage_path')
    .eq('id', id)
    .maybeSingle()

  if (!generation) {
    return NextResponse.json({ error: 'ไม่พบคลิปนี้' }, { status: 404 })
  }

  if (!generation.output_storage_path) {
    return NextResponse.json(
      {
        error:
          generation.status === 'failed'
            ? 'คลิปนี้สร้างไม่สำเร็จ'
            : 'คลิปนี้ยังสร้างไม่เสร็จ',
      },
      { status: 409 },
    )
  }

  const { data: signed, error } = await supabase.storage
    .from('video-assets')
    .createSignedUrl(generation.output_storage_path, LINK_TTL_SECONDS, {
      download: `${safeFileName(generation.prompt)}.mp4`,
    })

  if (error || !signed) {
    return NextResponse.json(
      { error: `สร้างลิงก์ดาวน์โหลดไม่สำเร็จ: ${error?.message ?? 'ไม่ทราบสาเหตุ'}` },
      { status: 500 },
    )
  }

  return NextResponse.redirect(signed.signedUrl)
}

/**
 * ชื่อไฟล์ที่ Windows/macOS รับได้
 *
 * คำสั่งภาพเป็นภาษาไทยและมักมีอักขระที่ตั้งเป็นชื่อไฟล์ไม่ได้ (? : / " |)
 * ปล่อยไปดิบ ๆ แล้วเบราว์เซอร์บางตัวจะตัดชื่อทิ้งทั้งหมดเหลือแต่นามสกุล
 */
function safeFileName(prompt: string): string {
  return (
    prompt
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'ad-video'
  )
}
