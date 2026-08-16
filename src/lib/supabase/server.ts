// import นี้ทำให้ build พังทันทีถ้ามีไฟล์ "use client" มาเรียก — ตั้งใจให้เป็นแบบนั้น
import 'server-only'

import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

/**
 * client ที่ผูก session ของผู้ใช้ — RLS บังคับใช้
 * ใช้ตัวนี้ "ตรวจสิทธิ์ก่อนเสมอ" แล้วค่อยเรียก createServiceClient() ทำงานจริง
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // เรียกจาก Server Component — refresh session ทำใน middleware แทน
          }
        },
      },
    },
  )
}

/**
 * ⚠️ ข้าม RLS ทั้งหมด
 * ใช้ได้เฉพาะใน worker/ กับ route handler ฝั่ง server และต้องตรวจสิทธิ์ผู้ใช้มาก่อนแล้ว
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error('ไม่ได้ตั้ง SUPABASE_SERVICE_ROLE_KEY')
  }

  return createSupabaseClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
