import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

/**
 * worker ไม่มี session ผู้ใช้ จึงใช้ service role ตลอด
 * (แยกจาก src/lib/supabase/server.ts เพราะไฟล์นั้น import 'server-only' ซึ่งรันนอก Next ไม่ได้)
 */
export function createWorkerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) throw new Error('ไม่ได้ตั้ง NEXT_PUBLIC_SUPABASE_URL')
  if (!key) throw new Error('ไม่ได้ตั้ง SUPABASE_SERVICE_ROLE_KEY')

  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export type WorkerClient = ReturnType<typeof createWorkerClient>
