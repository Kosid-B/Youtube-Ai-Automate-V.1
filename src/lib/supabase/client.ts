'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/database.types'

/** client ฝั่ง browser — ผูก session ของผู้ใช้ RLS บังคับใช้ตามปกติ */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
