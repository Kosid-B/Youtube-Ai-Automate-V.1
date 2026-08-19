import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** ลิงก์มีอายุสั้นพอให้กดโหลด แต่ไม่นานพอที่จะหลุดไปแล้วยังใช้ได้ */
const LINK_TTL_SECONDS = 300

/**
 * ดาวน์โหลดคลิปที่เรนเดอร์เสร็จ
 *
 * ใช้ client ที่ผูก session ไม่ใช่ service client — policy ของ bucket ตรวจให้อยู่แล้วว่า
 * ผู้ใช้เป็นสมาชิกองค์กรเจ้าของไฟล์ไหม ถ้าใช้ service client จะข้ามการตรวจนั้นไปเลย
 * แล้วต้องมาเขียนตรวจเองซึ่งพลาดง่ายกว่า
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

  // RLS ของตาราง videos คัดให้แล้วว่าเห็นเฉพาะขององค์กรตัวเอง
  const { data: video } = await supabase
    .from('videos')
    .select('id, title, storage_path')
    .eq('id', id)
    .single()

  if (!video) {
    return NextResponse.json({ error: 'ไม่พบคลิปนี้' }, { status: 404 })
  }

  if (!video.storage_path) {
    return NextResponse.json({ error: 'คลิปนี้ยังเรนเดอร์ไม่เสร็จ' }, { status: 409 })
  }

  const { data: signed, error } = await supabase.storage
    .from('videos')
    .createSignedUrl(video.storage_path, LINK_TTL_SECONDS, {
      // ตั้งชื่อไฟล์ตอนโหลดเป็นชื่อคลิป ไม่ใช่ uuid ที่อ่านไม่รู้เรื่อง
      download: `${safeFileName(video.title)}.mp4`,
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
 * ชื่อคลิปเป็นภาษาไทยและมักมีอักขระที่ตั้งเป็นชื่อไฟล์ไม่ได้ (? : / " |)
 * ปล่อยไปดิบ ๆ แล้วเบราว์เซอร์บางตัวจะตัดชื่อทิ้งทั้งหมดเหลือแต่นามสกุล
 */
function safeFileName(title: string): string {
  return (
    title
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'video'
  )
}
