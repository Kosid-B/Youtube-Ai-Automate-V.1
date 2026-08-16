import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * ปลายทางของลิงก์ที่ส่งไปทางอีเมล — แลกโค้ดเป็น session แล้วพาเข้าแอป
 * ต้องเป็น route handler เพราะ Server Component เขียนคุกกี้ไม่ได้
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/'

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', url.origin))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    // ลิงก์หมดอายุหรือถูกใช้ไปแล้ว — ส่งกลับไปขอลิงก์ใหม่
    return NextResponse.redirect(new URL('/login?error=expired', url.origin))
  }

  return NextResponse.redirect(new URL(next, url.origin))
}
